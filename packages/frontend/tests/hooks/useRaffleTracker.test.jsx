// tests/hooks/useRaffleTracker.test.jsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import PropTypes from "prop-types";

// Mock network and contracts
vi.mock("@/config/networks", () => ({
  getNetworkByKey: () => ({
    id: 31337,
    name: "Local Anvil",
    rpcUrl: "http://127.0.0.1:8545",
  }),
  getDefaultNetworkKey: () => "LOCAL",
}));
vi.mock("@/config/contracts", () => ({
  getContractAddresses: () => ({
    RAFFLE_TRACKER: "0x0000000000000000000000000000000000000009",
  }),
  RAFFLE_TRACKER_ABI: [],
}));

// Mock viem client
const readContract = vi.fn();
const mockClient = { readContract };
vi.mock("viem", async (importOriginal) => {
  const orig = await importOriginal();
  return {
    ...orig,
    createPublicClient: () => mockClient,
    http: vi.fn(() => ({})),
  };
});

import { useRaffleTracker } from "@/hooks/useRaffleTracker";

function withClient() {
  const client = new QueryClient();

  const Wrapper = ({ children }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );

  Wrapper.propTypes = {
    children: PropTypes.node,
  };

  Wrapper.displayName = "UseRaffleTrackerTestWrapper";

  return Wrapper;
}

describe("useRaffleTracker", () => {
  beforeEach(() => {
    readContract.mockReset();
  });

  it("returns player snapshot when read succeeds", async () => {
    // Return struct as array: [ticketCount, timestamp, blockNumber, totalTicketsAtTime, winProbabilityBps]
    readContract.mockResolvedValueOnce([
      100n,
      1700000000n,
      12345n,
      5000n,
      200n,
    ]);
    const wrapper = withClient();
    const { result } = renderHook(
      () => {
        const { usePlayerSnapshot } = useRaffleTracker();
        return usePlayerSnapshot("0x0000000000000000000000000000000000000077");
      },
      { wrapper },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({
      ticketCount: 100n,
      timestamp: 1700000000n,
      blockNumber: 12345n,
      totalTicketsAtTime: 5000n,
      winProbabilityBps: 200n,
    });
  });

  it("returns null when address missing (edge)", async () => {
    const wrapper = withClient();
    const { result } = renderHook(
      () => {
        const { usePlayerSnapshot } = useRaffleTracker();
        return usePlayerSnapshot(null);
      },
      { wrapper },
    );

    // Disabled query -> status pending until enabled; data should be undefined/null
    expect(
      result.current.status === "pending" || result.current.status === "idle",
    ).toBe(true);
  });

  it("surfaces error when contract read fails", async () => {
    readContract.mockRejectedValueOnce(new Error("revert"));
    const wrapper = withClient();
    const { result } = renderHook(
      () => {
        const { usePlayerSnapshot } = useRaffleTracker();
        return usePlayerSnapshot("0x0000000000000000000000000000000000000077");
      },
      { wrapper },
    );

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
