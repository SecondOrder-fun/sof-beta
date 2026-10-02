/**
 * tokenLaunchedListener
 *
 * Watches TokenLaunchpad.TokenLaunched and indexes every launch.
 *
 *   event TokenLaunched(
 *       uint256 indexed launchId, address indexed token, address indexed creator,
 *       string name, string symbol, string metadataURI,
 *       uint256 startPriceWei, bytes32 placementId
 *   );
 *
 * This listener is the ONLY source for a token's name, symbol and metadata URI.
 * The launchpad emits them but does not store them — on-chain storage would
 * need a setter, and a setter lets a creator swap the name or image after
 * people have bought. So a missed event is not recoverable by reading the
 * contract later, which is why the boot scan matters more here than it does for
 * a listener whose state can be re-read.
 *
 * `placementId` is the v4 PoolId (UniV4LiquidityPlacer.place returns
 * PoolId.unwrap), so indexing it here gives the trade listener the key it needs
 * to attribute PoolManager Swap logs to a token without a second lookup.
 *
 * launchTradeListener indexes launches too (it must know a pool before the
 * pool's first swaps are fetched). Both go through processTokenLaunchedLog, so
 * whichever insert wins broadcasts TokenLaunched, and it is broadcast once.
 * Name, symbol and metadata URI are made storable first (buildLaunchRow).
 *
 * The usual listener pattern:
 *   1. scan for missed historical events on boot
 *   2. start a polling watcher with a persistent block cursor
 *   3. process logs idempotently (insert-if-absent by token address)
 *
 * A launch that fails to index is never skipped while a retry could store it:
 * the live tick throws so the cursor stays put and the range is retried, and a
 * failed boot scan starts the poller at the failed log's block. A launch whose
 * row can never be stored (a constraint or data error) is logged with its tx
 * hash and skipped, so it cannot block every launch after it. A completed boot
 * scan starts the poller right after the block it scanned to.
 */

import { TokenLaunchpadABI } from "@sof/contracts";
import { publicClient } from "../lib/viemClient.js";
import { lookbackWindow, resumeWithoutWindow } from "../lib/bootScanWindow.js";
import {
  getContractEventsInChunks,
  startContractEventPolling,
} from "../lib/contractEventPolling.js";
import { createBlockCursor } from "../lib/blockCursor.js";
import { tokenLaunchesDb } from "../../shared/services/tokenLaunchesDb.js";
import { getSSEChannelService } from "../services/sseChannelService.js";
import { buildLaunchRow } from "./buildLaunchRow.js";

/**
 * Whether a database error means the row can NEVER be stored: SQLSTATE class
 * 22 (data exception — bad value, e.g. an unstorable character) or 23
 * (integrity constraint violation). supabase-js surfaces the SQLSTATE as
 * `error.code`. Anything else — network, timeout, PostgREST's own PGRST*
 * codes, no code at all — may pass on a retry.
 * @param {unknown} err
 */
export function isPermanentDbError(err) {
  const code = err && typeof err === "object" && "code" in err ? String(err.code) : "";
  return /^2[23][0-9A-Z]{3}$/.test(code);
}

/**
 * Index one TokenLaunched log, broadcasting it when THIS call inserted the row.
 *
 * Throws when the row could not be stored but might be on a retry (the block's
 * time could not be read, or a transient or unknown insert failure), so the
 * caller's range is retried: the event is the only source of the name and
 * symbol. A row that can never be stored (see
 * isPermanentDbError) is logged at error level with its tx hash and skipped —
 * retrying it would block every later launch, and the trade listener, forever.
 *
 * @param {object} log
 * @param {bigint} totalSupply
 * @param {object} logger
 * @param {object} [sseService]  omit for history (no broadcast)
 * @returns {Promise<'inserted' | 'exists' | 'skipped'>} 'inserted' if this call
 *   stored the launch, 'exists' if it was already stored, 'skipped' if it is
 *   not (and will not be) stored
 */
export async function processTokenLaunchedLog(log, totalSupply, logger, sseService) {
  // A failed block-time read throws, so the range is retried. Never a
  // stand-in time: the insert ignores a launch already indexed, so a wrong
  // launched_at would never be corrected — and the trade listener indexes
  // historical launches through here too, where "now" is far from the truth.
  const block = await publicClient.getBlock({ blockNumber: log.blockNumber });
  if (block?.timestamp == null) throw new Error(`block ${log.blockNumber} has no timestamp`);

  const row = buildLaunchRow(log, totalSupply, block.timestamp);
  if (!row) {
    logger.warn({ topics: log.topics }, "TokenLaunched log missing args — skipping");
    return "skipped";
  }

  // insertTokenLaunch returns false for a row already there (including the
  // lost side of a concurrent insert) and throws on a real failure.
  let inserted;
  try {
    inserted = await tokenLaunchesDb.insertTokenLaunch(row);
  } catch (err) {
    if (!isPermanentDbError(err)) throw err;
    logger.error(
      { txHash: row.tx_hash, token: row.token_address, block: row.block_number, code: err.code },
      `❌ TokenLaunched ${row.token_address} (tx ${row.tx_hash}) can never be stored — skipping: ${err.message}`,
    );
    return "skipped";
  }
  if (!inserted) {
    logger.debug(`TokenLaunched already indexed: ${row.token_address}`);
    return "exists";
  }

  logger.info(
    `🚀 TokenLaunched: ${row.symbol || "?"} (${row.token_address}) ` +
      `by ${row.creator_address} at ${row.start_price_wei} wei/token ` +
      `(block ${row.block_number})`,
  );

  if (sseService) {
    sseService.broadcast("raffle", {
      type: "TokenLaunched",
      token: row.token_address,
      creator: row.creator_address,
      name: row.name,
      symbol: row.symbol,
      startPriceWei: row.start_price_wei,
      impliedFdvWei: row.implied_fdv_wei,
      blockNumber: row.block_number,
      txHash: row.tx_hash,
    });
  }
  return "inserted";
}

/**
 * Backfill missed TokenLaunched events since `chain.lookbackBlocks`.
 *
 * @returns {Promise<{ resumeFrom?: bigint, windowUnknown?: true }>} where the
 *   live poller must start no later than: the block after the scanned head
 *   when the scan finished (so blocks mined during the scan are not skipped),
 *   the failed log's block — or the scan's start when the query itself
 *   failed — when it did not. `windowUnknown` when it failed before learning
 *   its window (see bootScanWindow.resumeWithoutWindow).
 */
async function scanHistoricalLaunches(launchpadAddress, totalSupply, logger) {
  let window;
  let failedAt;
  try {
    logger.info("🔍 Scanning for historical TokenLaunched events...");
    window = await lookbackWindow(publicClient);

    const logs = await getContractEventsInChunks({
      client: publicClient,
      address: launchpadAddress,
      abi: TokenLaunchpadABI,
      eventName: "TokenLaunched",
      fromBlock: window.from,
      toBlock: window.head,
      maxBlockRange: 2_000n,
      maxRetries: 5,
    });

    if (logs.length > 0) {
      logger.info(`   Found ${logs.length} historical TokenLaunched event(s)`);
      for (const log of logs) {
        failedAt = log.blockNumber;
        // No SSE broadcast for historical events — clients aren't connected yet.
        await processTokenLaunchedLog(log, totalSupply, logger, undefined);
      }
    } else {
      logger.info("   No historical TokenLaunched events found");
    }
    return { resumeFrom: window.head + 1n };
  } catch (error) {
    logger.error(
      `❌ Failed to scan historical TokenLaunched events: ${error.message}`,
    );
    // Don't throw — the live poller starts at the failed point instead.
    if (!window) return { windowUnknown: true };
    return { resumeFrom: failedAt ?? window.from };
  }
}

/**
 * Start watching TokenLaunchpad.TokenLaunched.
 *
 * @param {string} launchpadAddress - TokenLaunchpad address
 * @param {object} logger - Fastify logger (app.log)
 * @returns {Promise<() => Promise<void>>} unwatch (async — awaits cursor flush)
 */
export async function startTokenLaunchedListener(launchpadAddress, logger) {
  if (!launchpadAddress) throw new Error("launchpadAddress is required");
  if (!logger) throw new Error("logger instance is required");

  // Read once at start rather than per event: TOKEN_SUPPLY is a contract
  // constant, so a read per launch would be pure waste against the RPC budget.
  const totalSupply = await publicClient.readContract({
    address: launchpadAddress,
    abi: TokenLaunchpadABI,
    functionName: "TOKEN_SUPPLY",
  });

  const sseService = getSSEChannelService(logger);

  const scan = await scanHistoricalLaunches(launchpadAddress, totalSupply, logger);

  const blockCursor = await createBlockCursor(
    `${launchpadAddress}:TokenLaunched`,
  );
  const resumeFrom = scan.windowUnknown
    ? await resumeWithoutWindow(publicClient, blockCursor)
    : scan.resumeFrom;

  const unwatch = await startContractEventPolling({
    client: publicClient,
    address: launchpadAddress,
    abi: TokenLaunchpadABI,
    eventName: "TokenLaunched",
    pollingIntervalMs: 3_000,
    maxBlockRange: 2_000n,
    blockCursor,
    resumeNoLaterThan: resumeFrom,
    // A throw fails the tick before the cursor moves; the range is retried.
    onLogs: async (logs) => {
      for (const log of logs) {
        await processTokenLaunchedLog(log, totalSupply, logger, sseService);
      }
    },
    onError: (error) => {
      logger.error(
        {
          errorDetails: {
            type: error?.name ? String(error.name) : "Unknown",
            message: error?.message ? String(error.message) : String(error),
          },
        },
        "❌ TokenLaunched Listener Error",
      );
    },
  });

  logger.info(`🎧 Listening for TokenLaunched events on ${launchpadAddress}`);
  return unwatch;
}
