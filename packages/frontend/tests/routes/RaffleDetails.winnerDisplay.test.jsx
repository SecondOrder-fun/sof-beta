/*
  @vitest-environment jsdom
*/
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k) => k,
    i18n: { language: "en" },
  }),
}));

// Desktop platform
vi.mock("@/hooks/usePlatform", () => ({
  usePlatform: () => ({ isMobile: false }),
}));

vi.mock("wagmi", () => ({
  useAccount: () => ({ address: "0xabc", isConnected: true }),
  useWriteContract: () => ({
    writeContractAsync: vi.fn(),
    data: undefined,
    isPending: false,
    error: null,
  }),
}));

vi.mock("@/hooks/useRaffleState", () => ({
  useRaffleState: () => ({
    seasonDetailsQuery: {
      data: {
        status: 5,
        config: {
          name: "Completed Season",
          startTime: "100",
          endTime: "200",
          bondingCurve: "0xC011bEad00000000000000000000000000000000",
        },
      },
      isLoading: false,
      error: null,
    },
  }),
}));

vi.mock("@/hooks/useSeasonWinnerSummaries", () => ({
  useSeasonWinnerSummary: () => ({
    isLoading: false,
    error: null,
    data: {
      winnerAddress: "0x1111111111111111111111111111111111111111",
      winnerUsername: null,
      grandPrizeWei: 1230000000000000000n,
    },
  }),
}));

vi.mock("@/hooks/useCurveState", () => ({
  useCurveState: () => ({
    curveSupply: 0n,
    curveReserves: 0n,
    curveStep: { price: 0n, step: 0 },
    allBondSteps: [],
    debouncedRefresh: vi.fn(),
  }),
}));

vi.mock("@/hooks/useCurveEvents", () => ({
  useCurveEvents: () => {},
}));

vi.mock("@/components/admin/RaffleAdminControls", () => ({
  RaffleAdminControls: () => null,
}));
vi.mock("@/components/admin/TreasuryControls", () => ({
  TreasuryControls: () => null,
}));

vi.mock("@/components/curve/BuySellWidget", () => ({
  __esModule: true,
  default: () => <div />,
}));

vi.mock("@/components/curve/CurveGraph", () => ({
  __esModule: true,
  default: () => <div />,
}));

vi.mock("@/components/user/UsernameDisplay", () => ({
  __esModule: true,
  default: ({ address }) => <span>{address}</span>,
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

vi.mock("@/config/networks", () => ({
  getNetworkByKey: () => ({
    id: 31337,
    name: "Local",
    rpcUrl: "http://127.0.0.1:8545",
    explorer: "",
  }),
}));

vi.mock("viem", async () => {
  const actual = await vi.importActual("viem");
  return {
    ...actual,
    createPublicClient: vi.fn(() => ({
      readContract: vi.fn(async () => 0n),
      getBlock: vi.fn(async () => ({ timestamp: 123n })),
      getLogs: vi.fn(async () => []),
    })),
    http: vi.fn(() => ({})),
  };
});

// Mock useChainTime to return a current timestamp immediately (no async wait)
vi.mock("@/hooks/useChainTime", () => ({
  useChainTime: () => Math.floor(Date.now() / 1000),
}));

import RaffleDetails from "@/routes/RaffleDetails.jsx";

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/raffles/5"]}>
        <Routes>
          <Route path="/raffles/:seasonId" element={<RaffleDetails />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("RaffleDetails winner display", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows winner announcement card when season is completed", () => {
    renderPage();

    expect(screen.getByText("winnerAnnouncement")).toBeInTheDocument();
    expect(screen.getByText("winner:")).toBeInTheDocument();
    expect(
      screen.getByText("0x1111111111111111111111111111111111111111"),
    ).toBeInTheDocument();
    expect(screen.getByText(/grandPrize\s*:/)).toBeInTheDocument();
  });
});
