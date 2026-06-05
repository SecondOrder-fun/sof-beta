// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useInfoFiMarkets } from "../useInfoFiMarkets";

function wrapper({ children }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  global.fetch = vi.fn(async (url) => {
    const seasonId = new URL(url, "http://x").searchParams.get("seasonId");
    return {
      ok: true,
      json: async () => ({ markets: { [seasonId]: [{ id: Number(seasonId) }] } }),
    };
  });
});

describe("useInfoFiMarkets live/terminal gating", () => {
  it("merges markets from both live and terminal seasons", async () => {
    const seasons = [
      { id: 1, status: 1 }, // live
      { id: 2, status: 5 }, // terminal
    ];
    const { result } = renderHook(() => useInfoFiMarkets(seasons, {}), { wrapper });

    await waitFor(() => {
      expect(Object.keys(result.current.markets)).toContain("1");
      expect(Object.keys(result.current.markets)).toContain("2");
    });
  });

  it("does not poll when every passed season is terminal", async () => {
    const seasons = [
      { id: 2, status: 4 },
      { id: 3, status: 5 },
    ];
    const { result } = renderHook(() => useInfoFiMarkets(seasons, {}), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const callsAfterLoad = global.fetch.mock.calls.length;
    await new Promise((r) => setTimeout(r, 50));
    expect(global.fetch.mock.calls.length).toBe(callsAfterLoad);
  });
});
