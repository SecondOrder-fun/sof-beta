import { describe, it, expect } from "vitest";
import { buildChartSeries, CHART_RANGES, fdvFromPriceE18, unitsToRaw } from "@/lib/launchChart";
import { formatFdv, formatFdvEth } from "@/lib/launchFormat";

// 1 gwei per token at a 1e9 supply is a 1 ETH FDV — the deployed floor.
const GWEI = 1_000_000_000n;
/** A price in quote raw units per whole token, as the backend's `priceE18`. */
const e18 = (raw) => String(raw * 10n ** 18n);
/** The valuation of a raw-units-per-token price at the 1e9 supply. */
const fdvOf = (raw) => raw * 1_000_000_000n;
const launch = { t: 1000, priceE18: e18(GWEI) };

describe("buildChartSeries", () => {
  it("plots FDV in the quote, with the multiple since launch on each point", () => {
    const { series, launchFdv } = buildChartSeries({
      chart: { tradeCount: 2, launch, points: [{ t: 1000, priceE18: e18(GWEI) }, { t: 1100, priceE18: e18(3n * GWEI) }] },
      nowSec: 1100,
    });
    expect(launchFdv).toBe(1);
    expect(series.map((p) => p.fdv)).toEqual([1, 3]);
    expect(series.map((p) => p.multiple)).toEqual([1, 3]);
  });

  it("carries the line to now at the live pool price", () => {
    const { series } = buildChartSeries({
      chart: { tradeCount: 1, launch, points: [{ t: 1000, priceE18: e18(2n * GWEI) }] },
      currentFdv: fdvOf(5n * GWEI),
      nowSec: 2000,
    });
    expect(series.at(-1)).toMatchObject({ t: 2000, fdv: 5 });
  });

  it("carries a quiet line flat at the last price when no live price is known", () => {
    const { series } = buildChartSeries({
      chart: { tradeCount: 0, launch, points: [{ t: 1500, priceE18: e18(4n * GWEI) }] },
      nowSec: 2000,
    });
    expect(series.map((p) => [p.t, p.fdv])).toEqual([[1500, 4], [2000, 4]]);
  });

  it("reports the change over the range, from where the line enters it", () => {
    const { changePct } = buildChartSeries({
      chart: { tradeCount: 1, launch, points: [{ t: 1000, priceE18: e18(2n * GWEI) }, { t: 1100, priceE18: e18(3n * GWEI) }] },
      nowSec: 1100,
    });
    expect(changePct).toBeCloseTo(50);
  });

  it("has no trades when nothing traded and the line enters at the launch price", () => {
    const { hasTrades } = buildChartSeries({
      chart: { tradeCount: 0, launch, points: [{ t: 1000, priceE18: e18(GWEI) }] },
      nowSec: 2000,
    });
    expect(hasTrades).toBe(false);
  });

  it("has trades once the live pool price has left the launch price, even before the indexer sees one", () => {
    const { hasTrades } = buildChartSeries({
      chart: { tradeCount: 0, launch, points: [{ t: 1000, priceE18: e18(GWEI) }] },
      currentFdv: fdvOf(3n * GWEI),
      nowSec: 2000,
    });
    expect(hasTrades).toBe(true);
  });

  it("has no trades when the live pool price still sits at the launch price", () => {
    const { hasTrades } = buildChartSeries({
      chart: { tradeCount: 0, launch, points: [{ t: 1000, priceE18: e18(GWEI) }] },
      currentFdv: fdvOf(GWEI),
      nowSec: 2000,
    });
    expect(hasTrades).toBe(false);
  });

  it("still has trades for a quiet range after earlier trading", () => {
    const { hasTrades } = buildChartSeries({
      chart: { tradeCount: 0, launch, points: [{ t: 1500, priceE18: e18(4n * GWEI) }] },
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
        chart: { tradeCount: 0, launch, points: [{ t: 1000, priceE18: e18(GWEI) }] },
        launchFdv: fdvOf(POOL_LAUNCH),
        currentFdv: fdvOf(POOL_LAUNCH),
        nowSec: 2000,
      });
      expect(hasTrades).toBe(false);
    });

    it("uses the pool's launch price for the baseline, the launch point and the multiples", () => {
      const { launchFdv, series } = buildChartSeries({
        chart: { tradeCount: 1, launch, points: [{ t: 1000, priceE18: e18(GWEI) }, { t: 1100, priceE18: e18(2n * POOL_LAUNCH) }] },
        launchFdv: fdvOf(POOL_LAUNCH),
        currentFdv: fdvOf(2n * POOL_LAUNCH),
        nowSec: 1100,
      });
      expect(launchFdv).toBeCloseTo(0.995);
      // The launch point is drawn where the pool opened, at exactly 1x.
      expect(series[0]).toMatchObject({ t: 1000, fdvRaw: fdvOf(POOL_LAUNCH), multiple: 1 });
      // The multiple agrees with the header's market.multiple (2x the pool's launch).
      expect(series.at(-1).multiple).toBe(2);
    });

    it("leaves a range's entry point alone when it is a traded price", () => {
      const { series } = buildChartSeries({
        chart: { tradeCount: 0, launch, points: [{ t: 1500, priceE18: e18(4n * GWEI) }] },
        launchFdv: fdvOf(POOL_LAUNCH),
        nowSec: 1500,
      });
      expect(series[0].fdvRaw).toBe(fdvOf(4n * GWEI));
    });
  });

  // A USDC launch: prices in 1e-6 USDC per whole token, plotted in whole USDC.
  it("plots a 6-decimal quote's FDV in whole units", () => {
    const usdcLaunch = { t: 1000, priceE18: e18(5n) }; // 5e-6 USDC per token = 5,000 USDC FDV
    const { series, launchFdv, launchFdvRaw } = buildChartSeries({
      chart: { tradeCount: 1, launch: usdcLaunch, points: [{ t: 1000, priceE18: e18(5n) }, { t: 1100, priceE18: e18(10n) }] },
      nowSec: 1100,
      decimals: 6,
    });
    expect(launchFdv).toBe(5000);
    expect(launchFdvRaw).toBe(5_000_000_000n);
    expect(series.map((p) => p.fdv)).toEqual([5000, 10000]);
    expect(formatFdv(series[1].fdvRaw, 6, 2)).toBe("10,000");
  });

  // The case the e18 scale exists for: a 2,500 USDC launch is 2.5 raw units per
  // token. Integer raw units floored every price near it to 2 (2,000 USDC) and
  // drew a flat step; the scaled prices keep each move.
  it("keeps a 6-decimal quote's fractional raw units per token", () => {
    const usdcLaunch = { t: 1000, priceE18: "2500000000000000000" }; // 2.5 raw USDC per token
    const { series, launchFdvRaw } = buildChartSeries({
      chart: {
        tradeCount: 2,
        launch: usdcLaunch,
        points: [
          { t: 1000, priceE18: "2500000000000000000" },
          { t: 1050, priceE18: "2512345678901234567" },
          { t: 1100, priceE18: "2750000000000000000" },
        ],
      },
      nowSec: 1100,
      decimals: 6,
    });
    expect(launchFdvRaw).toBe(2_500_000_000n);
    expect(series.map((p) => p.fdvRaw)).toEqual([2_500_000_000n, 2_512_345_678n, 2_750_000_000n]);
    expect(series.map((p) => p.multiple)).toEqual([1, 1.0049, 1.1]);
    expect(formatFdv(series[1].fdvRaw, 6, 2)).toBe("2,512.34");
  });

  it("offers the ranges the backend accepts", () => {
    expect(CHART_RANGES).toEqual(["1h", "6h", "24h", "all"]);
  });
});

describe("fdvFromPriceE18", () => {
  it("is the whole supply at the price, multiplied before it divides", () => {
    expect(fdvFromPriceE18(e18(GWEI))).toBe(10n ** 18n); // 1 gwei per token = 1 ETH
    expect(fdvFromPriceE18("2500000000000000000")).toBe(2_500_000_000n); // 2,500 USDC
    // A price finer than a raw unit per token still counts: 1e-9 raw units per
    // token over 1e9 tokens is one raw unit of valuation; less floors to 0.
    expect(fdvFromPriceE18("1000000000")).toBe(1n);
    expect(fdvFromPriceE18("999999999")).toBe(0n);
    expect(fdvFromPriceE18(0n)).toBe(0n);
  });

  it("takes another supply", () => {
    expect(fdvFromPriceE18(e18(3n), 10n)).toBe(30n);
  });
});

describe("unitsToRaw", () => {
  it("turns an axis tick back into raw units without float noise", () => {
    expect(unitsToRaw(0.3)).toBe(3n * 10n ** 17n);
    expect(formatFdvEth(unitsToRaw(0.3), 2)).toBe("0.3");
    expect(formatFdvEth(unitsToRaw(1250), 2)).toBe("1,250");
  });

  it("uses the quote's decimals, dropping digits it cannot hold", () => {
    expect(unitsToRaw(2500, 6)).toBe(2_500_000_000n);
    expect(unitsToRaw(0.1234567, 6)).toBe(123_456n);
  });

  it("handles tiny values and non-positive input", () => {
    expect(unitsToRaw(1e-9)).toBe(10n ** 9n);
    expect(unitsToRaw(0)).toBe(0n);
    expect(unitsToRaw(Number.NaN)).toBe(0n);
  });
});
