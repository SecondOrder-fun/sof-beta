/*
  @vitest-environment jsdom
*/

import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

const LAUNCHPAD = "0x1000000000000000000000000000000000000001";
const PLACER = "0x3000000000000000000000000000000000000003";

// What each placer view returns; a missing entry fails, like a placer without it.
const views = { current: {} };
const multicall = vi.fn(async ({ contracts }) =>
  contracts.map((c) =>
    c.functionName in views.current
      ? { status: "success", result: views.current[c.functionName] }
      : { status: "failure", error: new Error(`no ${c.functionName}`) },
  ),
);
const readContract = vi.fn(async () => PLACER);

vi.mock("wagmi", async (importOriginal) => ({
  ...(await importOriginal()),
  usePublicClient: () => ({ multicall, readContract }),
}));
vi.mock("@/lib/wagmi", () => ({ getStoredNetworkKey: () => "TESTNET" }));
vi.mock("@/config/contracts", () => ({ getContractAddresses: () => ({ TOKEN_LAUNCHPAD: LAUNCHPAD }) }));
vi.mock("@/hooks/useSmartTransactions", () => ({ useSmartTransactions: () => ({}) }));

import { useTradeFeeBounds } from "@/hooks/useTokenLaunchpad";

function wrapper({ children }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return React.createElement(QueryClientProvider, { client: qc }, children);
}

describe("useTradeFeeBounds", () => {
  beforeEach(() => {
    multicall.mockClear();
  });

  it("reads the trade-fee range and the snipe tax new launches get", async () => {
    views.current = { minTradeFee: 5_000, MAX_TRADE_FEE: 100_000, snipeStartBps: 8_000, snipeDuration: 30 };
    const { result } = renderHook(() => useTradeFeeBounds(), { wrapper });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data).toEqual({ min: 5_000, max: 100_000, snipeStartBps: 8_000, snipeDuration: 30 });
    expect(multicall.mock.calls[0][0].contracts.every((c) => c.address === PLACER)).toBe(true);
  });

  it("reads no snipe tax from a placer from before it", async () => {
    views.current = { minTradeFee: 5_000, MAX_TRADE_FEE: 100_000 };
    const { result } = renderHook(() => useTradeFeeBounds(), { wrapper });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data).toEqual({ min: 5_000, max: 100_000, snipeStartBps: 0, snipeDuration: 0 });
  });

  it("fails rather than guess when the fee range cannot be read", async () => {
    views.current = { MAX_TRADE_FEE: 100_000, snipeStartBps: 8_000, snipeDuration: 30 };
    const { result } = renderHook(() => useTradeFeeBounds(), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
  });
});
