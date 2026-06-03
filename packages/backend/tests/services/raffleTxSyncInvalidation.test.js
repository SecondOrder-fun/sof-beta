// Regression test for the cache-invalidation contract on
// raffleTransactionService.syncSeasonTransactions. The method must
// funnel its `last_tx_sync_block` write through db.setLastTxSyncBlock
// (which invalidates season_contracts:*) rather than bypassing via
// db.client.from('season_contracts').update(...) directly. Direct
// bypass would silently leave stale data in the 5-min-TTL
// getActiveSeasonContracts / getAllSeasonContracts caches.

import { describe, it, expect, vi, beforeEach } from "vitest";

const { setLastTxSyncBlock, getBlockNumber, dbClientFrom } = vi.hoisted(
  () => ({
    setLastTxSyncBlock: vi.fn().mockResolvedValue(undefined),
    getBlockNumber: vi.fn(),
    dbClientFrom: vi.fn(),
  }),
);

vi.mock("../../src/lib/viemClient.js", () => ({
  publicClient: {
    getBlockNumber,
    getBlock: vi.fn(),
    getTransaction: vi.fn(),
  },
}));

vi.mock("../../src/utils/blockRangeQuery.js", () => ({
  // No events in the synthetic window — the loop body is skipped, the
  // method proceeds straight to the cursor write.
  queryLogsInChunks: vi.fn().mockResolvedValue([]),
}));

vi.mock("../../shared/supabaseClient.js", () => ({
  db: {
    client: { from: dbClientFrom },
    setLastTxSyncBlock,
  },
}));

import { raffleTransactionService } from "../../src/services/raffleTransactionService.js";

describe("raffleTransactionService.syncSeasonTransactions invalidation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses db.setLastTxSyncBlock (NOT a direct .from().update() bypass) when advancing the cursor", async () => {
    // Initial cursor: block 100.
    dbClientFrom.mockReturnValueOnce({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn().mockResolvedValue({
            data: { created_at: "2026-01-01T00:00:00Z", last_tx_sync_block: "100" },
            error: null,
          }),
        })),
      })),
    });
    // Chain head: block 500. Sync window is [101, 500].
    getBlockNumber.mockResolvedValueOnce(500n);

    // Spy on refreshUserPositions so we don't actually hit it.
    const refreshSpy = vi
      .spyOn(raffleTransactionService, "refreshUserPositions")
      .mockResolvedValue();

    const result = await raffleTransactionService.syncSeasonTransactions(
      7,
      "0xBondingCurve",
    );

    // Convention assertion: the cursor write went through the cache-
    // invalidating helper, not through db.client.from('season_contracts').
    expect(setLastTxSyncBlock).toHaveBeenCalledTimes(1);
    expect(setLastTxSyncBlock).toHaveBeenCalledWith(7, 500n);

    // The ONLY db.client.from call should be the initial cursor READ
    // (no second call for a direct UPDATE).
    expect(dbClientFrom).toHaveBeenCalledTimes(1);
    expect(dbClientFrom).toHaveBeenCalledWith("season_contracts");

    expect(result).toEqual(
      expect.objectContaining({ success: true, recorded: 0 }),
    );

    refreshSpy.mockRestore();
  });

  it("skips the cursor write entirely when the chain hasn't advanced past the last synced block", async () => {
    dbClientFrom.mockReturnValueOnce({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn().mockResolvedValue({
            data: { created_at: "2026-01-01T00:00:00Z", last_tx_sync_block: "500" },
            error: null,
          }),
        })),
      })),
    });
    getBlockNumber.mockResolvedValueOnce(500n);

    await raffleTransactionService.syncSeasonTransactions(7, "0xBondingCurve");

    // Already up to date → no write, no invalidation.
    expect(setLastTxSyncBlock).not.toHaveBeenCalled();
  });

  it("returns an error and does not advance the cursor when the season row is missing", async () => {
    dbClientFrom.mockReturnValueOnce({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi
            .fn()
            .mockResolvedValue({ data: null, error: null }),
        })),
      })),
    });

    const result = await raffleTransactionService.syncSeasonTransactions(
      99,
      "0xBondingCurve",
    );

    expect(result).toEqual({ error: "Season not found", seasonId: 99 });
    expect(setLastTxSyncBlock).not.toHaveBeenCalled();
  });
});
