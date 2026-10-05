// tests/api/activityRoutes.test.js
// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import fastify from "fastify";

const db = {
  listRecentTrades: vi.fn(async () => []),
  listRecentLaunches: vi.fn(async () => []),
  listRecentEntries: vi.fn(async () => []),
  listRecentSeasons: vi.fn(async () => []),
  listSeasonsById: vi.fn(async () => []),
  symbolsFor: vi.fn(async () => ({})),
  hiddenTokens: vi.fn(async () => new Set()),
};
vi.mock("../../shared/services/launchpadActivityDb.js", () => ({ launchpadActivityDb: db }));

let app;
beforeAll(async () => {
  const mod = await import("../../fastify/routes/activityRoutes.js");
  app = fastify({ logger: false });
  await app.register(mod.default, { prefix: "/api/activity" });
  await app.ready();
});
afterAll(async () => app && app.close());
beforeEach(() => vi.clearAllMocks());

const iso = (msAgo) => new Date(Date.now() - msAgo).toISOString();

describe("GET /api/activity", () => {
  it("returns a tokens row and a raffles row", async () => {
    db.listRecentTrades.mockResolvedValueOnce([
      { side: "BUY", block_time: iso(1000), trader: "0xa", token_address: "0xt", quote_amount: "1", price_e18: "1", tx_hash: "0x1" },
    ]);
    db.listRecentSeasons.mockResolvedValueOnce([
      { season_id: 3, status: 1, start_time: Math.floor(Date.now() / 1000) - 60, end_time: Math.floor(Date.now() / 1000) + 86400, quote_token_address: "0xt" },
    ]);
    db.symbolsFor.mockResolvedValueOnce({ "0xt": "POND" });

    const res = await app.inject({ method: "GET", url: "/api/activity" });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.tokens[0]).toMatchObject({ kind: "buy", symbol: "POND" });
    expect(body.raffles[0]).toMatchObject({ kind: "opened", seasonId: 3, symbol: "POND" });
  });

  // An entry can belong to a season older than the "recent" window; the feed
  // must still label it rather than drop it.
  it("fetches seasons that entries reference but the recent list missed", async () => {
    db.listRecentEntries.mockResolvedValueOnce([
      { season_id: 1, user_address: "0xa", ticket_amount: "2", block_timestamp: iso(500), tx_hash: "0x9", bonding_curve_address: "0xc" },
    ]);
    db.listSeasonsById.mockResolvedValueOnce([{ season_id: 1, status: 1, name: "Old", bonding_curve_address: "0xc" }]);

    const res = await app.inject({ method: "GET", url: "/api/activity" });

    expect(db.listSeasonsById).toHaveBeenCalledWith([1]);
    expect(res.json().raffles[0]).toMatchObject({ kind: "entry", seasonId: 1, seasonName: "Old" });
  });

  it("drops hidden tokens' trades and the seasons priced in them", async () => {
    db.listRecentTrades.mockResolvedValueOnce([
      { side: "BUY", block_time: iso(1000), trader: "0xa", token_address: "0xhid", tx_hash: "0x1", log_index: 0 },
      { side: "BUY", block_time: iso(2000), trader: "0xa", token_address: "0xok", tx_hash: "0x2", log_index: 0 },
    ]);
    db.listRecentSeasons.mockResolvedValueOnce([
      { season_id: 3, status: 1, start_time: Math.floor(Date.now() / 1000) - 60, quote_token_address: "0xhid" },
    ]);
    db.hiddenTokens.mockResolvedValueOnce(new Set(["0xhid"]));

    const body = (await app.inject({ method: "GET", url: "/api/activity" })).json();

    expect(db.hiddenTokens).toHaveBeenCalledWith(expect.arrayContaining(["0xhid", "0xok"]));
    expect(body.tokens.map((t) => t.token)).toEqual(["0xok"]);
    expect(body.raffles).toEqual([]);
  });

  it("does not look up seasons it already has", async () => {
    await app.inject({ method: "GET", url: "/api/activity" });
    expect(db.listSeasonsById).not.toHaveBeenCalled();
  });

  it("returns 500 without leaking the error", async () => {
    db.listRecentTrades.mockRejectedValueOnce(new Error("boom: secret"));
    const res = await app.inject({ method: "GET", url: "/api/activity" });
    expect(res.statusCode).toBe(500);
    expect(res.json().error).not.toContain("secret");
  });
});
