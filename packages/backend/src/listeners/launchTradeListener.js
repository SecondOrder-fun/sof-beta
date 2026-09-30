/**
 * launchTradeListener
 *
 * Indexes trades on launch pools into `launch_trades`: the Uniswap v4
 * PoolManager's `Swap` events, filtered to the pools the launchpad created.
 * Feeds the price chart, the trade feed, and the tokens row of the activity
 * ticker.
 *
 * Four things make this listener different from the others:
 *
 * 1. It must FILTER BY POOL at the RPC. The PoolManager is a singleton: every
 *    v4 swap on the chain comes out of it, so an unfiltered query is the whole
 *    network's volume. The poller is given the pool ids as an indexed-arg
 *    filter, and never falls back to an unfiltered query. The ids go out in
 *    batches of at most MAX_POOL_IDS_PER_QUERY, one getLogs per batch, so the
 *    OR-list stays inside what an RPC accepts as launches accumulate.
 *
 * 2. It DISCOVERS POOLS ITSELF, per block range. The filter is built from the
 *    pools known when a range is queried. If it relied on tokenLaunchedListener
 *    having indexed a launch first, any lag would let a new token's first swaps
 *    fall into a range already passed — lost for good, since the cursor has
 *    moved on. So before fetching swaps for a range, this reads that range's
 *    TokenLaunched events and adds their pools, indexing each launch through
 *    tokenLaunchedListener's own processTokenLaunchedLog (launch_trades' foreign
 *    key needs the row anyway). Sharing that function means whichever listener
 *    inserts a launch first broadcasts it, exactly once.
 *
 * 3. It ATTRIBUTES trades. A swap's `sender` is the router that called the
 *    PoolManager, not the trader. The launch router's own Bought/Sold event in
 *    the same transaction names the account (buildTradeRow.attributeTrader),
 *    trusted only for a sender that is TokenLaunchpad.router() — read at start,
 *    re-read every ROUTER_REFRESH_MS, and remembered across a router swap so
 *    the old router's trades still attribute. That costs one receipt fetch per
 *    router transaction; blocks and receipts are fetched FETCH_CONCURRENCY at a
 *    time.
 *
 * 4. It NEVER SKIPS a range it could not fully store. A failed block-time
 *    read, receipt read, launch insert or trade insert throws, which fails the
 *    poller tick before its cursor moves, so the range is retried. (A row
 *    written without its block time or trader would never be repaired: the
 *    trade insert ignores duplicates.) A failed boot scan starts the poller at
 *    the scan's first block instead.
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
import { processTokenLaunchedLog } from "./tokenLaunchedListener.js";
import { attributeTrader, buildTradeRow } from "./buildTradeRow.js";

/** Pool ids per Swap getLogs. Past this, one range becomes several queries. */
export const MAX_POOL_IDS_PER_QUERY = 100;
/** Block and receipt reads in flight at once, per batch of swaps. */
export const FETCH_CONCURRENCY = 4;
/** How often TokenLaunchpad.router() is re-read. */
export const ROUTER_REFRESH_MS = 5 * 60_000;

const BLOCK_RANGE = 2_000n;

const isZero = (v) => /^0x0+$/.test(String(v));
const lc = (v) => String(v).toLowerCase();

/**
 * pool id (lowercase) -> { token, symbol }. Seeded from the DB, extended by
 * on-chain discovery. Module-level so the historical scan and the live poller
 * share it.
 */
const pools = new Map();

/** Every launch router seen, lowercase. See point 3 above. */
const routers = new Set();
let routerReadAt = 0;

function rememberPool(poolId, token, symbol) {
  if (!poolId || isZero(poolId)) return;
  pools.set(lc(poolId), { token: lc(token), symbol: symbol ?? null });
}

/**
 * Current filter as batches of pool ids, or null when there is nothing to
 * watch (never an empty list, never unfiltered).
 */
export function poolFilter() {
  if (!pools.size) return null;
  const ids = [...pools.keys()];
  const batches = [];
  for (let i = 0; i < ids.length; i += MAX_POOL_IDS_PER_QUERY) {
    batches.push({ id: ids.slice(i, i + MAX_POOL_IDS_PER_QUERY) });
  }
  return batches;
}

/**
 * The trusted launch routers, re-reading TokenLaunchpad.router() when stale.
 * A failed re-read keeps the known set; a failure before any read has
 * succeeded throws, since attributing without it would store the router as
 * the trader for good.
 */
async function trustedRouters(launchpad, logger) {
  if (routerReadAt && Date.now() - routerReadAt < ROUTER_REFRESH_MS) return routers;
  try {
    const router = await publicClient.readContract({
      address: launchpad,
      abi: TokenLaunchpadABI,
      functionName: "router",
    });
    if (router && !isZero(router)) routers.add(lc(router));
    routerReadAt = Date.now();
  } catch (err) {
    if (!routerReadAt) throw new Error(`launch router unknown: ${err.message}`);
    logger.warn(`[LAUNCH_TRADES] router() re-read failed, keeping ${routers.size} known: ${err.message}`);
  }
  return routers;
}

/** Map `items` through `fn`, at most `limit` at a time, results in order. */
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/**
 * Add every pool launched in [fromBlock, toBlock], indexing each launch too.
 * Runs before the same range's swaps are fetched — see point 2 above. Throws
 * if a launch could not be indexed.
 */
async function discoverLaunches({ launchpad, totalSupply, fromBlock, toBlock, logger, sseService }) {
  const launches = await getContractEventsInChunks({
    client: publicClient,
    address: launchpad,
    abi: TokenLaunchpadABI,
    eventName: "TokenLaunched",
    fromBlock,
    toBlock,
    maxBlockRange: BLOCK_RANGE,
    maxRetries: 5,
  });
  for (const log of launches) {
    const { token, symbol, placementId } = log.args ?? {};
    if (!token || !placementId) continue;
    await processTokenLaunchedLog(log, totalSupply, logger, sseService);
    rememberPool(placementId, token, symbol);
  }
}

/**
 * Turn a batch of Swap logs into rows, fetching each block time and each
 * router transaction's receipt once. Throws if any of them is unavailable.
 */
async function buildRows(logs, { launchpad, poolManager, logger }) {
  const launchLogs = logs.filter((log) => pools.has(lc(log.args?.id)));
  if (!launchLogs.length) return [];

  const trusted = await trustedRouters(launchpad, logger);

  const blockNumbers = [...new Set(launchLogs.map((log) => log.blockNumber))];
  const blockTimes = new Map(
    await mapLimit(blockNumbers, FETCH_CONCURRENCY, async (bn) => {
      const block = await publicClient.getBlock({ blockNumber: bn });
      if (block?.timestamp == null) throw new Error(`block ${bn} has no timestamp`);
      return [bn, block.timestamp];
    }),
  );

  // Only router swaps can be attributed, so only they need a receipt.
  const routerTxs = [
    ...new Set(
      launchLogs.filter((log) => trusted.has(lc(log.args?.sender))).map((log) => log.transactionHash),
    ),
  ];
  const receipts = new Map(
    await mapLimit(routerTxs, FETCH_CONCURRENCY, async (tx) => {
      const receipt = await publicClient.getTransactionReceipt({ hash: tx });
      if (!receipt) throw new Error(`receipt ${tx} unavailable`);
      return [tx, receipt.logs ?? []];
    }),
  );

  const rows = [];
  for (const log of launchLogs) {
    const pool = pools.get(lc(log.args.id));
    const trader = attributeTrader(receipts.get(log.transactionHash) ?? [], log, {
      token: pool.token,
      routers: trusted,
      poolManager,
      poolManagerAbi: PoolManagerABI,
      routerAbi: UniV4LaunchRouterABI,
    });
    const row = buildTradeRow(log, {
      token: pool.token,
      blockTimeSec: blockTimes.get(log.blockNumber),
      trader,
    });
    if (row) rows.push({ row, symbol: pool.symbol });
  }
  return rows;
}

/**
 * Store a batch of swaps, then broadcast them. Throws if they could not be
 * stored, so the poller retries the range instead of moving past it.
 */
async function persist(logs, ctx, sseService) {
  const built = await buildRows(logs, ctx);
  if (!built.length) return;

  await tokenLaunchesDb.insertLaunchTrades(built.map((b) => b.row));

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
  const ctx = { launchpad, poolManager, logger };

  // Boot scan: launches first, then their swaps, over the lookback window.
  // Both reads are chunked. If any of it fails, the poller starts at the
  // window's first block so nothing in it is skipped.
  let resumeFrom;
  let scanFrom;
  try {
    const current = await publicClient.getBlockNumber();
    const lookback = getChainByKey(process.env.NETWORK).lookbackBlocks;
    scanFrom = current > lookback ? current - lookback : 0n;
    await discoverLaunches({ launchpad, totalSupply, fromBlock: scanFrom, toBlock: current, logger });
    const filter = poolFilter();
    if (filter) {
      const logs = await getContractEventsInChunks({
        client: publicClient,
        address: poolManager,
        abi: PoolManagerABI,
        eventName: "Swap",
        args: filter,
        fromBlock: scanFrom,
        toBlock: current,
        maxBlockRange: BLOCK_RANGE,
        maxRetries: 5,
      });
      logger.info(`[LAUNCH_TRADES] boot scan: ${logs.length} swap(s) on ${pools.size} launch pool(s)`);
      await persist(logs, ctx, undefined); // no SSE for history
    }
  } catch (err) {
    resumeFrom = scanFrom;
    logger.error(`❌ [LAUNCH_TRADES] boot scan failed, poller will re-cover it: ${err.message}`);
  }

  const blockCursor = await createBlockCursor(`${poolManager}:Swap:launchpad`);

  const unwatch = await startContractEventPolling({
    client: publicClient,
    address: poolManager,
    abi: PoolManagerABI,
    eventName: "Swap",
    pollingIntervalMs: 3_000,
    maxBlockRange: BLOCK_RANGE,
    blockCursor,
    resumeNoLaterThan: resumeFrom,
    args: async ({ fromBlock, toBlock }) => {
      await discoverLaunches({ launchpad, totalSupply, fromBlock, toBlock, logger, sseService });
      return poolFilter();
    },
    onLogs: (logs) => persist(logs, ctx, sseService),
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

/** Test seam: the module's internals and a way to reset its state. */
export const __test = {
  discoverLaunches,
  persist,
  rememberPool,
  reset() {
    pools.clear();
    routers.clear();
    routerReadAt = 0;
  },
};
