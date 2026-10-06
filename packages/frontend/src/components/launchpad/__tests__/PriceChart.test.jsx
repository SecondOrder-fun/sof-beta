import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import PriceChart from "@/components/launchpad/PriceChart";
import { useTokenChart } from "@/hooks/useLaunchActivity";
import { buildChartSeries } from "@/lib/launchChart";

vi.mock("@/hooks/useLaunchActivity", () => ({ useTokenChart: vi.fn() }));
// The real series builder, wrapped so a test can see the "now" it was given.
vi.mock("@/lib/launchChart", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, buildChartSeries: vi.fn(actual.buildChartSeries) };
});
vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal()),
  useTranslation: () => ({ t: (key, opts) => (opts ? `${key}${JSON.stringify(opts)}` : key) }),
}));

const TOKEN = "0x1111111111111111111111111111111111111111";
const GWEI = 10n ** 9n;
/** A backend price (quote raw units per whole token) as its `priceE18`. */
const e18 = (raw) => String(raw * 10n ** 18n);
const NOW = Math.floor(Date.now() / 1000);
const launch = { t: NOW - 86400, priceE18: e18(2n * GWEI) };

const market = { fdv: 47n * 10n ** 18n, launchFdv: 2n * 10n ** 18n, launchPrice: 2n * GWEI, price: 47n * GWEI, multiple: 23.5 };

const setup = ({ chart, isLoading = false, isError = false, m = market } = {}) => {
  useTokenChart.mockReturnValue({ data: chart, isLoading, isError });
  return render(<PriceChart token={TOKEN} market={m} />);
};

describe("PriceChart", () => {
  beforeEach(() => vi.clearAllMocks());

  it("headlines the live FDV and its change over the range", () => {
    setup({
      chart: { tradeCount: 3, launch, points: [{ t: NOW - 86400, priceE18: e18(40n * GWEI) }, { t: NOW - 60, priceE18: e18(46n * GWEI) }] },
    });
    expect(screen.getByText("47")).toBeInTheDocument();
    // 40 -> 47 (the live price carries the line to now) = +17.5%
    expect(screen.getByText('chart.change{"sign":"+","pct":"17.5","range":"chart.range.24h"}')).toBeInTheDocument();
  });

  it("shows a fall with a minus sign", () => {
    setup({
      chart: { tradeCount: 1, launch, points: [{ t: NOW - 3600, priceE18: e18(94n * GWEI) }] },
    });
    expect(screen.getByText('chart.change{"sign":"−","pct":"50.0","range":"chart.range.24h"}')).toBeInTheDocument();
  });

  it("names the headline unit by the launch's quote", () => {
    setup({ chart: { tradeCount: 1, launch, points: [{ t: NOW - 3600, priceE18: e18(40n * GWEI) }] } });
    expect(screen.getByText("ETH")).toBeInTheDocument();
  });

  it("prints a USDC launch in USDC, from the market's quote", () => {
    const usdc = { symbol: "USDC", decimals: 6, address: "0x036CbD53842c5426634e7929541eC2318f3dCF7e" };
    const m = { fdv: 9_000n * 10n ** 6n, launchFdv: 5_000n * 10n ** 6n, launchPrice: 5n, price: 9n, multiple: 1.8, quote: usdc };
    setup({ chart: { tradeCount: 1, launch: { t: NOW - 86400, priceE18: e18(5n) }, points: [{ t: NOW - 3600, priceE18: e18(5n) }] }, m });
    expect(screen.getByText("9,000")).toBeInTheDocument();
    expect(screen.getByText("USDC")).toBeInTheDocument();
    expect(screen.getByText('detail.sinceLaunch{"multiple":"1.80","launchFdv":"5,000","quote":"USDC"}')).toBeInTheDocument();
    expect(screen.getByText(/detail\.pricePerToken\{"price":"0\.000009","unit":"USDC"\}/)).toBeInTheDocument();
  });

  it("takes the quote from the chart response before the pool is read", () => {
    setup({
      chart: { tradeCount: 0, quoteSymbol: "USDC", quoteDecimals: 6, launch: { t: NOW - 86400, priceE18: e18(5n) }, points: [{ t: NOW - 86400, priceE18: e18(5n) }] },
      m: null,
    });
    expect(screen.getByText('chart.launchLine{"fdv":"5,000","quote":"USDC"}')).toBeInTheDocument();
  });

  // 2.5 and 2.6 raw USDC units per token — one integer step apart before the
  // e18 scale, which drew both as 2,000 USDC.
  it("keeps a USDC launch's valuation exact from the indexed prices alone", () => {
    setup({
      chart: {
        tradeCount: 1,
        quoteSymbol: "USDC",
        quoteDecimals: 6,
        launch: { t: NOW - 86400, priceE18: "2500000000000000000" },
        points: [{ t: NOW - 86400, priceE18: "2500000000000000000" }, { t: NOW - 60, priceE18: "2600000000000000000" }],
      },
      m: null,
    });
    expect(screen.getByText("2,600")).toBeInTheDocument();
    expect(screen.getByText('chart.change{"sign":"+","pct":"4.0","range":"chart.range.24h"}')).toBeInTheDocument();
  });

  it("with no trades, shows the launch baseline and an empty state, not a flat line", () => {
    // The live pool still at the launch price: nothing has traded anywhere.
    const atLaunch = { ...market, fdv: 2n * 10n ** 18n, price: 2n * GWEI, multiple: 1 };
    setup({ chart: { tradeCount: 0, launch, points: [{ t: launch.t, priceE18: launch.priceE18 }] }, m: atLaunch });
    expect(screen.getByText("chart.empty")).toBeInTheDocument();
    expect(screen.getByText('chart.launchLine{"fdv":"2","quote":"ETH"}')).toBeInTheDocument();
    expect(screen.queryByText(/chart\.change/)).not.toBeInTheDocument();
  });

  it("an untraded pool at its tick-rounded launch price is still 'no trades yet'", () => {
    // Requested 2 gwei; the pool opened (and still sits) at 1.99 gwei.
    const opened = 1_990_000_000n;
    const untraded = { fdv: opened * 10n ** 9n, launchFdv: opened * 10n ** 9n, launchPrice: opened, price: opened, multiple: 1 };
    setup({ chart: { tradeCount: 0, launch, points: [{ t: launch.t, priceE18: launch.priceE18 }] }, m: untraded });
    expect(screen.getByText("chart.empty")).toBeInTheDocument();
    // The baseline is where the pool opened, printed like the headline.
    expect(screen.getByText('chart.launchLine{"fdv":"1.99","quote":"ETH"}')).toBeInTheDocument();
    expect(screen.queryByText(/chart\.change/)).not.toBeInTheDocument();
  });

  it("draws a move the live pool shows before the indexer has any trade, rather than 'no trades yet'", () => {
    setup({ chart: { tradeCount: 0, launch, points: [{ t: launch.t, priceE18: launch.priceE18 }] } });
    expect(screen.queryByText("chart.empty")).not.toBeInTheDocument();
    // 2 -> 47 gwei over the range.
    expect(screen.getByText('chart.change{"sign":"+","pct":"2250.0","range":"chart.range.24h"}')).toBeInTheDocument();
  });

  it("says so when the history cannot be loaded", () => {
    setup({ isError: true });
    expect(screen.getByText("chart.unavailable")).toBeInTheDocument();
  });

  it("keeps the cached history on screen when a background refetch fails", () => {
    const atLaunch = { ...market, fdv: 2n * 10n ** 18n, price: 2n * GWEI, multiple: 1 };
    setup({ chart: { tradeCount: 0, launch, points: [{ t: launch.t, priceE18: launch.priceE18 }] }, isError: true, m: atLaunch });
    expect(screen.queryByText("chart.unavailable")).not.toBeInTheDocument();
    expect(screen.getByText("chart.empty")).toBeInTheDocument();
  });

  describe("the headline with no price to show", () => {
    it("is a dash, not a skeleton forever, when both the pool and the chart reads have failed", () => {
      const { container } = setup({ isError: true, m: null });
      expect(screen.getByText("—")).toBeInTheDocument();
      expect(container.querySelector(".animate-pulse")).toBeNull();
    });

    it("is a skeleton while the chart read is in flight", () => {
      const { container } = setup({ isLoading: true, m: null });
      expect(container.querySelector(".animate-pulse")).not.toBeNull();
      expect(screen.queryByText("—")).not.toBeInTheDocument();
    });

    it("is a skeleton while the pool read is in flight", () => {
      useTokenChart.mockReturnValue({ data: undefined, isLoading: false, isError: true });
      const { container } = render(<PriceChart token={TOKEN} market={undefined} isMarketLoading />);
      expect(container.querySelector(".animate-pulse")).not.toBeNull();
      expect(screen.queryByText("—")).not.toBeInTheDocument();
    });
  });

  describe("carrying the line to now on a quiet token", () => {
    afterEach(() => vi.useRealTimers());

    it("moves 'now' with the clock even when neither the history nor the pool changes", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-09-30T12:00:00Z"));
      const start = Math.floor(Date.now() / 1000);
      // One old trade; the live pool sits at that price. Nothing will change.
      const quiet = { tradeCount: 1, launch: { t: start - 86400, priceE18: e18(2n * GWEI) }, points: [{ t: start - 3600, priceE18: e18(47n * GWEI) }] };
      setup({ chart: quiet });
      const lastT = () => buildChartSeries.mock.lastCall[0].nowSec;
      expect(lastT()).toBe(start);
      act(() => vi.advanceTimersByTime(30_000));
      expect(lastT()).toBe(start + 30);
      act(() => vi.advanceTimersByTime(30_000));
      expect(lastT()).toBe(start + 60);
    });
  });

  it("defaults to 24h and refetches for the range picked", () => {
    setup({ chart: { tradeCount: 0, launch, points: [] } });
    expect(useTokenChart).toHaveBeenLastCalledWith(TOKEN, "24h");
    fireEvent.mouseDown(screen.getByRole("tab", { name: "chart.range.1h" }), { button: 0 });
    expect(useTokenChart).toHaveBeenLastCalledWith(TOKEN, "1h");
  });
});
