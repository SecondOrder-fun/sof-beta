// tests/hooks/useRaffleHolders.probability.test.jsx
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useRaffleHolders } from "@/hooks/useRaffleHolders";

describe("useRaffleHolders - Probability Recalculation", () => {
  let queryClient;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });
    vi.clearAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  const wrapper = ({ children }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  const mockApiResponse = (holders, totalTickets) => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            holders,
            totalHolders: holders.length,
            totalTickets,
          }),
      }),
    );
  };

  it("should calculate equal probabilities for equal holders", async () => {
    mockApiResponse(
      [
        { user_address: "0x111", current_tickets: 100, last_block_number: 100, last_block_timestamp: "2024-01-15T10:00:00.000Z", transaction_count: 1 },
        { user_address: "0x222", current_tickets: 100, last_block_number: 101, last_block_timestamp: "2024-01-15T10:01:00.000Z", transaction_count: 1 },
        { user_address: "0x333", current_tickets: 100, last_block_number: 102, last_block_timestamp: "2024-01-15T10:02:00.000Z", transaction_count: 1 },
      ],
      300,
    );

    const { result } = renderHook(
      () => useRaffleHolders("0xCurve", 1),
      { wrapper },
    );

    await waitFor(() => {
      expect(result.current.holders).toHaveLength(3);
    });

    // Each holder has 100/300 = 3333 bps (33.33%)
    result.current.holders.forEach((holder) => {
      expect(holder.winProbabilityBps).toBe(3333);
    });

    expect(result.current.totalTickets).toBe(300n);

    // Probabilities should sum to ~10000 (allowing for rounding)
    const totalProb = result.current.holders.reduce(
      (sum, h) => sum + h.winProbabilityBps,
      0,
    );
    expect(totalProb).toBeGreaterThanOrEqual(9999);
    expect(totalProb).toBeLessThanOrEqual(10000);
  });

  it("should handle single holder correctly (100%)", async () => {
    mockApiResponse(
      [
        { user_address: "0x111", current_tickets: 500, last_block_number: 100, last_block_timestamp: "2024-01-15T10:00:00.000Z", transaction_count: 1 },
      ],
      500,
    );

    const { result } = renderHook(
      () => useRaffleHolders("0xCurve", 1),
      { wrapper },
    );

    await waitFor(() => {
      expect(result.current.holders).toHaveLength(1);
    });

    expect(result.current.holders[0].winProbabilityBps).toBe(10000);
  });

  it("should handle zero total tickets (empty)", async () => {
    mockApiResponse([], 0);

    const { result } = renderHook(
      () => useRaffleHolders("0xCurve", 1),
      { wrapper },
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.holders).toHaveLength(0);
    expect(result.current.totalTickets).toBe(0n);
  });

  it("should maintain correct probabilities for unequal holdings", async () => {
    // User A: 100/250 = 40%, User B: 100/250 = 40%, User C: 50/250 = 20%
    mockApiResponse(
      [
        { user_address: "0xAAA", current_tickets: 100, last_block_number: 103, last_block_timestamp: "2024-01-15T10:03:00.000Z", transaction_count: 2 },
        { user_address: "0xBBB", current_tickets: 100, last_block_number: 101, last_block_timestamp: "2024-01-15T10:01:00.000Z", transaction_count: 1 },
        { user_address: "0xCCC", current_tickets: 50, last_block_number: 102, last_block_timestamp: "2024-01-15T10:02:00.000Z", transaction_count: 1 },
      ],
      250,
    );

    const { result } = renderHook(
      () => useRaffleHolders("0xCurve", 1),
      { wrapper },
    );

    await waitFor(() => {
      expect(result.current.holders).toHaveLength(3);
    });

    const userA = result.current.holders.find((h) => h.player === "0xAAA");
    const userB = result.current.holders.find((h) => h.player === "0xBBB");
    const userC = result.current.holders.find((h) => h.player === "0xCCC");

    expect(userA.winProbabilityBps).toBe(4000);
    expect(userB.winProbabilityBps).toBe(4000);
    expect(userC.winProbabilityBps).toBe(2000);

    const totalProb = result.current.holders.reduce(
      (sum, h) => sum + h.winProbabilityBps,
      0,
    );
    expect(totalProb).toBe(10000);
  });

  it("should handle dominant holder scenario", async () => {
    // One holder dominates: 9900/10000 = 99%, other: 100/10000 = 1%
    mockApiResponse(
      [
        { user_address: "0xWhale", current_tickets: 9900, last_block_number: 100, last_block_timestamp: "2024-01-15T10:00:00.000Z", transaction_count: 5 },
        { user_address: "0xSmall", current_tickets: 100, last_block_number: 101, last_block_timestamp: "2024-01-15T10:01:00.000Z", transaction_count: 1 },
      ],
      10000,
    );

    const { result } = renderHook(
      () => useRaffleHolders("0xCurve", 1),
      { wrapper },
    );

    await waitFor(() => {
      expect(result.current.holders).toHaveLength(2);
    });

    const whale = result.current.holders.find((h) => h.player === "0xWhale");
    const small = result.current.holders.find((h) => h.player === "0xSmall");

    expect(whale.winProbabilityBps).toBe(9900);
    expect(small.winProbabilityBps).toBe(100);
  });
});
