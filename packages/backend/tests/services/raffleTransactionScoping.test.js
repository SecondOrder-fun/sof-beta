// tests/services/raffleTransactionScoping.test.js
// @vitest-environment node
//
// Regression for #144 / #147: raffle_transactions is partitioned by season_id,
// and the on-chain season_id restarts when the Raffle contract is redeployed,
// so partition season_N accumulates rows from every deployment's season N.
// Season-scoped reads must additionally filter by the season's current bonding
// curve address (a per-season, per-deployment unique value) so prior-deployment
// rows can't bleed in. Writes must stamp the address.
import { describe, it, expect, beforeEach, vi } from "vitest";

const captures = { eq: {}, insert: {} };
let results = {};

function makeBuilder(table) {
  captures.eq[table] = captures.eq[table] || [];
  const b = {};
  const self = () => b;
  b.select = vi.fn(self);
  b.insert = vi.fn((payload) => {
    captures.insert[table] = payload;
    return b;
  });
  b.eq = vi.fn((col, val) => {
    captures.eq[table].push([col, val]);
    return b;
  });
  b.order = vi.fn(self);
  b.range = vi.fn(self);
  b.single = vi.fn(self);
  // Thenable: awaiting any terminal point in the chain resolves to the result.
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
  captures.insert = {};
  results = {};
  mockGetSeasonContracts.mockReset();
  mockFrom.mockClear();
});

describe("raffleTransactionService season+curve scoping", () => {
  it("getSeasonTransactions filters by the season's current bonding curve address", async () => {
    mockGetSeasonContracts.mockResolvedValue({ bonding_curve_address: "0xcurve3" });
    results.raffle_transactions = { data: [{ id: 1 }], error: null, count: 1 };

    const res = await raffleTransactionService.getSeasonTransactions(3, {});

    expect(mockGetSeasonContracts).toHaveBeenCalledWith(3);
    expect(captures.eq.raffle_transactions).toContainEqual(["season_id", 3]);
    expect(captures.eq.raffle_transactions).toContainEqual([
      "bonding_curve_address",
      "0xcurve3",
    ]);
    expect(res.transactions).toHaveLength(1);
  });

  it("getSeasonHolders filters by the season's current bonding curve address", async () => {
    mockGetSeasonContracts.mockResolvedValue({ bonding_curve_address: "0xcurve3" });
    results.raffle_transactions = {
      data: [
        { user_address: "0xa", tickets_after: 5, block_number: 10, id: 1 },
      ],
      error: null,
    };

    const res = await raffleTransactionService.getSeasonHolders(3);

    expect(captures.eq.raffle_transactions).toContainEqual(["season_id", 3]);
    expect(captures.eq.raffle_transactions).toContainEqual([
      "bonding_curve_address",
      "0xcurve3",
    ]);
    expect(res.totalHolders).toBe(1);
  });

  it("getUserTransactions filters by the season's current bonding curve address", async () => {
    mockGetSeasonContracts.mockResolvedValue({ bonding_curve_address: "0xcurve3" });
    results.raffle_transactions = { data: [{ id: 1 }], error: null };

    await raffleTransactionService.getUserTransactions("0xUSER", 3, {});

    expect(captures.eq.raffle_transactions).toContainEqual([
      "bonding_curve_address",
      "0xcurve3",
    ]);
  });

  it("recordTransaction persists the bonding curve address (lowercased)", async () => {
    results.raffle_transactions = { data: { id: 1 }, error: null };

    await raffleTransactionService.recordTransaction({
      seasonId: 3,
      userAddress: "0xAbC",
      transactionType: "BUY",
      ticketAmount: 1,
      sofAmount: 1,
      txHash: "0xhash",
      blockNumber: 10,
      blockTimestamp: "2026-05-29T00:00:00.000Z",
      ticketsBefore: 0,
      ticketsAfter: 1,
      bondingCurveAddress: "0xCURVE3",
    });

    expect(captures.insert.raffle_transactions.bonding_curve_address).toBe(
      "0xcurve3",
    );
    expect(captures.insert.raffle_transactions.season_id).toBe(3);
  });

  it("getSeasonTransactions falls back to season-only filter when curve address is unknown", async () => {
    mockGetSeasonContracts.mockResolvedValue(null);
    results.raffle_transactions = { data: [], error: null, count: 0 };

    await raffleTransactionService.getSeasonTransactions(3, {});

    expect(captures.eq.raffle_transactions).toContainEqual(["season_id", 3]);
    expect(
      captures.eq.raffle_transactions.find(
        (e) => e[0] === "bonding_curve_address",
      ),
    ).toBeUndefined();
  });
});
