// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const mockReadContract = vi.fn();
const mockSma = vi.fn();

vi.mock("wagmi", () => ({
  usePublicClient: () => ({ readContract: mockReadContract }),
}));
vi.mock("@/hooks/useRaffleAccount", () => ({
  useRaffleAccount: () => ({ sma: mockSma() }),
}));
vi.mock("@/lib/wagmi", () => ({ getStoredNetworkKey: () => "TESTNET" }));
vi.mock("@/config/contracts", () => ({
  getContractAddresses: () => ({ ROLLOVER_ESCROW: "0xescrow" }),
}));
vi.mock("@/services/onchainRolloverEscrow", () => ({
  readCohortState: vi.fn(),
  readAvailableBalance: vi.fn(),
}));

import { readCohortState, readAvailableBalance } from "@/services/onchainRolloverEscrow";
import { useEligibleRolloverCohort } from "@/hooks/useEligibleRolloverCohort";

function wrapper({ children }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe("useEligibleRolloverCohort", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSma.mockReturnValue("0xsma");
    readCohortState.mockResolvedValue({
      phase: "active",
      nextSeasonId: 2n,
      bonusBps: 600,
    });
    readAvailableBalance.mockResolvedValue(455n * 10n ** 18n);
  });

  it("returns isEligible=false synchronously when currentSeasonId <= 1n", async () => {
    const { result } = renderHook(() => useEligibleRolloverCohort(1n), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isEligible).toBe(false);
    expect(readCohortState).not.toHaveBeenCalled();
    expect(readAvailableBalance).not.toHaveBeenCalled();
  });

  it("returns isEligible=true when phase=active, nextSeasonId matches, available > 0", async () => {
    const { result } = renderHook(() => useEligibleRolloverCohort(2n), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isEligible).toBe(true);
    expect(result.current.cohortSeasonId).toBe(1n);
    expect(result.current.available).toBe(455n * 10n ** 18n);
    expect(result.current.bonusBps).toBe(600);
    expect(result.current.bonusAmount(100n * 10n ** 18n)).toBe(6n * 10n ** 18n);
  });

  it("returns isEligible=false when cohort phase is open (not yet active)", async () => {
    readCohortState.mockResolvedValue({ phase: "open", nextSeasonId: 2n, bonusBps: 600 });
    const { result } = renderHook(() => useEligibleRolloverCohort(2n), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isEligible).toBe(false);
  });

  it("returns isEligible=false when nextSeasonId on cohort doesn't match", async () => {
    readCohortState.mockResolvedValue({ phase: "active", nextSeasonId: 99n, bonusBps: 600 });
    const { result } = renderHook(() => useEligibleRolloverCohort(2n), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isEligible).toBe(false);
  });

  it("returns isEligible=false when available is 0", async () => {
    readAvailableBalance.mockResolvedValue(0n);
    const { result } = renderHook(() => useEligibleRolloverCohort(2n), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isEligible).toBe(false);
  });

  it("returns isEligible=false without any reads when sma is missing", async () => {
    mockSma.mockReturnValue(null);
    const { result } = renderHook(() => useEligibleRolloverCohort(2n), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isEligible).toBe(false);
    expect(readCohortState).not.toHaveBeenCalled();
  });
});
