import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  registerSharedHead,
  getSharedHead,
  __resetSharedHeads,
} from "../../src/lib/blockHead.js";
import { chainTimeCache } from "../../src/lib/chainTimeCache.js";

describe("shared block-head tracker", () => {
  let client;

  beforeEach(() => {
    vi.useFakeTimers();
    client = {
      getBlockNumber: vi.fn().mockResolvedValue(100n),
      getBlock: vi.fn().mockResolvedValue({ timestamp: 1700000000n }),
    };
  });

  afterEach(() => {
    __resetSharedHeads();
    vi.useRealTimers();
  });

  it("returns null from getSharedHead before registration", () => {
    expect(getSharedHead(client)).toBeNull();
  });

  it("registration is idempotent — same tracker for same client", () => {
    const a = registerSharedHead(client);
    const b = registerSharedHead(client);
    expect(a).toBe(b);
    expect(getSharedHead(client)).toBe(a);
  });

  it("getHead fetches the head once on first call and caches it", async () => {
    const tracker = registerSharedHead(client);

    const head = await tracker.getHead();
    expect(head.blockNumber).toBe(100n);
    expect(head.timestamp).toBe(1700000000n);
    expect(client.getBlockNumber).toHaveBeenCalledTimes(1);
    expect(client.getBlock).toHaveBeenCalledTimes(1);

    // Second read is served from cache — no further RPC.
    const head2 = await tracker.getHead();
    expect(head2.blockNumber).toBe(100n);
    expect(client.getBlockNumber).toHaveBeenCalledTimes(1);
    expect(client.getBlock).toHaveBeenCalledTimes(1);
  });

  it("shares one head fetch across many concurrent consumers", async () => {
    const tracker = registerSharedHead(client);

    // 10 listeners read the head at the same time.
    const heads = await Promise.all(
      Array.from({ length: 10 }, () => tracker.getHead()),
    );

    expect(heads.every((h) => h.blockNumber === 100n)).toBe(true);
    // The whole point: 10 readers, ONE pair of RPC calls.
    expect(client.getBlockNumber).toHaveBeenCalledTimes(1);
    expect(client.getBlock).toHaveBeenCalledTimes(1);
  });

  it("updates the chain-time cache centrally on refresh", async () => {
    const tracker = registerSharedHead(client);
    await tracker.getHead();
    expect(chainTimeCache.blockNumber).toBe(100);
    expect(chainTimeCache.timestamp).toBe(1700000000);
  });

  it("start() refreshes on an interval; stop() halts it", async () => {
    const tracker = registerSharedHead(client, { intervalMs: 4_000 });
    tracker.start();

    // Primes immediately.
    await vi.advanceTimersByTimeAsync(0);
    expect(client.getBlockNumber).toHaveBeenCalledTimes(1);

    client.getBlockNumber.mockResolvedValue(105n);
    await vi.advanceTimersByTimeAsync(4_000);
    expect(client.getBlockNumber).toHaveBeenCalledTimes(2);
    expect((await tracker.getHead()).blockNumber).toBe(105n);

    tracker.stop();
    await vi.advanceTimersByTimeAsync(8_000);
    // No further refreshes after stop.
    expect(client.getBlockNumber).toHaveBeenCalledTimes(2);
  });

  it("tolerates getBlock failure — head still has blockNumber, timestamp null", async () => {
    client.getBlock.mockRejectedValue(new Error("rate limit exceeded"));
    const tracker = registerSharedHead(client);

    const head = await tracker.getHead();
    expect(head.blockNumber).toBe(100n);
    expect(head.timestamp).toBeNull();
  });
});
