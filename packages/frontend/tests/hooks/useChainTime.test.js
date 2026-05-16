/*
  @vitest-environment jsdom
*/

import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";

// Stub VITE_API_BASE_URL so buildApiUrl resolves correctly
vi.stubEnv("VITE_API_BASE_URL", "http://localhost:3001/api");

// Mock the internal helpers used by useWarmRead
vi.mock("@/hooks/chain/internal", () => ({
  buildApiUrl: (path) => `http://localhost:3001/api${path}`,
  bumpTelemetry: vi.fn(),
  normalizeFetchError: (_e, res) =>
    new Error(res ? `HTTP ${res.status}` : "fetch error"),
}));

describe("useChainTime", () => {
  let queryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: 0 },
      },
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  function wrapper({ children }) {
    return createElement(
      QueryClientProvider,
      { client: queryClient },
      children,
    );
  }

  it("returns block.timestamp as a number from /api/chain/time", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        blockNumber: 12345,
        timestamp: 1700000000,
        cachedAt: Date.now(),
      }),
    });

    const { useChainTime } = await import("@/hooks/useChainTime");

    const { result } = renderHook(() => useChainTime(), { wrapper });

    await waitFor(() => {
      expect(result.current).toBe(1700000000);
    });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledWith(
      "http://localhost:3001/api/chain/time",
      expect.objectContaining({ headers: expect.any(Object) }),
    );
  });

  it("shares cache across multiple consumers (single fetch)", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        blockNumber: 12345,
        timestamp: 1700000000,
        cachedAt: Date.now(),
      }),
    });

    const { useChainTime } = await import("@/hooks/useChainTime");

    const { result: r1 } = renderHook(() => useChainTime(), { wrapper });
    const { result: r2 } = renderHook(() => useChainTime(), { wrapper });

    await waitFor(() => {
      expect(r1.current).toBe(1700000000);
    });
    await waitFor(() => {
      expect(r2.current).toBe(1700000000);
    });

    // Both consumers share the same query key — only one fetch
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("returns null when backend has not yet populated the cache", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 503,
    });

    const { useChainTime } = await import("@/hooks/useChainTime");

    const { result } = renderHook(() => useChainTime(), { wrapper });

    // Should remain null while the query is pending / errored
    await new Promise((r) => setTimeout(r, 50));
    expect(result.current).toBe(null);
  });

  it("accepts refetchInterval override via opts", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        blockNumber: 99,
        timestamp: 1800000000,
        cachedAt: Date.now(),
      }),
    });

    const { useChainTime } = await import("@/hooks/useChainTime");

    const { result } = renderHook(
      () => useChainTime({ refetchInterval: 5_000 }),
      { wrapper },
    );

    await waitFor(() => {
      expect(result.current).toBe(1800000000);
    });
  });
});
