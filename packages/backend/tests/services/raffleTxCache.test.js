// tests/services/raffleTxCache.test.js
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
vi.mock("../../src/utils/blockRangeQuery.js", () => ({
  queryLogsInChunks: vi.fn(() => []),
}));
vi.mock("@sof/contracts", () => ({ SOFBondingCurveABI: [] }));

import { raffleTransactionService } from "../../src/services/raffleTransactionService.js";
import { RAFFLE_TX_KEY_PREFIX } from "../../shared/redisCache.js";

beforeEach(() => hoisted.cacheRead.mockReset());

describe("getSeasonTransactions caching", () => {
  it("reads through cacheRead keyed by season+pagination, 30s TTL", async () => {
    const cached = { transactions: [{ id: 1 }], total: 1 };
    hoisted.cacheRead.mockResolvedValueOnce(cached);

    const result = await raffleTransactionService.getSeasonTransactions(3, {
      limit: 500,
      offset: 0,
      order: "desc",
    });

    expect(result).toEqual(cached);
    const [key, , opts] = hoisted.cacheRead.mock.calls[0];
    expect(key).toBe(`${RAFFLE_TX_KEY_PREFIX}3:desc:500:0`);
    expect(opts.ttlSeconds).toBe(30);
  });
});
