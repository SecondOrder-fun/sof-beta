// tests/e2e/onchain-markets-ui.test.jsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act, waitFor } from "@testing-library/react";
import PropTypes from "prop-types";

// Mock on-chain services used by hooks
let __seasonId = 1;
let __markets = [];
let __marketCreatedHandler = null;
let __priceUpdatedHandler = null;

vi.mock("@/services/onchainInfoFi", () => {
  return {
    // season enumeration
    listSeasonWinnerMarkets: vi.fn(async ({ seasonId }) => {
      // Return current in-memory list filtered by season
      return __markets.filter((m) => Number(m.seasonId) === Number(seasonId));
    }),
    subscribeMarketCreated: vi.fn(({ onEvent }) => {
      __marketCreatedHandler = onEvent;
      return () => {
        __marketCreatedHandler = null;
      };
    }),

    // oracle pricing
    readOraclePrice: vi.fn(async ({ marketId }) => {
      const entry = __markets.find((m) => m.id === String(marketId));
      // default baseline if not set on entry
      const hybridPriceBps = entry?.__price?.hybrid ?? 1234;
      const raffleProbabilityBps = entry?.__price?.raffle ?? 2500;
      const marketSentimentBps = entry?.__price?.market ?? 3000;
      const lastUpdate = entry?.__price?.ts ?? Math.floor(Date.now() / 1000);
      const active = true;
      return {
        hybridPriceBps,
        raffleProbabilityBps,
        marketSentimentBps,
        lastUpdate,
        active,
      };
    }),
    subscribeOraclePriceUpdated: vi.fn(({ onEvent }) => {
      __priceUpdatedHandler = onEvent;
      return () => {
        __priceUpdatedHandler = null;
      };
    }),

    // helper used by onchain enumeration output
    computeWinnerMarketId: ({ seasonId, player }) =>
      `0x${String(seasonId)}_${String(player).toLowerCase()}`,
  };
});

// Import hooks under test
const { useOnchainInfoFiMarkets } =
  await import("@/hooks/useOnchainInfoFiMarkets");
const { useOraclePriceLive } = await import("@/hooks/useOraclePriceLive");

function MarketsHarness({ seasonId }) {
  const { markets, isLoading } = useOnchainInfoFiMarkets(seasonId, "LOCAL");
  return (
    <div>
      <div data-testid="loading">{String(isLoading)}</div>
      <div data-testid="count">{String(markets.length)}</div>
      <ul>
        {markets.map((m) => (
          <li key={m.id} data-testid={`market-${m.id}`}>
            {m.player}
          </li>
        ))}
      </ul>
    </div>
  );
}

MarketsHarness.propTypes = {
  seasonId: PropTypes.number.isRequired,
};

MarketsHarness.displayName = "MarketsHarness";

function OracleHarness({ marketId }) {
  const { data, isLive } = useOraclePriceLive(marketId, "LOCAL");
  return (
    <div>
      <div data-testid="live">{String(isLive)}</div>
      <div data-testid="hybrid">{String(data.hybridPriceBps)}</div>
      <div data-testid="raffle">{String(data.raffleProbabilityBps)}</div>
      <div data-testid="market">{String(data.marketSentimentBps)}</div>
      <div data-testid="active">{String(data.active)}</div>
    </div>
  );
}

OracleHarness.propTypes = {
  marketId: PropTypes.string.isRequired,
};

OracleHarness.displayName = "OracleHarness";

// Utility to simulate on-chain events in the mocked layer
function triggerMarketCreated({ seasonId, player, marketId }) {
  if (typeof __marketCreatedHandler === "function") {
    __marketCreatedHandler({
      args: { seasonId: BigInt(seasonId), player, marketId },
    });
  }
}

function triggerPriceUpdated({
  marketId,
  raffleBps,
  marketBps,
  hybridBps,
  timestamp,
}) {
  if (typeof __priceUpdatedHandler === "function") {
    __priceUpdatedHandler({
      args: { marketId, raffleBps, marketBps, hybridBps, timestamp },
    });
  }
}

describe("On-chain Markets UI (E2E-style)", () => {
  beforeEach(() => {
    vi.resetModules();
    __seasonId = 1;
    __markets = [];
    __marketCreatedHandler = null;
    __priceUpdatedHandler = null;
  });

  it("creates a market via MarketCreated and renders live oracle price updates (success case)", async () => {
    const player = "0x1111111111111111111111111111111111111111";
    const marketId = `0x${__seasonId}_${player.toLowerCase()}`;

    // Initially no markets
    render(<MarketsHarness seasonId={__seasonId} />);
    expect(screen.getByTestId("count").textContent).toBe("0");

    // Add market to in-memory store (as if chain has it now)
    __markets.push({
      id: marketId,
      seasonId: __seasonId,
      raffle_id: __seasonId,
      player,
      market_type: "WINNER_PREDICTION",
      __price: {
        hybrid: 1111,
        raffle: 2000,
        market: 2500,
        ts: Math.floor(Date.now() / 1000),
      },
    });

    // Fire MarketCreated event for this season; hook should refetch
    await act(async () => {
      triggerMarketCreated({ seasonId: __seasonId, player, marketId });
    });

    // Expect one market now
    expect(screen.getByTestId("count").textContent).toBe("1");
    expect(screen.getByTestId(`market-${marketId}`)).toBeDefined();

    // Mount oracle harness for this market
    render(<OracleHarness marketId={marketId} />);

    // Initial values from readOraclePrice (async)
    await waitFor(() => {
      expect(screen.getByTestId("hybrid").textContent).toBe("1111");
      expect(screen.getByTestId("raffle").textContent).toBe("2000");
      expect(screen.getByTestId("market").textContent).toBe("2500");
    });

    // Now simulate a PriceUpdated event
    await act(async () => {
      triggerPriceUpdated({
        marketId,
        raffleBps: 3000,
        marketBps: 3200,
        hybridBps: 3100,
        timestamp: Date.now(),
      });
    });

    // Hook should reflect live update
    expect(screen.getByTestId("hybrid").textContent).toBe("3100");
    expect(screen.getByTestId("raffle").textContent).toBe("3000");
    expect(screen.getByTestId("market").textContent).toBe("3200");
  });

  it("ignores MarketCreated for a different season (edge case)", async () => {
    const player = "0x2222222222222222222222222222222222222222";
    const marketId = `0x2_${player.toLowerCase()}`;

    render(<MarketsHarness seasonId={1} />);
    expect(screen.getByTestId("count").textContent).toBe("0");

    await act(async () => {
      // seasonId 2 should be ignored by seasonId 1 harness
      triggerMarketCreated({ seasonId: 2, player, marketId });
    });

    expect(screen.getByTestId("count").textContent).toBe("0");
  });

  it("handles oracle read failure gracefully (failure case)", async () => {
    // Override mock to throw on read
    const mod = await import("@/services/onchainInfoFi");
    mod.readOraclePrice.mockImplementationOnce(async () => {
      throw new Error("oracle down");
    });

    // Create a single market so the oracle hook mounts against an id
    const player = "0x3333333333333333333333333333333333333333";
    const marketId = `0x${__seasonId}_${player.toLowerCase()}`;
    __markets.push({
      id: marketId,
      seasonId: __seasonId,
      raffle_id: __seasonId,
      player,
      market_type: "WINNER_PREDICTION",
    });

    render(<OracleHarness marketId={marketId} />);

    // When read fails, our hook marks active false and leaves values null
    expect(screen.getByTestId("active").textContent).toBe("false");
    expect(screen.getByTestId("hybrid").textContent).toBe("null");
    expect(screen.getByTestId("raffle").textContent).toBe("null");
    expect(screen.getByTestId("market").textContent).toBe("null");
  });
});
