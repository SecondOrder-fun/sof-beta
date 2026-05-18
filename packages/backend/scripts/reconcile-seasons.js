#!/usr/bin/env node
/**
 * reconcile-seasons.js
 *
 * One-off reconciliation: reads on-chain state for every season from the
 * Raffle contract and upserts both `season_contracts` and `curve_state`
 * tables.
 *
 * Use this when:
 *   - You've added the seasonStatusListener / extended schema after seasons
 *     already existed on-chain (the listener doesn't backfill curve_state)
 *   - You suspect listener block cursors drifted and rows are stale
 *
 * Usage:
 *   cd packages/backend && node -r dotenv/config scripts/reconcile-seasons.js
 *
 * Reads NETWORK from env. Reconciles seasons 1..currentSeasonId.
 */

import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { getPublicClient } from '../src/lib/viemClient.js';
import { getChainByKey } from '../src/config/chain.js';
import { db } from '../shared/supabaseClient.js';
import { RaffleABI, SOFBondingCurveABI } from '@sof/contracts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
config({ path: join(__dirname, '..', '.env') });

const NETWORK_KEY = process.env.NETWORK || 'LOCAL';
const ZERO_ADDR = '0x0000000000000000000000000000000000000000';

async function reconcileSeason(client, raffleAddress, seasonId) {
  const seasonIdNum = Number(seasonId);

  let details;
  try {
    details = await client.readContract({
      address: raffleAddress,
      abi: RaffleABI,
      functionName: 'getSeasonDetails',
      args: [BigInt(seasonIdNum)],
    });
  } catch (err) {
    console.warn(`  [season ${seasonIdNum}] getSeasonDetails failed: ${err.message}`);
    return { seasonContracts: false, curveState: false };
  }

  const cfg = details?.[0] ?? {};
  const status = details?.[1] != null ? Number(details[1]) : 0;
  const totalParticipants = details?.[2] != null ? details[2].toString() : '0';
  const totalTickets = details?.[3] != null ? details[3].toString() : '0';
  const totalPrizePool = details?.[4] != null ? details[4].toString() : '0';

  const bondingCurve = cfg.bondingCurve ?? cfg[5] ?? null;
  const raffleToken = cfg.raffleToken ?? cfg[6] ?? null;
  const name = cfg.name ?? cfg[0] ?? null;
  const startTime = cfg.startTime != null ? Number(cfg.startTime) : (cfg[1] != null ? Number(cfg[1]) : null);
  const endTime = cfg.endTime != null ? Number(cfg.endTime) : (cfg[2] != null ? Number(cfg[2]) : null);
  const winnerCount = cfg.winnerCount != null ? Number(cfg.winnerCount) : (cfg[3] != null ? Number(cfg[3]) : null);
  const grandPrizeBps = cfg.grandPrizeBps != null ? Number(cfg.grandPrizeBps) : (cfg[4] != null ? Number(cfg[4]) : null);
  const isActive = status === 1;

  const hasValidBondingCurve = bondingCurve && bondingCurve.toLowerCase() !== ZERO_ADDR;
  if (!hasValidBondingCurve) {
    console.log(`  [season ${seasonIdNum}] no bonding curve — skipping (status=${status}, name="${name ?? '∅'}")`);
    return { seasonContracts: false, curveState: false };
  }

  // ----- season_contracts upsert -----
  let seasonOk = false;
  try {
    await db.upsertSeasonContractRow(seasonIdNum, {
      bonding_curve_address: bondingCurve.toLowerCase(),
      raffle_token_address: raffleToken?.toLowerCase() ?? null,
      raffle_address: raffleAddress.toLowerCase(),
      is_active: isActive,
      name,
      start_time: startTime,
      end_time: endTime,
      winner_count: winnerCount,
      grand_prize_bps: grandPrizeBps,
      status,
      total_participants: totalParticipants,
      total_tickets: totalTickets,
      total_prize_pool: totalPrizePool,
    });
    seasonOk = true;
  } catch (err) {
    console.error(`  [season ${seasonIdNum}] season_contracts upsert failed: ${err.message}`);
  }

  // ----- curve_state upsert -----
  let curveOk = false;
  try {
    const results = await client.multicall({
      contracts: [
        { address: bondingCurve, abi: SOFBondingCurveABI, functionName: 'curveConfig' },
        { address: bondingCurve, abi: SOFBondingCurveABI, functionName: 'getCurrentStep' },
        { address: bondingCurve, abi: SOFBondingCurveABI, functionName: 'accumulatedFees' },
        { address: bondingCurve, abi: SOFBondingCurveABI, functionName: 'getBondSteps' },
        { address: bondingCurve, abi: SOFBondingCurveABI, functionName: 'treasuryAddress' },
      ],
      allowFailure: true,
    });

    const curveCfg = results[0]?.status === 'success' ? results[0].result : null;
    const currentStep = results[1]?.status === 'success' ? results[1].result : null;
    const accumulatedFees = results[2]?.status === 'success' ? results[2].result : null;
    const bondSteps = results[3]?.status === 'success' ? results[3].result : null;
    const treasuryAddr = results[4]?.status === 'success' ? results[4].result : null;

    const stepsJson = Array.isArray(bondSteps)
      ? bondSteps.map((s) => ({
          rangeTo: s.rangeTo?.toString?.() ?? s[0]?.toString?.() ?? '0',
          price: s.price?.toString?.() ?? s[1]?.toString?.() ?? '0',
        }))
      : null;

    const currentSupply = curveCfg ? (curveCfg[0]?.toString?.() ?? '0') : '0';
    const sofReserves = curveCfg ? (curveCfg[1]?.toString?.() ?? '0') : '0';

    await db.upsertCurveState(bondingCurve, {
      current_supply: currentSupply,
      sof_reserves: sofReserves,
      accumulated_fees: accumulatedFees != null ? accumulatedFees.toString() : '0',
      current_step_index: currentStep ? Number(currentStep[0]) : null,
      current_step_price: currentStep ? currentStep[1].toString() : null,
      current_step_range_to: currentStep ? currentStep[2].toString() : null,
      bond_steps: stepsJson,
      treasury_address: treasuryAddr?.toLowerCase() ?? null,
    });
    curveOk = true;
  } catch (err) {
    console.error(`  [season ${seasonIdNum}] curve_state upsert failed: ${err.message}`);
  }

  const statusLabel = ['NotStarted', 'Active', 'EndRequested', 'VRFPending', 'Distributing', 'Completed', 'Cancelled'][status] ?? `status=${status}`;
  console.log(`  [season ${seasonIdNum}] ✓ "${name ?? '∅'}" ${statusLabel} — season=${seasonOk ? '✓' : '✗'} curve=${curveOk ? '✓' : '✗'}`);
  return { seasonContracts: seasonOk, curveState: curveOk };
}

async function main() {
  const chain = getChainByKey(NETWORK_KEY);
  if (!chain?.raffle) {
    console.error(`✗ No raffle address configured for network: ${NETWORK_KEY}`);
    process.exit(1);
  }

  console.log(`🔧 Reconciling seasons against on-chain state`);
  console.log(`  Network:        ${NETWORK_KEY}`);
  console.log(`  Raffle address: ${chain.raffle}`);
  console.log('');

  const client = getPublicClient(NETWORK_KEY);

  const currentSeasonId = await client.readContract({
    address: chain.raffle,
    abi: RaffleABI,
    functionName: 'currentSeasonId',
  });
  const total = Number(currentSeasonId);
  console.log(`  Seasons to reconcile: 1..${total}\n`);

  let seasonsOk = 0;
  let curvesOk = 0;
  for (let i = 1; i <= total; i++) {
    const { seasonContracts, curveState } = await reconcileSeason(client, chain.raffle, i);
    if (seasonContracts) seasonsOk++;
    if (curveState) curvesOk++;
  }

  console.log(`\n✓ Done. season_contracts: ${seasonsOk}/${total} | curve_state: ${curvesOk}/${total}`);
}

main().catch((err) => {
  console.error('✗ Reconciliation failed:', err);
  process.exit(1);
});
