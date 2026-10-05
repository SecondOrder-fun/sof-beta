/*
  @vitest-environment jsdom
*/

import { describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

const LAUNCHPAD = "0x1000000000000000000000000000000000000001";
const TOTAL = 30;
const tokenFor = (id) => `0x${id.toString(16).padStart(40, "0")}`;

const ZERO = "0x0000000000000000000000000000000000000000";
const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const readContract = vi.fn(async ({ functionName }) => (functionName === "launchCount" ? BigInt(TOTAL) : null));
const multicall = vi.fn(async ({ contracts }) =>
  contracts.map((c) => {
    if (c.functionName === "getLaunch") {
      const id = Number(c.args[0]);
      return {
        status: "success",
        // Odd launches are USDC-paired (a listed quote: no symbol/decimals read).
        result: {
          token: tokenFor(id + 1),
          creator: tokenFor(999),
          launchedAt: 1n,
          quoteToken: id % 2 ? USDC : ZERO,
          startFdv: id % 2 ? 2_500_000_000n : 10n ** 18n,
          placementId: "0x01",
        },
      };
    }
    return { status: "success", result: "X" };
  }),
);

vi.mock("wagmi", () => ({ usePublicClient: () => ({ multicall, readContract }) }));
vi.mock("@/lib/wagmi", () => ({ getStoredNetworkKey: () => "TESTNET" }));
vi.mock("@/config/contracts", () => ({ getContractAddresses: () => ({ TOKEN_LAUNCHPAD: LAUNCHPAD }) }));
vi.mock("@/utils/abis", () => ({ TokenLaunchpadAbi: [], ERC20Abi: [] }));

import { LAUNCHES_PAGE_SIZE, useTokenLaunches } from "@/hooks/useTokenLaunches";

function wrapper({ children }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return React.createElement(QueryClientProvider, { client: qc }, children);
}

describe("useTokenLaunches paging", () => {
  it("reads the newest page and says there is more", async () => {
    const { result } = renderHook(() => useTokenLaunches(), { wrapper });
    await waitFor(() => expect(result.current.launches).toHaveLength(LAUNCHES_PAGE_SIZE));
    expect(result.current.launches[0].launchId).toBe(TOTAL - 1);
    expect(result.current.hasMore).toBe(true);
  });

  it("reads everything once the limit covers the total", async () => {
    const { result } = renderHook(() => useTokenLaunches({ limit: LAUNCHES_PAGE_SIZE * 2 }), { wrapper });
    await waitFor(() => expect(result.current.launches).toHaveLength(TOTAL));
    expect(result.current.launches.at(-1).launchId).toBe(0);
    expect(result.current.hasMore).toBe(false);
  });

  it("carries each launch's quote token and requested valuation", async () => {
    const { result } = renderHook(() => useTokenLaunches(), { wrapper });
    await waitFor(() => expect(result.current.launches).toHaveLength(LAUNCHES_PAGE_SIZE));
    const [usdcLaunch, ethLaunch] = result.current.launches; // ids 29, 28
    expect(usdcLaunch).toMatchObject({ quoteToken: USDC, startFdv: 2_500_000_000n });
    expect(usdcLaunch.quote).toMatchObject({ symbol: "USDC", decimals: 6 });
    expect(ethLaunch.quote).toMatchObject({ address: ZERO, symbol: "ETH", decimals: 18 });
    // Both quotes are listed, so no token was asked its symbol or decimals.
    const asked = multicall.mock.calls.flatMap(([{ contracts }]) => contracts.map((c) => c.functionName));
    expect(asked).not.toContain("decimals");
  });
});
