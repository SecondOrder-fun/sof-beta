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
vi.mock("../../src/lib/blockCursor.js", () => ({
  createBlockCursor: vi.fn(async () => ({ get: vi.fn(), set: vi.fn(), flush: vi.fn() })),
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

const { processTokenLaunchedLog, startTokenLaunchedListener } = await import(
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

beforeEach(() => {
  vi.clearAllMocks();
  __test.reset();
  publicClient.getBlock.mockResolvedValue({ timestamp: 1_700_000_000n });
  publicClient.getContractEvents.mockResolvedValue([]);
  publicClient.getTransactionReceipt.mockResolvedValue({ logs: [] });
  publicClient.readContract.mockImplementation(async ({ functionName }) =>
    functionName === "router" ? ROUTER : SUPPLY,
  );
  tokenLaunchesDb.insertLaunchTrades.mockResolvedValue(1);
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
    expect(await processTokenLaunchedLog(launchLog(), SUPPLY, logger, sse)).toBe(true);
    expect(await processTokenLaunchedLog(launchLog(), SUPPLY, logger, sse)).toBe(false);
    expect(launchedBroadcasts()).toHaveLength(1);
  });

  it("starts the live poller at a launch the boot scan failed to index", async () => {
    publicClient.getBlockNumber.mockResolvedValue(10_000n);
    publicClient.getContractEvents.mockResolvedValueOnce([launchLog({ blockNumber: 6_123n })]);
    tokenLaunchesDb.insertTokenLaunch.mockRejectedValueOnce(new Error("db down"));

    await startTokenLaunchedListener(LAUNCHPAD, logger);

    expect(startContractEventPolling).toHaveBeenCalledWith(expect.objectContaining({ resumeNoLaterThan: 6_123n }));
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
});

describe("launchTradeListener boot scan", () => {
  // RPCs reject wide getLogs ranges; the lookback window is read in chunks.
  it("reads launches over the lookback window in chunks of at most 2,000 blocks", async () => {
    publicClient.getBlockNumber.mockResolvedValue(10_000n);
    await startLaunchTradeListener({ poolManager: POOL_MANAGER, launchpad: LAUNCHPAD, logger });

    const launchQueries = publicClient.getContractEvents.mock.calls
      .map(([p]) => p)
      .filter((p) => p.eventName === "TokenLaunched");
    expect(launchQueries.length).toBeGreaterThan(1);
    for (const q of launchQueries) expect(q.toBlock - q.fromBlock).toBeLessThanOrEqual(2_000n);
    expect(launchQueries[0].fromBlock).toBe(5_000n);
    expect(launchQueries.at(-1).toBlock).toBe(10_000n);
  });

  it("starts the live poller at the window's start when the scan fails", async () => {
    publicClient.getBlockNumber.mockResolvedValue(10_000n);
    publicClient.getContractEvents.mockRejectedValueOnce(new Error("range too large"));
    await startLaunchTradeListener({ poolManager: POOL_MANAGER, launchpad: LAUNCHPAD, logger });
    expect(startContractEventPolling).toHaveBeenCalledWith(expect.objectContaining({ resumeNoLaterThan: 5_000n }));
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
