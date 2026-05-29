// tests/services/userPositionScoping.test.js
// @vitest-environment node
//
// Regression for #152: the user_raffle_positions matview aggregates by
// season_id, which collides across contract redeploys (on-chain season_id
// restarts). getUserPosition / getAllUserPositions must be scoped to each
// season's CURRENT bonding curve so prior-deployment positions don't bleed in.
import { describe, it, expect, beforeEach, vi } from "vitest";

const captures = { eq: {}, in: {} };
let results = {};

function makeBuilder(table) {
  captures.eq[table] = captures.eq[table] || [];
  captures.in[table] = captures.in[table] || [];
  const b = {};
  const self = () => b;
  b.select = vi.fn(self);
  b.eq = vi.fn((col, val) => {
    captures.eq[table].push([col, val]);
    return b;
  });
  b.in = vi.fn((col, vals) => {
    captures.in[table].push([col, vals]);
    return b;
  });
  b.order = vi.fn(self);
  b.single = vi.fn(self);
  b.then = (resolve) => resolve(results[table] ?? { data: null, error: null });
  return b;
}

const mockFrom = vi.fn((table) => makeBuilder(table));
const mockGetSeasonContracts = vi.fn();

vi.mock("../../shared/supabaseClient.js", () => ({
  db: {
    client: {
      from: (...a) => mockFrom(...a),
      rpc: vi.fn(() => Promise.resolve({ error: null })),
    },
    getSeasonContracts: (...a) => mockGetSeasonContracts(...a),
  },
}));
vi.mock("../../src/lib/viemClient.js", () => ({ publicClient: {} }));
vi.mock("../../src/utils/blockRangeQuery.js", () => ({
  queryLogsInChunks: vi.fn(() => []),
}));
vi.mock("@sof/contracts", () => ({ SOFBondingCurveABI: [] }));

const { raffleTransactionService } = await import(
  "../../src/services/raffleTransactionService.js"
);

beforeEach(() => {
  captures.eq = {};
  captures.in = {};
  results = {};
  mockGetSeasonContracts.mockReset();
  mockFrom.mockClear();
});

describe("user position curve scoping (#152)", () => {
  it("getUserPosition filters the matview by the season's current bonding curve", async () => {
    mockGetSeasonContracts.mockResolvedValue({ bonding_curve_address: "0xcurrent3" });
    results.user_raffle_positions = {
      data: { season_id: 3, bonding_curve_address: "0xcurrent3", current_tickets: 5 },
      error: null,
    };

    const pos = await raffleTransactionService.getUserPosition("0xUSER", 3);

    expect(mockGetSeasonContracts).toHaveBeenCalledWith(3);
    expect(captures.eq.user_raffle_positions).toContainEqual(["season_id", 3]);
    expect(captures.eq.user_raffle_positions).toContainEqual([
      "bonding_curve_address",
      "0xcurrent3",
    ]);
    expect(pos.current_tickets).toBe(5);
  });

  it("getAllUserPositions keeps only positions on each season's current curve", async () => {
    // Two rows for season 3: the current curve and a (hypothetical future)
    // prior-deployment curve. Only the current one should survive.
    results.user_raffle_positions = {
      data: [
        { season_id: 3, bonding_curve_address: "0xcurrent3", current_tickets: 5 },
        { season_id: 3, bonding_curve_address: "0xold3", current_tickets: 99 },
        { season_id: 2, bonding_curve_address: "0xcurrent2", current_tickets: 7 },
      ],
      error: null,
    };
    results.season_contracts = {
      data: [
        { season_id: 3, bonding_curve_address: "0xcurrent3" },
        { season_id: 2, bonding_curve_address: "0xcurrent2" },
      ],
      error: null,
    };

    const positions = await raffleTransactionService.getAllUserPositions("0xUSER");

    expect(positions).toHaveLength(2);
    expect(positions.map((p) => p.bonding_curve_address).sort()).toEqual([
      "0xcurrent2",
      "0xcurrent3",
    ]);
    // The prior-deployment curve row (0xold3, 99 tickets) must be excluded.
    expect(positions.find((p) => p.bonding_curve_address === "0xold3")).toBeUndefined();
    // It looked up season_contracts for the seasons present.
    expect(captures.in.season_contracts).toContainEqual([
      "season_id",
      expect.arrayContaining([3, 2]),
    ]);
  });
});
