// src/lib/launchChart.js
//
// Turns the backend's chart response (GET /api/launchpad/tokens/:address/chart)
// into the series the price chart draws. Pure, so the rules are testable
// without rendering a chart.
//
// The chart plots FDV in ETH — the unit every other number on the token page
// uses. Price per token and the multiple since launch ride along on each point
// for the tooltip rather than getting a second axis.

import { formatEther } from 'viem';

/** Range tabs, in display order. Values match the backend's `range` param. */
export const CHART_RANGES = ['1h', '6h', '24h', 'all'];

/** Whole tokens per launch (TOKEN_SUPPLY / 1e18); same default as useLaunchMarkets. */
export const DEFAULT_WHOLE_SUPPLY = 1_000_000_000n;

const fdvEth = (priceWei, wholeSupply) => Number(formatEther(BigInt(priceWei) * wholeSupply));

/**
 * @param {object} p
 * @param {{ tradeCount: number, launch: { t: number, priceWei: string }, points: { t: number, priceWei: string }[] }} p.chart
 * @param {bigint} [p.currentPriceWei]  live pool price; extends the line to "now"
 * @param {number} p.nowSec
 * @param {bigint} [p.wholeSupply]
 * @returns {{
 *   series: { t: number, fdv: number, priceWei: string, multiple: number }[],
 *   launchFdv: number,
 *   changePct: number | null,
 *   hasTrades: boolean,
 * }}
 */
export function buildChartSeries({ chart, currentPriceWei, nowSec, wholeSupply = DEFAULT_WHOLE_SUPPLY }) {
  const launchPrice = BigInt(chart.launch.priceWei);
  const launchFdv = fdvEth(launchPrice, wholeSupply);
  const raw = [...(chart.points ?? [])];

  // No trade in the range, the line enters at the launch price, and the live
  // pool still sits at the launch price: nothing has ever traded, so there is
  // no line to draw. (A quiet range after earlier trades enters at the last
  // traded price instead, and still draws. A live price off the launch price
  // means the pool has traded even if the indexer has not caught up — without
  // it the headline would show a move while the chart said "No trades yet".)
  const hasTrades =
    chart.tradeCount > 0 ||
    (raw.length > 0 && BigInt(raw[0].priceWei) !== launchPrice) ||
    (currentPriceWei != null && BigInt(currentPriceWei) !== launchPrice);

  // Carry the line to "now" at the live price, so a quiet stretch reads as
  // flat instead of stopping at the last trade.
  const last = raw[raw.length - 1];
  if (last && nowSec > last.t) {
    raw.push({ t: nowSec, priceWei: String(currentPriceWei ?? last.priceWei) });
  }

  const series = raw.map((p) => ({
    t: p.t,
    fdv: fdvEth(p.priceWei, wholeSupply),
    priceWei: String(p.priceWei),
    multiple: launchPrice > 0n ? Number((BigInt(p.priceWei) * 10_000n) / launchPrice) / 10_000 : 0,
  }));

  const first = series[0]?.fdv;
  const end = series[series.length - 1]?.fdv;
  const changePct = first > 0 && end != null ? ((end - first) / first) * 100 : null;

  return { series, launchFdv, changePct, hasTrades };
}

/**
 * Axis tick label for a point in time: clock time inside a day, date beyond.
 * @param {number} t unix seconds
 * @param {string} range
 */
export function formatChartTime(t, range) {
  const d = new Date(t * 1000);
  if (range === 'all') return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}
