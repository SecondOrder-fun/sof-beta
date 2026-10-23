// tests/services/positionCache.test.js
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const hoisted = vi.hoisted(() => ({
  cacheRead: vi.fn(),
  cacheInvalidate: vi.fn(),
  cacheInvalidatePattern: vi.fn(),
}));

vi.mock("../../shared/redisCache.js", async (orig) => {
  const actual = await orig();
  return {
    ...actual,
    cacheRead: hoisted.cacheRead,
    cacheInvalidate: hoisted.cacheInvalidate,
    cacheInvalidatePattern: hoisted.cacheInvalidatePattern,
  };
});

// db is imported by the service; stub it so import doesn't touch network.
vi.mock("../../shared/supabaseClient.js", () => ({
  db: { client: { from: vi.fn() } },
}));
vi.mock("../../src/lib/viemClient.js", () => ({ publicClient: {} }));

import { infoFiPositionService } from "../../src/services/infoFiPositionService.js";
import { POSITIONS_KEY_PREFIX, MARKET_INFO_KEY_PREFIX } from "../../shared/redisCache.js";

beforeEach(() => {
  hoisted.cacheRead.mockReset();
  hoisted.cacheInvalidate.mockReset();
  hoisted.cacheInvalidatePattern.mockReset();
});

describe("getNetPosition caching", () => {
  it("reads through cacheRead with a per-market+user key", async () => {
    const cached = { yes: "1", no: "0", net: "1", isHedged: false, numTradesYes: 1, numTradesNo: 0 };
    hoisted.cacheRead.mockResolvedValueOnce(cached);

    const result = await infoFiPositionService.getNetPosition("0xABC", 7);

    expect(result).toEqual(cached);
    expect(hoisted.cacheRead).toHaveBeenCalledTimes(1);
    const [key, , opts] = hoisted.cacheRead.mock.calls[0];
    expect(key).toBe(`${POSITIONS_KEY_PREFIX}net:7:0xabc`);
    expect(opts.ttlSeconds).toBe(20);
  });
});

describe("recordPosition", () => {
  const trade = {
    fpmmAddress: "0xfpmm",
    args: {
      trader: "0xTrader",
      isBuy: true,
      yes: true,
      collateral: 10n ** 18n,
      shares: 2n * 10n ** 18n,
      fee: 2n * 10n ** 16n,
    },
    txHash: "0xhash",
    logIndex: 3,
    blockNumber: 100n,
    blockTime: new Date("2026-10-23T00:00:00Z"),
  };

  const stubUpsert = async (rows) => {
    const select = vi.fn().mockResolvedValue({ data: rows, error: null });
    const upsert = vi.fn(() => ({ select }));
    const { db } = await import("../../shared/supabaseClient.js");
    db.client.from = vi.fn(() => ({ upsert }));
    return upsert;
  };

  it("upserts one row keyed by (tx_hash, log_index) and invalidates the market caches", async () => {
    vi.spyOn(infoFiPositionService, "getMarketIdFromFpmm").mockResolvedValue(42);
    const upsert = await stubUpsert([{ id: 1 }]);

    const result = await infoFiPositionService.recordPosition(trade);

    expect(result).toEqual({ alreadyRecorded: false, data: { id: 1 } });
    const [row, opts] = upsert.mock.calls[0];
    expect(opts).toEqual({ onConflict: "tx_hash,log_index", ignoreDuplicates: true });
    expect(row).toMatchObject({ market_id: 42, side: "BUY", tx_hash: "0xhash", log_index: 3 });
    expect(hoisted.cacheInvalidatePattern).toHaveBeenCalledWith(`${POSITIONS_KEY_PREFIX}net:42:*`);
    expect(hoisted.cacheInvalidate).toHaveBeenCalledWith(`${MARKET_INFO_KEY_PREFIX}42`);
  });

  it("reports a replayed log as already recorded and leaves the caches alone", async () => {
    vi.spyOn(infoFiPositionService, "getMarketIdFromFpmm").mockResolvedValue(42);
    await stubUpsert([]);

    const result = await infoFiPositionService.recordPosition(trade);

    expect(result).toEqual({ alreadyRecorded: true });
    expect(hoisted.cacheInvalidate).not.toHaveBeenCalled();
  });

  it("throws when the FPMM has no market, so the caller retries", async () => {
    vi.spyOn(infoFiPositionService, "getMarketIdFromFpmm").mockResolvedValue(null);
    await expect(infoFiPositionService.recordPosition(trade)).rejects.toThrow(/No market found/);
  });
});
