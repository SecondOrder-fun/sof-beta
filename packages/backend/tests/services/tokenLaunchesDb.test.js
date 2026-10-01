// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

// A chainable Supabase query double: records each query's calls and resolves
// to the next queued result, or the default once the queue is empty.
const queries = [];
let result = { data: [], error: null };
const queued = [];
function query(table) {
  const q = {};
  const own = [["from", table]];
  queries.push(own);
  for (const m of ["select", "eq", "not", "in", "gt", "order", "limit", "range", "upsert", "insert", "maybeSingle"]) {
    q[m] = (...args) => {
      own.push([m, ...args]);
      return q;
    };
  }
  q.then = (resolve, reject) => Promise.resolve(queued.length ? queued.shift() : result).then(resolve, reject);
  return q;
}

vi.mock("../../shared/supabaseClient.js", () => ({
  hasSupabase: true,
  supabase: { from: (table) => query(table) },
}));

const { listPoolIndex, insertLaunchTrades, listTokenLaunches, countTokenLaunches } = await import(
  "../../shared/services/tokenLaunchesDb.js"
);

beforeEach(() => {
  queries.length = 0;
  queued.length = 0;
  result = { data: [], error: null };
});

const pools = (...tokens) => tokens.map((t) => ({ pool_id: `0xp${t}`, token_address: `0x${t}`, symbol: t }));

// PostgREST caps a response (1,000 rows by default); an unpaged read silently
// truncated the trade listener's pool map, leaving pools unwatched.
describe("listPoolIndex", () => {
  it("pages by token_address keyset until a short page", async () => {
    queued.push({ data: pools("a", "b"), error: null }, { data: pools("c", "d"), error: null }, { data: pools("e"), error: null });
    const all = await listPoolIndex({ pageSize: 2 });
    expect(all.map((p) => p.token_address)).toEqual(["0xa", "0xb", "0xc", "0xd", "0xe"]);
    expect(queries).toHaveLength(3);
    expect(queries[0].some(([m]) => m === "gt")).toBe(false);
    expect(queries[1]).toContainEqual(["gt", "token_address", "0xb"]);
    expect(queries[2]).toContainEqual(["gt", "token_address", "0xd"]);
    for (const q of queries) {
      expect(q).toContainEqual(["order", "token_address", { ascending: true }]);
      expect(q).toContainEqual(["limit", 2]);
      expect(q).toContainEqual(["not", "pool_id", "is", null]);
    }
  });

  it("reads one more (empty) page when the last one is exactly full", async () => {
    queued.push({ data: pools("a", "b"), error: null }, { data: [], error: null });
    expect(await listPoolIndex({ pageSize: 2 })).toHaveLength(2);
    expect(queries).toHaveLength(2);
  });

  it("throws on a failed page rather than returning a partial map", async () => {
    queued.push({ data: pools("a", "b"), error: null }, { data: null, error: { message: "boom" } });
    await expect(listPoolIndex({ pageSize: 2 })).rejects.toThrow("listPoolIndex: boom");
  });
});

const trade = (i) => ({ tx_hash: `0xTX${i}`, log_index: i, token_address: "0xT", pool_id: "0xP", trader: "0xA" });

describe("insertLaunchTrades", () => {
  // ON CONFLICT DO NOTHING ... RETURNING yields only the rows inserted, which
  // is what lets the listener broadcast new trades and skip replayed ones.
  it("returns only the rows the database inserted", async () => {
    queued.push({ data: [{ tx_hash: "0xtx2", log_index: 2 }], error: null });
    const inserted = await insertLaunchTrades([trade(1), trade(2)]);
    expect(inserted).toEqual([{ tx_hash: "0xtx2", log_index: 2 }]);
    const [upsert] = queries[0].filter(([m]) => m === "upsert");
    expect(upsert[2]).toEqual({ onConflict: "tx_hash,log_index", ignoreDuplicates: true });
    expect(upsert[1][0]).toMatchObject({ tx_hash: "0xtx1", token_address: "0xt", pool_id: "0xp", trader: "0xa" });
    expect(queries[0]).toContainEqual(["select", "tx_hash, log_index"]);
  });

  it("sends large sets in batches and gathers every batch's inserts", async () => {
    queued.push({ data: [{ tx_hash: "0xtx0", log_index: 0 }], error: null }, { data: [{ tx_hash: "0xtx2", log_index: 2 }], error: null });
    const inserted = await insertLaunchTrades([trade(0), trade(1), trade(2)], { batchSize: 2 });
    expect(queries).toHaveLength(2);
    expect(queries.map((q) => q.find(([m]) => m === "upsert")[1].length)).toEqual([2, 1]);
    expect(inserted.map((r) => r.log_index)).toEqual([0, 2]);
  });

  it("throws on a failed insert", async () => {
    result = { data: null, error: { message: "nope" } };
    await expect(insertLaunchTrades([trade(1)])).rejects.toThrow("insertLaunchTrades: nope");
  });

  it("returns nothing for nothing", async () => {
    expect(await insertLaunchTrades([])).toEqual([]);
    expect(queries).toHaveLength(0);
  });
});

// The profile's creator-fees list reads one creator's launches; the rows store
// creator_address lowercased, and hidden tokens must stay out like everywhere.
describe("creator filter", () => {
  const CREATOR = "0xAbCdEf0000000000000000000000000000000001";

  it("lists one creator's visible launches, matching case-insensitively", async () => {
    await listTokenLaunches({ creator: CREATOR, limit: 100 });
    expect(queries[0]).toContainEqual(["eq", "creator_address", CREATOR.toLowerCase()]);
    expect(queries[0]).toContainEqual(["eq", "is_hidden", false]);
    expect(queries[0]).toContainEqual(["range", 0, 99]);
  });

  it("counts with the same filters", async () => {
    result = { count: 3, error: null };
    expect(await countTokenLaunches({ creator: CREATOR })).toBe(3);
    expect(queries[0]).toContainEqual(["eq", "creator_address", CREATOR.toLowerCase()]);
    expect(queries[0]).toContainEqual(["eq", "is_hidden", false]);
  });

  it("does not filter by creator when none is given", async () => {
    await listTokenLaunches({});
    expect(queries[0].some(([m, col]) => m === "eq" && col === "creator_address")).toBe(false);
  });
});
