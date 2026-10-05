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
 *    batches of at most MAX_POOL_IDS_PER_QUERY, one getLogs per batch (run in
 *    parallel), so the OR-list stays inside what an RPC accepts as launches
 *    accumulate.
 *
 * 2. It DISCOVERS POOLS ITSELF, per block range. The filter is built from the
 *    pools known when a range is queried. If it relied on tokenLaunchedListener
 *    having indexed a launch first, any lag would let a new token's first swaps
 *    fall into a range already passed — lost for good, since the cursor has
 *    moved on. So before fetching swaps for a range, this reads that range's
 *    TokenLaunched events and adds their pools, indexing each launch through
 *    tokenLaunchedListener's own processTokenLaunchedLog (launch_trades' foreign
 *    key needs the row anyway). Sharing that function means whichever listener
 *    inserts a launch first broadcasts it, exactly once. Blocks already read
 *    for launches (tracked in memory) are not read again, so a retried range
 *    or the boot scan's window costs no second TokenLaunched query. A launch
 *    whose row can never be stored is skipped, and so is its pool: its trades
 *    could not be stored either (foreign key).
 *
 * 3. It ATTRIBUTES trades. A swap's `sender` is the router that called the
 *    PoolManager, not the trader. The launch router's own Bought/Sold event in
 *    the same transaction names the account (buildTradeRow.attributeTrader),
 *    trusted only for a sender that has been a launch router: every
 *    TokenLaunchpad `RouterUpdated` (previous and current), read from the
 *    launchpad's deploy block when known (`deployBlock`: LAUNCHPAD_DEPLOY_BLOCK,
 *    else the block the deployment file records) — else from the earlier of
 *    the lookback window and the stored cursor — plus the current router().
 *    The history is kept current by reading RouterUpdated up to the newest
 *    swap before each batch is attributed, so a restart or a router swap never
 *    turns a router into a stored trader — provided the deploy block is known.
 *    Without it, a router retired before the history's start is not trusted,
 *    and swaps still routed through it would store the router as the trader
 *    (server.js warns at startup in that case). That costs one receipt
 *    fetch per router transaction; blocks and receipts are fetched
 *    FETCH_CONCURRENCY at a time.
 *
 * 4. It NEVER SKIPS a range it could not fully store. A failed block-time
 *    read, receipt read, router-history read, launch insert or trade insert
 *    throws, which fails the poller tick before its cursor moves, so the range
 *    is retried. (A row written without its block time or trader would never
 *    be repaired: the trade insert ignores duplicates.) A completed boot scan
 *    starts the poller right after the block it scanned to, and saves that
 *    block as the cursor unless the stored cursor is older than the scan's
 *    window (the gap between them is still the poller's to cover); a failed
 *    one at the scan's first block (or, if it never learned its window, the
 *    stored cursor or the lookback window's start — bootScanWindow). Only
 *    trades this process inserted are broadcast as TokenTrade, so a replayed
 *    range never re-announces old trades as live.
 */

import { PoolManagerABI, TokenLaunchpadABI, UniV4LaunchRouterABI } from "@sof/contracts";
import { publicClient } from "../lib/viemClient.js";
import { lookbackWindow, resumeWithoutWindow } from "../lib/bootScanWindow.js";
import {
  getContractEventsInChunks,
  startContractEventPolling,
} from "../lib/contractEventPolling.js";
import { createBlockCursor } from "../lib/blockCursor.js";
import { tokenLaunchesDb } from "../../shared/services/tokenLaunchesDb.js";
import { getSSEChannelService } from "../services/sseChannelService.js";
import { processTokenLaunchedLog } from "./tokenLaunchedListener.js";
import { attributeTrader, buildTradeRow, tokenIsCurrency0 } from "./buildTradeRow.js";

/** Pool ids per Swap getLogs. Past this, one range becomes several queries. */
export const MAX_POOL_IDS_PER_QUERY = 100;
/** Block and receipt reads in flight at once, per batch of swaps. */
export const FETCH_CONCURRENCY = 4;

const BLOCK_RANGE = 2_000n;

const isZero = (v) => /^0x0+$/.test(String(v));
const lc = (v) => String(v).toLowerCase();
const maxBig = (a, b) => (a > b ? a : b);
const minBig = (a, b) => (a < b ? a : b);

/**
 * pool id (lowercase) -> { token, symbol, quote, tokenIsCurrency0 }. Seeded from
 * the DB, extended by on-chain discovery. Module-level so the historical scan
 * and the live poller share it. `tokenIsCurrency0` (the launch token sorts below
 * its ERC-20 quote) decides which side of each Swap is the quote.
 */
const pools = new Map();

/** The block span whose TokenLaunched events have been read. See point 2. */
let launchesCovered = /** @type {{ from: bigint, to: bigint } | null} */ (null);

/** Every launch router seen, lowercase. See point 3 above. */
const routers = new Set();
/**
 * First block of the RouterUpdated history, set at startup to the earliest
 * block the poller may process (or the deploy block); unset (only before
 * startup sets it) = the lookback window's.
 */
let routerHistoryFrom = /** @type {bigint | undefined} */ (undefined);
/** Last block RouterUpdated has been read up to; null before the first read. */
let routerScannedTo = /** @type {bigint | null} */ (null);
let routerCurrentRead = false;

function rememberPool(poolId, token, symbol, quote) {
  if (!poolId || isZero(poolId)) return;
  const q = lc(quote ?? "0x0000000000000000000000000000000000000000");
  pools.set(lc(poolId), {
    token: lc(token),
    symbol: symbol ?? null,
    quote: q,
    tokenIsCurrency0: tokenIsCurrency0(token, q),
  });
}

function rememberRouter(address) {
  if (address && !isZero(address)) routers.add(lc(address));
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
 * The trusted launch routers, with the RouterUpdated history read up to at
 * least `upToBlock`. Throws if it cannot be brought that far (or router()
 * has never been read): attributing without it would store a router as the
 * trader for good.
 * @param {string} launchpad
 * @param {bigint} upToBlock
 */
async function trustedRouters(launchpad, upToBlock) {
  try {
    if (routerScannedTo === null || routerScannedTo < upToBlock) {
      let from;
      if (routerScannedTo !== null) from = routerScannedTo + 1n;
      else if (routerHistoryFrom !== undefined) from = routerHistoryFrom;
      else from = (await lookbackWindow(publicClient)).from;
      const updates = await getContractEventsInChunks({
        client: publicClient,
        address: launchpad,
        abi: TokenLaunchpadABI,
        eventName: "RouterUpdated",
        fromBlock: from,
        toBlock: upToBlock,
        maxBlockRange: BLOCK_RANGE,
        maxRetries: 5,
      });
      for (const u of updates) {
        rememberRouter(u.args?.previous);
        rememberRouter(u.args?.current);
      }
      routerScannedTo = upToBlock;
    }
    // Once: the router in force before the history's first block. Every later
    // change emits RouterUpdated, which the history read above picks up.
    if (!routerCurrentRead) {
      rememberRouter(
        await publicClient.readContract({ address: launchpad, abi: TokenLaunchpadABI, functionName: "router" }),
      );
      routerCurrentRead = true;
    }
  } catch (err) {
    throw new Error(`launch router unknown: ${err.message}`);
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

/** The part of [fromBlock, toBlock] not yet read for launches, or null. */
function uncoveredLaunchRange(fromBlock, toBlock) {
  const c = launchesCovered;
  if (!c || fromBlock < c.from || fromBlock > c.to + 1n) return { from: fromBlock, to: toBlock };
  if (toBlock <= c.to) return null;
  return { from: c.to + 1n, to: toBlock };
}

function markLaunchesCovered(from, to) {
  const c = launchesCovered;
  launchesCovered =
    c && from <= c.to + 1n && to + 1n >= c.from
      ? { from: minBig(c.from, from), to: maxBig(c.to, to) }
      : { from, to };
}

/**
 * Add every pool launched in [fromBlock, toBlock], indexing each launch too.
 * Runs before the same range's swaps are fetched — see point 2 above. Only
 * the blocks not already read are queried. Throws if a launch could not be
 * indexed (and might be on a retry).
 */
async function discoverLaunches({ launchpad, totalSupply, fromBlock, toBlock, logger, sseService }) {
  const range = uncoveredLaunchRange(fromBlock, toBlock);
  if (!range) return;
  const launches = await getContractEventsInChunks({
    client: publicClient,
    address: launchpad,
    abi: TokenLaunchpadABI,
    eventName: "TokenLaunched",
    fromBlock: range.from,
    toBlock: range.to,
    maxBlockRange: BLOCK_RANGE,
    maxRetries: 5,
  });
  for (const log of launches) {
    const { token, symbol, placementId, quoteToken } = log.args ?? {};
    if (!token || !placementId) continue;
    const status = await processTokenLaunchedLog(log, totalSupply, logger, sseService);
    if (status !== "skipped") rememberPool(placementId, token, symbol, quoteToken);
  }
  markLaunchesCovered(range.from, range.to);
}

/**
 * Turn a batch of Swap logs into rows, fetching each block time and each
 * router transaction's receipt once. Throws if any of them is unavailable.
 */
async function buildRows(logs, { launchpad, poolManager }) {
  const launchLogs = logs.filter((log) => pools.has(lc(log.args?.id)));
  if (!launchLogs.length) return [];

  const newest = launchLogs.reduce((m, log) => maxBig(m, BigInt(log.blockNumber)), 0n);
  const trusted = await trustedRouters(launchpad, newest);

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
      tokenIsCurrency0: pool.tokenIsCurrency0,
      routers: trusted,
      poolManager,
      poolManagerAbi: PoolManagerABI,
      routerAbi: UniV4LaunchRouterABI,
    });
    const row = buildTradeRow(log, {
      token: pool.token,
      tokenIsCurrency0: pool.tokenIsCurrency0,
      blockTimeSec: blockTimes.get(log.blockNumber),
      trader,
    });
    if (row) rows.push({ row, symbol: pool.symbol });
  }
  return rows;
}

/**
 * Store a batch of swaps, then broadcast the ones this call inserted. Throws
 * if they could not be stored, so the poller retries the range instead of
 * moving past it. Rows already stored (a restart's replay, a retried range)
 * are not broadcast again: TokenTrade means a live trade.
 */
async function persist(logs, ctx, sseService) {
  const built = await buildRows(logs, ctx);
  if (!built.length) return;

  const inserted = await tokenLaunchesDb.insertLaunchTrades(built.map((b) => b.row));

  if (!sseService) return;
  const tradeKey = (txHash, logIndex) => `${lc(txHash)}:${Number(logIndex)}`;
  const fresh = new Set((inserted ?? []).map((r) => tradeKey(r.tx_hash, r.log_index)));
  for (const { row, symbol } of built) {
    if (!fresh.has(tradeKey(row.tx_hash, row.log_index))) continue;
    sseService.broadcast("raffle", {
      type: "TokenTrade",
      token: row.token_address,
      symbol,
      side: row.side,
      trader: row.trader,
      quoteToken: pools.get(lc(row.pool_id))?.quote ?? null,
      quoteAmount: row.quote_amount,
      tokenAmount: row.token_amount,
      price: row.price,
      blockNumber: row.block_number,
      txHash: row.tx_hash,
    });
  }
}

/**
 * @param {object} p
 * @param {string} p.poolManager   Uniswap v4 PoolManager
 * @param {string} p.launchpad     TokenLaunchpad
 * @param {bigint} [p.deployBlock] the launchpad's deploy block, when known:
 *   where the router history starts (else the lookback window / cursor)
 * @param {object} p.logger
 * @returns {Promise<() => Promise<void>>}
 */
export async function startLaunchTradeListener({ poolManager, launchpad, deployBlock, logger }) {
  if (!poolManager || !launchpad) throw new Error("poolManager and launchpad are required");
  if (!logger) throw new Error("logger instance is required");

  const totalSupply = await publicClient.readContract({
    address: launchpad,
    abi: TokenLaunchpadABI,
    functionName: "TOKEN_SUPPLY",
  });

  for (const p of await tokenLaunchesDb.listPoolIndex()) {
    rememberPool(p.pool_id, p.token_address, p.symbol, p.quote_token);
  }

  const sseService = getSSEChannelService(logger);
  const ctx = { launchpad, poolManager, logger };

  const blockCursor = await createBlockCursor(`${poolManager}:Swap:launchpad`);
  const stored = await blockCursor.get();
  /** The first block the stored cursor has the poller process, if any. */
  const cursorNext = stored !== null && stored !== undefined ? stored + 1n : undefined;

  // Boot scan: router history, launches, then their swaps, over the lookback
  // window. All reads are chunked. Where the poller starts after it: see
  // point 4 above.
  let resumeFrom;
  let window;
  try {
    window = await lookbackWindow(publicClient);
    // The router history must reach back as far as any swap the poller may
    // replay: the deploy block if known, else the window or the stored
    // cursor, whichever is earlier.
    routerHistoryFrom =
      typeof deployBlock === "bigint"
        ? deployBlock
        : cursorNext !== undefined
          ? minBig(window.from, cursorNext)
          : window.from;
    const known = await trustedRouters(launchpad, window.head);
    logger.info(`[LAUNCH_TRADES] ${known.size} launch router(s) trusted`);

    await discoverLaunches({ launchpad, totalSupply, fromBlock: window.from, toBlock: window.head, logger });
    const filter = poolFilter();
    if (filter) {
      const logs = await getContractEventsInChunks({
        client: publicClient,
        address: poolManager,
        abi: PoolManagerABI,
        eventName: "Swap",
        args: filter,
        fromBlock: window.from,
        toBlock: window.head,
        maxBlockRange: BLOCK_RANGE,
        maxRetries: 5,
      });
      logger.info(`[LAUNCH_TRADES] boot scan: ${logs.length} swap(s) on ${pools.size} launch pool(s)`);
      await persist(logs, ctx, undefined); // no SSE for history
    }
    // Not the head at poller start: blocks mined during the scan would be skipped.
    resumeFrom = window.head + 1n;
    // The scan stored [window.from, head]. When that reaches back to the
    // stored cursor (or there is none), move the cursor to the head, so the
    // poller resumes after it instead of processing the window a second time.
    // A cursor older than the window keeps its place: the blocks between it
    // and the window were not scanned, and the poller must still cover them.
    if (cursorNext === undefined || (cursorNext >= window.from && stored < window.head)) {
      await blockCursor.set(window.head);
    }
  } catch (err) {
    logger.error(`❌ [LAUNCH_TRADES] boot scan failed, poller will re-cover it: ${err.message}`);
    resumeFrom = window ? window.from : await resumeWithoutWindow(publicClient, blockCursor);
    // Failed before learning its window: the router history was never given
    // a start, and must reach back to the earliest block the poller may
    // process — the stored cursor's next block, or the window resumeFrom is.
    if (routerHistoryFrom === undefined) {
      routerHistoryFrom =
        typeof deployBlock === "bigint"
          ? deployBlock
          : [cursorNext, resumeFrom].filter((b) => typeof b === "bigint").reduce(minBig);
    }
  }

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
  trustedRouters,
  reset() {
    pools.clear();
    routers.clear();
    launchesCovered = null;
    routerHistoryFrom = undefined;
    routerScannedTo = null;
    routerCurrentRead = false;
  },
};
