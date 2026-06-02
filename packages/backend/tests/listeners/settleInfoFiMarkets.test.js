// Regression test for the cache-invalidation contract on the bulk-settle
// path. Both paths that mass-update infofi_markets (the on-chain
// SeasonCompleted listener AND the manual /admin/settle-season endpoint)
// MUST call db.invalidateMarketsCache() after the loop — otherwise the
// cached /markets response serves stale `is_active=true / is_settled=false`
// for up to 30s after each settle.
//
// This file covers the listener path; the corresponding admin endpoint
// is covered by infoFiSettleSeason.test.js.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/lib/viemClient.js", () => ({
  publicClient: {
    readContract: vi.fn(),
  },
  getWalletClient: vi.fn(),
}));

vi.mock("../../src/config/chain.js", () => ({
  getChainByKey: vi.fn(),
}));

vi.mock("../../shared/supabaseClient.js", () => {
  // The .from(...).update(...).eq(...) chain in the listener resolves to
  // `{ error: null }` — we don't need the chain to return data, just to
  // not throw.
  const eq = vi.fn().mockResolvedValue({ error: null });
  const update = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ update }));
  return {
    supabase: { from },
    db: {
      getInfoFiMarketsBySeasonId: vi.fn(),
      invalidateMarketsCache: vi.fn().mockResolvedValue(undefined),
    },
  };
});

vi.mock("../../src/services/pokeConsolationEligible.js", () => ({
  pokeConsolationEligibleChunked: vi.fn(),
}));

vi.mock("../../src/services/sseChannelService.js", () => ({
  getSSEChannelService: vi.fn(),
}));

vi.mock("../../shared/historicalOddsService.js", () => ({
  historicalOddsService: { recordOdds: vi.fn() },
}));

vi.mock("../../shared/redisCache.js", () => ({
  cacheRead: vi.fn((_k, loader) => loader()),
  cacheInvalidate: vi.fn(),
  cacheInvalidatePattern: vi.fn(),
}));

vi.mock("../../shared/redisClient.js", () => ({
  redisClient: { getClient: vi.fn() },
}));

import { settleInfoFiMarkets } from "../../src/listeners/seasonCompletedListener.js";
import { publicClient } from "../../src/lib/viemClient.js";
import { db } from "../../shared/supabaseClient.js";

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

const WINNER = "0x1111111111111111111111111111111111111111";
const LOSER = "0x2222222222222222222222222222222222222222";

const SAMPLE_MARKETS = [
  {
    id: 1,
    season_id: 7,
    player_address: WINNER,
    market_type: "WINNER_PREDICTION",
    is_active: true,
    is_settled: false,
  },
  {
    id: 2,
    season_id: 7,
    player_address: LOSER,
    market_type: "WINNER_PREDICTION",
    is_active: true,
    is_settled: false,
  },
];

describe("seasonCompletedListener.settleInfoFiMarkets", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Provide winners + markets by default; resolveMarketsOnchain inside
    // the listener will throw on its own readContract call and the catch
    // path logs and continues — that's fine for our invalidation assertion.
    publicClient.readContract.mockResolvedValue([WINNER]);
    db.getInfoFiMarketsBySeasonId.mockResolvedValue(SAMPLE_MARKETS);
  });

  it("invalidates the markets cache after a successful bulk settle", async () => {
    const logger = makeLogger();
    await settleInfoFiMarkets(7, "0xRaffle", [], logger);

    expect(db.invalidateMarketsCache).toHaveBeenCalledTimes(1);
  });

  it("invalidates even when some per-market updates report errors", async () => {
    // Future-proofing: if one market's UPDATE fails, the loop logs and
    // continues. The cache MUST still be busted — the markets that DID
    // settle are otherwise stuck behind stale cache for 30s.
    const { supabase } = await import("../../shared/supabaseClient.js");
    const eq = vi
      .fn()
      .mockResolvedValueOnce({ error: { message: "row missing" } })
      .mockResolvedValueOnce({ error: null });
    const update = vi.fn(() => ({ eq }));
    supabase.from.mockReturnValue({ update });

    const logger = makeLogger();
    await settleInfoFiMarkets(7, "0xRaffle", [], logger);

    expect(db.invalidateMarketsCache).toHaveBeenCalledTimes(1);
  });

  it("skips invalidation when there are zero markets to settle (early return)", async () => {
    db.getInfoFiMarketsBySeasonId.mockResolvedValueOnce([]);
    const logger = makeLogger();
    await settleInfoFiMarkets(7, "0xRaffle", [], logger);

    // No bulk update happened → no stale cache to bust → no invalidation.
    expect(db.invalidateMarketsCache).not.toHaveBeenCalled();
  });

  it("skips invalidation when no winners are returned from the raffle (early return)", async () => {
    publicClient.readContract.mockResolvedValueOnce([]);
    const logger = makeLogger();
    await settleInfoFiMarkets(7, "0xRaffle", [], logger);

    expect(db.invalidateMarketsCache).not.toHaveBeenCalled();
  });
});
