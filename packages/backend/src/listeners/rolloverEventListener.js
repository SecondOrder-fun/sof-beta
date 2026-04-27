/**
 * Rollover Event Listener
 *
 * Watches RolloverEscrow contract events (Deposit / Spend / Refund) and
 * indexes them in `rollover_events`. Uses the `startContractEventPolling`
 * + `createBlockCursor` pattern (same as seasonStartedListener,
 * positionUpdateListener) so a backend restart resumes from the last
 * processed block instead of dropping events fired during downtime.
 *
 * On startup, runs a historical scan (`lookbackBlocks` window) to backfill
 * any events missed while the listener was down before the cursor was
 * created.
 *
 * Required contract deployment:
 * - RolloverEscrow address in packages/contracts/deployments/{network}.json
 *
 * Silently skips startup if the contract is not yet deployed (address empty).
 */

import { parseAbiItem } from "viem";
import { getChainByKey } from "../config/chain.js";
import { publicClient } from "../lib/viemClient.js";
import { db } from "../../shared/supabaseClient.js";
import {
  getContractEventsInChunks,
  startContractEventPolling,
} from "../lib/contractEventPolling.js";
import { createBlockCursor } from "../lib/blockCursor.js";

const ROLLOVER_DEPOSIT_EVENT = parseAbiItem(
  "event RolloverDeposit(address indexed user, uint256 indexed seasonId, uint256 amount)",
);

const ROLLOVER_SPEND_EVENT = parseAbiItem(
  "event RolloverSpend(address indexed user, uint256 indexed seasonId, uint256 indexed nextSeasonId, uint256 baseAmount, uint256 bonusAmount)",
);

const ROLLOVER_REFUND_EVENT = parseAbiItem(
  "event RolloverRefund(address indexed user, uint256 indexed seasonId, uint256 amount)",
);

/**
 * Build the upsert payload for one event type. Centralized so both the
 * historical scan and the live poller produce identical row shapes.
 */
function buildRolloverRow(eventType, log) {
  const { user, seasonId, amount, baseAmount, bonusAmount, nextSeasonId } =
    log.args;
  const base = {
    event_type: eventType,
    season_id: Number(seasonId),
    user_address: user.toLowerCase(),
    tx_hash: log.transactionHash,
    block_number: Number(log.blockNumber),
  };
  if (eventType === "SPEND") {
    return {
      ...base,
      amount: baseAmount.toString(),
      bonus_amount: bonusAmount.toString(),
      next_season_id: Number(nextSeasonId),
    };
  }
  return { ...base, amount: amount.toString() };
}

async function persistRolloverEvent(eventType, log, logger) {
  try {
    const row = buildRolloverRow(eventType, log);
    const { error } = await db.client.from("rollover_events").upsert(row, {
      onConflict: "tx_hash,event_type",
    });
    if (error) throw error;
    return { ok: true, row };
  } catch (err) {
    logger.error(
      { err },
      `[RolloverListener] Failed to index Rollover${eventType.charAt(0)}${eventType.slice(1).toLowerCase()}: ${log.transactionHash}`,
    );
    return { ok: false, err };
  }
}

/**
 * Walk past blocks for one rollover event and persist anything missed
 * during backend downtime. Returns the number of newly-persisted rows
 * for diagnostic logging.
 */
async function scanHistorical({
  escrowAddress,
  event,
  eventType,
  fromBlock,
  toBlock,
  logger,
}) {
  try {
    const logs = await getContractEventsInChunks({
      client: publicClient,
      address: escrowAddress,
      // `getContractEventsInChunks` accepts `event` as a parsed AbiItem
      // (same as viem's getLogs). We pass an `abi` array of one item.
      abi: [event],
      eventName: event.name,
      fromBlock,
      toBlock,
      maxBlockRange: 2_000n,
      maxRetries: 5,
    });

    if (logs.length === 0) return 0;

    let recorded = 0;
    for (const log of logs) {
      const result = await persistRolloverEvent(eventType, log, logger);
      if (result.ok) recorded += 1;
    }
    return recorded;
  } catch (err) {
    logger.error(
      { err },
      `[RolloverListener] Historical scan failed for ${event.name}`,
    );
    return 0;
  }
}

/**
 * Start watching RolloverEscrow events and indexing them into the database.
 *
 * @param {string} network - "LOCAL" | "TESTNET" | "MAINNET"
 * @param {object} logger - Fastify-compatible logger with .info/.warn/.error
 * @returns {Promise<Function|undefined>} Combined unwatch function, or undefined if skipped
 */
export async function startRolloverEventListener(network, logger) {
  const chain = getChainByKey(network);
  const escrowAddress = chain.rolloverEscrow;

  if (!escrowAddress) {
    logger.warn(
      "[RolloverListener] RolloverEscrow address not configured — skipping rollover event listener",
    );
    return undefined;
  }

  // Determine historical-scan window. lookbackBlocks already accounts for
  // network differences (LOCAL: 10k, TESTNET/MAINNET: 50k).
  const currentBlock = await publicClient.getBlockNumber();
  const lookback = chain.lookbackBlocks ?? 10_000n;
  const fromBlock =
    currentBlock > lookback ? currentBlock - lookback : 0n;

  // ── Historical scan (one pass) ──────────────────────────────────────
  const eventDefs = [
    { event: ROLLOVER_DEPOSIT_EVENT, eventType: "DEPOSIT" },
    { event: ROLLOVER_SPEND_EVENT, eventType: "SPEND" },
    { event: ROLLOVER_REFUND_EVENT, eventType: "REFUND" },
  ];

  for (const { event, eventType } of eventDefs) {
    const recorded = await scanHistorical({
      escrowAddress,
      event,
      eventType,
      fromBlock,
      toBlock: currentBlock,
      logger,
    });
    if (recorded > 0) {
      logger.info(
        `[RolloverListener] Historical ${eventType}: backfilled ${recorded} row(s)`,
      );
    }
  }

  // ── Live polling, one cursor per event type ─────────────────────────
  const unwatchers = [];
  for (const { event, eventType } of eventDefs) {
    const cursor = await createBlockCursor(
      `${escrowAddress}:Rollover${event.name.replace("Rollover", "")}`,
    );

    const unwatch = await startContractEventPolling({
      client: publicClient,
      address: escrowAddress,
      abi: [event],
      eventName: event.name,
      pollingIntervalMs: 3_000,
      maxBlockRange: 2_000n,
      blockCursor: cursor,
      onLogs: async (logs) => {
        for (const log of logs) {
          const { ok, row } = await persistRolloverEvent(eventType, log, logger);
          if (ok) {
            logger.info(
              `[RolloverListener] ${eventType}: ${row.user_address} season=${row.season_id} (tx: ${log.transactionHash})`,
            );
          }
        }
      },
      onError: (err) => {
        logger.error(
          { err },
          `[RolloverListener] ${event.name} poll error`,
        );
      },
    });
    unwatchers.push(unwatch);
  }

  logger.info(
    `[RolloverListener] Polling RolloverDeposit, RolloverSpend, RolloverRefund at ${escrowAddress} (cursor-backed)`,
  );

  return function unwatchAll() {
    for (const unwatch of unwatchers) unwatch();
  };
}
