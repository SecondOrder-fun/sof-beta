// @vitest-environment node
// tokenLaunchedListener + launchTradeListener: the rules that keep the launch
// index complete — nothing stored half-built, nothing skipped past, and every
// launch broadcast exactly once whichever listener indexes it.
import { describe, it, expect, vi, beforeEach } from "vitest";

const publicClient = {
  getBlock: vi.fn(),
  getBlockNumber: vi.fn(),
  getContractEvents: vi.fn(),
  getTransactionReceipt: vi.fn(),
  readContract: vi.fn(),
};
vi.mock("../../src/lib/viemClient.js", () => ({ publicClient }));
vi.mock("../../src/config/chain.js", () => ({ getChainByKey: () => ({ lookbackBlocks: 5_000n }) }));
/** What each listener's stored block cursor holds; null = never persisted. */
let storedCursor = null;
/** Every cursor write; a write is what the poller then reads back. */
const cursorSet = vi.fn(async (block) => {
  storedCursor = block;
});
vi.mock("../../src/lib/blockCursor.js", () => ({
  createBlockCursor: vi.fn(async () => ({ get: vi.fn(async () => storedCursor), set: cursorSet, flush: vi.fn() })),
}));

const sse = { broadcast: vi.fn() };
vi.mock("../../src/services/sseChannelService.js", () => ({ getSSEChannelService: () => sse }));

const tokenLaunchesDb = {
  insertTokenLaunch: vi.fn(),
  insertLaunchTrades: vi.fn(),
  listPoolIndex: vi.fn(async () => []),
};
vi.mock("../../shared/services/tokenLaunchesDb.js", () => ({ tokenLaunchesDb }));

// Keep the real chunked reader; capture the live poller's params instead of
// starting it.
const startContractEventPolling = vi.fn(async () => async () => {});
vi.mock("../../src/lib/contractEventPolling.js", async (importOriginal) => ({
  ...(await importOriginal()),
  startContractEventPolling: (...a) => startContractEventPolling(...a),
}));

const { processTokenLaunchedLog, startTokenLaunchedListener, isPermanentDbError } = await import(
  "../../src/listeners/tokenLaunchedListener.js"
);
const {
  startLaunchTradeListener,
  poolFilter,
  MAX_POOL_IDS_PER_QUERY,
  FETCH_CONCURRENCY,
  __test,
} = await import("../../src/listeners/launchTradeListener.js");

const LAUNCHPAD = "0x1000000000000000000000000000000000000001";
const POOL_MANAGER = "0x2000000000000000000000000000000000000002";
const ROUTER = "0x7777777777777777777777777777777777777777";
const OLD_ROUTER = "0x6666666666666666666666666666666666666666";
const TOKEN = "0x1111111111111111111111111111111111111111";
const POOL = `0x${"ab".repeat(32)}`;
const SUPPLY = 10n ** 27n;

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

const launchLog = (over = {}) => ({
  blockNumber: 100n,
  transactionHash: "0xlaunch",
  args: {
    launchId: 0n, token: TOKEN, creator: "0x3333333333333333333333333333333333333333",
    name: "Pond", symbol: "POND", metadataURI: "ipfs://x", startPriceWei: 1_000_000_000n, placementId: POOL,
  },
  ...over,
});

const swap = (i, over = {}) => ({
  blockNumber: BigInt(200 + i),
  logIndex: 0,
  transactionHash: `0xtx${i}`,
  args: { id: POOL, sender: "0x9999999999999999999999999999999999999999", amount0: -1n, amount1: 5n, sqrtPriceX96: 2n ** 96n, tick: 0 },
  ...over,
});

/** insertTokenLaunch as the DB behaves: true for the first insert of a token, false after. */
function fakeLaunchStore() {
  const stored = new Set();
  tokenLaunchesDb.insertTokenLaunch.mockImplementation(async (row) => {
    const key = row.token_address.toLowerCase();
    if (stored.has(key)) return false;
    stored.add(key);
    return true;
  });
}

const launchedBroadcasts = () => sse.broadcast.mock.calls.filter(([, e]) => e.type === "TokenLaunched");

/** getContractEvents answering per event name; anything unlisted is empty. */
function eventsByName(map) {
  publicClient.getContractEvents.mockImplementation(async (p) => {
    const v = map[p.eventName];
    return typeof v === "function" ? v(p) : v ?? [];
  });
}

const pollerParams = () => startContractEventPolling.mock.calls.at(-1)[0];
const queriesFor = (eventName) =>
  publicClient.getContractEvents.mock.calls.map(([p]) => p).filter((p) => p.eventName === eventName);

beforeEach(() => {
  vi.clearAllMocks();
  // Drop any unconsumed *Once values too, so no test leaks into the next.
  for (const fn of [...Object.values(publicClient), ...Object.values(tokenLaunchesDb)]) fn.mockReset();
  __test.reset();
  storedCursor = null;
  publicClient.getBlockNumber.mockResolvedValue(10_000n);
  publicClient.getBlock.mockResolvedValue({ timestamp: 1_700_000_000n });
  publicClient.getContractEvents.mockResolvedValue([]);
  publicClient.getTransactionReceipt.mockResolvedValue({ logs: [] });
  publicClient.readContract.mockImplementation(async ({ functionName }) =>
    functionName === "router" ? ROUTER : SUPPLY,
  );
  // As the DB behaves: every row is new (the RETURNING set is all of them).
  tokenLaunchesDb.insertLaunchTrades.mockImplementation(async (rows) =>
    rows.map((r) => ({ tx_hash: String(r.tx_hash).toLowerCase(), log_index: r.log_index })),
  );
  tokenLaunchesDb.listPoolIndex.mockResolvedValue([]);
  fakeLaunchStore();
});

const ctx = { launchpad: LAUNCHPAD, poolManager: POOL_MANAGER, logger };

describe("tokenLaunchedListener.processTokenLaunchedLog", () => {
  // The event is the only source of the name and symbol: a failed insert must
  // fail the tick so the range is retried, not be logged and skipped past.
  it("propagates a failed insert", async () => {
    tokenLaunchesDb.insertTokenLaunch.mockRejectedValueOnce(new Error("db down"));
    await expect(processTokenLaunchedLog(launchLog(), SUPPLY, logger, sse)).rejects.toThrow("db down");
    expect(sse.broadcast).not.toHaveBeenCalled();
  });

  it("broadcasts only when its own insert won", async () => {
    expect(await processTokenLaunchedLog(launchLog(), SUPPLY, logger, sse)).toBe("inserted");
    expect(await processTokenLaunchedLog(launchLog(), SUPPLY, logger, sse)).toBe("exists");
    expect(launchedBroadcasts()).toHaveLength(1);
  });

  // A row that can never be stored would otherwise fail its range forever,
  // blocking every later launch — and the trade listener, which indexes
  // launches through this same function.
  it.each([
    ["22001", "value too long for type"],
    ["22P05", "unsupported Unicode escape sequence"],
    ["23502", "null value in column violates not-null constraint"],
    ["23514", "new row violates check constraint"],
  ])("skips, logging the tx hash, a launch the database rejects for good (%s)", async (code, message) => {
    tokenLaunchesDb.insertTokenLaunch.mockRejectedValueOnce(Object.assign(new Error(message), { code }));
    expect(await processTokenLaunchedLog(launchLog(), SUPPLY, logger, sse)).toBe("skipped");
    expect(sse.broadcast).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ txHash: "0xlaunch", code }),
      expect.stringContaining("0xlaunch"),
    );
  });

  it.each([
    ["no code", new Error("fetch failed")],
    ["a connection error", Object.assign(new Error("connection failure"), { code: "08006" })],
    ["a PostgREST error", Object.assign(new Error("JWT expired"), { code: "PGRST301" })],
    ["a timeout", Object.assign(new Error("statement timeout"), { code: "57014" })],
  ])("rethrows a failure a retry may fix (%s)", async (_label, err) => {
    tokenLaunchesDb.insertTokenLaunch.mockRejectedValueOnce(err);
    await expect(processTokenLaunchedLog(launchLog(), SUPPLY, logger, sse)).rejects.toBe(err);
  });

  it("classifies SQLSTATE classes 22 and 23 as permanent, and nothing else", () => {
    expect(isPermanentDbError({ code: "22001" })).toBe(true);
    expect(isPermanentDbError({ code: "23503" })).toBe(true);
    expect(isPermanentDbError({ code: "40001" })).toBe(false);
    expect(isPermanentDbError({ code: "PGRST116" })).toBe(false);
    expect(isPermanentDbError(new Error("x"))).toBe(false);
    expect(isPermanentDbError(null)).toBe(false);
  });

  // launched_at is insert-if-absent and never corrected, and the trade
  // listener indexes historical launches through here: "now" would stick.
  it.each([
    ["the read fails", () => publicClient.getBlock.mockRejectedValueOnce(new Error("block unavailable"))],
    ["the block has no timestamp", () => publicClient.getBlock.mockResolvedValueOnce({})],
  ])("throws, storing nothing, when %s", async (_label, arrange) => {
    arrange();
    await expect(processTokenLaunchedLog(launchLog(), SUPPLY, logger, sse)).rejects.toThrow();
    expect(tokenLaunchesDb.insertTokenLaunch).not.toHaveBeenCalled();
    expect(sse.broadcast).not.toHaveBeenCalled();
  });

  it("stores the block's own time as launched_at", async () => {
    await processTokenLaunchedLog(launchLog(), SUPPLY, logger, sse);
    expect(tokenLaunchesDb.insertTokenLaunch.mock.calls[0][0].launched_at).toBe(
      new Date(1_700_000_000 * 1000).toISOString(),
    );
  });

  // U+0000 is legal in an event string and fatal in Postgres TEXT.
  it("stores a name holding a NUL character instead of failing on it", async () => {
    await processTokenLaunchedLog(
      launchLog({ args: { ...launchLog().args, name: "Po\u0000nd" } }),
      SUPPLY, logger, sse,
    );
    expect(tokenLaunchesDb.insertTokenLaunch.mock.calls[0][0].name).toBe("Pond");
  });
});

describe("tokenLaunchedListener boot scan", () => {
  it("starts the live poller at a launch the boot scan failed to index", async () => {
    publicClient.getContractEvents.mockResolvedValueOnce([launchLog({ blockNumber: 6_123n })]);
    tokenLaunchesDb.insertTokenLaunch.mockRejectedValueOnce(new Error("db down"));

    await startTokenLaunchedListener(LAUNCHPAD, logger);

    expect(pollerParams().resumeNoLaterThan).toBe(6_123n);
  });

  it("starts the live poller at a launch whose block time could not be read", async () => {
    publicClient.getContractEvents.mockResolvedValueOnce([launchLog({ blockNumber: 7_001n })]);
    publicClient.getBlock.mockRejectedValueOnce(new Error("block unavailable"));

    await startTokenLaunchedListener(LAUNCHPAD, logger);

    expect(tokenLaunchesDb.insertTokenLaunch).not.toHaveBeenCalled();
    expect(pollerParams().resumeNoLaterThan).toBe(7_001n);
  });

  // With no cursor the poller would start at the head it reads — later than
  // the scan's, so blocks mined during the scan would be skipped.
  it("starts the live poller right after the block a completed scan reached", async () => {
    await startTokenLaunchedListener(LAUNCHPAD, logger);
    expect(pollerParams().resumeNoLaterThan).toBe(10_001n);
  });

  it("starts at the lookback window's start when the scan failed before learning its window", async () => {
    publicClient.getBlockNumber.mockRejectedValueOnce(new Error("rpc down")).mockResolvedValue(10_000n);
    await startTokenLaunchedListener(LAUNCHPAD, logger);
    expect(pollerParams().resumeNoLaterThan).toBe(5_000n);
  });

  it("resumes from the stored cursor when the scan failed before learning its window", async () => {
    storedCursor = 9_000n;
    publicClient.getBlockNumber.mockRejectedValueOnce(new Error("rpc down"));
    await startTokenLaunchedListener(LAUNCHPAD, logger);
    expect(pollerParams().resumeNoLaterThan).toBeUndefined();
  });
});

// launchTradeListener indexes launches too. Whichever listener's insert wins
// broadcasts, and only that one.
describe("launch indexing shared by both listeners", () => {
  it("broadcasts once when the trade listener indexes the launch first", async () => {
    publicClient.getContractEvents.mockResolvedValue([launchLog()]);
    await __test.discoverLaunches({ launchpad: LAUNCHPAD, totalSupply: SUPPLY, fromBlock: 90n, toBlock: 110n, logger, sseService: sse });
    await processTokenLaunchedLog(launchLog(), SUPPLY, logger, sse);
    expect(launchedBroadcasts()).toHaveLength(1);
    expect(poolFilter()).toEqual([{ id: [POOL] }]);
  });

  it("broadcasts once when the launch listener indexes it first", async () => {
    await processTokenLaunchedLog(launchLog(), SUPPLY, logger, sse);
    publicClient.getContractEvents.mockResolvedValue([launchLog()]);
    await __test.discoverLaunches({ launchpad: LAUNCHPAD, totalSupply: SUPPLY, fromBlock: 90n, toBlock: 110n, logger, sseService: sse });
    expect(launchedBroadcasts()).toHaveLength(1);
  });

  it("fails the range when the launch cannot be indexed (its trades need the row)", async () => {
    publicClient.getContractEvents.mockResolvedValue([launchLog()]);
    tokenLaunchesDb.insertTokenLaunch.mockRejectedValueOnce(new Error("db down"));
    await expect(
      __test.discoverLaunches({ launchpad: LAUNCHPAD, totalSupply: SUPPLY, fromBlock: 90n, toBlock: 110n, logger }),
    ).rejects.toThrow("db down");
  });

  // Its trades would fail the launch_trades foreign key forever.
  it("does not watch the pool of a launch skipped as unstorable", async () => {
    publicClient.getContractEvents.mockResolvedValue([launchLog()]);
    tokenLaunchesDb.insertTokenLaunch.mockRejectedValueOnce(Object.assign(new Error("bad"), { code: "22P05" }));
    await __test.discoverLaunches({ launchpad: LAUNCHPAD, totalSupply: SUPPLY, fromBlock: 90n, toBlock: 110n, logger });
    expect(poolFilter()).toBeNull();
  });
});

describe("launchTradeListener launch discovery", () => {
  const discover = (fromBlock, toBlock) =>
    __test.discoverLaunches({ launchpad: LAUNCHPAD, totalSupply: SUPPLY, fromBlock, toBlock, logger });

  // Every poller tick (and every retry of a failed range) used to re-read
  // TokenLaunched for blocks already read.
  it("reads only the blocks not already read for launches", async () => {
    await discover(100n, 200n);
    await discover(150n, 250n);
    await discover(100n, 250n);
    await discover(251n, 260n);
    expect(queriesFor("TokenLaunched").map((q) => [q.fromBlock, q.toBlock])).toEqual([
      [100n, 200n],
      [201n, 250n],
      [251n, 260n],
    ]);
  });

  it("reads a range outside the span already read in full", async () => {
    await discover(1_000n, 1_100n);
    await discover(10n, 20n);
    expect(queriesFor("TokenLaunched").map((q) => [q.fromBlock, q.toBlock])).toEqual([
      [1_000n, 1_100n],
      [10n, 20n],
    ]);
  });

  it("re-reads a range whose discovery failed", async () => {
    publicClient.getContractEvents.mockRejectedValueOnce(new Error("bad range"));
    await expect(discover(100n, 200n)).rejects.toThrow("bad range");
    await discover(100n, 200n);
    expect(queriesFor("TokenLaunched")).toHaveLength(2);
  });

  it("the poller's filter skips blocks the boot scan covered, and still never goes unfiltered", async () => {
    await startLaunchTradeListener({ poolManager: POOL_MANAGER, launchpad: LAUNCHPAD, logger });
    const before = queriesFor("TokenLaunched").length;
    // No launches anywhere: nothing to watch -> null, not an unfiltered query.
    expect(await pollerParams().args({ fromBlock: 9_500n, toBlock: 10_000n })).toBeNull();
    expect(queriesFor("TokenLaunched")).toHaveLength(before);
    await pollerParams().args({ fromBlock: 9_500n, toBlock: 10_010n });
    expect(queriesFor("TokenLaunched").slice(before).map((q) => [q.fromBlock, q.toBlock])).toEqual([[10_001n, 10_010n]]);
  });
});

describe("launchTradeListener boot scan", () => {
  // RPCs reject wide getLogs ranges; the lookback window is read in chunks.
  it("reads launches over the lookback window in chunks of at most 2,000 blocks", async () => {
    await startLaunchTradeListener({ poolManager: POOL_MANAGER, launchpad: LAUNCHPAD, logger });

    const launchQueries = queriesFor("TokenLaunched");
    expect(launchQueries.length).toBeGreaterThan(1);
    for (const q of launchQueries) expect(q.toBlock - q.fromBlock).toBeLessThanOrEqual(2_000n);
    expect(launchQueries[0].fromBlock).toBe(5_000n);
    expect(launchQueries.at(-1).toBlock).toBe(10_000n);
  });

  it("starts the live poller at the window's start when the scan fails", async () => {
    publicClient.getContractEvents.mockRejectedValueOnce(new Error("range too large"));
    await startLaunchTradeListener({ poolManager: POOL_MANAGER, launchpad: LAUNCHPAD, logger });
    expect(pollerParams().resumeNoLaterThan).toBe(5_000n);
  });

  // First deploy (no cursor): the poller would start at a head read after the
  // scan, skipping the blocks mined while it ran.
  it("starts the live poller right after the block a completed scan reached", async () => {
    await startLaunchTradeListener({ poolManager: POOL_MANAGER, launchpad: LAUNCHPAD, logger });
    expect(pollerParams().resumeNoLaterThan).toBe(10_001n);
  });

  it("starts at the lookback window's start when the head read failed (no cursor)", async () => {
    publicClient.getBlockNumber.mockRejectedValueOnce(new Error("rpc down")).mockResolvedValue(10_000n);
    await startLaunchTradeListener({ poolManager: POOL_MANAGER, launchpad: LAUNCHPAD, logger });
    expect(pollerParams().resumeNoLaterThan).toBe(5_000n);
  });

  it("resumes from the stored cursor when the head read failed", async () => {
    storedCursor = 9_000n;
    publicClient.getBlockNumber.mockRejectedValueOnce(new Error("rpc down"));
    await startLaunchTradeListener({ poolManager: POOL_MANAGER, launchpad: LAUNCHPAD, logger });
    expect(pollerParams().resumeNoLaterThan).toBeUndefined();
  });

  // The poller starts at the stored cursor + 1 when that is earlier than
  // resumeNoLaterThan, so without saving the scanned head it re-processed the
  // whole window the scan had just stored.
  it.each([
    ["no stored cursor", null],
    ["a stored cursor inside the window", 9_000n],
  ])("saves the scanned head as the cursor after a completed scan (%s)", async (_label, stored) => {
    storedCursor = stored;
    await startLaunchTradeListener({ poolManager: POOL_MANAGER, launchpad: LAUNCHPAD, logger });
    expect(cursorSet).toHaveBeenCalledWith(10_000n);
    expect(storedCursor).toBe(10_000n); // what the poller reads: it resumes at 10,001
    expect(pollerParams().resumeNoLaterThan).toBe(10_001n);
  });

  // The blocks between an old cursor and the window were never scanned.
  it("keeps a cursor older than the window, so the poller still covers the gap", async () => {
    storedCursor = 2_000n;
    await startLaunchTradeListener({ poolManager: POOL_MANAGER, launchpad: LAUNCHPAD, logger });
    expect(cursorSet).not.toHaveBeenCalled();
  });

  it("does not move the cursor when the scan fails", async () => {
    publicClient.getContractEvents.mockRejectedValueOnce(new Error("range too large"));
    await startLaunchTradeListener({ poolManager: POOL_MANAGER, launchpad: LAUNCHPAD, logger });
    expect(cursorSet).not.toHaveBeenCalled();
  });
});

// A scan that failed before learning its window left the router history
// starting at the lookback window, while the poller resumed from an older
// stored cursor: replayed swaps through an earlier router would store the
// router as the trader.
describe("launchTradeListener router history after a scan that never learned its window", () => {
  const firstRouterQuery = async () => {
    await __test.trustedRouters(LAUNCHPAD, 10_000n);
    return queriesFor("RouterUpdated")[0].fromBlock;
  };

  it("starts at the stored cursor's next block", async () => {
    storedCursor = 2_000n;
    publicClient.getBlockNumber.mockRejectedValueOnce(new Error("rpc down"));
    await startLaunchTradeListener({ poolManager: POOL_MANAGER, launchpad: LAUNCHPAD, logger });
    expect(pollerParams().resumeNoLaterThan).toBeUndefined(); // the poller resumes at 2,001
    expect(await firstRouterQuery()).toBe(2_001n);
  });

  it("starts at the window the poller resumes from, with no cursor", async () => {
    publicClient.getBlockNumber.mockRejectedValueOnce(new Error("rpc down")).mockResolvedValue(10_000n);
    await startLaunchTradeListener({ poolManager: POOL_MANAGER, launchpad: LAUNCHPAD, logger });
    expect(await firstRouterQuery()).toBe(5_000n);
  });

  it("starts at the deploy block when known", async () => {
    storedCursor = 2_000n;
    publicClient.getBlockNumber.mockRejectedValueOnce(new Error("rpc down"));
    await startLaunchTradeListener({ poolManager: POOL_MANAGER, launchpad: LAUNCHPAD, logger, deployBlock: 1_234n });
    expect(await firstRouterQuery()).toBe(1_234n);
  });
});

describe("launchTradeListener trusted routers", () => {
  const routerSwap = (i, sender, over = {}) => swap(i, { args: { ...swap(i).args, sender }, ...over });

  // Routers lived only in memory: after a restart, replayed swaps through an
  // earlier router stored the router as the trader.
  it("trusts every router in the launchpad's RouterUpdated history after a restart", async () => {
    eventsByName({ RouterUpdated: [{ args: { previous: OLD_ROUTER, current: ROUTER } }] });
    await startLaunchTradeListener({ poolManager: POOL_MANAGER, launchpad: LAUNCHPAD, logger });
    __test.rememberPool(POOL, TOKEN, "POND");

    await __test.persist([routerSwap(1, OLD_ROUTER)], ctx, undefined);

    expect(publicClient.getTransactionReceipt).toHaveBeenCalledWith({ hash: "0xtx1" });
    const trusted = await __test.trustedRouters(LAUNCHPAD, 10_000n);
    expect([...trusted].sort()).toEqual([OLD_ROUTER, ROUTER].sort());
  });

  it("reads the history from the launchpad's deploy block when known, in chunks", async () => {
    await startLaunchTradeListener({ poolManager: POOL_MANAGER, launchpad: LAUNCHPAD, logger, deployBlock: 1_234n });
    const q = queriesFor("RouterUpdated");
    expect(q[0].fromBlock).toBe(1_234n);
    expect(q.at(-1).toBlock).toBe(10_000n);
    for (const r of q) expect(r.toBlock - r.fromBlock).toBeLessThanOrEqual(2_000n);
  });

  it("reads the history from the stored cursor when it is older than the lookback window", async () => {
    storedCursor = 2_000n;
    await startLaunchTradeListener({ poolManager: POOL_MANAGER, launchpad: LAUNCHPAD, logger });
    expect(queriesFor("RouterUpdated")[0].fromBlock).toBe(2_001n);
  });

  it("falls back to the lookback window without a deploy block or older cursor", async () => {
    await startLaunchTradeListener({ poolManager: POOL_MANAGER, launchpad: LAUNCHPAD, logger });
    expect(queriesFor("RouterUpdated")[0].fromBlock).toBe(5_000n);
  });

  // A router swapped in after boot must be trusted before its first swap is
  // attributed, or that swap stores the router as the trader for good.
  it("keeps the history current up to the newest swap before attributing", async () => {
    const NEW_ROUTER = "0x5555555555555555555555555555555555555555";
    await startLaunchTradeListener({ poolManager: POOL_MANAGER, launchpad: LAUNCHPAD, logger });
    __test.rememberPool(POOL, TOKEN, "POND");
    eventsByName({
      RouterUpdated: ({ fromBlock, toBlock }) =>
        fromBlock <= 10_040n && toBlock >= 10_040n ? [{ args: { previous: ROUTER, current: NEW_ROUTER } }] : [],
    });

    await __test.persist([routerSwap(9_850, NEW_ROUTER)], ctx, undefined); // block 10,050

    const q = queriesFor("RouterUpdated").at(-1);
    expect([q.fromBlock, q.toBlock]).toEqual([10_001n, 10_050n]);
    expect(publicClient.getTransactionReceipt).toHaveBeenCalledWith({ hash: "0xtx9850" });
  });

  it("does not re-read history it already has", async () => {
    await startLaunchTradeListener({ poolManager: POOL_MANAGER, launchpad: LAUNCHPAD, logger });
    __test.rememberPool(POOL, TOKEN, "POND");
    const before = queriesFor("RouterUpdated").length;
    await __test.persist([swap(1)], ctx, undefined); // block 201, long covered
    expect(queriesFor("RouterUpdated")).toHaveLength(before);
  });

  it("throws, storing nothing, when the history cannot be brought up to the swaps", async () => {
    __test.rememberPool(POOL, TOKEN, "POND");
    publicClient.getContractEvents.mockRejectedValueOnce(new Error("logs unavailable"));
    await expect(__test.persist([swap(9_850)], ctx, sse)).rejects.toThrow("launch router unknown");
    expect(tokenLaunchesDb.insertLaunchTrades).not.toHaveBeenCalled();
  });
});

describe("launchTradeListener.persist", () => {
  beforeEach(() => __test.rememberPool(POOL, TOKEN, "POND"));

  // The poller only keeps its cursor still if the handler throws.
  it("throws when the trades cannot be stored", async () => {
    tokenLaunchesDb.insertLaunchTrades.mockRejectedValueOnce(new Error("insert failed"));
    await expect(__test.persist([swap(1)], ctx, sse)).rejects.toThrow("insert failed");
    expect(sse.broadcast).not.toHaveBeenCalled();
  });

  // A row stored with block_time NULL is never repaired (duplicates are
  // ignored on retry), so a missing block fails the range instead.
  it("throws, storing nothing, when a block time is unavailable", async () => {
    publicClient.getBlock.mockRejectedValueOnce(new Error("block unavailable"));
    await expect(__test.persist([swap(1)], ctx, sse)).rejects.toThrow("block unavailable");
    expect(tokenLaunchesDb.insertLaunchTrades).not.toHaveBeenCalled();
  });

  it("throws when the launch router has never been read (it would store the router as trader)", async () => {
    publicClient.readContract.mockRejectedValueOnce(new Error("rpc down"));
    await expect(__test.persist([swap(1)], ctx, sse)).rejects.toThrow("launch router unknown");
    expect(tokenLaunchesDb.insertLaunchTrades).not.toHaveBeenCalled();
  });

  // A restart or a retried range re-sends trades already stored; broadcasting
  // them would announce old trades as live.
  it("broadcasts only the trades the insert actually stored", async () => {
    tokenLaunchesDb.insertLaunchTrades.mockResolvedValueOnce([{ tx_hash: "0xtx2", log_index: 0 }]);
    await __test.persist([swap(1), swap(2)], ctx, sse);
    const trades = sse.broadcast.mock.calls.filter(([, e]) => e.type === "TokenTrade");
    expect(trades.map(([, e]) => e.txHash)).toEqual(["0xtx2"]);
  });

  it("broadcasts nothing for a fully replayed batch", async () => {
    tokenLaunchesDb.insertLaunchTrades.mockResolvedValueOnce([]);
    await __test.persist([swap(1), swap(2)], ctx, sse);
    expect(sse.broadcast).not.toHaveBeenCalled();
  });

  it("broadcasts every trade of a new batch", async () => {
    await __test.persist([swap(1), swap(2)], ctx, sse);
    expect(sse.broadcast.mock.calls.filter(([, e]) => e.type === "TokenTrade")).toHaveLength(2);
  });

  it("fetches receipts only for swaps sent by the launch router", async () => {
    await __test.persist([swap(1), swap(2, { args: { ...swap(2).args, sender: ROUTER } })], ctx, sse);
    expect(publicClient.getTransactionReceipt).toHaveBeenCalledTimes(1);
    expect(publicClient.getTransactionReceipt).toHaveBeenCalledWith({ hash: "0xtx2" });
    expect(tokenLaunchesDb.insertLaunchTrades.mock.calls[0][0]).toHaveLength(2);
  });

  it(`fetches blocks concurrently, at most ${FETCH_CONCURRENCY} at a time`, async () => {
    let inFlight = 0;
    let peak = 0;
    publicClient.getBlock.mockImplementation(async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight -= 1;
      return { timestamp: 1_700_000_000n };
    });
    await __test.persist(Array.from({ length: 12 }, (_, i) => swap(i)), ctx, undefined);
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(FETCH_CONCURRENCY);
    expect(publicClient.getBlock).toHaveBeenCalledTimes(12);
  });
});

describe("launchTradeListener.poolFilter", () => {
  it("is null with no pools — nothing to watch, never unfiltered", () => {
    expect(poolFilter()).toBeNull();
  });

  // An ever-growing OR-list in one getLogs eventually exceeds what an RPC
  // accepts; it is split into batches, one query each.
  it(`batches pool ids, at most ${MAX_POOL_IDS_PER_QUERY} per query`, () => {
    for (let i = 0; i < 250; i++) __test.rememberPool(`0x${i.toString(16).padStart(64, "0")}1`, TOKEN, "T");
    const batches = poolFilter();
    expect(batches.map((b) => b.id.length)).toEqual([100, 100, 50]);
    expect(new Set(batches.flatMap((b) => b.id)).size).toBe(250);
  });
});
