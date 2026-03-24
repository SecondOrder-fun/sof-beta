/*
  @vitest-environment jsdom
*/
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// i18n
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k) => k,
    i18n: { language: "en" },
  }),
}));

// Platform
vi.mock("@/hooks/usePlatform", () => ({
  usePlatform: () => ({ isMobile: false }),
}));

// Wagmi hooks
vi.mock("wagmi", () => ({
  createConfig: vi.fn(() => ({})),
  WagmiProvider: ({ children }) => children,
  useAccount: () => ({ address: "0xabc", chainId: 1, isConnected: true }),
  useChainId: () => 1,
  useConnect: () => ({ connect: vi.fn() }),
  useSwitchChain: () => ({ switchChain: vi.fn() }),
  useChains: () => [
    { id: 1, rpcUrls: { default: { http: ["http://localhost"] } } },
  ],
  useWriteContract: () => ({
    writeContractAsync: vi.fn(),
    data: undefined,
    isPending: false,
    error: null,
  }),
}));

// Seasons
vi.mock("@/hooks/useAllSeasons", () => ({
  useAllSeasons: () => ({
    isLoading: false,
    error: null,
    data: [
      {
        id: 1,
        status: 1,
        config: {
          name: "Active Season",
          bondingCurve: "0x0000000000000000000000000000000000000001",
          startTime: `${Math.floor(Date.now() / 1000) - 60}`,
          endTime: `${Math.floor(Date.now() / 1000) + 3600}`,
        },
      },
      {
        id: 4,
        status: 0,
        config: {
          name: "Upcoming Season",
          bondingCurve: "0x0000000000000000000000000000000000000004",
          startTime: `${Math.floor(Date.now() / 1000) + 3600}`,
          endTime: `${Math.floor(Date.now() / 1000) + 7200}`,
        },
      },
      {
        id: 2,
        status: 5,
        totalTickets: 1n,
        config: {
          name: "Completed Season",
          bondingCurve: "0x0000000000000000000000000000000000000002",
        },
      },
      {
        id: 3,
        status: 5,
        totalTickets: 0n,
        config: {
          name: "Empty Season",
          bondingCurve: "0x0000000000000000000000000000000000000003",
        },
      },
    ],
  }),
}));

vi.mock("@/hooks/useSeasonWinnerSummaries", () => ({
  useSeasonWinnerSummaries: () => ({
    isLoading: false,
    error: null,
    data: {
      2: {
        winnerAddress: "0x1111111111111111111111111111111111111111",
        winnerUsername: null,
        grandPrizeWei: 1230000000000000000n,
      },
    },
  }),
}));

// Login modal
vi.mock("@/hooks/useLoginModal", () => ({
  useLoginModal: () => ({
    openLoginModal: vi.fn(),
    closeLoginModal: vi.fn(),
    isLoginModalOpen: false,
  }),
}));

// Gating hook
vi.mock("@/hooks/useSeasonGating", () => ({
  useSeasonGating: () => ({
    isVerified: null,
    verifyPassword: vi.fn(),
    refetch: vi.fn(),
  }),
}));

// Contract config
vi.mock("@/config/contracts", () => ({
  getContractAddresses: () => ({}),
  SEASON_GATING_ABI: [],
}));

vi.mock("@/config/networks", () => ({
  getNetworkByKey: () => null,
}));

vi.mock("@/lib/wagmi", () => ({
  getStoredNetworkKey: () => "LOCAL",
  getChainConfig: () => ({
    key: "LOCAL",
    chain: { id: 1, rpcUrls: { default: { http: ["http://localhost"] } } },
    transport: null,
  }),
}));

// Stub useProfileData to avoid deep chain of wagmi/viem dependencies
vi.mock("@/hooks/useProfileData", () => ({
  useProfileData: () => ({
    sofBalanceQuery: { data: 0n, isLoading: false },
    seasonBalancesQuery: { data: [], isLoading: false },
    winningSeasonsQuery: { data: [], isLoading: false },
    client: null,
    netKey: "LOCAL",
    contracts: {},
    seasons: [],
    allSeasonsQuery: { data: [], isLoading: false },
  }),
}));

// Prevent curve hook from doing work
vi.mock("@/hooks/useCurveState", () => ({
  useCurveState: () => ({
    curveSupply: 0n,
    curveStep: { price: 0n },
    allBondSteps: [],
  }),
}));

// Stub graph component
vi.mock("@/components/curve/CurveGraph", () => ({
  __esModule: true,
  default: () => <div />,
}));

// Stub countdown to avoid NumberFlow implementation issues in jsdom
vi.mock("@/components/common/CountdownTimer", () => ({
  __esModule: true,
  default: () => <span>COUNTDOWN</span>,
}));

// Stub UsernameDisplay to avoid nested hooks
vi.mock("@/components/user/UsernameDisplay", () => ({
  __esModule: true,
  default: ({ address }) => <span>{address}</span>,
}));

import RaffleList from "@/routes/RaffleList.jsx";

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <RaffleList />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("RaffleList winner display", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders winner + grand prize for completed seasons", async () => {
    renderPage();

    expect(screen.getAllByText("#2")[0]).toBeInTheDocument();
    expect(screen.getByText("Completed Season")).toBeInTheDocument();

    // Winner row
    expect(screen.getByText("winner")).toBeInTheDocument();
    expect(
      screen.getByText("0x1111111111111111111111111111111111111111"),
    ).toBeInTheDocument();

    // Prize row
    expect(screen.getByText(/grandPrize/)).toBeInTheDocument();
    expect(screen.getAllByText(/SOF$/)[0]).toBeInTheDocument();
  });

  it("does not render winner block for non-completed seasons", async () => {
    renderPage();

    expect(screen.getAllByText("#1")[0]).toBeInTheDocument();
    expect(screen.getAllByText("Active Season")[0]).toBeInTheDocument();
  });

  it("renders startsIn countdown and hides curve/price for pre-start seasons", async () => {
    renderPage();

    expect(screen.getAllByText("#4")[0]).toBeInTheDocument();
    const upcomingTitle = screen.getByText("Upcoming Season");
    const upcomingCard = upcomingTitle.closest(".rounded-lg");
    expect(upcomingCard).toBeTruthy();

    const scoped = within(upcomingCard);

    // Pre-start card should show startsIn and not show bonding-curve derived UI.
    expect(scoped.getByText(/startsIn/)).toBeInTheDocument();
    expect(scoped.queryByText("currentPrice")).not.toBeInTheDocument();
    expect(scoped.queryByText("common:buy")).not.toBeInTheDocument();
    expect(scoped.queryByText("common:sell")).not.toBeInTheDocument();
  });

  it("renders a no-winner fallback for completed seasons with no participants", async () => {
    renderPage();

    expect(screen.getAllByText("#3")[0]).toBeInTheDocument();
    expect(screen.getByText("Empty Season")).toBeInTheDocument();
    expect(screen.getByText("noWinner")).toBeInTheDocument();
    expect(screen.getByText("noParticipants")).toBeInTheDocument();
  });
});
