import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

import PriceChart from "@/components/launchpad/PriceChart";
import { useTokenChart } from "@/hooks/useLaunchActivity";

vi.mock("@/hooks/useLaunchActivity", () => ({ useTokenChart: vi.fn() }));
vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal()),
  useTranslation: () => ({ t: (key, opts) => (opts ? `${key}${JSON.stringify(opts)}` : key) }),
}));

const TOKEN = "0x1111111111111111111111111111111111111111";
const GWEI = 10n ** 9n;
const NOW = Math.floor(Date.now() / 1000);
const launch = { t: NOW - 86400, priceWei: String(2n * GWEI) };

const market = { fdvWei: 47n * 10n ** 18n, launchFdvWei: 2n * 10n ** 18n, launchPriceWei: 2n * GWEI, priceWei: 47n * GWEI, multiple: 23.5 };

const setup = ({ chart, isLoading = false, isError = false, m = market } = {}) => {
  useTokenChart.mockReturnValue({ data: chart, isLoading, isError });
  return render(<PriceChart token={TOKEN} market={m} />);
};

describe("PriceChart", () => {
  beforeEach(() => vi.clearAllMocks());

  it("headlines the live FDV and its change over the range", () => {
    setup({
      chart: { tradeCount: 3, launch, points: [{ t: NOW - 86400, priceWei: String(40n * GWEI) }, { t: NOW - 60, priceWei: String(46n * GWEI) }] },
    });
    expect(screen.getByText("47")).toBeInTheDocument();
    // 40 -> 47 (the live price carries the line to now) = +17.5%
    expect(screen.getByText('chart.change{"sign":"+","pct":"17.5","range":"chart.range.24h"}')).toBeInTheDocument();
  });

  it("shows a fall with a minus sign", () => {
    setup({
      chart: { tradeCount: 1, launch, points: [{ t: NOW - 3600, priceWei: String(94n * GWEI) }] },
    });
    expect(screen.getByText('chart.change{"sign":"−","pct":"50.0","range":"chart.range.24h"}')).toBeInTheDocument();
  });

  it("names the headline unit through i18n", () => {
    setup({ chart: { tradeCount: 1, launch, points: [{ t: NOW - 3600, priceWei: String(40n * GWEI) }] } });
    expect(screen.getByText("chart.ethUnit")).toBeInTheDocument();
  });

  it("with no trades, shows the launch baseline and an empty state, not a flat line", () => {
    // The live pool still at the launch price: nothing has traded anywhere.
    const atLaunch = { ...market, fdvWei: 2n * 10n ** 18n, priceWei: 2n * GWEI, multiple: 1 };
    setup({ chart: { tradeCount: 0, launch, points: [{ t: launch.t, priceWei: launch.priceWei }] }, m: atLaunch });
    expect(screen.getByText("chart.empty")).toBeInTheDocument();
    expect(screen.getByText('chart.launchLine{"fdv":"2"}')).toBeInTheDocument();
    expect(screen.queryByText(/chart\.change/)).not.toBeInTheDocument();
  });

  it("an untraded pool at its tick-rounded launch price is still 'no trades yet'", () => {
    // Requested 2 gwei; the pool opened (and still sits) at 1.99 gwei.
    const opened = 1_990_000_000n;
    const untraded = { fdvWei: opened * 10n ** 9n, launchFdvWei: opened * 10n ** 9n, launchPriceWei: opened, priceWei: opened, multiple: 1 };
    setup({ chart: { tradeCount: 0, launch, points: [{ t: launch.t, priceWei: launch.priceWei }] }, m: untraded });
    expect(screen.getByText("chart.empty")).toBeInTheDocument();
    // The baseline is where the pool opened, printed like the headline.
    expect(screen.getByText('chart.launchLine{"fdv":"1.99"}')).toBeInTheDocument();
    expect(screen.queryByText(/chart\.change/)).not.toBeInTheDocument();
  });

  it("draws a move the live pool shows before the indexer has any trade, rather than 'no trades yet'", () => {
    setup({ chart: { tradeCount: 0, launch, points: [{ t: launch.t, priceWei: launch.priceWei }] } });
    expect(screen.queryByText("chart.empty")).not.toBeInTheDocument();
    // 2 -> 47 gwei over the range.
    expect(screen.getByText('chart.change{"sign":"+","pct":"2250.0","range":"chart.range.24h"}')).toBeInTheDocument();
  });

  it("says so when the history cannot be loaded", () => {
    setup({ isError: true });
    expect(screen.getByText("chart.unavailable")).toBeInTheDocument();
  });

  it("keeps the cached history on screen when a background refetch fails", () => {
    const atLaunch = { ...market, fdvWei: 2n * 10n ** 18n, priceWei: 2n * GWEI, multiple: 1 };
    setup({ chart: { tradeCount: 0, launch, points: [{ t: launch.t, priceWei: launch.priceWei }] }, isError: true, m: atLaunch });
    expect(screen.queryByText("chart.unavailable")).not.toBeInTheDocument();
    expect(screen.getByText("chart.empty")).toBeInTheDocument();
  });

  it("defaults to 24h and refetches for the range picked", () => {
    setup({ chart: { tradeCount: 0, launch, points: [] } });
    expect(useTokenChart).toHaveBeenLastCalledWith(TOKEN, "24h");
    fireEvent.mouseDown(screen.getByRole("tab", { name: "chart.range.1h" }), { button: 0 });
    expect(useTokenChart).toHaveBeenLastCalledWith(TOKEN, "1h");
  });
});
