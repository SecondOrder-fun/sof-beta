import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { startContractEventPolling } from "../../src/lib/contractEventPolling.js";
import {
  registerSharedHead,
  __resetSharedHeads,
} from "../../src/lib/blockHead.js";

// Minimal ABI with a single event
const testAbi = [
  {
    type: "event",
    name: "TestEvent",
    inputs: [{ name: "value", type: "uint256", indexed: false }],
  },
];

describe("startContractEventPolling", () => {
  let mockClient;

  beforeEach(() => {
    vi.useFakeTimers();
    mockClient = {
      getBlockNumber: vi.fn().mockResolvedValue(100n),
      getContractEvents: vi.fn().mockResolvedValue([]),
    };
  });

  afterEach(() => {
    __resetSharedHeads();
    vi.useRealTimers();
  });

  it("throws on missing required params", async () => {
    await expect(
      startContractEventPolling({
        address: "0x1",
        abi: testAbi,
        eventName: "TestEvent",
        onLogs: () => {},
      }),
    ).rejects.toThrow("client is required");

    await expect(
      startContractEventPolling({
        client: mockClient,
        abi: testAbi,
        eventName: "TestEvent",
        onLogs: () => {},
      }),
    ).rejects.toThrow("address is required");
  });

  it("starts from current block + 1 when no startBlock or cursor", async () => {
    const onLogs = vi.fn();

    const unwatch = await startContractEventPolling({
      client: mockClient,
      address: "0xABC",
      abi: testAbi,
      eventName: "TestEvent",
      pollingIntervalMs: 1_000,
      onLogs,
    });

    // First tick runs immediately — getBlockNumber returns 100n
    // lastProcessedBlock should be 101n (currentBlock + 1), so no new blocks to fetch
    await vi.advanceTimersByTimeAsync(0);
    expect(mockClient.getContractEvents).not.toHaveBeenCalled();

    await unwatch();
  });

  it("resumes from blockCursor when available", async () => {
    const onLogs = vi.fn();
    const blockCursor = {
      get: vi.fn().mockResolvedValue(50n),
      set: vi.fn().mockResolvedValue(undefined),
    };

    // Block 50 was last processed, so start from 51
    // Current block is 100
    mockClient.getBlockNumber.mockResolvedValue(100n);
    mockClient.getContractEvents.mockResolvedValue([
      { args: { value: 42n }, blockNumber: 55n },
    ]);

    const unwatch = await startContractEventPolling({
      client: mockClient,
      address: "0xABC",
      abi: testAbi,
      eventName: "TestEvent",
      pollingIntervalMs: 1_000,
      blockCursor,
      onLogs,
    });

    // Wait for the initial tick to process
    await vi.advanceTimersByTimeAsync(0);

    // Should have called getContractEvents starting from block 51
    expect(mockClient.getContractEvents).toHaveBeenCalled();
    const callArgs = mockClient.getContractEvents.mock.calls[0][0];
    expect(callArgs.fromBlock).toBe(51n);

    // onLogs should have been called with our mock log
    expect(onLogs).toHaveBeenCalledWith([
      { args: { value: 42n }, blockNumber: 55n },
    ]);

    // blockCursor.set should have been called with the latest block
    expect(blockCursor.set).toHaveBeenCalledWith(100n);

    await unwatch();
  });

  it("uses explicit startBlock over blockCursor", async () => {
    const blockCursor = {
      get: vi.fn().mockResolvedValue(50n),
      set: vi.fn(),
    };

    const unwatch = await startContractEventPolling({
      client: mockClient,
      address: "0xABC",
      abi: testAbi,
      eventName: "TestEvent",
      startBlock: 75n,
      pollingIntervalMs: 1_000,
      blockCursor,
      onLogs: vi.fn(),
    });

    // blockCursor.get should NOT have been called since explicit startBlock takes priority
    expect(blockCursor.get).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(0);

    // Should start from block 75
    expect(mockClient.getContractEvents).toHaveBeenCalled();
    const callArgs = mockClient.getContractEvents.mock.calls[0][0];
    expect(callArgs.fromBlock).toBe(75n);

    await unwatch();
  });

  it("awaits blockCursor.flush() when stop fn is invoked", async () => {
    // The stop fn returned by startContractEventPolling is the graceful
    // shutdown hook; it must await the cursor's flush() so server.js
    // can include it in the app.close()-ordered drain. Without this,
    // the buffered cursor value is lost on every deploy.
    let flushResolve;
    const flushPromise = new Promise((resolve) => {
      flushResolve = resolve;
    });
    const blockCursor = {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue(undefined),
      flush: vi.fn(() => flushPromise),
    };

    const unwatch = await startContractEventPolling({
      client: mockClient,
      address: "0xABC",
      abi: testAbi,
      eventName: "TestEvent",
      pollingIntervalMs: 1_000,
      blockCursor,
      onLogs: vi.fn(),
    });

    await vi.advanceTimersByTimeAsync(0);

    // Stop fn returns a Promise — it must NOT resolve before flush settles.
    const stopPromise = unwatch();
    expect(blockCursor.flush).toHaveBeenCalledTimes(1);

    // Resolve the flush and verify stop completes.
    flushResolve();
    await stopPromise;
  });

  it("does not advance cursor past unprocessed chunks when stopped mid-catchup", async () => {
    // Regression: previously the tick set lastProcessedBlock = currentBlock + 1
    // and persisted cursor.set(currentBlock) unconditionally after the chunked
    // loop, even when `stopped` flipped true between chunks. With the new
    // awaited shutdown flush, that lie was being committed to Supabase, so
    // every event in the unfinished block range was silently dropped on the
    // next process boot. The fix tracks the actual last-processed block via
    // the loop's `fromBlock` cursor.
    const blockCursor = {
      get: vi.fn().mockResolvedValue(0n),
      set: vi.fn().mockResolvedValue(undefined),
      flush: vi.fn().mockResolvedValue(undefined),
    };

    // currentBlock=4000, lastProcessed=1, maxBlockRange=2000 → need 2 chunks
    // [1..2001] and [2002..4000]. We make the FIRST getContractEvents call
    // succeed, then trigger stop() before the second chunk can run.
    mockClient.getBlockNumber.mockResolvedValue(4000n);
    let stopTrigger;
    mockClient.getContractEvents = vi.fn().mockImplementation(async (args) => {
      // After processing the first chunk, signal the test to stop the poller
      // before the loop's next iteration check.
      if (args.fromBlock === 1n) {
        queueMicrotask(() => stopTrigger());
        return [];
      }
      return [];
    });

    const unwatch = await startContractEventPolling({
      client: mockClient,
      address: "0xABC",
      abi: testAbi,
      eventName: "TestEvent",
      pollingIntervalMs: 1_000,
      maxBlockRange: 2000n,
      blockCursor,
      onLogs: vi.fn(),
    });

    const stopPromise = new Promise((resolve) => {
      stopTrigger = () => resolve(unwatch());
    });
    await stopPromise;

    // cursor.set must have been called with the END of the first chunk
    // (block 2001), NOT with the chain head (4000n) which would falsely
    // claim we processed the skipped second chunk.
    const setCalls = blockCursor.set.mock.calls.map((c) => c[0]);
    expect(setCalls).toContain(2001n);
    expect(setCalls).not.toContain(4000n);
  });

  it("drains in-flight tick before flushing on stop", async () => {
    // The stop fn must await any tick that is currently running so its
    // trailing `await blockCursor.set(currentBlock)` lands in the buffer
    // BEFORE flush() reads it. Without this, the most-recent block
    // observed by the listener would silently fail to persist on
    // graceful shutdown — defeating the bounded-rescan guarantee.
    let resolveBlockNumber;
    const blockNumberPromise = new Promise((resolve) => {
      resolveBlockNumber = resolve;
    });
    // First call (setup) resolves immediately; second call (tick) blocks
    // until we explicitly resolve it.
    mockClient.getBlockNumber
      .mockResolvedValueOnce(50n)
      .mockReturnValueOnce(blockNumberPromise);

    const flushOrder = [];
    const blockCursor = {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockImplementation(async (block) => {
        flushOrder.push(`set(${block})`);
      }),
      flush: vi.fn().mockImplementation(async () => {
        flushOrder.push("flush");
      }),
    };

    const unwatch = await startContractEventPolling({
      client: mockClient,
      address: "0xABC",
      abi: testAbi,
      eventName: "TestEvent",
      pollingIntervalMs: 1_000,
      blockCursor,
      onLogs: vi.fn(),
    });

    // Trigger the interval to fire — tick runs and blocks on the
    // pending getBlockNumber promise.
    await vi.advanceTimersByTimeAsync(1_000);

    // Initiate stop while the tick is still mid-flight.
    const stopPromise = unwatch();

    // Now let the tick complete by resolving its getBlockNumber.
    // currentBlock=60 > lastProcessedBlock=51, so it will call
    // blockCursor.set(60) at the tail of the tick.
    resolveBlockNumber(60n);
    await stopPromise;

    // SOME set() must come before flush() — confirms the tick's
    // trailing write landed in the buffer before flush ran. The exact
    // block value depends on whether the loop processed any chunks
    // before stopped flipped true; for this test it's the "no chunks
    // processed" case (set is called with lastProcessedBlock - 1).
    const setIdx = flushOrder.findIndex((s) => s.startsWith("set("));
    const flushIdx = flushOrder.indexOf("flush");
    expect(setIdx).toBeGreaterThanOrEqual(0);
    expect(flushIdx).toBeGreaterThanOrEqual(0);
    expect(setIdx).toBeLessThan(flushIdx);
  });

  it("stop fn tolerates cursors without flush() (back-compat)", async () => {
    // Older cursor implementations only had {get, set}. The typeof guard
    // must skip flush silently rather than throwing.
    const blockCursor = {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue(undefined),
    };

    const unwatch = await startContractEventPolling({
      client: mockClient,
      address: "0xABC",
      abi: testAbi,
      eventName: "TestEvent",
      pollingIntervalMs: 1_000,
      blockCursor,
      onLogs: vi.fn(),
    });

    await vi.advanceTimersByTimeAsync(0);
    await expect(unwatch()).resolves.toBeUndefined();
  });

  it("reads the chain head from a shared tracker instead of its own getBlockNumber", async () => {
    // When a shared head tracker is registered for the client, the poller must
    // NOT issue its own getBlockNumber/getBlock — that redundant pair, fired by
    // every listener every tick, was the dominant Tenderly RPC load.
    const tracker = registerSharedHead(mockClient);
    vi.spyOn(tracker, "getHead").mockResolvedValue({
      blockNumber: 100n,
      timestamp: 1700000000n,
    });

    mockClient.getBlock = vi.fn();
    const blockCursor = {
      get: vi.fn().mockResolvedValue(50n),
      set: vi.fn().mockResolvedValue(undefined),
    };
    mockClient.getContractEvents.mockResolvedValue([]);

    const unwatch = await startContractEventPolling({
      client: mockClient,
      address: "0xABC",
      abi: testAbi,
      eventName: "TestEvent",
      pollingIntervalMs: 1_000,
      blockCursor,
      onLogs: vi.fn(),
    });

    await vi.advanceTimersByTimeAsync(0);

    expect(tracker.getHead).toHaveBeenCalled();
    expect(mockClient.getBlockNumber).not.toHaveBeenCalled();
    expect(mockClient.getBlock).not.toHaveBeenCalled();
    // Still scans from cursor+1 (51) up to the shared head (100).
    expect(mockClient.getContractEvents).toHaveBeenCalledWith(
      expect.objectContaining({ fromBlock: 51n }),
    );

    await unwatch();
  });

  it("backs off after a rate-limit error instead of retrying every tick", async () => {
    // LimitExceededRpcError is what the Tenderly gateway returns. On hitting
    // it the poller must enter a cooldown and skip subsequent ticks rather
    // than re-firing getContractEvents on the very next interval and adding
    // to the storm.
    mockClient.getBlockNumber.mockResolvedValue(100n);
    const rateLimitError = new Error(
      "Request exceeds defined limit.\n\nDetails: rate limit exceeded",
    );
    rateLimitError.name = "LimitExceededRpcError";
    mockClient.getContractEvents.mockRejectedValue(rateLimitError);

    const blockCursor = {
      get: vi.fn().mockResolvedValue(50n),
      set: vi.fn().mockResolvedValue(undefined),
    };
    const onError = vi.fn();

    const unwatch = await startContractEventPolling({
      client: mockClient,
      address: "0xABC",
      abi: testAbi,
      eventName: "TestEvent",
      pollingIntervalMs: 1_000,
      blockCursor,
      onError,
      onLogs: vi.fn(),
    });

    // First tick fails once.
    await vi.advanceTimersByTimeAsync(0);
    expect(mockClient.getContractEvents).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledTimes(1);

    // Next interval lands inside the cooldown window — no new RPC call.
    await vi.advanceTimersByTimeAsync(1_000);
    expect(mockClient.getContractEvents).toHaveBeenCalledTimes(1);

    await unwatch();
  });

  it("backs off on an HTTP 429 (viem HttpRequestError), not just JSON-RPC limit errors", async () => {
    // Tenderly can throttle via an HTTP 429 instead of a JSON-RPC
    // LimitExceededRpcError. viem renders that as an HttpRequestError whose
    // message says "Status: 429" (NOT "responded with 429") and which carries
    // a numeric `.status`. The poller must recognize it and back off.
    mockClient.getBlockNumber.mockResolvedValue(100n);
    const httpError = new Error("HTTP request failed.\n\nStatus: 429\nURL: x");
    httpError.name = "HttpRequestError";
    httpError.status = 429;
    mockClient.getContractEvents.mockRejectedValue(httpError);

    const blockCursor = {
      get: vi.fn().mockResolvedValue(50n),
      set: vi.fn().mockResolvedValue(undefined),
    };

    const unwatch = await startContractEventPolling({
      client: mockClient,
      address: "0xABC",
      abi: testAbi,
      eventName: "TestEvent",
      pollingIntervalMs: 1_000,
      blockCursor,
      onError: vi.fn(),
      onLogs: vi.fn(),
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(mockClient.getContractEvents).toHaveBeenCalledTimes(1);

    // In cooldown — no re-fire on the next interval.
    await vi.advanceTimersByTimeAsync(1_000);
    expect(mockClient.getContractEvents).toHaveBeenCalledTimes(1);

    await unwatch();
  });

  it("resumes polling after the backoff cooldown expires", async () => {
    mockClient.getBlockNumber.mockResolvedValue(100n);
    const rateLimitError = new Error("rate limit exceeded");
    rateLimitError.name = "LimitExceededRpcError";
    mockClient.getContractEvents.mockRejectedValueOnce(rateLimitError);
    // After the first failure, subsequent calls succeed.
    mockClient.getContractEvents.mockResolvedValue([]);

    const blockCursor = {
      get: vi.fn().mockResolvedValue(50n),
      set: vi.fn().mockResolvedValue(undefined),
    };

    const unwatch = await startContractEventPolling({
      client: mockClient,
      address: "0xABC",
      abi: testAbi,
      eventName: "TestEvent",
      pollingIntervalMs: 1_000,
      blockCursor,
      onError: vi.fn(),
      onLogs: vi.fn(),
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(mockClient.getContractEvents).toHaveBeenCalledTimes(1);

    // Advance well past the maximum first-failure cooldown.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(mockClient.getContractEvents.mock.calls.length).toBeGreaterThan(1);

    await unwatch();
  });

  it("persists block on each successful tick", async () => {
    const blockCursor = {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue(undefined),
    };

    mockClient.getBlockNumber
      .mockResolvedValueOnce(100n) // initial
      .mockResolvedValueOnce(100n) // first tick
      .mockResolvedValueOnce(105n); // second tick

    const unwatch = await startContractEventPolling({
      client: mockClient,
      address: "0xABC",
      abi: testAbi,
      eventName: "TestEvent",
      pollingIntervalMs: 1_000,
      blockCursor,
      onLogs: vi.fn(),
    });

    // First tick — no new blocks (starts at 101, current is 100)
    await vi.advanceTimersByTimeAsync(0);

    // Advance to second tick (current block 105)
    await vi.advanceTimersByTimeAsync(1_000);

    // blockCursor.set should have been called with 105n
    expect(blockCursor.set).toHaveBeenCalledWith(105n);

    await unwatch();
  });
});
