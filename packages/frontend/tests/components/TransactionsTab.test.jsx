// tests/components/TransactionsTab.test.jsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// Mock hooks - must be before imports
vi.mock("@/hooks/useRaffleTransactions");
vi.mock("@/hooks/useCurveEvents");
vi.mock("@/lib/wagmi");
vi.mock("@/config/networks");
vi.mock("react-i18next");
vi.mock("@/components/common/PlayerLabel", () => ({
  default: ({ address, name }) => (
    <span data-testid="player-label">{name || address}</span>
  ),
}));
vi.mock("@/components/common/ExplorerLink", () => ({
  default: ({ value }) => <span data-testid="explorer-link">{value}</span>,
}));
vi.mock("@tanstack/react-query", async () => {
  const actual = await vi.importActual("@tanstack/react-query");
  return {
    ...actual,
    useQueryClient: () => ({
      invalidateQueries: vi.fn(),
    }),
  };
});

import TransactionsTab from "@/components/curve/TransactionsTab";
import { useRaffleTransactions } from "@/hooks/useRaffleTransactions";
import { useCurveEvents } from "@/hooks/useCurveEvents";
import { getStoredNetworkKey } from "@/lib/wagmi";
import { getNetworkByKey } from "@/config/networks";
import { useTranslation } from "react-i18next";

// Setup mocks
vi.mocked(useCurveEvents).mockImplementation(() => {});
vi.mocked(getStoredNetworkKey).mockReturnValue("localhost");
vi.mocked(getNetworkByKey).mockReturnValue({
  id: 31337,
  name: "Localhost",
  explorer: "http://localhost:3000",
});
vi.mocked(useTranslation).mockReturnValue({
  t: (key) => key,
  i18n: { language: "en" },
});

describe("TransactionsTab", () => {
  let queryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });
    vi.clearAllMocks();
  });

  const wrapper = ({ children }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  it("should render loading skeleton", () => {
    vi.mocked(useRaffleTransactions).mockReturnValue({
      transactions: [],
      isPending: true,
      error: null,
    });

    render(<TransactionsTab bondingCurveAddress="0x123" seasonId={1} />, {
      wrapper,
    });
    // Skeleton table renders column headers
    expect(screen.getByText("transactionType")).toBeInTheDocument();
    expect(screen.getByText("player")).toBeInTheDocument();
    expect(screen.getByText("time")).toBeInTheDocument();
  });

  it("should render empty state when no transactions", async () => {
    vi.mocked(useRaffleTransactions).mockReturnValue({
      transactions: [],
      isPending: false,
      error: null,
    });

    render(<TransactionsTab bondingCurveAddress="0x123" seasonId={1} />, {
      wrapper,
    });

    await waitFor(() => {
      expect(screen.getByText("noTransactions")).toBeInTheDocument();
    });
  });

  it("should render error state", () => {
    vi.mocked(useRaffleTransactions).mockReturnValue({
      transactions: [],
      isPending: false,
      error: new Error("Test error"),
    });

    render(<TransactionsTab bondingCurveAddress="0x123" seasonId={1} />, {
      wrapper,
    });
    expect(screen.getByText(/errorLoadingTransactions/)).toBeInTheDocument();
  });

  it("should render transactions table with data", async () => {
    const mockTransactions = [
      {
        txHash: "0xabc1234567890",
        blockNumber: 100,
        timestamp: 1234567890,
        player: "0x1234567890123456789012345678901234567890",
        oldTickets: 0n,
        newTickets: 100n,
        ticketsDelta: 100n,
        totalTickets: 100n,
        probabilityBps: 10000,
        type: "buy",
      },
    ];

    vi.mocked(useRaffleTransactions).mockReturnValue({
      transactions: mockTransactions,
      isPending: false,
      error: null,
    });

    render(<TransactionsTab bondingCurveAddress="0x123" seasonId={1} />, {
      wrapper,
    });

    await waitFor(() => {
      expect(screen.getByText(/0xabc12345/i)).toBeInTheDocument();
    });
  });

  it("should call useRaffleTransactions without startBlock/startTime", () => {
    vi.mocked(useRaffleTransactions).mockReturnValue({
      transactions: [],
      isPending: false,
      error: null,
    });

    render(<TransactionsTab bondingCurveAddress="0x123" seasonId={1} />, {
      wrapper,
    });

    expect(useRaffleTransactions).toHaveBeenCalledWith("0x123", 1);
  });
});
