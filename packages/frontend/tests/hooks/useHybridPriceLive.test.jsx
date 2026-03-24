// tests/hooks/useHybridPriceLive.test.jsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import PropTypes from "prop-types";

vi.mock("@/lib/wagmi", () => ({
  getStoredNetworkKey: vi.fn(() => "TESTNET"),
}));

const readOraclePriceMock = vi.fn();
vi.mock("@/services/onchainInfoFi", () => ({
  readOraclePrice: (...args) => readOraclePriceMock(...args),
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  const Wrapper = ({ children }) => {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };

  Wrapper.displayName = "UseHybridPriceLiveTestWrapper";
  Wrapper.propTypes = {
    children: PropTypes.node.isRequired,
  };

  return Wrapper;
}

function HookProbe({ marketId, useHook }) {
  const { data, isLive, source } = useHook(marketId);
  return (
    <div>
      <div data-testid="source">{source}</div>
      <div data-testid="isLive">{String(isLive)}</div>
      <div data-testid="hybrid">{String(data?.hybridPriceBps ?? "")}</div>
      <div data-testid="raffle">{String(data?.raffleProbabilityBps ?? "")}</div>
      <div data-testid="sentiment">
        {String(data?.marketSentimentBps ?? "")}
      </div>
      <div data-testid="updated">{String(data?.lastUpdated ?? "")}</div>
    </div>
  );
}

HookProbe.displayName = "UseHybridPriceLiveHookProbe";
HookProbe.propTypes = {
  marketId: PropTypes.oneOfType([PropTypes.string, PropTypes.number])
    .isRequired,
  useHook: PropTypes.func.isRequired,
};

describe("useHybridPriceLive", () => {
  beforeEach(() => {
    readOraclePriceMock.mockReset();
  });

  it("returns blockchain pricing data when oracle entry is active", async () => {
    readOraclePriceMock.mockResolvedValue({
      active: true,
      raffleProbabilityBps: 2222,
      marketSentimentBps: 3333,
      hybridPriceBps: 5555,
      lastUpdate: "oracle",
    });

    const { useHybridPriceLive } = await import("@/hooks/useHybridPriceLive");

    render(<HookProbe marketId={1} useHook={useHybridPriceLive} />, {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(readOraclePriceMock).toHaveBeenCalledWith({
        marketId: 1,
        networkKey: "TESTNET",
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId("hybrid").textContent).toBe("5555");
    });

    await waitFor(() => {
      expect(screen.getByTestId("source").textContent).toBe("blockchain");
    });

    await waitFor(() => {
      expect(screen.getByTestId("raffle").textContent).toBe("2222");
    });

    await waitFor(() => {
      expect(screen.getByTestId("sentiment").textContent).toBe("3333");
    });

    await waitFor(() => {
      expect(screen.getByTestId("updated").textContent).toBe("oracle");
    });
  });

  it("returns null data when oracle entry is inactive and never updated", async () => {
    readOraclePriceMock.mockResolvedValue({
      active: false,
      raffleProbabilityBps: 0,
      marketSentimentBps: 0,
      hybridPriceBps: 0,
      lastUpdate: 0,
    });

    const { useHybridPriceLive } = await import("@/hooks/useHybridPriceLive");

    render(<HookProbe marketId={2} useHook={useHybridPriceLive} />, {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(readOraclePriceMock).toHaveBeenCalledWith({
        marketId: 2,
        networkKey: "TESTNET",
      });
    });

    expect(screen.getByTestId("source").textContent).toBe("blockchain");
    expect(screen.getByTestId("hybrid").textContent).toBe("");
    expect(screen.getByTestId("raffle").textContent).toBe("");
    expect(screen.getByTestId("sentiment").textContent).toBe("");
    expect(screen.getByTestId("updated").textContent).toBe("");
  });
});
