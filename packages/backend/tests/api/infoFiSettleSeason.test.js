// Regression test for the cache-invalidation contract on the manual
// /admin/settle-season endpoint. The bulk update inside this handler
// bypasses db.updateInfoFiMarket and MUST call db.invalidateMarketsCache()
// explicitly — see the comment near supabaseClient.invalidateMarketsCache.
//
// The parallel on-chain path (seasonCompletedListener.settleInfoFiMarkets)
// is covered by tests/listeners/settleInfoFiMarkets.test.js.

import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  afterAll,
  beforeEach,
} from "vitest";
import Fastify from "fastify";

vi.mock("../../shared/adminGuard.js", () => ({
  // Bypass the admin guard — we're testing the cache invalidation
  // contract, not the auth path (which has its own tests).
  createRequireAdmin: () => async () => {},
}));

vi.mock("../../src/lib/viemClient.js", () => ({
  publicClient: { readContract: vi.fn() },
  getPublicClient: vi.fn(),
}));

vi.mock("../../src/config/chain.js", () => ({
  getChainByKey: vi.fn(),
}));

vi.mock("../../shared/pricingService.js", () => ({
  pricingService: {
    getCachedPricing: vi.fn(),
    subscribeToMarket: vi.fn(() => () => {}),
  },
}));

vi.mock("../../shared/marketMakerService.js", () => ({
  marketMakerService: {
    quote: vi.fn(),
    buy: vi.fn(),
    sell: vi.fn(),
  },
}));

// Track the markets-cache invalidation as a spy. Use vi.hoisted so the
// spy is initialized before the hoisted vi.mock factory below tries to
// reference it.
const { invalidateMarketsCache } = vi.hoisted(() => ({
  invalidateMarketsCache: vi.fn().mockResolvedValue(undefined),
}));

function buildSupabaseMock(markets) {
  // Two .from() paths the settle-season handler uses against
  // infofi_markets: a select (initial fetch) and an update (per-market
  // settle). Plus infofi_positions (.select) and infofi_winnings (.select
  // + .insert) for the winnings flow. We return empty arrays for the
  // positions path so the winnings loop is a no-op — the cache-
  // invalidation contract is what we care about.
  const fromHandlers = {
    infofi_markets: () => {
      // The handler chain is: from().select("*").eq("season_id", id)
      // then per-market: from().update({...}).eq("id", marketId)
      const selectChain = {
        eq: vi.fn().mockResolvedValue({ data: markets, error: null }),
      };
      const updateChain = {
        eq: vi.fn().mockResolvedValue({ error: null }),
      };
      return {
        select: vi.fn(() => selectChain),
        update: vi.fn(() => updateChain),
      };
    },
    infofi_positions: () => ({
      select: vi.fn(() => ({
        eq: vi.fn().mockResolvedValue({ data: [], error: null }),
      })),
    }),
    infofi_winnings: () => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi
              .fn()
              .mockResolvedValue({ data: null, error: null }),
          })),
        })),
      })),
      insert: vi.fn().mockResolvedValue({ error: null }),
    }),
  };

  return {
    from: vi.fn((table) => {
      const factory = fromHandlers[table];
      if (!factory) {
        throw new Error(`Unexpected supabase.from('${table}') in test`);
      }
      return factory();
    }),
  };
}

const { supabaseHolder } = vi.hoisted(() => ({
  supabaseHolder: { current: null },
}));

vi.mock("../../shared/supabaseClient.js", () => ({
  get supabase() {
    return supabaseHolder.current;
  },
  db: {
    invalidateMarketsCache,
    // Other methods the route may touch — return shapes that let the
    // handler proceed to the invalidation call.
    getInfoFiMarketById: vi.fn(),
  },
}));

import infoFiRoutes from "../../fastify/routes/infoFiRoutes.js";

describe("POST /admin/settle-season cache invalidation", () => {
  let app;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    await app.register(infoFiRoutes, { prefix: "/api/infofi" });
    await app.ready();
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls db.invalidateMarketsCache after bulk-settling all markets", async () => {
    supabaseHolder.current = buildSupabaseMock([
      {
        id: 1,
        season_id: 7,
        player_address: "0x1111111111111111111111111111111111111111",
        market_type: "WINNER_PREDICTION",
      },
      {
        id: 2,
        season_id: 7,
        player_address: "0x2222222222222222222222222222222222222222",
        market_type: "WINNER_PREDICTION",
      },
    ]);

    const res = await app.inject({
      method: "POST",
      url: "/api/infofi/admin/settle-season",
      payload: {
        seasonId: 7,
        winnerAddress: "0x1111111111111111111111111111111111111111",
        resolveOnchain: false, // skip the wallet/publicClient path
      },
    });

    expect(res.statusCode).toBe(200);
    expect(invalidateMarketsCache).toHaveBeenCalledTimes(1);
  });

  it("skips invalidation when no markets exist for the season", async () => {
    supabaseHolder.current = buildSupabaseMock([]);

    const res = await app.inject({
      method: "POST",
      url: "/api/infofi/admin/settle-season",
      payload: {
        seasonId: 99,
        winnerAddress: "0x1111111111111111111111111111111111111111",
        resolveOnchain: false,
      },
    });

    expect(res.statusCode).toBe(200);
    // Handler early-returns before the bulk-update + invalidation block.
    expect(invalidateMarketsCache).not.toHaveBeenCalled();
  });
});
