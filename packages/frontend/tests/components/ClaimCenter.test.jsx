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
    useWatchContractEvent: () => {},
  };
});

// Mock network key helper
vi.mock("@/lib/wagmi", () => ({
  getStoredNetworkKey: () => "LOCAL",
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

// Mock raffle distributor helpers
const mockGetPrizeDistributor = vi.fn(
  async () => "0x000000000000000000000000000000000000dEaD",
);
const mockGetSeasonPayouts = vi.fn();
const mockClaimGrand = vi.fn();
const mockClaimConsolation = vi.fn();
const mockIsConsolationClaimed = vi.fn();
const mockIsSeasonParticipant = vi.fn();

vi.mock("@/services/onchainRaffleDistributor", () => ({
  getPrizeDistributor: (...args) => mockGetPrizeDistributor(...args),
  getSeasonPayouts: (...args) => mockGetSeasonPayouts(...args),
  claimGrand: (...args) => mockClaimGrand(...args),
  claimConsolation: (...args) => mockClaimConsolation(...args),
  isConsolationClaimed: (...args) => mockIsConsolationClaimed(...args),
  isSeasonParticipant: (...args) => mockIsSeasonParticipant(...args),
}));

vi.mock("@/hooks/useAllSeasons", () => ({
  useAllSeasons: () => ({
    data: [{ id: 1 }],
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

    // Default season payouts: funded season with consolation pool
    mockGetSeasonPayouts.mockResolvedValue({
      distributor: "0x000000000000000000000000000000000000dEaD",
      seasonId: 1,
      data: {
        funded: true,
        grandWinner: "0x2222222222222222222222222222222222222222",
        grandAmount: 1000n,
        consolationAmount: 3000n,
        totalParticipants: 4n, // 1 winner + 3 losers
        grandClaimed: false,
      },
    });

    // By default the user has not yet claimed consolation
    mockIsConsolationClaimed.mockResolvedValue(false);
    mockIsSeasonParticipant.mockResolvedValue(true);
    mockClaimConsolation.mockResolvedValue("0xclaim");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows a consolation prize row for an eligible non-winning participant", async () => {
    const Wrapper = createWrapper();

    render(<ClaimCenter address={address} />, { wrapper: Wrapper });

    // Switch to Raffles tab
    const rafflesTab = await screen.findByText("Raffle Prizes");
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

    const rafflesTab = await screen.findByText("Raffle Prizes");
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
    mockIsConsolationClaimed.mockResolvedValue(true);

    const Wrapper = createWrapper();

    render(<ClaimCenter address={address} />, { wrapper: Wrapper });

    const rafflesTab = await screen.findByText("Raffle Prizes");
    fireEvent.click(rafflesTab);

    // When already claimed, there should be no claim rows
    await waitFor(() => {
      expect(screen.getByText("No active seasons")).toBeInTheDocument();
    });
  });
});
