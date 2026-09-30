// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

// A chainable Supabase query double: records every call (per query, too) and
// resolves to the next queued result, or the default once the queue is empty.
const calls = [];
const queries = [];
let result = { data: [], error: null };
const queued = [];
function query() {
  const q = {};
  const own = [];
  queries.push(own);
  for (const m of ["select", "eq", "not", "in", "gte", "lt", "or", "order", "limit", "maybeSingle"]) {
    q[m] = (...args) => {
      calls.push([m, ...args]);
      own.push([m, ...args]);
      return q;
    };
  }
  q.then = (resolve, reject) => Promise.resolve(queued.length ? queued.shift() : result).then(resolve, reject);
  return q;
}

vi.mock("../../shared/supabaseClient.js", () => ({
  hasSupabase: true,
  supabase: { from: (table) => (calls.push(["from", table]), query()) },
}));

const {
  listTradesSince,
  lastTradeBefore,
  listRecentTrades,
  listRecentSeasons,
  listSeasonsForToken,
  listRecentEntries,
  hiddenTokens,
  curveReserves,
} = await import("../../shared/services/launchpadActivityDb.js");

beforeEach(() => {
  calls.length = 0;
  queries.length = 0;
  queued.length = 0;
  result = { data: [], error: null };
});

/** Trades newest first, as the DB returns them: block n, log index 0. */
const newestFirst = (from, to) =>
  Array.from({ length: from - to + 1 }, (_, i) => ({ block_number: from - i, log_index: 0, price_wei: String(from - i) }));

describe("listTradesSince", () => {
  it("reads newest first by (block_number, log_index) and returns oldest first", async () => {
    result = { data: [{ block_number: 9, log_index: 0 }, { block_number: 8, log_index: 1 }, { block_number: 8, log_index: 0 }], error: null };
    const { trades, truncated, before } = await listTradesSince("0xT", null);
    expect(calls).toContainEqual(["order", "block_number", { ascending: false }]);
    expect(calls).toContainEqual(["order", "log_index", { ascending: false }]);
    expect(trades.map((r) => [r.block_number, r.log_index])).toEqual([[8, 0], [8, 1], [9, 0]]);
    expect(truncated).toBe(false);
    expect(before).toBeNull();
  });

  // A range with more trades than one page must not stop at the page:
  // "all" would otherwise start at the launch price with the history missing.
  it("pages through the whole range by keyset, not offset", async () => {
    queued.push({ data: newestFirst(10, 9), error: null }, { data: newestFirst(8, 7), error: null }, { data: newestFirst(6, 6), error: null });
    const { trades, truncated } = await listTradesSince("0xT", "2026-01-01T00:00:00.000Z", { cap: 100, pageSize: 2 });
    expect(queries).toHaveLength(3);
    expect(queries[0].some(([m]) => m === "or")).toBe(false);
    expect(queries[1]).toContainEqual(["or", "block_number.lt.9,and(block_number.eq.9,log_index.lt.0)"]);
    expect(queries[2]).toContainEqual(["or", "block_number.lt.7,and(block_number.eq.7,log_index.lt.0)"]);
    for (const q of queries) expect(q).toContainEqual(["gte", "block_time", "2026-01-01T00:00:00.000Z"]);
    expect(trades.map((r) => r.block_number)).toEqual([6, 7, 8, 9, 10]);
    expect(truncated).toBe(false);
  });

  // Past the cap the OLDEST trades go, never the latest price; the newest one
  // left out is where the chart line enters.
  it("stops at the cap, keeps the newest, and returns the trade just before them", async () => {
    queued.push({ data: newestFirst(10, 9), error: null }, { data: newestFirst(8, 7), error: null });
    const { trades, truncated, before } = await listTradesSince("0xT", null, { cap: 3, pageSize: 2 });
    expect(queries).toHaveLength(2);
    expect(queries[1]).toContainEqual(["limit", 2]); // cap + 1 - 2 already read
    expect(trades.map((r) => r.block_number)).toEqual([8, 9, 10]);
    expect(truncated).toBe(true);
    expect(before.block_number).toBe(7);
  });

  it("is not truncated when the range holds exactly the cap", async () => {
    queued.push({ data: newestFirst(10, 9), error: null }, { data: newestFirst(8, 8), error: null });
    const { trades, truncated, before } = await listTradesSince("0xT", null, { cap: 3, pageSize: 2 });
    expect(trades).toHaveLength(3);
    expect(truncated).toBe(false);
    expect(before).toBeNull();
  });

  it("throws on a failed page", async () => {
    queued.push({ data: newestFirst(10, 9), error: null }, { data: null, error: { message: "boom" } });
    await expect(listTradesSince("0xT", null, { cap: 10, pageSize: 2 })).rejects.toThrow("listTradesSince: boom");
  });
});

// Several trades share a block (one transaction can hold several): within
// it, log_index is the order.
describe("trade ordering tie-breaks on log_index", () => {
  it("lastTradeBefore takes the last log of the last block", async () => {
    await lastTradeBefore("0xT", "2026-01-01T00:00:00.000Z");
    const order = calls.filter(([m]) => m === "order");
    expect(order).toEqual([
      ["order", "block_number", { ascending: false }],
      ["order", "log_index", { ascending: false }],
    ]);
  });

  it("listRecentTrades is newest first by block, then log index", async () => {
    await listRecentTrades(5);
    const order = calls.filter(([m]) => m === "order");
    expect(order).toEqual([
      ["order", "block_number", { ascending: false }],
      ["order", "log_index", { ascending: false }],
    ]);
  });
});

// Filtering hidden tokens after the limit let a wash-traded hidden token push
// every visible trade out of the page, emptying the ticker's tokens row.
describe("listRecentTrades hides hidden tokens in the query", () => {
  it("inner-joins token_launches on is_hidden = false, before the limit", async () => {
    await listRecentTrades(20);
    expect(queries).toHaveLength(1);
    const q = queries[0];
    expect(q.find(([m]) => m === "select")[1]).toContain("token_launches!inner(is_hidden)");
    expect(q).toContainEqual(["eq", "token_launches.is_hidden", false]);
    expect(q).toContainEqual(["limit", 20]);
  });

  it("drops the join's column from the rows", async () => {
    result = { data: [{ tx_hash: "0x1", log_index: 0, token_address: "0xt", token_launches: { is_hidden: false } }], error: null };
    expect(await listRecentTrades(5)).toEqual([{ tx_hash: "0x1", log_index: 0, token_address: "0xt" }]);
  });
});

describe("curveReserves", () => {
  it("reads every curve's reserves in one query, keyed lowercase", async () => {
    result = { data: [{ bonding_curve_address: "0xabc", sof_reserves: "123" }], error: null };
    const reserves = await curveReserves(["0xABC", "0xdef", "0xabc"]);
    expect(queries).toHaveLength(1);
    expect(calls).toContainEqual(["from", "curve_state"]);
    expect(calls).toContainEqual(["in", "bonding_curve_address", ["0xabc", "0xdef"]]);
    expect(reserves.get("0xabc")).toBe("123");
    expect(reserves.has("0xdef")).toBe(false);
  });

  it("does not query for no curves", async () => {
    expect((await curveReserves([])).size).toBe(0);
    expect(calls).toEqual([]);
  });
});

describe("listRecentSeasons", () => {
  // updated_at moves on every listener write, replays included.
  it("orders by the season's schedule, never updated_at", async () => {
    await listRecentSeasons(20);
    const order = calls.filter(([m]) => m === "order");
    expect(order).toEqual([
      ["order", "end_time", { ascending: false, nullsFirst: false }],
      ["order", "start_time", { ascending: false, nullsFirst: false }],
      ["order", "season_id", { ascending: false }],
    ]);
  });
});

describe("season columns", () => {
  it("select grand_prize_bps for the summaries", async () => {
    await listSeasonsForToken("0xT");
    expect(calls.find(([m]) => m === "select")[1]).toContain("grand_prize_bps");
  });
});

describe("listRecentEntries", () => {
  it("selects each entry's bonding curve and skips rows with none", async () => {
    await listRecentEntries(5);
    const select = calls.find((c) => c[0] === "select");
    expect(select[1]).toContain("bonding_curve_address");
    expect(calls).toContainEqual(["not", "bonding_curve_address", "is", null]);
  });
});

describe("hiddenTokens", () => {
  it("returns the hidden subset, lowercased", async () => {
    result = { data: [{ token_address: "0xabc" }], error: null };
    const hidden = await hiddenTokens(["0xABC", "0xdef"]);
    expect(calls).toContainEqual(["eq", "is_hidden", true]);
    expect(calls).toContainEqual(["in", "token_address", ["0xabc", "0xdef"]]);
    expect([...hidden]).toEqual(["0xabc"]);
  });

  it("does not query for an empty list", async () => {
    expect((await hiddenTokens([])).size).toBe(0);
    expect(calls).toEqual([]);
  });
});
