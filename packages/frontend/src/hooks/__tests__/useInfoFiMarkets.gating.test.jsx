// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useInfoFiMarkets } from "../useInfoFiMarkets";

function wrapper({ children }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  vi.useFakeTimers();
  global.fetch = vi.fn(async (url) => {
    const seasonId = new URL(url, "http://x").searchParams.get("seasonId");
    return {
      ok: true,
      json: async () => ({ markets: { [seasonId]: [{ id: Number(seasonId) }] } }),
    };
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useInfoFiMarkets live/terminal gating", () => {
  it("merges markets from both live and terminal seasons", async () => {
    const seasons = [
      { id: 1, status: 1 }, // live
      { id: 2, status: 5 }, // terminal
    ];
    const { result } = renderHook(() => useInfoFiMarkets(seasons, {}), { wrapper });

    await vi.waitFor(
      () => {
        expect(Object.keys(result.current.markets)).toContain("1");
        expect(Object.keys(result.current.markets)).toContain("2");
      },
      { timeout: 5000, interval: 20 },
    );
  });

  it("does not poll when every passed season is terminal", async () => {
    const seasons = [
      { id: 2, status: 4 },
      { id: 3, status: 5 },
    ];
    const { result } = renderHook(() => useInfoFiMarkets(seasons, {}), { wrapper });

    // Let the initial (one-shot) fetch settle.
    await vi.waitFor(() => expect(result.current.isLoading).toBe(false), {
      timeout: 5000,
      interval: 20,
    });

    const callsAfterLoad = global.fetch.mock.calls.length;
    expect(callsAfterLoad).toBeGreaterThan(0);

    // Advance well past the 10s live refetchInterval. Terminal queries use
    // refetchInterval: false, so no further fetches should fire.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(11_000);
    });

    expect(global.fetch.mock.calls.length).toBe(callsAfterLoad);
  });

  it("keeps polling while at least one season is live", async () => {
    const seasons = [
      { id: 1, status: 1 }, // live
      { id: 4, status: 5 }, // terminal
    ];
    const { result } = renderHook(() => useInfoFiMarkets(seasons, {}), { wrapper });

    // Let the initial fetches settle.
    await vi.waitFor(() => expect(result.current.isLoading).toBe(false), {
      timeout: 5000,
      interval: 20,
    });

    const callsAfterLoad = global.fetch.mock.calls.length;
    expect(callsAfterLoad).toBeGreaterThan(0);

    // Advance past the 10s live refetchInterval — the live query must refetch.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(11_000);
    });

    expect(global.fetch.mock.calls.length).toBeGreaterThan(callsAfterLoad);
  });
});
