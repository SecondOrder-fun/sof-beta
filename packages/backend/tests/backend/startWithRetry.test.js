// @vitest-environment node
// A transient failure while a listener starts (a chain or database read) used
// to leave it stopped until the next deploy. startWithRetry keeps retrying,
// with bounded backoff, and never throws into the server.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  startWithRetry,
  startRetryDelayMs,
  START_RETRY_BASE_MS,
  START_RETRY_MAX_MS,
} from "../../src/lib/startWithRetry.js";

const logger = { info: vi.fn(), error: vi.fn() };

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
});
afterEach(() => vi.useRealTimers());

describe("startRetryDelayMs", () => {
  it("doubles from 5s and caps at 5 minutes", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 20].map((n) => startRetryDelayMs(n))).toEqual([
      5_000, 10_000, 20_000, 40_000, 80_000, 160_000, 300_000, 300_000, 300_000,
    ]);
    expect(START_RETRY_BASE_MS).toBe(5_000);
    expect(START_RETRY_MAX_MS).toBe(300_000);
  });
});

describe("startWithRetry", () => {
  it("starts once when the first attempt succeeds", async () => {
    const unwatch = vi.fn();
    const start = vi.fn(async () => unwatch);
    const handle = startWithRetry({ label: "L", start, logger });
    await handle.ready;
    expect(start).toHaveBeenCalledTimes(1);
    expect(logger.error).not.toHaveBeenCalled();
    await handle.stop();
    expect(unwatch).toHaveBeenCalledTimes(1);
  });

  it("retries a failed start on the backoff schedule until it succeeds, never throwing", async () => {
    const unwatch = vi.fn();
    const start = vi
      .fn()
      .mockRejectedValueOnce(new Error("rpc down"))
      .mockRejectedValueOnce(new Error("db down"))
      .mockResolvedValue(unwatch);
    const handle = startWithRetry({ label: "L", start, logger });
    await expect(handle.ready).resolves.toBeUndefined();
    expect(start).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(4_999);
    expect(start).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(start).toHaveBeenCalledTimes(2); // after 5s

    await vi.advanceTimersByTimeAsync(9_999);
    expect(start).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(start).toHaveBeenCalledTimes(3); // after a further 10s, and it started

    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(start).toHaveBeenCalledTimes(3); // no retries once running
    expect(logger.error).toHaveBeenCalledTimes(2);
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining("L started after 2 failed attempt(s)"));

    await handle.stop();
    expect(unwatch).toHaveBeenCalledTimes(1);
  });

  it("keeps retrying at the cap", async () => {
    const start = vi.fn(async () => {
      throw new Error("down");
    });
    startWithRetry({ label: "L", start, logger, baseMs: 1_000, maxMs: 4_000 });
    await vi.advanceTimersByTimeAsync(1_000 + 2_000 + 4_000 + 4_000 + 4_000);
    expect(start).toHaveBeenCalledTimes(6);
  });

  // Shutdown must not race a late start: a start landing after the listeners
  // were stopped would run with nothing left to stop it.
  it("stop cancels a pending retry", async () => {
    const start = vi.fn(async () => {
      throw new Error("down");
    });
    const handle = startWithRetry({ label: "L", start, logger });
    await handle.ready;
    await handle.stop();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(start).toHaveBeenCalledTimes(1);
  });

  it("stop during an attempt in flight stops what that attempt starts", async () => {
    const unwatch = vi.fn();
    let finish;
    const start = vi.fn(() => new Promise((resolve) => (finish = resolve)));
    const handle = startWithRetry({ label: "L", start, logger });
    const stopped = handle.stop();
    finish(unwatch);
    await stopped;
    expect(unwatch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(start).toHaveBeenCalledTimes(1);
  });

  it("does not retry a start that fails after stop", async () => {
    let fail;
    const start = vi.fn(() => new Promise((_resolve, reject) => (fail = reject)));
    const handle = startWithRetry({ label: "L", start, logger });
    const stopped = handle.stop();
    fail(new Error("down"));
    await stopped;
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(start).toHaveBeenCalledTimes(1);
    expect(logger.error).not.toHaveBeenCalled();
  });
});
