// tests/components/HoldersTab.test.jsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// Mock hooks - use vi.hoisted() to ensure proper hoisting
const mockUseRaffleHolders = vi.hoisted(() => vi.fn());
const mockUseWallet = vi.hoisted(() => vi.fn());

vi.mock("@/hooks/useRaffleHolders", () => ({
  useRaffleHolders: mockUseRaffleHolders,
}));

vi.mock("@/hooks/useWallet", () => ({
  useWallet: mockUseWallet,
}));

vi.mock("@/hooks/useCurveEvents", () => ({
  useCurveEvents: vi.fn(),
}));

vi.mock("@/components/common/PlayerLabel", () => ({
  default: ({ address, name }) => (
    <span data-testid="player-label">{name || address}</span>
  ),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key) => key,
    i18n: { language: "en" },
  }),
}));

vi.mock("wagmi", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    useAccount: () => ({ address: mockUseWallet().address }),
  };
});

vi.mock("@tanstack/react-query", async () => {
  const actual = await vi.importActual("@tanstack/react-query");
  return {
    ...actual,
    useQueryClient: () => ({
      invalidateQueries: vi.fn(),
    }),
  };
});

import HoldersTab from "@/components/curve/HoldersTab";

describe("HoldersTab", () => {
  let queryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });
    vi.clearAllMocks();

    // Set default mock return values
    mockUseRaffleHolders.mockReturnValue({
      holders: [],
      totalHolders: 0,
      totalTickets: 0n,
      isPending: false,
      error: null,
    });

    mockUseWallet.mockReturnValue({
      address: null,
    });
  });

  const wrapper = ({ children }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  it("should render loading skeleton", () => {
    mockUseRaffleHolders.mockReturnValue({
      holders: [],
      totalHolders: 0,
      totalTickets: 0n,
      isPending: true,
      error: null,
    });

    render(<HoldersTab bondingCurveAddress="0x123" seasonId={1} />, {
      wrapper,
    });
    // Skeleton table renders column headers
    expect(screen.getByText("rank")).toBeInTheDocument();
    expect(screen.getByText("player")).toBeInTheDocument();
    expect(screen.getByText("tickets")).toBeInTheDocument();
  });

  it("should render empty state when no holders", async () => {
    mockUseRaffleHolders.mockReturnValue({
      holders: [],
      totalHolders: 0,
      totalTickets: 0n,
      isPending: false,
      error: null,
    });

    render(<HoldersTab bondingCurveAddress="0x123" seasonId={1} />, {
      wrapper,
    });

    await waitFor(() => {
      expect(screen.getByText("noHolders")).toBeInTheDocument();
    });
  });

  it("should render error state", () => {
    mockUseRaffleHolders.mockReturnValue({
      holders: [],
      totalHolders: 0,
      totalTickets: 0n,
      isPending: false,
      error: new Error("Test error"),
    });

    render(<HoldersTab bondingCurveAddress="0x123" seasonId={1} />, {
      wrapper,
    });
    expect(screen.getByText(/errorLoadingHolders/)).toBeInTheDocument();
  });

  it("should render holders table with data", async () => {
    const mockHolders = [
      {
        player: "0x1234567890123456789012345678901234567890",
        ticketCount: 1000n,
        totalTicketsAtTime: 10000n,
        winProbabilityBps: 1000,
        blockNumber: 100,
        logIndex: 0,
        lastUpdate: 1234567890,
        rank: 1,
      },
    ];

    mockUseRaffleHolders.mockReturnValue({
      holders: mockHolders,
      totalHolders: 1,
      totalTickets: 10000n,
      isPending: false,
      error: null,
    });

    render(<HoldersTab bondingCurveAddress="0x123" seasonId={1} />, {
      wrapper,
    });

    // Should render data, not skeleton or error
    expect(screen.queryByText(/errorLoadingHolders/i)).not.toBeInTheDocument();
  });

  it("should highlight connected wallet", async () => {
    const connectedAddress = "0x1234567890123456789012345678901234567890";

    mockUseWallet.mockReturnValue({
      address: connectedAddress,
    });

    const mockHolders = [
      {
        player: connectedAddress,
        ticketCount: 1000n,
        totalTicketsAtTime: 10000n,
        winProbabilityBps: 1000,
        blockNumber: 100,
        logIndex: 0,
        lastUpdate: 1234567890,
        rank: 1,
      },
    ];

    mockUseRaffleHolders.mockReturnValue({
      holders: mockHolders,
      totalHolders: 1,
      totalTickets: 10000n,
      isPending: false,
      error: null,
    });

    render(<HoldersTab bondingCurveAddress="0x123" seasonId={1} />, {
      wrapper,
    });

    await waitFor(() => {
      expect(screen.getByText("yourPosition")).toBeInTheDocument();
    });
  });
});
