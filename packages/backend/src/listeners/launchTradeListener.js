/**
 * launchTradeListener
 *
 * Indexes trades on launch pools into `launch_trades`: the Uniswap v4
 * PoolManager's `Swap` events, filtered to the pools the launchpad created.
 * Feeds the price chart, the trade feed, and the tokens row of the activity
 * ticker.
 *
 * Three things make this listener different from the others:
 *
 * 1. It must FILTER BY POOL at the RPC. The PoolManager is a singleton: every
 *    v4 swap on the chain comes out of it, so an unfiltered query is the whole
 *    network's volume. The poller is given the pool ids as an indexed-arg
 *    filter, and never falls back to an unfiltered query.
 *
 * 2. It DISCOVERS POOLS ITSELF, per block range. The filter is built from the
 *    pools known when a range is queried. If it relied on tokenLaunchedListener
 *    having indexed a launch first, any lag would let a new token's first swaps
 *    fall into a range already passed — lost for good, since the cursor has
 *    moved on. So before fetching swaps for a range, this reads that range's
 *    TokenLaunched events and adds their pools (and indexes the launch, which
 *    launch_trades' foreign key needs anyway; the insert is idempotent).
 *
 * 3. It ATTRIBUTES trades. A swap's `sender` is the router that called the
 *    PoolManager, not the trader. The router's own Bought/Sold event in the
 *    same transaction names the account (buildTradeRow.attributeTrader).
 *    That costs one receipt fetch per trade transaction.
 */

import { PoolManagerABI, TokenLaunchpadABI, UniV4LaunchRouterABI } from "@sof/contracts";
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
import { attributeTrader, buildTradeRow } from "./buildTradeRow.js";

/**
 * pool id (lowercase) -> { token, symbol }. Seeded from the DB, extended by
 * on-chain discovery. Module-level so the historical scan and the live poller
 * share it.
 */
const pools = new Map();

function rememberPool(poolId, token, symbol) {
  if (!poolId || /^0x0+$/.test(poolId)) return;
  pools.set(String(poolId).toLowerCase(), { token: String(token).toLowerCase(), symbol: symbol ?? null });
}

/** Current filter, or null when there is nothing to watch (never an empty list). */
function poolFilter() {
  return pools.size ? { id: [...pools.keys()] } : null;
}

/**
 * Add every pool launched in [fromBlock, toBlock], indexing each launch too.
 * Runs before the same range's swaps are fetched — see point 2 above.
 */
async function discoverLaunches({ launchpad, totalSupply, fromBlock, toBlock, logger }) {
  const launches = await publicClient.getContractEvents({
    address: launchpad,
    abi: TokenLaunchpadABI,
    eventName: "TokenLaunched",
    fromBlock,
    toBlock,
  });
  for (const log of launches) {
    const { token, symbol, placementId } = log.args ?? {};
    if (!token || !placementId) continue;
    rememberPool(placementId, token, symbol);
    try {
      const block = await publicClient.getBlock({ blockNumber: log.blockNumber });
      const row = buildLaunchRow(log, totalSupply, block?.timestamp);
      if (row) await tokenLaunchesDb.insertTokenLaunch(row);
    } catch (err) {
      // tokenLaunchedListener will index it too; a failure here only delays
      // the FK target, and insertLaunchTrades below will surface that.
      logger.warn(`[LAUNCH_TRADES] could not index launch ${token}: ${err.message}`);
    }
  }
}

/**
 * Turn a batch of Swap logs into rows, fetching each block time and each
 * transaction receipt once.
 */
async function buildRows(logs, logger) {
  const blockTimes = new Map();
  const receipts = new Map();
  const rows = [];

  for (const log of logs) {
    const pool = pools.get(String(log.args?.id).toLowerCase());
    if (!pool) continue; // not a launch pool (cannot happen with the filter, but cheap to guard)

    const bn = log.blockNumber;
    if (!blockTimes.has(bn)) {
      try {
        blockTimes.set(bn, (await publicClient.getBlock({ blockNumber: bn }))?.timestamp);
      } catch {
        blockTimes.set(bn, undefined);
      }
    }

    const tx = log.transactionHash;
    if (!receipts.has(tx)) {
      try {
        receipts.set(tx, (await publicClient.getTransactionReceipt({ hash: tx }))?.logs ?? []);
      } catch (err) {
        logger.warn(`[LAUNCH_TRADES] receipt ${tx} unavailable, keeping router as trader: ${err.message}`);
        receipts.set(tx, []);
      }
    }

    const trader = attributeTrader(receipts.get(tx), log.args?.sender, pool.token, UniV4LaunchRouterABI);
    const row = buildTradeRow(log, { token: pool.token, blockTimeSec: blockTimes.get(bn), trader });
    if (row) rows.push({ row, symbol: pool.symbol });
  }
  return rows;
}

async function persist(logs, logger, sseService) {
  const built = await buildRows(logs, logger);
  if (!built.length) return;

  try {
    await tokenLaunchesDb.insertLaunchTrades(built.map((b) => b.row));
  } catch (err) {
    logger.error(`❌ [LAUNCH_TRADES] insert failed for ${built.length} trade(s): ${err.message}`);
    return;
  }

  if (!sseService) return;
  for (const { row, symbol } of built) {
    sseService.broadcast("raffle", {
      type: "TokenTrade",
      token: row.token_address,
      symbol,
      side: row.side,
      trader: row.trader,
      ethAmount: row.eth_amount,
      tokenAmount: row.token_amount,
      priceWei: row.price_wei,
      blockNumber: row.block_number,
      txHash: row.tx_hash,
    });
  }
}

/**
 * @param {object} p
 * @param {string} p.poolManager   Uniswap v4 PoolManager
 * @param {string} p.launchpad     TokenLaunchpad
 * @param {object} p.logger
 * @returns {Promise<() => Promise<void>>}
 */
export async function startLaunchTradeListener({ poolManager, launchpad, logger }) {
  if (!poolManager || !launchpad) throw new Error("poolManager and launchpad are required");
  if (!logger) throw new Error("logger instance is required");

  const totalSupply = await publicClient.readContract({
    address: launchpad,
    abi: TokenLaunchpadABI,
    functionName: "TOKEN_SUPPLY",
  });

  for (const p of await tokenLaunchesDb.listPoolIndex()) {
    rememberPool(p.pool_id, p.token_address, p.symbol);
  }

  const sseService = getSSEChannelService(logger);

  // Boot scan: launches first, then their swaps, over the lookback window.
  try {
    const current = await publicClient.getBlockNumber();
    const lookback = getChainByKey(process.env.NETWORK).lookbackBlocks;
    const fromBlock = current > lookback ? current - lookback : 0n;
    await discoverLaunches({ launchpad, totalSupply, fromBlock, toBlock: current, logger });
    const filter = poolFilter();
    if (filter) {
      const logs = await getContractEventsInChunks({
        client: publicClient,
        address: poolManager,
        abi: PoolManagerABI,
        eventName: "Swap",
        args: filter,
        fromBlock,
        toBlock: current,
        maxBlockRange: 2_000n,
        maxRetries: 5,
      });
      logger.info(`[LAUNCH_TRADES] boot scan: ${logs.length} swap(s) on ${pools.size} launch pool(s)`);
      await persist(logs, logger, undefined); // no SSE for history
    }
  } catch (err) {
    logger.error(`❌ [LAUNCH_TRADES] boot scan failed: ${err.message}`);
  }

  const blockCursor = await createBlockCursor(`${poolManager}:Swap:launchpad`);

  const unwatch = await startContractEventPolling({
    client: publicClient,
    address: poolManager,
    abi: PoolManagerABI,
    eventName: "Swap",
    pollingIntervalMs: 3_000,
    maxBlockRange: 2_000n,
    blockCursor,
    args: async ({ fromBlock, toBlock }) => {
      await discoverLaunches({ launchpad, totalSupply, fromBlock, toBlock, logger });
      return poolFilter();
    },
    onLogs: (logs) => persist(logs, logger, sseService),
    onError: (error) => {
      logger.error(
        { errorDetails: { type: error?.name ?? "Unknown", message: error?.message ?? String(error) } },
        "❌ LaunchTrade Listener Error",
      );
    },
  });

  logger.info(`🎧 Listening for launch-pool swaps on ${poolManager} (${pools.size} pool(s) known)`);
  return unwatch;
}
