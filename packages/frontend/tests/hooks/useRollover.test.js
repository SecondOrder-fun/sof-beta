/*
  @vitest-environment jsdom
*/
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

// Mock wagmi
vi.mock("wagmi", () => ({
  useAccount: () => ({
    address: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
    isConnected: true,
  }),
  usePublicClient: () => mockPublicClient,
}));

// Mock i18n
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key) => key, i18n: { language: "en" } }),
}));

// Mock smart transactions
vi.mock("@/hooks/useSmartTransactions", () => ({
  useSmartTransactions: () => ({
    executeBatch: vi.fn().mockResolvedValue("0xbatch123"),
  }),
}));

// Mock config
vi.mock("@/config/contracts", () => ({
  getContractAddresses: () => ({
    ROLLOVER_ESCROW: "0xEscrow",
    PRIZE_DISTRIBUTOR: "0xDistributor",
  }),
}));

vi.mock("@/lib/wagmi", () => ({
  getStoredNetworkKey: () => "LOCAL",
}));

// Mock useToast
vi.mock("@/hooks/useToast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

// Mock publicClient
const mockPublicClient = {
  readContract: vi.fn(),
};

// Import after mocks
import { useRollover } from "@/hooks/useRollover";

function createWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // eslint-disable-next-line react/prop-types, react/display-name
  return ({ children }) => React.createElement(QueryClientProvider, { client: qc }, children);
}

describe("useRollover", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns rollover state when user has a position", async () => {
    // getUserPosition returns (deposited, spent, refunded)
    mockPublicClient.readContract
      .mockResolvedValueOnce([175000000000000000000n, 0n, false]) // getUserPosition
      .mockResolvedValueOnce([2, 2n, 600, 175000000000000000000n, 0n, 0n, false]) // getCohortState (7 values, no openedAt)
      .mockResolvedValueOnce(175000000000000000000n); // getAvailableBalance

    const { result } = renderHook(() => useRollover(1), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.rolloverDeposited).toBe(175000000000000000000n);
    expect(result.current.rolloverBalance).toBe(175000000000000000000n);
    expect(result.current.cohortPhase).toBe("active");
    expect(result.current.bonusBps).toBe(600);
    expect(result.current.isRolloverAvailable).toBe(true);
  });

  it("returns unavailable when no position exists", async () => {
    mockPublicClient.readContract
      .mockResolvedValueOnce([0n, 0n, false]) // getUserPosition
      .mockResolvedValueOnce([0, 0n, 0, 0n, 0n, 0n, false]) // getCohortState
      .mockResolvedValueOnce(0n); // getAvailableBalance

    const { result } = renderHook(() => useRollover(1), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.isRolloverAvailable).toBe(false);
    expect(result.current.rolloverBalance).toBe(0n);
  });

  it("computes bonusAmount correctly", async () => {
    mockPublicClient.readContract
      .mockResolvedValueOnce([100000000000000000000n, 0n, false])
      .mockResolvedValueOnce([2, 2n, 600, 100000000000000000000n, 0n, 0n, false])
      .mockResolvedValueOnce(100000000000000000000n);

    const { result } = renderHook(() => useRollover(1), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // 100 SOF * 600 / 10000 = 6 SOF
    const bonus = result.current.bonusAmount(100000000000000000000n);
    expect(bonus).toBe(6000000000000000000n);
  });
});
