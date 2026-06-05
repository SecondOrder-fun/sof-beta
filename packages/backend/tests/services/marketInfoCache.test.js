// tests/services/marketInfoCache.test.js
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const hoisted = vi.hoisted(() => ({ cacheRead: vi.fn() }));

vi.mock("../../shared/redisCache.js", async (orig) => {
  const actual = await orig();
  return { ...actual, cacheRead: hoisted.cacheRead };
});
vi.mock("../../shared/supabaseClient.js", () => ({
  db: { client: { from: vi.fn() } },
}));
vi.mock("../../src/lib/viemClient.js", () => ({ publicClient: {} }));

import { infoFiPositionService } from "../../src/services/infoFiPositionService.js";
import { MARKET_INFO_KEY_PREFIX } from "../../shared/redisCache.js";

beforeEach(() => hoisted.cacheRead.mockReset());

describe("getMarketInfo caching", () => {
  it("reads through cacheRead keyed by market id with a 20s TTL", async () => {
    const cached = { totalYesPool: "0", totalNoPool: "0", volume: "0" };
    hoisted.cacheRead.mockResolvedValueOnce(cached);

    const result = await infoFiPositionService.getMarketInfo(42);

    expect(result).toEqual(cached);
    const [key, , opts] = hoisted.cacheRead.mock.calls[0];
    expect(key).toBe(`${MARKET_INFO_KEY_PREFIX}42`);
    expect(opts.ttlSeconds).toBe(20);
  });
});
