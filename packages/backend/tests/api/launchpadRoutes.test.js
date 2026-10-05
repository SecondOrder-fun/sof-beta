// tests/api/launchpadRoutes.test.js
// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import fastify from "fastify";

const listTokenLaunches = vi.fn(async () => []);
const countTokenLaunches = vi.fn(async () => 0);
const getTokenLaunch = vi.fn(async () => null);
const listLaunchTrades = vi.fn(async () => []);

const listTradesSince = vi.fn(async () => ({ trades: [], truncated: false, before: null }));
const lastTradeBefore = vi.fn(async () => null);
const listSeasonsForToken = vi.fn(async () => []);
const listSeasonsForTokens = vi.fn(async () => []);
const hiddenTokens = vi.fn(async () => new Set());
const curveReserves = vi.fn(async () => new Map());

vi.mock("../../shared/services/launchpadActivityDb.js", () => ({
  launchpadActivityDb: {
    curveReserves: (...a) => curveReserves(...a),
    listTradesSince: (...a) => listTradesSince(...a),
    lastTradeBefore: (...a) => lastTradeBefore(...a),
    listSeasonsForToken: (...a) => listSeasonsForToken(...a),
    listSeasonsForTokens: (...a) => listSeasonsForTokens(...a),
    hiddenTokens: (...a) => hiddenTokens(...a),
  },
}));

vi.mock("../../shared/services/tokenLaunchesDb.js", () => ({
  tokenLaunchesDb: {
    listTokenLaunches: (...a) => listTokenLaunches(...a),
    countTokenLaunches: (...a) => countTokenLaunches(...a),
    getTokenLaunch: (...a) => getTokenLaunch(...a),
    listLaunchTrades: (...a) => listLaunchTrades(...a),
  },
}));

const TOKEN = "0x1111111111111111111111111111111111111111";
const CREATOR = "0x2222222222222222222222222222222222222222";

const ONE_ETH = (10n ** 18n).toString();

const row = (over = {}) => ({
  token_address: TOKEN,
  launch_id: 0,
  creator_address: CREATOR,
  name: "Second Order",
  symbol: "SOF",
  metadata_uri: "ipfs://meta",
  quote_token: "0x0000000000000000000000000000000000000000",
  quote_symbol: "ETH",
  quote_decimals: 18,
  start_price: "1000000000",
  start_fdv: ONE_ETH,
  total_supply: (1_000_000_000n * 10n ** 18n).toString(),
  pool_id: `0x${"ab".repeat(32)}`,
  launched_at: "2026-09-29T00:00:00.000Z",
  block_number: 1234,
  tx_hash: "0xdeadbeef",
  is_hidden: false,
  is_verified: false,
  ...over,
});

let app;

beforeAll(async () => {
  const mod = await import("../../fastify/routes/launchpadRoutes.js");
  app = fastify({ logger: false });
  await app.register(mod.default, { prefix: "/api/launchpad" });
  await app.ready();
});

afterAll(async () => {
  if (app) await app.close();
});

beforeEach(() => vi.clearAllMocks());

describe("GET /api/launchpad/tokens", () => {
  it("returns launches in the shape the frontend already consumes", async () => {
    listTokenLaunches.mockResolvedValueOnce([row()]);
    countTokenLaunches.mockResolvedValueOnce(1);

    const res = await app.inject({ method: "GET", url: "/api/launchpad/tokens" });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(1);
    expect(body.launches[0]).toMatchObject({
      token: TOKEN,
      creator: CREATOR,
      name: "Second Order",
      symbol: "SOF",
      startPrice: "1000000000",
      startFdv: ONE_ETH,
      quoteToken: "0x0000000000000000000000000000000000000000",
      quoteSymbol: "ETH",
      quoteDecimals: 18,
    });
  });

  // wei does not survive a JS number — 1 ETH is 1e18, already past 2^53.
  it("keeps wei values as strings", async () => {
    listTokenLaunches.mockResolvedValueOnce([row()]);
    const res = await app.inject({ method: "GET", url: "/api/launchpad/tokens" });
    const launch = res.json().launches[0];

    expect(typeof launch.startFdv).toBe("string");
    expect(typeof launch.startPrice).toBe("string");
    expect(typeof launch.totalSupply).toBe("string");
  });

  it("defaults to a page of 24", async () => {
    await app.inject({ method: "GET", url: "/api/launchpad/tokens" });
    expect(listTokenLaunches).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 24, offset: 0 }),
    );
  });

  it("clamps an oversized limit rather than serving it", async () => {
    await app.inject({ method: "GET", url: "/api/launchpad/tokens?limit=99999" });
    expect(listTokenLaunches).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 100 }),
    );
  });

  it("falls back to the default for a garbage or negative limit", async () => {
    await app.inject({ method: "GET", url: "/api/launchpad/tokens?limit=abc" });
    expect(listTokenLaunches).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 24 }),
    );

    await app.inject({ method: "GET", url: "/api/launchpad/tokens?limit=-5&offset=-1" });
    expect(listTokenLaunches).toHaveBeenLastCalledWith(
      expect.objectContaining({ limit: 24, offset: 0 }),
    );
  });

  it("filters by creator", async () => {
    await app.inject({
      method: "GET",
      url: `/api/launchpad/tokens?creator=${CREATOR}`,
    });
    expect(listTokenLaunches).toHaveBeenCalledWith(
      expect.objectContaining({ creator: CREATOR }),
    );
  });

  // The total pages the filtered list, so it must be the filtered count.
  it("counts with the same creator filter as the list", async () => {
    await app.inject({ method: "GET", url: `/api/launchpad/tokens?creator=${CREATOR}` });
    expect(countTokenLaunches).toHaveBeenCalledWith(expect.objectContaining({ creator: CREATOR }));
  });

  it("matches a checksummed creator by lowercasing it, for the list and the total", async () => {
    const mixed = "0xAbCdEf0000000000000000000000000000000001";
    await app.inject({ method: "GET", url: `/api/launchpad/tokens?creator=${mixed}&limit=100` });
    expect(listTokenLaunches).toHaveBeenCalledWith(
      expect.objectContaining({ creator: mixed.toLowerCase(), limit: 100 }),
    );
    expect(countTokenLaunches).toHaveBeenCalledWith(expect.objectContaining({ creator: mixed.toLowerCase() }));
  });

  it("does not ask for hidden tokens when filtering by creator", async () => {
    await app.inject({ method: "GET", url: `/api/launchpad/tokens?creator=${CREATOR}` });
    expect(listTokenLaunches.mock.calls[0][0].includeHidden).toBeFalsy();
    expect(countTokenLaunches.mock.calls[0][0].includeHidden).toBeFalsy();
  });

  it("rejects a repeated creator rather than picking one", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/launchpad/tokens?creator=${CREATOR}&creator=${TOKEN}`,
    });
    expect(res.statusCode).toBe(400);
    expect(listTokenLaunches).not.toHaveBeenCalled();
  });

  it("rejects a malformed creator address instead of querying with it", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/launchpad/tokens?creator=not-an-address",
    });
    expect(res.statusCode).toBe(400);
    expect(listTokenLaunches).not.toHaveBeenCalled();
  });

  it("returns 500 rather than leaking a database error", async () => {
    listTokenLaunches.mockRejectedValueOnce(new Error("supabase exploded"));
    const res = await app.inject({ method: "GET", url: "/api/launchpad/tokens" });

    expect(res.statusCode).toBe(500);
    expect(res.json().error).not.toContain("supabase exploded");
  });
});

describe("GET /api/launchpad/tokens/:address", () => {
  it("returns the launch", async () => {
    getTokenLaunch.mockResolvedValueOnce(row());
    const res = await app.inject({
      method: "GET",
      url: `/api/launchpad/tokens/${TOKEN}`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().launch.token).toBe(TOKEN);
  });

  it("404s an address that is not indexed", async () => {
    getTokenLaunch.mockResolvedValueOnce(null);
    const res = await app.inject({
      method: "GET",
      url: `/api/launchpad/tokens/${TOKEN}`,
    });
    expect(res.statusCode).toBe(404);
  });

  // Hiding is moderation: the row stays indexed and the trade history keeps
  // filling, but the public API behaves as though the token is not there.
  it("404s a hidden token", async () => {
    getTokenLaunch.mockResolvedValueOnce(row({ is_hidden: true }));
    const res = await app.inject({
      method: "GET",
      url: `/api/launchpad/tokens/${TOKEN}`,
    });
    expect(res.statusCode).toBe(404);
  });

  it("400s a malformed address", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/launchpad/tokens/0xnope",
    });
    expect(res.statusCode).toBe(400);
    expect(getTokenLaunch).not.toHaveBeenCalled();
  });
});

describe("GET /api/launchpad/tokens/:address/trades", () => {
  it("returns an empty list before the trade indexer has run", async () => {
    listLaunchTrades.mockResolvedValueOnce([]);
    const res = await app.inject({
      method: "GET",
      url: `/api/launchpad/tokens/${TOKEN}/trades`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().trades).toEqual([]);
  });

  // The token page renders from the chain even when the API hides a token, so
  // the trade list (trader addresses included) must be hidden here too.
  it("404s a hidden token's trades", async () => {
    getTokenLaunch.mockResolvedValueOnce(row({ is_hidden: true }));
    const res = await app.inject({
      method: "GET",
      url: `/api/launchpad/tokens/${TOKEN}/trades`,
    });
    expect(res.statusCode).toBe(404);
    expect(listLaunchTrades).not.toHaveBeenCalled();
  });

  it("maps trade rows to the API shape", async () => {
    listLaunchTrades.mockResolvedValueOnce([
      {
        tx_hash: "0xabc",
        log_index: 2,
        token_address: TOKEN,
        pool_id: `0x${"ab".repeat(32)}`,
        trader: CREATOR,
        side: "BUY",
        quote_amount: "100000000000000000",
        token_amount: "5000000000000000000000",
        price: "1000000000",
        tick: -12345,
        block_number: 99,
        block_time: "2026-09-29T00:01:00.000Z",
      },
    ]);

    const res = await app.inject({
      method: "GET",
      url: `/api/launchpad/tokens/${TOKEN}/trades`,
    });

    expect(res.json().trades[0]).toMatchObject({
      txHash: "0xabc",
      logIndex: 2,
      side: "BUY",
      quoteAmount: "100000000000000000",
      tokenAmount: "5000000000000000000000",
      price: "1000000000",
    });
  });

  it("clamps the trade limit", async () => {
    await app.inject({
      method: "GET",
      url: `/api/launchpad/tokens/${TOKEN}/trades?limit=10000`,
    });
    expect(listLaunchTrades).toHaveBeenCalledWith(
      TOKEN,
      expect.objectContaining({ limit: 500 }),
    );
  });

  it("400s a malformed address", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/launchpad/tokens/nope/trades",
    });
    expect(res.statusCode).toBe(400);
    expect(listLaunchTrades).not.toHaveBeenCalled();
  });
});

describe("GET /api/launchpad/tokens/:address/chart", () => {
  it("returns points that start at the launch for the 'all' range", async () => {
    getTokenLaunch.mockResolvedValueOnce(row());
    listTradesSince.mockResolvedValueOnce({
      trades: [{ price: "2000000000", block_time: "2026-09-29T01:00:00.000Z" }],
      truncated: false,
      before: null,
    });

    const res = await app.inject({ method: "GET", url: `/api/launchpad/tokens/${TOKEN}/chart?range=all` });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.points[0].price).toBe("1000000000"); // the launch price
    expect(body.points.at(-1).price).toBe("2000000000");
    expect(body.truncated).toBe(false);
    expect(listTradesSince).toHaveBeenCalledWith(TOKEN, null);
  });

  // Past the trade cap the oldest trades are missing: entering at the launch
  // price would draw a jump that never happened.
  it("enters a truncated chart at the newest trade left out, not the launch price", async () => {
    getTokenLaunch.mockResolvedValueOnce(row());
    listTradesSince.mockResolvedValueOnce({
      trades: [
        { price: "7000000000", block_time: "2026-09-29T05:00:00.000Z" },
        { price: "7100000000", block_time: "2026-09-29T06:00:00.000Z" },
      ],
      truncated: true,
      before: { price: "6900000000", block_time: "2026-09-29T04:00:00.000Z" },
    });

    const res = await app.inject({ method: "GET", url: `/api/launchpad/tokens/${TOKEN}/chart?range=all` });

    const body = res.json();
    expect(body.truncated).toBe(true);
    expect(body.points[0]).toEqual({
      t: Date.parse("2026-09-29T04:00:00.000Z") / 1000,
      price: "6900000000",
    });
    expect(body.points.map((p) => p.price)).not.toContain("1000000000");
    expect(body.launch.price).toBe("1000000000");
  });

  // The seed a truncated range would discard is not queried at all.
  it("does not read the last trade before the range when the range is truncated", async () => {
    getTokenLaunch.mockResolvedValueOnce(row());
    listTradesSince.mockResolvedValueOnce({
      trades: [{ price: "7000000000", block_time: new Date().toISOString() }],
      truncated: true,
      before: { price: "6900000000", block_time: new Date(Date.now() - 60_000).toISOString() },
    });
    const res = await app.inject({ method: "GET", url: `/api/launchpad/tokens/${TOKEN}/chart?range=24h` });
    expect(res.statusCode).toBe(200);
    expect(lastTradeBefore).not.toHaveBeenCalled();
    expect(res.json().points[0].price).toBe("6900000000");
  });

  it("enters a complete range at the last trade before it", async () => {
    getTokenLaunch.mockResolvedValueOnce(row());
    lastTradeBefore.mockResolvedValueOnce({ price: "5000000000", block_time: "2026-01-01T00:00:00.000Z" });
    const res = await app.inject({ method: "GET", url: `/api/launchpad/tokens/${TOKEN}/chart?range=1h` });
    expect(lastTradeBefore).toHaveBeenCalledTimes(1);
    expect(lastTradeBefore.mock.calls[0][1]).toBe(listTradesSince.mock.calls[0][1]);
    expect(res.json().points[0].price).toBe("5000000000");
  });

  it("queries only the requested window", async () => {
    getTokenLaunch.mockResolvedValueOnce(row());
    await app.inject({ method: "GET", url: `/api/launchpad/tokens/${TOKEN}/chart?range=1h` });
    const since = new Date(listTradesSince.mock.calls[0][1]).getTime();
    expect(Date.now() - since).toBeGreaterThanOrEqual(3600_000 - 5_000);
    expect(Date.now() - since).toBeLessThanOrEqual(3600_000 + 5_000);
  });

  it("rejects an unknown range", async () => {
    const res = await app.inject({ method: "GET", url: `/api/launchpad/tokens/${TOKEN}/chart?range=7y` });
    expect(res.statusCode).toBe(400);
  });

  // `range in CHART_RANGES` accepted inherited keys and then 500'd on them.
  it.each(["toString", "constructor", "__proto__", "hasOwnProperty", "valueOf"])(
    "rejects the prototype key %s as a range (400, not 500)",
    async (range) => {
      const res = await app.inject({ method: "GET", url: `/api/launchpad/tokens/${TOKEN}/chart?range=${range}` });
      expect(res.statusCode).toBe(400);
      expect(getTokenLaunch).not.toHaveBeenCalled();
    },
  );

  it("404s a token that is not indexed", async () => {
    getTokenLaunch.mockResolvedValueOnce(null);
    const res = await app.inject({ method: "GET", url: `/api/launchpad/tokens/${TOKEN}/chart` });
    expect(res.statusCode).toBe(404);
  });
});

describe("GET /api/launchpad/tokens/:address/seasons", () => {
  it("lists the token's seasons and features the live one", async () => {
    listSeasonsForToken.mockResolvedValueOnce([
      { season_id: 4, status: 5, quote_token_address: TOKEN },
      { season_id: 3, status: 1, quote_token_address: TOKEN },
    ]);
    const res = await app.inject({ method: "GET", url: `/api/launchpad/tokens/${TOKEN}/seasons` });
    expect(res.statusCode).toBe(200);
    expect(res.json().seasons).toHaveLength(2);
    expect(res.json().featured).toMatchObject({ seasonId: 3, state: "live" });
  });

  it("features nothing for a token with no raffle", async () => {
    const res = await app.inject({ method: "GET", url: `/api/launchpad/tokens/${TOKEN}/seasons` });
    expect(res.json()).toEqual({ seasons: [], featured: null });
    expect(curveReserves).not.toHaveBeenCalled();
  });

  // season_contracts records the pool only at status changes, so a live
  // season read 0 there. Its curve's reserves are the live pool.
  it("reads a live season's prize pool from its curve's reserves, in one query", async () => {
    listSeasonsForToken.mockResolvedValueOnce([
      { season_id: 5, status: 1, total_prize_pool: "0", quote_token_address: TOKEN, bonding_curve_address: "0xCURVE5" },
      { season_id: 4, status: 1, total_prize_pool: "0", quote_token_address: TOKEN, bonding_curve_address: "0xcurve4" },
      { season_id: 3, status: 5, total_prize_pool: "900", quote_token_address: TOKEN, bonding_curve_address: "0xcurve3" },
    ]);
    curveReserves.mockResolvedValueOnce(new Map([["0xcurve5", "12345"], ["0xcurve3", "1"]]));

    const body = (await app.inject({ method: "GET", url: `/api/launchpad/tokens/${TOKEN}/seasons` })).json();

    expect(curveReserves).toHaveBeenCalledTimes(1);
    expect(curveReserves).toHaveBeenCalledWith(["0xCURVE5", "0xcurve4"]); // live seasons only
    expect(body.seasons.map((s) => s.prizePool)).toEqual(["12345", "0", "900"]); // no curve row -> as stored
    expect(body.featured).toMatchObject({ seasonId: 5, prizePool: "12345" });
  });

  it("404s a hidden token rather than listing its seasons", async () => {
    hiddenTokens.mockResolvedValueOnce(new Set([TOKEN]));
    listSeasonsForToken.mockResolvedValueOnce([{ season_id: 3, status: 1, quote_token_address: TOKEN }]);
    const res = await app.inject({ method: "GET", url: `/api/launchpad/tokens/${TOKEN}/seasons` });
    expect(res.statusCode).toBe(404);
    expect(hiddenTokens).toHaveBeenCalledWith([TOKEN]);
  });
});

describe("GET /api/launchpad/raffles", () => {
  const OTHER = "0x3333333333333333333333333333333333333333";

  it("returns one badge per token, in a single query", async () => {
    listSeasonsForTokens.mockResolvedValueOnce([
      { season_id: 5, status: 1, quote_token_address: TOKEN },
      { season_id: 4, status: 5, quote_token_address: TOKEN },
      { season_id: 2, status: 0, quote_token_address: OTHER },
    ]);
    const res = await app.inject({ method: "GET", url: `/api/launchpad/raffles?tokens=${TOKEN},${OTHER}` });
    expect(res.statusCode).toBe(200);
    expect(listSeasonsForTokens).toHaveBeenCalledTimes(1);
    expect(res.json().raffles[TOKEN]).toMatchObject({ seasonId: 5, state: "live" });
    expect(res.json().raffles[OTHER]).toMatchObject({ state: "upcoming" });
  });

  it("omits hidden tokens", async () => {
    hiddenTokens.mockResolvedValueOnce(new Set([OTHER]));
    listSeasonsForTokens.mockResolvedValueOnce([
      { season_id: 5, status: 1, quote_token_address: TOKEN },
      { season_id: 2, status: 1, quote_token_address: OTHER },
    ]);
    const res = await app.inject({ method: "GET", url: `/api/launchpad/raffles?tokens=${TOKEN},${OTHER}` });
    expect(Object.keys(res.json().raffles)).toEqual([TOKEN]);
  });

  it("badges a live season with its curve's reserves, one query for the page, skipping hidden tokens", async () => {
    hiddenTokens.mockResolvedValueOnce(new Set([OTHER]));
    listSeasonsForTokens.mockResolvedValueOnce([
      { season_id: 5, status: 1, total_prize_pool: "0", quote_token_address: TOKEN, bonding_curve_address: "0xc5" },
      { season_id: 2, status: 1, total_prize_pool: "0", quote_token_address: OTHER, bonding_curve_address: "0xc2" },
    ]);
    curveReserves.mockResolvedValueOnce(new Map([["0xc5", "777"]]));
    const res = await app.inject({ method: "GET", url: `/api/launchpad/raffles?tokens=${TOKEN},${OTHER}` });
    expect(curveReserves).toHaveBeenCalledTimes(1);
    expect(curveReserves).toHaveBeenCalledWith(["0xc5"]);
    expect(res.json().raffles[TOKEN]).toMatchObject({ seasonId: 5, prizePool: "777" });
  });

  it("answers an empty list without touching the database", async () => {
    const res = await app.inject({ method: "GET", url: "/api/launchpad/raffles" });
    expect(res.json()).toEqual({ raffles: {} });
    expect(listSeasonsForTokens).not.toHaveBeenCalled();
  });

  it("rejects malformed addresses and oversized requests", async () => {
    expect((await app.inject({ method: "GET", url: "/api/launchpad/raffles?tokens=nope" })).statusCode).toBe(400);
    const many = Array.from({ length: 101 }, () => TOKEN).join(",");
    expect((await app.inject({ method: "GET", url: `/api/launchpad/raffles?tokens=${many}` })).statusCode).toBe(400);
  });
});
