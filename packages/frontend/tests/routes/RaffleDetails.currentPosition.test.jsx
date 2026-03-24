/*
  @vitest-environment jsdom
*/
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// Mock i18n
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key) => key,
    i18n: { language: "en" },
  }),
}));

// Mock hooks used by RaffleDetails
vi.mock("@/hooks/useRaffleState", () => ({
  useRaffleState: () => ({
    seasonDetailsQuery: {
      data: {
        status: 1,
        config: {
          name: "Test Season 1",
          startTime: `${Math.floor(Date.now() / 1000) - 60}`,
          endTime: `${Math.floor(Date.now() / 1000) + 3600}`,
          bondingCurve: "0xC011bEad00000000000000000000000000000000",
        },
      },
      isLoading: false,
      error: null,
    },
  }),
}));

vi.mock("@/hooks/useCurveState", () => ({
  useCurveState: () => ({
    curveSupply: 10000n,
    curveReserves: 0n,
    curveStep: { step: 10 },
    allBondSteps: [],
    debouncedRefresh: vi.fn(),
  }),
}));

vi.mock("@/hooks/useRaffleTracker", () => ({
  useRaffleTracker: () => ({
    usePlayerSnapshot: () => ({
      isLoading: false,
      error: null,
      data: null,
      refetch: vi.fn(),
    }),
    usePlayerSnapshotLive: () => {},
  }),
}));

vi.mock("@/hooks/useWallet", () => ({
  useWallet: () => ({
    address: "0xabc0000000000000000000000000000000000001",
    isConnected: true,
  }),
}));

// Mock the chunked query utility
vi.mock("@/utils/blockRangeQuery", () => ({
  queryLogsInChunks: vi.fn(() => Promise.resolve([])),
}));

vi.mock("wagmi", () => ({
  useAccount: () => ({
    address: "0xabc0000000000000000000000000000000000001",
    isConnected: true,
  }),
  useChains: () => [
    {
      id: 31337,
      rpcUrls: { default: { http: ["http://127.0.0.1:8545"] } },
    },
  ],
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

const readContractMock = vi.fn(async ({ functionName }) => {
  if (functionName === "playerTickets") return 1234n;
  if (functionName === "curveConfig")
    return [10000n, 0n, 0n, 0, 0, false, true];
  if (functionName === "balanceOf") return 1234n;
  if (functionName === "totalSupply") return 10000n;
  if (functionName === "token")
    return "0xDeaD00000000000000000000000000000000BEEF";
  return 0n;
});

vi.mock("@/lib/viemClient", () => ({
  buildPublicClient: () => ({
    readContract: readContractMock,
    getBlock: vi.fn(async () => ({
      timestamp: BigInt(Math.floor(Date.now() / 1000)),
    })),
  }),
}));

vi.mock("viem", async () => {
  const actual = await vi.importActual("viem");
  return {
    ...actual,
    createPublicClient: vi.fn(() => ({
      readContract: readContractMock,
      getBlock: vi.fn(async () => ({
        timestamp: BigInt(Math.floor(Date.now() / 1000)),
      })),
      getBlockNumber: vi.fn(async () => 1000n),
      getLogs: vi.fn(async () => []),
    })),
    http: vi.fn(() => ({})),
    parseAbiItem: vi.fn(() => ({})),
  };
});

// Mock BuySellWidget to expose a test button that triggers onTxSuccess and onNotify
vi.mock("@/components/curve/BuySellWidget", () => ({
  __esModule: true,
  default: ({ onTxSuccess, onNotify }) => (
    <div>
      <button
        onClick={() => {
          onNotify?.({
            type: "success",
            message: "Purchase complete",
            hash: "0xtest",
          });
          onTxSuccess?.();
        }}
      >
        Simulate Buy
      </button>
    </div>
  ),
}));

// Mock BondingCurvePanel minimal
vi.mock("@/components/curve/CurveGraph", () => ({
  __esModule: true,
  default: () => <div data-testid="curve" />,
}));

vi.mock("@/components/common/CountdownTimer", () => ({
  __esModule: true,
  default: () => <span>countdown</span>,
}));

// Mock deps used inside RaffleDetails
vi.mock("@/config/networks", () => ({
  getNetworkByKey: () => ({
    id: 31337,
    name: "Local Anvil",
    rpcUrl: "http://127.0.0.1:8545",
    explorer: "",
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

vi.mock("@/hooks/useSeasonWinnerSummaries", () => ({
  useSeasonWinnerSummary: () => ({ isLoading: false, error: null, data: null }),
  useSeasonWinnerSummaries: () => ({ isLoading: false, error: null, data: {} }),
}));

// Mock useChainTime to return a current timestamp immediately (no async wait)
vi.mock("@/hooks/useChainTime", () => ({
  useChainTime: () => Math.floor(Date.now() / 1000),
}));

// Mock usePlayerPosition — position logic was extracted from RaffleDetails.
// refreshNow calls are verified via the mock spy.
const mockRefreshPositionNow = vi.fn();
vi.mock("@/hooks/usePlayerPosition", () => ({
  usePlayerPosition: () => ({
    position: { tickets: 1234n, probBps: 1234, total: 10000n },
    isRefreshing: false,
    setIsRefreshing: vi.fn(),
    setPosition: vi.fn(),
    refreshNow: mockRefreshPositionNow,
  }),
}));

// Mock admin components to avoid Wagmi provider requirements
vi.mock("@/components/admin/RaffleAdminControls", () => ({
  RaffleAdminControls: () => null,
}));
vi.mock("@/components/admin/TreasuryControls", () => ({
  TreasuryControls: () => null,
}));

import RaffleDetails from "@/routes/RaffleDetails.jsx";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/raffles/1"]}>
        <Routes>
          <Route path="/raffles/:seasonId" element={<RaffleDetails />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("RaffleDetails current position refresh", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders position data from usePlayerPosition and triggers refresh after buy", async () => {
    // Position logic was extracted to usePlayerPosition hook.
    // The readContract assertions for playerTickets/curveConfig are now in
    // tests/hooks/usePlayerPosition.test.jsx.
    // Here we verify the component renders position data and triggers refresh.
    renderPage();

    // Shows "yourCurrentPosition" header (i18n key)
    expect(screen.getByText("yourCurrentPosition")).toBeInTheDocument();

    // Position data from mock (tickets: 1234n)
    await waitFor(() => {
      expect(screen.getByText("1234")).toBeInTheDocument();
    });

    // Wait for BuySellWidget to appear (gated on chainNow)
    await waitFor(() => {
      expect(screen.getByText("Simulate Buy")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Simulate Buy"));

    // After buy, the staggered refresh triggers refreshNow from the hook
    await waitFor(
      () => {
        expect(mockRefreshPositionNow).toHaveBeenCalled();
      },
      { timeout: 3000 },
    );
  });
});
