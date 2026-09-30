import { describe, it, expect } from "vitest";
import { buildChartSeries, CHART_RANGES } from "@/lib/launchChart";

// 1 gwei per token at a 1e9 supply is a 1 ETH FDV — the deployed floor.
const GWEI = 1_000_000_000n;
const launch = { t: 1000, priceWei: String(GWEI) };

describe("buildChartSeries", () => {
  it("plots FDV in ETH, with the multiple since launch on each point", () => {
    const { series, launchFdv } = buildChartSeries({
      chart: { tradeCount: 2, launch, points: [{ t: 1000, priceWei: String(GWEI) }, { t: 1100, priceWei: String(3n * GWEI) }] },
      nowSec: 1100,
    });
    expect(launchFdv).toBe(1);
    expect(series.map((p) => p.fdv)).toEqual([1, 3]);
    expect(series.map((p) => p.multiple)).toEqual([1, 3]);
  });

  it("carries the line to now at the live pool price", () => {
    const { series } = buildChartSeries({
      chart: { tradeCount: 1, launch, points: [{ t: 1000, priceWei: String(2n * GWEI) }] },
      currentPriceWei: 5n * GWEI,
      nowSec: 2000,
    });
    expect(series.at(-1)).toMatchObject({ t: 2000, fdv: 5 });
  });

  it("carries a quiet line flat at the last price when no live price is known", () => {
    const { series } = buildChartSeries({
      chart: { tradeCount: 0, launch, points: [{ t: 1500, priceWei: String(4n * GWEI) }] },
      nowSec: 2000,
    });
    expect(series.map((p) => [p.t, p.fdv])).toEqual([[1500, 4], [2000, 4]]);
  });

  it("reports the change over the range, from where the line enters it", () => {
    const { changePct } = buildChartSeries({
      chart: { tradeCount: 1, launch, points: [{ t: 1000, priceWei: String(2n * GWEI) }, { t: 1100, priceWei: String(3n * GWEI) }] },
      nowSec: 1100,
    });
    expect(changePct).toBeCloseTo(50);
  });

  it("has no trades when nothing traded and the line enters at the launch price", () => {
    const { hasTrades } = buildChartSeries({
      chart: { tradeCount: 0, launch, points: [{ t: 1000, priceWei: String(GWEI) }] },
      nowSec: 2000,
    });
    expect(hasTrades).toBe(false);
  });

  it("still has trades for a quiet range after earlier trading", () => {
    const { hasTrades } = buildChartSeries({
      chart: { tradeCount: 0, launch, points: [{ t: 1500, priceWei: String(4n * GWEI) }] },
      nowSec: 2000,
    });
    expect(hasTrades).toBe(true);
  });

  it("offers the ranges the backend accepts", () => {
    expect(CHART_RANGES).toEqual(["1h", "6h", "24h", "all"]);
  });
});
