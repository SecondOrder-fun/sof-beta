#!/usr/bin/env node
/**
 * backfill-positions.js
 *
 * Backfills `raffle_transactions` (and the materialized `user_raffle_positions`
 * view that derives from it) for every season that has a bonding curve.
 *
 * Why: positionUpdateListener has a block cursor and only scans from where it
 * last left off. If the listener was added to the deploy after PositionUpdate
 * events had already fired (e.g., a season from a prior session), those events
 * never make it into the DB and the UI shows empty Transactions / Holders.
 *
 * The listener's own `scanHistoricalPositionUpdateEvents` is private and only
 * runs at listener start time. This script provides a standalone backfill:
 * for each season, fetch all PositionUpdate logs from chain in chunks and
 * upsert them via `recordTransaction` (which is idempotent on tx_hash).
 *
 * Usage:
 *   cd packages/backend && NETWORK=TESTNET \
 *     node -r dotenv/config scripts/backfill-positions.js \
 *     dotenv_config_path=env/.env.testnet
 *
 * Optional: SEASON_ID=<n> to backfill a single season instead of all.
 */

import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { getPublicClient } from '../src/lib/viemClient.js';
import { getChainByKey } from '../src/config/chain.js';
import { getContractEventsInChunks } from '../src/lib/contractEventPolling.js';
import { raffleTransactionService } from '../src/services/raffleTransactionService.js';
import { RaffleABI, SOFBondingCurveABI } from '@sof/contracts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
config({ path: join(__dirname, '..', '.env') });

const NETWORK_KEY = process.env.NETWORK || 'LOCAL';
const SINGLE_SEASON_ID = process.env.SEASON_ID ? Number(process.env.SEASON_ID) : null;
const ZERO_ADDR = '0x0000000000000000000000000000000000000000';

async function backfillSeason(client, raffleAddress, seasonId) {
  console.log(`\n━━━ Season ${seasonId} ━━━`);

  let bondingCurve;
  try {
    const details = await client.readContract({
      address: raffleAddress,
      abi: RaffleABI,
      functionName: 'getSeasonDetails',
      args: [BigInt(seasonId)],
    });
    const cfg = details?.[0] ?? {};
    bondingCurve = cfg.bondingCurve ?? cfg[5] ?? null;
  } catch (err) {
    console.warn(`  getSeasonDetails(${seasonId}) failed: ${err.message}`);
    return { found: 0, recorded: 0, skipped: 0, failed: 0 };
  }

  if (!bondingCurve || bondingCurve.toLowerCase() === ZERO_ADDR) {
    console.log(`  no bonding curve — skipping`);
    return { found: 0, recorded: 0, skipped: 0, failed: 0 };
  }
  console.log(`  bonding curve: ${bondingCurve}`);

  const currentBlock = await client.getBlockNumber();
  console.log(`  scanning blocks 0..${currentBlock}`);

  let logs;
  try {
    logs = await getContractEventsInChunks({
      client,
      address: bondingCurve,
      abi: SOFBondingCurveABI,
      eventName: 'PositionUpdate',
      fromBlock: 0n,
      toBlock: currentBlock,
      maxBlockRange: 2_000n,
      maxRetries: 5,
    });
  } catch (err) {
    console.error(`  getLogs failed: ${err.message}`);
    return { found: 0, recorded: 0, skipped: 0, failed: 0 };
  }

  console.log(`  found ${logs.length} PositionUpdate log(s)`);

  let recorded = 0;
  let skipped = 0;
  let failed = 0;
  for (const log of logs) {
    const { seasonId: sid, player, oldTickets, newTickets } = log.args;
    const sidNum = typeof sid === 'bigint' ? Number(sid) : Number(sid);
    const oldNum = typeof oldTickets === 'bigint' ? Number(oldTickets) : Number(oldTickets);
    const newNum = typeof newTickets === 'bigint' ? Number(newTickets) : Number(newTickets);
    const ticketDelta = newNum - oldNum;
    const transactionType = ticketDelta > 0 ? 'BUY' : 'SELL';

    let block;
    try {
      block = await client.getBlock({ blockNumber: log.blockNumber });
    } catch (err) {
      console.warn(`    [tx ${log.transactionHash}] getBlock failed: ${err.message}`);
      failed++;
      continue;
    }

    try {
      const result = await raffleTransactionService.recordTransaction({
        seasonId: sidNum,
        userAddress: player,
        transactionType,
        ticketAmount: Math.abs(ticketDelta),
        sofAmount: 0, // not derivable from PositionUpdate alone
        txHash: log.transactionHash,
        blockNumber: Number(log.blockNumber),
        blockTimestamp: new Date(Number(block.timestamp) * 1000).toISOString(),
        ticketsBefore: oldNum,
        ticketsAfter: newNum,
      });
      if (result?.alreadyRecorded) skipped++; else recorded++;
    } catch (err) {
      console.warn(`    [tx ${log.transactionHash}] recordTransaction failed: ${err.message}`);
      failed++;
    }
  }

  // Refresh the materialized view that drives /api/raffle/holders/season/:id
  try {
    await raffleTransactionService.refreshUserPositions(seasonId);
    console.log(`  ✓ refreshed user_raffle_positions for season ${seasonId}`);
  } catch (err) {
    console.warn(`  refreshUserPositions(${seasonId}) failed: ${err.message}`);
  }

  console.log(`  done: recorded=${recorded} skipped=${skipped} failed=${failed}`);
  return { found: logs.length, recorded, skipped, failed };
}

async function main() {
  const chain = getChainByKey(NETWORK_KEY);
  if (!chain?.raffle) {
    console.error(`✗ No raffle address configured for network: ${NETWORK_KEY}`);
    process.exit(1);
  }

  console.log(`🔧 Backfilling raffle_transactions from chain`);
  console.log(`  Network:        ${NETWORK_KEY}`);
  console.log(`  Raffle address: ${chain.raffle}`);

  const client = getPublicClient(NETWORK_KEY);

  let seasonsToScan;
  if (SINGLE_SEASON_ID) {
    seasonsToScan = [SINGLE_SEASON_ID];
  } else {
    const currentSeasonId = await client.readContract({
      address: chain.raffle,
      abi: RaffleABI,
      functionName: 'currentSeasonId',
    });
    const total = Number(currentSeasonId);
    seasonsToScan = Array.from({ length: total }, (_, i) => i + 1);
  }
  console.log(`  Seasons to scan: ${seasonsToScan.join(', ')}\n`);

  let totalRecorded = 0;
  let totalSkipped = 0;
  let totalFailed = 0;
  for (const seasonId of seasonsToScan) {
    const { recorded, skipped, failed } = await backfillSeason(client, chain.raffle, seasonId);
    totalRecorded += recorded;
    totalSkipped += skipped;
    totalFailed += failed;
  }

  console.log(`\n✓ Done. recorded=${totalRecorded} skipped=${totalSkipped} failed=${totalFailed}`);
}

main().catch((err) => {
  console.error('✗ Backfill failed:', err);
  process.exit(1);
});
