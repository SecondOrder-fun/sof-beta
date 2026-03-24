/*
  @vitest-environment jsdom
*/
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";

// Mock i18n
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key) => key,
    i18n: { language: "en" },
  }),
}));

// Mocks
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

// Mock the chunked query utility
vi.mock("@/utils/blockRangeQuery", () => ({
  queryLogsInChunks: vi.fn(() => Promise.resolve([])),
}));

// Mock useRaffleHolders (now uses fetch, not viem)
vi.mock("@/hooks/useRaffleHolders", () => ({
  useRaffleHolders: () => ({
    holders: [],
    totalHolders: 0,
    totalTickets: 0n,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

const readContractMock = vi.fn(async ({ functionName }) => {
  if (functionName === "playerTickets") throw new Error("no selector");
  if (functionName === "curveConfig") throw new Error("no selector");
  if (functionName === "token")
    return "0xDeaD00000000000000000000000000000000BEEF";
  if (functionName === "balanceOf") return 4321n;
  if (functionName === "totalSupply") return 10000n;
  return 0n;
});

vi.mock("wagmi", () => ({
  useAccount: () => ({ address: "0xabc1", isConnected: true }),
  useChains: () => [
    { id: 31337, rpcUrls: { default: { http: ["http://127.0.0.1:8545"] } } },
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

vi.mock("@/lib/viemClient", () => ({
  buildPublicClient: () => ({
    readContract: readContractMock,
    getBlock: vi.fn(async () => ({
      timestamp: BigInt(Math.floor(Date.now() / 1000)),
    })),
  }),
}));

// Force curve mapping to fail to exercise ERC20 fallback path
vi.mock("viem", async () => {
  const actual = await vi.importActual("viem");
  return {
    ...actual,
    createPublicClient: vi.fn(() => ({
      readContract: vi.fn(async ({ functionName }) => {
        if (functionName === "playerTickets") throw new Error("no selector");
        if (functionName === "curveConfig") throw new Error("no selector");
        if (functionName === "token")
          return "0xDeaD00000000000000000000000000000000BEEF";
        if (functionName === "balanceOf") return 4321n;
        if (functionName === "totalSupply") return 10000n;
        return 0n;
      }),
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
  useWallet: () => ({ address: "0xabc1", isConnected: true }),
}));
vi.mock("@/config/networks", () => ({
  getNetworkByKey: () => ({
    id: 31337,
    name: "Local",
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

// Mock usePlayerPosition (extracted from RaffleDetails inline code)
const mockRefreshPositionNow = vi.fn();
vi.mock("@/hooks/usePlayerPosition", () => ({
  usePlayerPosition: () => ({
    position: { tickets: 4321n, probBps: 4321, total: 10000n },
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

// Stub BuySellWidget to trigger notify + success
vi.mock("@/components/curve/BuySellWidget", () => ({
  __esModule: true,
  default: ({ onTxSuccess, onNotify }) => (
    <div>
      <button
        onClick={() => {
          onNotify?.({
            type: "success",
            message: "Purchase complete",
            hash: "0xhash",
          });
          onTxSuccess?.();
        }}
      >
        Sim Tx
      </button>
    </div>
  ),
}));

// Stub graph
vi.mock("@/components/curve/CurveGraph", () => ({
  __esModule: true,
  default: () => <div />,
}));

vi.mock("@/components/common/CountdownTimer", () => ({
  __esModule: true,
  default: () => <span>countdown</span>,
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

describe("RaffleDetails toasts and ERC20 fallback", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows a toast with hash and auto-expires after 2 minutes", async () => {
    vi.useFakeTimers();

    renderPage();

    // BuySellWidget is gated on chainNow (async getBlock), so flush microtasks before asserting.
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByText("Sim Tx")).toBeInTheDocument();

    // Click to trigger toast
    fireEvent.click(screen.getByText("Sim Tx"));

    // Wait for React to process the state update
    await act(async () => {
      await Promise.resolve();
    });

    // toast should appear with message and hash
    expect(screen.getByText(/Purchase complete/i)).toBeInTheDocument();
    expect(screen.getByText(/View Transaction/i)).toBeInTheDocument();

    // advance timers 2 minutes to trigger toast expiration
    act(() => {
      vi.advanceTimersByTime(120000);
    });

    // toast should be removed
    expect(screen.queryByText(/View Transaction/i)).not.toBeInTheDocument();

    vi.useRealTimers();
  });

  it("displays position data from usePlayerPosition hook", async () => {
    // The ERC20 fallback logic has been extracted to usePlayerPosition
    // and is tested in tests/hooks/usePlayerPosition.test.jsx.
    // Here we verify the component renders position data from the hook.
    renderPage();

    await act(async () => {
      await Promise.resolve();
    });

    // The mocked usePlayerPosition returns tickets: 4321n
    await waitFor(
      () => {
        expect(screen.getByText("4321")).toBeInTheDocument();
      },
      { timeout: 3000 },
    );
  });
});
