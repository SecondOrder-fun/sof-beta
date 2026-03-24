// tests/hooks/useAllSeasons.test.jsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import PropTypes from "prop-types";

// Mocks
vi.mock("@/lib/wagmi", () => ({ getStoredNetworkKey: () => "LOCAL" }));
vi.mock("@/config/contracts", () => ({
  getContractAddresses: () => ({
    RAFFLE: "0x0000000000000000000000000000000000000002",
  }),
  RAFFLE_ABI: [],
}));

const readContractMock = vi.fn();

// Mock wagmi usePublicClient
vi.mock("wagmi", () => ({
  usePublicClient: () => ({ readContract: readContractMock }),
}));

// Mock useRaffleRead to provide currentSeasonId
vi.mock("@/hooks/useRaffleRead", () => ({
  useRaffleRead: () => ({ currentSeasonQuery: { isSuccess: true, data: 2 } }),
}));

import { useAllSeasons } from "@/hooks/useAllSeasons";

function withClient() {
  const client = new QueryClient();
  const Wrapper = ({ children }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  Wrapper.displayName = "UseAllSeasonsTestWrapper";
  Wrapper.propTypes = {
    children: PropTypes.node.isRequired,
  };
  return Wrapper;
}

describe("useAllSeasons", () => {
  beforeEach(() => {
    readContractMock.mockReset();
  });

  it("returns normalized seasons and filters ghost/default ones", async () => {
    // The hook loops from 1 to currentSeasonId (which is 2)
    // So it will call readContract for season 1 and season 2
    readContractMock
      .mockResolvedValueOnce([
        { startTime: 100, endTime: 200, bondingCurve: "0xBEEF" },
        1,
        10n,
        100n,
        1000n,
      ])
      .mockResolvedValueOnce([
        { startTime: 150, endTime: 300, bondingCurve: "0xCAFE" },
        1,
        20n,
        200n,
        2000n,
      ]);

    const wrapper = withClient();
    const { result } = renderHook(() => useAllSeasons(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const seasons = result.current.data;

    // Should include only season ids 1 and 2
    expect(seasons.map((s) => s.id)).toEqual([1, 2]);
    expect(seasons[0]).toMatchObject({
      totalParticipants: 10n,
      totalTickets: 100n,
      totalPrizePool: 1000n,
    });
    expect(readContractMock).toHaveBeenCalledTimes(2);
  });

  it("returns empty when RAFFLE missing (edge)", async () => {
    vi.doMock("@/config/contracts", () => ({
      getContractAddresses: () => ({ RAFFLE: "" }),
      RAFFLE_ABI: [],
    }));
    const wrapper = withClient();
    const { result } = renderHook(() => useAllSeasons(), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual([]));
  });
});
