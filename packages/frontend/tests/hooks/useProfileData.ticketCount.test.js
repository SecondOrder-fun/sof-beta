// tests/hooks/useProfileData.ticketCount.test.js
// TDD: Verify useProfileData returns ticketCount and bondingCurve in raffle positions

import { describe, test, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import { useProfileData } from "@/hooks/useProfileData";

// Mock dependencies
vi.mock("@/hooks/useViemClient", () => ({
  useViemClient: vi.fn(),
}));

vi.mock("@/config/contracts", () => ({
  getContractAddresses: () => ({
    SOF: "0xSOF",
    RAFFLE: "0xRAFFLE",
  }),
}));

vi.mock("@/hooks/useAllSeasons", () => ({
  useAllSeasons: vi.fn(),
}));

vi.mock("@/services/onchainRaffleDistributor", () => ({
  getPrizeDistributor: vi.fn(),
}));

// useSOFBalance added to useProfileData (D18 migration)
vi.mock("@/hooks/useSOFBalance", () => ({
  useSOFBalance: () => ({
    balanceRaw: 0n,
    isLoading: false,
    refetch: () => {},
  }),
}));

vi.mock("@/utils/abis", () => ({
  ERC20Abi: [],
  SOFBondingCurveAbi: [],
  RaffleAbi: [],
  RafflePrizeDistributorAbi: [],
}));

import { useViemClient } from "@/hooks/useViemClient";
import { useAllSeasons } from "@/hooks/useAllSeasons";

/**
 * Mock client that supports both `readContract` (legacy single-call path)
 * and `multicall` (the batched path used by seasonBalancesQuery). Routes
 * each contract call by functionName.
 */
function createMockClient({ sofBalance, raffleToken, decimals, ticketBalance }) {
  function resolveCall({ functionName, address }) {
    if (functionName === "balanceOf" && address === "0xSOF") return sofBalance ?? 0n;
    if (functionName === "raffleToken") return raffleToken;
    if (functionName === "decimals") return decimals;
    if (functionName === "balanceOf") return ticketBalance;
    return null;
  }
  return {
    readContract: vi.fn((args) => Promise.resolve(resolveCall(args))),
    multicall: vi.fn(({ contracts }) =>
      Promise.resolve(
        contracts.map((c) => ({ status: "success", result: resolveCall(c) })),
      ),
    ),
  };
}

describe("useProfileData - ticketCount and bondingCurve", () => {
  let queryClient;

  const wrapper = ({ children }) =>
    createElement(
      QueryClientProvider,
      { client: queryClient },
      children
    );

  beforeEach(() => {
    vi.resetAllMocks();
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
  });

  test("seasonBalancesQuery results include ticketCount computed from balance/decimals", async () => {
    const mockClient = createMockClient({
      sofBalance: 100n * 10n ** 18n,
      raffleToken: "0xRaffleToken",
      decimals: 18,
      ticketBalance: 5000000000000000000n, // 5 * 10^18
    });

    useViemClient.mockReturnValue({ client: mockClient, netKey: "testnet" });
    useAllSeasons.mockReturnValue({
      data: [
        { id: 1, config: { name: "Season 1", bondingCurve: "0xCurve1" } },
      ],
    });

    const { result } = renderHook(() => useProfileData("0xUser"), { wrapper });

    await waitFor(() => {
      const data = result.current.seasonBalancesQuery.data;
      expect(data).toBeDefined();
      expect(data.length).toBeGreaterThan(0);
    });

    const positions = result.current.seasonBalancesQuery.data;
    expect(positions).toHaveLength(1);
    expect(positions[0]).toMatchObject({
      seasonId: 1,
      name: "Season 1",
      token: "0xRaffleToken",
      bondingCurve: "0xCurve1",
      ticketCount: "5",
    });
  });

  test("ticketCount is correctly computed for non-18 decimal tokens", async () => {
    const mockClient = createMockClient({
      sofBalance: 50n * 10n ** 18n,
      raffleToken: "0xRaffleToken2",
      decimals: 6,
      ticketBalance: 3000000n, // 3 * 10^6
    });

    useViemClient.mockReturnValue({ client: mockClient, netKey: "testnet" });
    useAllSeasons.mockReturnValue({
      data: [
        { id: 2, config: { name: "Season 2", bondingCurve: "0xCurve2" } },
      ],
    });

    const { result } = renderHook(() => useProfileData("0xUser"), { wrapper });

    await waitFor(() => {
      const data = result.current.seasonBalancesQuery.data;
      expect(data).toBeDefined();
      expect(data.length).toBeGreaterThan(0);
    });

    const positions = result.current.seasonBalancesQuery.data;
    expect(positions).toHaveLength(1);
    expect(positions[0].ticketCount).toBe("3");
    expect(positions[0].bondingCurve).toBe("0xCurve2");
  });
});
