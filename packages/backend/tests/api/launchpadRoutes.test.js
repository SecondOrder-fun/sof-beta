// tests/api/launchpadRoutes.test.js
// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import fastify from "fastify";

const listTokenLaunches = vi.fn(async () => []);
const countTokenLaunches = vi.fn(async () => 0);
const getTokenLaunch = vi.fn(async () => null);
const listLaunchTrades = vi.fn(async () => []);

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
  start_price_wei: "1000000000",
  implied_fdv_wei: ONE_ETH,
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
      startPriceWei: "1000000000",
      impliedFdvWei: ONE_ETH,
    });
  });

  // wei does not survive a JS number — 1 ETH is 1e18, already past 2^53.
  it("keeps wei values as strings", async () => {
    listTokenLaunches.mockResolvedValueOnce([row()]);
    const res = await app.inject({ method: "GET", url: "/api/launchpad/tokens" });
    const launch = res.json().launches[0];

    expect(typeof launch.impliedFdvWei).toBe("string");
    expect(typeof launch.startPriceWei).toBe("string");
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

  it("maps trade rows to the API shape", async () => {
    listLaunchTrades.mockResolvedValueOnce([
      {
        tx_hash: "0xabc",
        log_index: 2,
        token_address: TOKEN,
        pool_id: `0x${"ab".repeat(32)}`,
        trader: CREATOR,
        side: "BUY",
        eth_amount: "100000000000000000",
        token_amount: "5000000000000000000000",
        price_wei: "1000000000",
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
      ethAmount: "100000000000000000",
      tokenAmount: "5000000000000000000000",
      priceWei: "1000000000",
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
