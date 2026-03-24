/*
  @vitest-environment jsdom
*/

import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";

vi.mock("@/lib/wagmi", () => ({
  getStoredNetworkKey: () => "TESTNET",
}));

const getBlockMock = vi.fn().mockResolvedValue({ timestamp: 1700000000n });

vi.mock("@/lib/viemClient", () => ({
  buildPublicClient: () => ({
    getBlock: getBlockMock,
  }),
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

  function wrapper({ children }) {
    return createElement(
      QueryClientProvider,
      { client: queryClient },
      children,
    );
  }

  it("returns block.timestamp as a number", async () => {
    const { useChainTime } = await import("@/hooks/useChainTime");

    const { result } = renderHook(() => useChainTime(), { wrapper });

    await waitFor(() => {
      expect(result.current).toBe(1700000000);
    });

    expect(getBlockMock).toHaveBeenCalledTimes(1);
  });

  it("shares cache across multiple consumers", async () => {
    const { useChainTime } = await import("@/hooks/useChainTime");

    const { result: r1 } = renderHook(() => useChainTime(), { wrapper });
    const { result: r2 } = renderHook(() => useChainTime(), { wrapper });

    await waitFor(() => {
      expect(r1.current).toBe(1700000000);
    });
    await waitFor(() => {
      expect(r2.current).toBe(1700000000);
    });

    // Only one RPC call because both hooks share the same query key
    expect(getBlockMock).toHaveBeenCalledTimes(1);
  });

  it("returns null when client is unavailable", async () => {
    vi.resetModules();
    vi.doMock("@/lib/wagmi", () => ({
      getStoredNetworkKey: () => "TESTNET",
    }));
    vi.doMock("@/lib/viemClient", () => ({
      buildPublicClient: () => null,
    }));

    const { useChainTime } = await import("@/hooks/useChainTime");

    const { result } = renderHook(() => useChainTime(), { wrapper });

    // Should stay null because buildPublicClient returns null
    await new Promise((r) => setTimeout(r, 50));
    expect(result.current).toBe(null);
  });
});
