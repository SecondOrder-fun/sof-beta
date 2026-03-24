/*
  @vitest-environment jsdom
*/

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key, params) => params?.defaultValue || key,
  }),
}));

vi.mock("@/hooks/usePlatform", () => ({
  usePlatform: () => ({ isMobile: true }),
}));

vi.mock("wagmi", () => ({
  useAccount: () => ({
    address: "0x1111111111111111111111111111111111111111",
    isConnected: true,
  }),
  usePublicClient: () => ({
    watchContractEvent: () => () => {},
  }),
  useWriteContract: () => ({
    writeContractAsync: vi.fn(),
    data: undefined,
    isPending: false,
    error: null,
  }),
}));

vi.mock("@/lib/wagmi", () => ({
  getStoredNetworkKey: () => "LOCAL",
  getChainConfig: () => ({ id: 31337, name: "Local", rpcUrl: "http://127.0.0.1:8545" }),
}));

vi.mock("@/hooks/useSeasonGating", () => ({
  useSeasonGating: () => ({ gates: [], isGated: false, isLoading: false }),
  GateType: { PASSWORD: "PASSWORD", SIGNATURE: "SIGNATURE" },
}));

vi.mock("@/hooks/useSponsoredPrizes", () => ({
  useSponsoredPrizes: () => ({ tierConfigs: [], prizes: [], isLoading: false }),
}));

vi.mock("@/hooks/useSmartTransactions", () => ({
  useSmartTransactions: () => ({
    executeBatch: vi.fn(),
    isSmartWallet: false,
  }),
}));

vi.mock("@/components/prizes/SponsorPrizeWidget", () => ({
  SponsorPrizeWidget: () => null,
}));

vi.mock("@/components/prizes/ClaimPrizeWidget", () => ({
  ClaimPrizeWidget: () => null,
}));

vi.mock("@/hooks/useRaffleState", () => ({
  useRaffleState: () => ({
    seasonDetailsQuery: {
      data: {
        config: {
          name: "Test Season",
          endTime: BigInt(Math.floor(Date.now() / 1000) + 600),
          bondingCurve: "0x0000000000000000000000000000000000000001",
        },
        status: 1,
        totalTickets: 0,
        totalPrizePool: 0n,
      },
      isLoading: false,
      error: null,
    },
  }),
}));

vi.mock("@/hooks/useSeasonWinnerSummaries", () => ({
  useSeasonWinnerSummary: () => ({ isLoading: false, error: null, data: null }),
  useSeasonWinnerSummaries: () => ({ isLoading: false, error: null, data: {} }),
}));

// CountdownTimer uses @number-flow/react which is not jsdom-friendly in tests.
vi.mock("@/components/common/CountdownTimer", () => ({
  __esModule: true,
  default: () => <span>COUNTDOWN</span>,
}));

vi.mock("@/hooks/useCurveState", () => ({
  useCurveState: () => ({
    curveSupply: 0n,
    curveReserves: 0n,
    curveStep: { price: 0n },
    allBondSteps: [],
    debouncedRefresh: vi.fn(),
  }),
}));

// RaffleDetails renders BuySellSheet in mobile mode; stub it to keep this test focused
// on the "Your Tickets" refresh path.
vi.mock("@/components/mobile/BuySellSheet", () => ({
  default: () => null,
}));

const readContractMock = vi.fn();

// Critical for the regression: emulate ABI module shapes where the JSON import is `{ abi: [...] }`
// and verify RaffleDetails normalizes `SOFBondingCurveAbi` / `ERC20Abi` to arrays.
vi.mock("@/utils/abis", () => ({
  SOFBondingCurveAbi: { abi: [{ type: "function", name: "playerTickets" }] },
  ERC20Abi: { abi: [{ type: "function", name: "balanceOf" }] },
}));

vi.mock("@/lib/viemClient", () => ({
  buildPublicClient: () => ({
    readContract: readContractMock,
    getBlock: vi.fn(async () => ({ timestamp: 123n })),
  }),
}));

// Mock useChainTime to return a current timestamp immediately (no async wait)
vi.mock("@/hooks/useChainTime", () => ({
  useChainTime: () => Math.floor(Date.now() / 1000),
}));

// usePlayerPosition was extracted from RaffleDetails. ABI normalization tests are in
// tests/hooks/usePlayerPosition.test.jsx. Here we mock the hook to return a position.
const mockRefreshNow = vi.fn();
vi.mock("@/hooks/usePlayerPosition", () => ({
  usePlayerPosition: () => ({
    position: { tickets: 7n, probBps: 7000, total: 10n },
    isRefreshing: false,
    setIsRefreshing: vi.fn(),
    setPosition: vi.fn(),
    refreshNow: mockRefreshNow,
  }),
}));

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import RaffleDetails from "@/routes/RaffleDetails.jsx";

describe("RaffleDetails (mobile) position display", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders Your Tickets with position data from usePlayerPosition hook", async () => {
    // ABI normalization logic was extracted to usePlayerPosition and is
    // tested directly in tests/hooks/usePlayerPosition.test.jsx.
    // Here we verify the mobile view renders the hook's returned position.
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/raffles/1"]}>
          <Routes>
            <Route path="/raffles/:seasonId" element={<RaffleDetails />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await act(async () => {
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getByText("raffle:yourTickets")).toBeInTheDocument();
    });

    // The ticket count from the mocked usePlayerPosition (tickets: 7n)
    await waitFor(() => {
      expect(screen.getByText("7")).toBeInTheDocument();
    });
  });
});
