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
 * Pattern mirrors accountCreatedListener.js:
 *   1. scan for missed historical events on boot
 *   2. start a polling watcher with a persistent block cursor
 *   3. process logs idempotently (insert-if-absent by token address)
 */

import { TokenLaunchpadABI } from "@sof/contracts";
import { publicClient } from "../lib/viemClient.js";
import { getChainByKey } from "../config/chain.js";
import {
  getContractEventsInChunks,
  startContractEventPolling,
} from "../lib/contractEventPolling.js";
import { createBlockCursor } from "../lib/blockCursor.js";
import { tokenLaunchesDb } from "../../shared/services/tokenLaunchesDb.js";
import { getSSEChannelService } from "../services/sseChannelService.js";
import { buildLaunchRow } from "./buildLaunchRow.js";

/**
 * Index one TokenLaunched log.
 */
async function processTokenLaunchedLog(log, totalSupply, logger, sseService) {
  try {
    let blockTimeSec;
    try {
      const block = await publicClient.getBlock({ blockNumber: log.blockNumber });
      blockTimeSec = block?.timestamp;
    } catch {
      // A missing block timestamp is not worth dropping the launch over —
      // buildLaunchRow falls back to now, which is close enough for ordering
      // a feed that is being indexed live.
      blockTimeSec = undefined;
    }

    const row = buildLaunchRow(log, totalSupply, blockTimeSec);
    if (!row) {
      logger.warn({ topics: log.topics }, "TokenLaunched log missing args — skipping");
      return;
    }

    const inserted = await tokenLaunchesDb.insertTokenLaunch(row);
    if (!inserted) {
      logger.debug(`TokenLaunched already indexed: ${row.token_address}`);
      return;
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
  } catch (error) {
    logger.error(
      `❌ Failed to index TokenLaunched for ${log?.args?.token}: ${error.message}`,
    );
    // Continue — a single bad launch must not stop the listener.
  }
}

/**
 * Backfill missed TokenLaunched events since `chain.lookbackBlocks`.
 */
async function scanHistoricalLaunches(launchpadAddress, totalSupply, logger) {
  try {
    logger.info("🔍 Scanning for historical TokenLaunched events...");
    const currentBlock = await publicClient.getBlockNumber();
    const chain = getChainByKey(process.env.NETWORK);
    const lookbackBlocks = chain.lookbackBlocks;
    const fromBlock =
      currentBlock > lookbackBlocks ? currentBlock - lookbackBlocks : 0n;

    const logs = await getContractEventsInChunks({
      client: publicClient,
      address: launchpadAddress,
      abi: TokenLaunchpadABI,
      eventName: "TokenLaunched",
      fromBlock,
      toBlock: currentBlock,
      maxBlockRange: 2_000n,
      maxRetries: 5,
    });

    if (logs.length > 0) {
      logger.info(`   Found ${logs.length} historical TokenLaunched event(s)`);
      for (const log of logs) {
        // No SSE broadcast for historical events — clients aren't connected yet.
        await processTokenLaunchedLog(log, totalSupply, logger, undefined);
      }
    } else {
      logger.info("   No historical TokenLaunched events found");
    }
  } catch (error) {
    logger.error(
      `❌ Failed to scan historical TokenLaunched events: ${error.message}`,
    );
    // Don't throw — continue with the real-time listener.
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

  await scanHistoricalLaunches(launchpadAddress, totalSupply, logger);

  const blockCursor = await createBlockCursor(
    `${launchpadAddress}:TokenLaunched`,
  );

  const unwatch = await startContractEventPolling({
    client: publicClient,
    address: launchpadAddress,
    abi: TokenLaunchpadABI,
    eventName: "TokenLaunched",
    pollingIntervalMs: 3_000,
    maxBlockRange: 2_000n,
    blockCursor,
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
