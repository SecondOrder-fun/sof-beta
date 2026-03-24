// tests/hooks/useRaffleHolders.test.jsx
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useRaffleHolders } from "@/hooks/useRaffleHolders";

describe("useRaffleHolders", () => {
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

  it("should return empty holders when API returns empty", async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({ holders: [], totalHolders: 0, totalTickets: 0 }),
      }),
    );

    const { result } = renderHook(
      () => useRaffleHolders("0x123", 1),
      { wrapper },
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.holders).toEqual([]);
    expect(result.current.totalHolders).toBe(0);
    expect(result.current.totalTickets).toBe(0n);
  });

  it("should handle missing bondingCurveAddress (disabled query)", () => {
    const { result } = renderHook(
      () => useRaffleHolders(null, 1),
      { wrapper },
    );

    expect(result.current.holders).toEqual([]);
    expect(result.current.isLoading).toBe(false);
  });

  it("should provide refetch function", async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({ holders: [], totalHolders: 0, totalTickets: 0 }),
      }),
    );

    const { result } = renderHook(
      () => useRaffleHolders("0x123", 1),
      { wrapper },
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(typeof result.current.refetch).toBe("function");
  });

  it("should map API fields to hook output shape", async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            holders: [
              {
                user_address: "0xAlice",
                current_tickets: 100,
                last_block_number: 500,
                last_block_timestamp: "2024-01-15T10:00:00.000Z",
                transaction_count: 3,
              },
              {
                user_address: "0xBob",
                current_tickets: 50,
                last_block_number: 400,
                last_block_timestamp: "2024-01-14T10:00:00.000Z",
                transaction_count: 1,
              },
            ],
            totalHolders: 2,
            totalTickets: 150,
          }),
      }),
    );

    const { result } = renderHook(
      () => useRaffleHolders("0xCurve", 1),
      { wrapper },
    );

    await waitFor(() => {
      expect(result.current.holders).toHaveLength(2);
    });

    const [alice, bob] = result.current.holders;

    expect(alice.player).toBe("0xAlice");
    expect(alice.ticketCount).toBe(100n);
    expect(alice.rank).toBe(1);
    expect(alice.blockNumber).toBe(500);
    expect(typeof alice.lastUpdate).toBe("number");
    expect(alice.winProbabilityBps).toBe(6666); // 100/150 * 10000

    expect(bob.player).toBe("0xBob");
    expect(bob.ticketCount).toBe(50n);
    expect(bob.rank).toBe(2);
    expect(bob.winProbabilityBps).toBe(3333); // 50/150 * 10000

    expect(result.current.totalHolders).toBe(2);
    expect(result.current.totalTickets).toBe(150n);
  });

  it("should throw on API error", async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({
        ok: false,
        status: 500,
      }),
    );

    const { result } = renderHook(
      () => useRaffleHolders("0x123", 1),
      { wrapper },
    );

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(result.current.error.message).toContain("500");
  });
});
