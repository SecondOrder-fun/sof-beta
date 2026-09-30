/*
  @vitest-environment jsdom
*/

import { describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

const SMA = "0x1111111111111111111111111111111111111111";
const SEASON_TOKEN = "0x2222222222222222222222222222222222222222";

const readContract = vi.fn(async ({ functionName }) => (functionName === "balanceOf" ? 5n * 10n ** 18n : "X"));

vi.mock("wagmi", () => ({
  useAccount: () => ({ isConnected: true }),
  usePublicClient: () => ({ readContract }),
}));
vi.mock("@/hooks/useRaffleAccount", () => ({ useRaffleAccount: () => ({ sma: SMA, isReady: true }) }));
vi.mock("@/hooks/useSmartTransactions", () => ({ useSmartTransactions: () => ({ executeBatch: vi.fn() }) }));
vi.mock("@/utils/abis", () => ({ ERC20Abi: [] }));

import { useQuoteToken } from "@/hooks/useQuoteToken";

function wrapper({ children }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return React.createElement(QueryClientProvider, { client: qc }, children);
}

describe("useQuoteToken", () => {
  // A season's token is undefined while it resolves. Reading the platform token in
  // the meantime would show a balance in the wrong token.
  it("reads nothing and stays pending until a token is given", () => {
    readContract.mockClear();
    const { result } = renderHook(() => useQuoteToken(undefined), { wrapper });
    expect(result.current.balancePending).toBe(true);
    expect(result.current.balance).toBe("0");
    expect(readContract).not.toHaveBeenCalled();
  });

  it("reads the given token", async () => {
    readContract.mockClear();
    const { result } = renderHook(() => useQuoteToken(SEASON_TOKEN), { wrapper });
    await waitFor(() => expect(result.current.balance).toBe("5"));
    expect(result.current.balancePending).toBe(false);
    expect(readContract.mock.calls.every(([c]) => c.address === SEASON_TOKEN)).toBe(true);
  });
});
