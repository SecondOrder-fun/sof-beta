// tests/services/positionCache.test.js
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const hoisted = vi.hoisted(() => ({
  cacheRead: vi.fn(),
  cacheInvalidatePattern: vi.fn(),
}));

vi.mock("../../shared/redisCache.js", async (orig) => {
  const actual = await orig();
  return {
    ...actual,
    cacheRead: hoisted.cacheRead,
    cacheInvalidatePattern: hoisted.cacheInvalidatePattern,
  };
});

// db is imported by the service; stub it so import doesn't touch network.
vi.mock("../../shared/supabaseClient.js", () => ({
  db: { client: { from: vi.fn() } },
}));
vi.mock("../../src/lib/viemClient.js", () => ({ publicClient: {} }));

import { infoFiPositionService } from "../../src/services/infoFiPositionService.js";
import { POSITIONS_KEY_PREFIX } from "../../shared/redisCache.js";

beforeEach(() => {
  hoisted.cacheRead.mockReset();
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

describe("recordPosition invalidation", () => {
  it("invalidates the market's position + market_info caches after insert", async () => {
    vi.spyOn(infoFiPositionService, "getMarketIdFromFpmm").mockResolvedValue(42);
    const single = vi.fn().mockResolvedValue({ data: { id: 1 }, error: null });
    const selectAfterInsert = vi.fn(() => ({ single }));
    const insert = vi.fn(() => ({ select: selectAfterInsert }));
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    const eqTx = vi.fn(() => ({ maybeSingle }));
    const selectId = vi.fn(() => ({ eq: eqTx }));
    const { db } = await import("../../shared/supabaseClient.js");
    db.client.from = vi.fn(() => ({ select: selectId, insert }));

    await infoFiPositionService.recordPosition({
      fpmmAddress: "0xfpmm",
      trader: "0xTrader",
      buyYes: true,
      amountIn: 10n ** 18n,
      amountOut: 10n ** 18n,
      txHash: "0xhash",
    });

    expect(hoisted.cacheInvalidatePattern).toHaveBeenCalledWith(
      `${POSITIONS_KEY_PREFIX}net:42:*`,
    );
    expect(hoisted.cacheInvalidatePattern).toHaveBeenCalledWith(
      "market_info:42",
    );
  });
});
