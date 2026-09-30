import { describe, it, expect } from "vitest";
import { buildChartSeries, CHART_RANGES, ethToWei } from "@/lib/launchChart";
import { formatFdvEth } from "@/lib/launchFormat";

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

  it("has trades once the live pool price has left the launch price, even before the indexer sees one", () => {
    const { hasTrades } = buildChartSeries({
      chart: { tradeCount: 0, launch, points: [{ t: 1000, priceWei: String(GWEI) }] },
      currentPriceWei: 3n * GWEI,
      nowSec: 2000,
    });
    expect(hasTrades).toBe(true);
  });

  it("has no trades when the live pool price still sits at the launch price", () => {
    const { hasTrades } = buildChartSeries({
      chart: { tradeCount: 0, launch, points: [{ t: 1000, priceWei: String(GWEI) }] },
      currentPriceWei: GWEI,
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

  describe("measured from the pool's actual launch price, not the requested one", () => {
    // The creator asked for 1 gwei; the placer rounded to a tick and the pool
    // opened a little lower. The backend's chart only knows the requested price.
    const POOL_LAUNCH = 995_000_000n;

    it("an untraded pool sitting at its tick-rounded launch price has no trades", () => {
      const { hasTrades } = buildChartSeries({
        chart: { tradeCount: 0, launch, points: [{ t: 1000, priceWei: String(GWEI) }] },
        launchPriceWei: POOL_LAUNCH,
        currentPriceWei: POOL_LAUNCH,
        nowSec: 2000,
      });
      expect(hasTrades).toBe(false);
    });

    it("uses the pool's launch price for the baseline, the launch point and the multiples", () => {
      const { launchFdv, series } = buildChartSeries({
        chart: { tradeCount: 1, launch, points: [{ t: 1000, priceWei: String(GWEI) }, { t: 1100, priceWei: String(2n * POOL_LAUNCH) }] },
        launchPriceWei: POOL_LAUNCH,
        currentPriceWei: 2n * POOL_LAUNCH,
        nowSec: 1100,
      });
      expect(launchFdv).toBeCloseTo(0.995);
      // The launch point is drawn where the pool opened, at exactly 1x.
      expect(series[0]).toMatchObject({ t: 1000, priceWei: String(POOL_LAUNCH), multiple: 1 });
      // The multiple agrees with the header's market.multiple (2x the pool's launch).
      expect(series.at(-1).multiple).toBe(2);
    });

    it("leaves a range's entry point alone when it is a traded price", () => {
      const { series } = buildChartSeries({
        chart: { tradeCount: 0, launch, points: [{ t: 1500, priceWei: String(4n * GWEI) }] },
        launchPriceWei: POOL_LAUNCH,
        nowSec: 1500,
      });
      expect(series[0].priceWei).toBe(String(4n * GWEI));
    });
  });

  it("offers the ranges the backend accepts", () => {
    expect(CHART_RANGES).toEqual(["1h", "6h", "24h", "all"]);
  });
});

describe("ethToWei", () => {
  it("turns an axis tick back into wei without float noise", () => {
    expect(ethToWei(0.3)).toBe(3n * 10n ** 17n);
    expect(formatFdvEth(ethToWei(0.3), 2)).toBe("0.3");
    expect(formatFdvEth(ethToWei(1250), 2)).toBe("1,250");
  });

  it("handles tiny values and non-positive input", () => {
    expect(ethToWei(1e-9)).toBe(10n ** 9n);
    expect(ethToWei(0)).toBe(0n);
    expect(ethToWei(Number.NaN)).toBe(0n);
  });
});
