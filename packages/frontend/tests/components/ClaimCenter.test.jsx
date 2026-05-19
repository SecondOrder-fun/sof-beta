import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import PropTypes from "prop-types";
import ClaimCenter from "../../src/components/infofi/ClaimCenter.jsx";

// Mock i18n
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key, params) => {
      // Minimal key handling used in ClaimCenter
      if (key === "market:claimWinnings") return "Claim Winnings";
      if (key === "raffle:season") return "Season";
      if (key === "raffle:seasonNumber") return `Season ${params?.number}`;
      if (key === "raffle:grandPrize") return "Grand Prize";
      if (key === "raffle:consolationPrize") return "Consolation Prize";
      if (key === "raffle:noActiveSeasons") return "No active seasons";
      if (key === "raffle:noClaimablePrizes") return "No claimable raffle prizes";
      if (key === "errors:nothingToClaim") return "Nothing to claim";
      if (key === "transactions:claiming") return "Claiming...";
      if (key === "raffle:claimPrize") return "Claim Prize";
      if (key === "common:loading") return "Loading...";
      if (key === "common:error") return "Error";
      if (key === "errors:notConnected") return "Wallet not connected";
      if (key === "common:subtotal") return "Subtotal";
      return key;
    },
  }),
}));

vi.mock("wagmi", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    useAccount: () => ({
      address: "0x1111111111111111111111111111111111111111",
    }),
  };
});

// The component now polls eth_getLogs via useWatchContractLogs instead of
// wagmi's useWatchContractEvent — stub it out in tests so we don't need
// a real WagmiProvider for the public client.
vi.mock("@/hooks/chain/useWatchContractLogs", () => ({
  useWatchContractLogs: () => {},
}));

// Mock network key helper
vi.mock("@/lib/wagmi", () => ({
  getStoredNetworkKey: () => "LOCAL",
  getChainConfig: () => ({ chain: { id: 31337 }, transport: {} }),
}));

// Mock onchain InfoFi helpers used only for discovery in this test
vi.mock("@/services/onchainInfoFi", () => ({
  enumerateAllMarkets: vi.fn(async () => [
    // Single season for testing
    { seasonId: 1 },
  ]),
  readBetFull: vi.fn(),
  claimPayoutTx: vi.fn(),
  redeemPositionTx: vi.fn(),
  readFpmmPosition: vi.fn(),
}));

// Mock raffle distributor helpers (only getPrizeDistributor is still
// imported by ClaimCenter — the heavy queries were rewritten to drive a
// multicall on buildPublicClient instead of looping over the
// per-season service helpers).
const mockGetPrizeDistributor = vi.fn(
  async () => "0x000000000000000000000000000000000000dEaD",
);
const mockClaimGrand = vi.fn();
const mockClaimConsolation = vi.fn();

vi.mock("@/services/onchainRaffleDistributor", () => ({
  getPrizeDistributor: (...args) => mockGetPrizeDistributor(...args),
  claimGrand: (...args) => mockClaimGrand(...args),
  claimConsolation: (...args) => mockClaimConsolation(...args),
}));

// Mock the shared viem client factory — ClaimCenter's raffleClaimsQuery
// drives everything through three multicalls now. Each test below
// stubs mockMulticall to return the appropriate payout / participant /
// claimed sequences.
const mockMulticall = vi.fn();
vi.mock("@/lib/viemClient", () => ({
  buildPublicClient: () => ({ multicall: (...args) => mockMulticall(...args) }),
}));

// Mock getContractAddresses so raffleClaimsQuery's RAFFLE check passes.
vi.mock("@/config/contracts", () => ({
  getContractAddresses: () => ({
    RAFFLE: "0x3333333333333333333333333333333333333333",
    CONDITIONAL_TOKENS: "0x4444444444444444444444444444444444444444",
  }),
}));

// Mock useRollover — unused in these tests but loaded by ConsolationClaimRow.
vi.mock("@/hooks/useRollover", () => ({
  useRollover: () => ({
    rolloverBalance: 0n,
    rolloverDeposited: 0n,
    rolloverSpent: 0n,
    isRefunded: false,
    cohortPhase: "none",
    bonusBps: 0,
    nextSeasonId: 0,
    bonusAmount: 0n,
    isRolloverAvailable: false,
    hasClaimableRollover: false,
    bonusPercent: 0,
    claimToRollover: { mutate: vi.fn(), isPending: false },
    spendFromRollover: { mutate: vi.fn(), isPending: false },
    refundRollover: { mutate: vi.fn(), isPending: false },
    isLoading: false,
  }),
}));

// Mock useClaims — ClaimCenter calls .mutate on these. Route calls to the
// existing mockClaim* spies so assertions below still fire.
vi.mock("@/hooks/useClaims", () => ({
  useClaims: () => ({
    pendingClaims: new Set(),
    successfulClaims: new Set(),
    getClaimKey: (type, params) => `${type}-${params?.seasonId ?? params?.marketId}`,
    claimInfoFiOne: { mutate: vi.fn(), isPending: false },
    claimFPMMOne: { mutate: vi.fn(), isPending: false },
    claimRaffleGrand: { mutate: (args) => mockClaimGrand(args), isPending: false },
    claimRaffleConsolation: { mutate: (args) => mockClaimConsolation(args), isPending: false },
  }),
}));

// raffleClaimsQuery gates to status 5 (Completed) or 6 (Cancelled). Tests
// here exercise the consolation path on a completed season.
vi.mock("@/hooks/useAllSeasons", () => ({
  useAllSeasons: () => ({
    data: [{ id: 1, status: 5 }],
    isLoading: false,
    error: null,
  }),
}));

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  const Wrapper = ({ children }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  Wrapper.displayName = "QueryClientWrapper";
  Wrapper.propTypes = {
    children: PropTypes.node.isRequired,
  };

  return Wrapper;
};

describe("ClaimCenter - raffle consolation prizes", () => {
  const address = "0x1111111111111111111111111111111111111111";

  // Helper: queue the three multicall responses for one completed
  // season's consolation-claim evaluation. The order matches
  // raffleClaimsQuery's batches:
  //   1) PrizeDistributor.getSeason(seasonId)
  //   2) Raffle.getParticipantPosition(seasonId, user)
  //   3) PrizeDistributor.isConsolationClaimed(seasonId, user)
  function queueRaffleClaimsMulticalls({
    funded = true,
    grandWinner = "0x2222222222222222222222222222222222222222",
    grandAmount = 1000n,
    grandClaimed = false,
    consolationAmount = 3000n,
    totalParticipants = 4n,
    isParticipant = true,
    alreadyClaimed = false,
  } = {}) {
    mockMulticall
      .mockResolvedValueOnce([
        {
          status: "success",
          result: {
            funded,
            grandWinner,
            grandAmount,
            consolationAmount,
            totalParticipants,
            grandClaimed,
          },
        },
      ])
      .mockResolvedValueOnce([
        {
          status: "success",
          result: { ticketCount: isParticipant ? 5n : 0n },
        },
      ])
      .mockResolvedValueOnce([
        { status: "success", result: alreadyClaimed },
      ]);
  }

  beforeEach(() => {
    vi.clearAllMocks();

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ markets: {}, winnings: [] }),
      })),
    );

    mockClaimConsolation.mockResolvedValue("0xclaim");
    // Default scenario: completed season with a consolation pool, user
    // participated and has not yet claimed. Individual tests override
    // by re-stubbing mockMulticall.
    queueRaffleClaimsMulticalls();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows a consolation prize row for an eligible non-winning participant", async () => {
    const Wrapper = createWrapper();

    render(<ClaimCenter address={address} />, { wrapper: Wrapper });

    // Switch to Raffles tab
    const rafflesTab = await screen.findByText("common:raffle_prizes");
    fireEvent.click(rafflesTab);

    // Expect a consolation prize row to appear with correct label
    await waitFor(() => {
      expect(screen.getByText(/Consolation Prize/i)).toBeInTheDocument();
    });

    // Amount should be consolationAmount / (totalParticipants - 1) = 3000 / 3 = 1000 (formatted to 18 decimals)
    await waitFor(() => {
      expect(screen.getByText("0.000000000000001")).toBeInTheDocument();
    });
  });

  it("calls claimConsolation when the consolation claim button is clicked", async () => {
    const Wrapper = createWrapper();

    render(<ClaimCenter address={address} />, { wrapper: Wrapper });

    const rafflesTab = await screen.findByText("common:raffle_prizes");
    fireEvent.click(rafflesTab);

    // Wait for button to render
    const button = await screen.findByText("Claim Prize");
    fireEvent.click(button);

    await waitFor(() => {
      expect(mockClaimConsolation).toHaveBeenCalledTimes(1);
      const callArgs = mockClaimConsolation.mock.calls[0][0] || {};
      expect(callArgs.seasonId).toBe(1);
    });
  });

  it("does not create a consolation claim if already claimed", async () => {
    // Re-stub the multicall sequence with alreadyClaimed=true.
    mockMulticall.mockReset();
    queueRaffleClaimsMulticalls({ alreadyClaimed: true });

    const Wrapper = createWrapper();

    render(<ClaimCenter address={address} />, { wrapper: Wrapper });

    const rafflesTab = await screen.findByText("common:raffle_prizes");
    fireEvent.click(rafflesTab);

    // When already claimed, the empty-state copy appears.
    await waitFor(() => {
      expect(screen.getByText("No claimable raffle prizes")).toBeInTheDocument();
    });
  });
});
