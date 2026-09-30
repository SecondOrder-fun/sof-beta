// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

// A chainable Supabase query double: records every call and resolves to
// whatever the test queued.
const calls = [];
let result = { data: [], error: null };
function query() {
  const q = {};
  for (const m of ["select", "eq", "not", "in", "gte", "lt", "order", "limit", "maybeSingle"]) {
    q[m] = (...args) => {
      calls.push([m, ...args]);
      return q;
    };
  }
  q.then = (resolve, reject) => Promise.resolve(result).then(resolve, reject);
  return q;
}

vi.mock("../../shared/supabaseClient.js", () => ({
  hasSupabase: true,
  supabase: { from: (table) => (calls.push(["from", table]), query()) },
}));

const { listTradesSince, listRecentEntries, hiddenTokens } = await import(
  "../../shared/services/launchpadActivityDb.js"
);

beforeEach(() => {
  calls.length = 0;
  result = { data: [], error: null };
});

describe("listTradesSince", () => {
  // Capped at `limit`, a busy token must lose its OLDEST points in range, not
  // its newest — the chart has to end at the current price.
  it("takes the newest trades and returns them oldest first", async () => {
    result = { data: [{ block_number: 9 }, { block_number: 8 }, { block_number: 7 }], error: null };
    const rows = await listTradesSince("0xT", null, 3);
    expect(calls).toContainEqual(["order", "block_number", { ascending: false }]);
    expect(calls).toContainEqual(["order", "log_index", { ascending: false }]);
    expect(calls).toContainEqual(["limit", 3]);
    expect(rows.map((r) => r.block_number)).toEqual([7, 8, 9]);
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
