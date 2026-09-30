// src/lib/launchChart.js
//
// Turns the backend's chart response (GET /api/launchpad/tokens/:address/chart)
// into the series the price chart draws. Pure, so the rules are testable
// without rendering a chart.
//
// The chart plots FDV in ETH — the unit every other number on the token page
// uses. Price per token and the multiple since launch ride along on each point
// for the tooltip rather than getting a second axis. "Launch" means the price
// the pool opened at (as the header's multiple does), not the requested one.

import { formatEther, parseEther } from 'viem';

/** Range tabs, in display order. Values match the backend's `range` param. */
export const CHART_RANGES = ['1h', '6h', '24h', 'all'];

/** Whole tokens per launch (TOKEN_SUPPLY / 1e18); same default as useLaunchMarkets. */
export const DEFAULT_WHOLE_SUPPLY = 1_000_000_000n;

const fdvEth = (priceWei, wholeSupply) => Number(formatEther(BigInt(priceWei) * wholeSupply));

/**
 * @param {object} p
 * @param {{ tradeCount: number, launch: { t: number, priceWei: string }, points: { t: number, priceWei: string }[] }} p.chart
 * @param {bigint} [p.launchPriceWei]   the price the pool actually opened at
 *   (useLaunchMarkets' market.launchPriceWei). The backend's `launch.priceWei`
 *   is the creator's REQUESTED start price, which the placer rounds to a tick,
 *   so an untraded pool never sits exactly on it. Falls back to the requested
 *   price only while the pool has not been read.
 * @param {bigint} [p.currentPriceWei]  live pool price; extends the line to "now"
 * @param {number} p.nowSec
 * @param {bigint} [p.wholeSupply]
 * @returns {{
 *   series: { t: number, fdv: number, fdvWei: bigint, priceWei: string, multiple: number }[],
 *   launchFdv: number,
 *   launchFdvWei: bigint,
 *   changePct: number | null,
 *   hasTrades: boolean,
 * }}
 */
export function buildChartSeries({ chart, launchPriceWei, currentPriceWei, nowSec, wholeSupply = DEFAULT_WHOLE_SUPPLY }) {
  const requestedPrice = BigInt(chart.launch.priceWei);
  const launchPrice = launchPriceWei != null ? BigInt(launchPriceWei) : requestedPrice;
  const launchFdvWei = launchPrice * wholeSupply;
  const launchFdv = fdvEth(launchPrice, wholeSupply);
  const raw = [...(chart.points ?? [])];

  // The backend enters the line at the requested start price when no trade
  // precedes the range (always, for "all"). That point stands for the launch,
  // so draw it at the price the pool really opened at — otherwise the line
  // would open with a step that never traded.
  if (raw.length > 0 && BigInt(raw[0].priceWei) === requestedPrice) {
    raw[0] = { ...raw[0], priceWei: String(launchPrice) };
  }

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
    // `fdv` is what the chart plots; `fdvWei` is what labels print, exactly.
    fdv: fdvEth(p.priceWei, wholeSupply),
    fdvWei: BigInt(p.priceWei) * wholeSupply,
    priceWei: String(p.priceWei),
    multiple: launchPrice > 0n ? Number((BigInt(p.priceWei) * 10_000n) / launchPrice) / 10_000 : 0,
  }));

  const first = series[0]?.fdv;
  const end = series[series.length - 1]?.fdv;
  const changePct = first > 0 && end != null ? ((end - first) / first) * 100 : null;

  return { series, launchFdv, launchFdvWei, changePct, hasTrades };
}

/**
 * An ETH amount the chart library hands back as a float (an axis tick) as
 * wei, so it prints through the same formatter as every other valuation.
 * Goes through 15 significant digits so float noise (0.3 -> 0.29999…) does
 * not survive into a truncating formatter.
 * @param {number} eth
 * @returns {bigint}
 */
export function ethToWei(eth) {
  if (!Number.isFinite(eth) || eth <= 0) return 0n;
  const text = eth.toPrecision(15);
  return parseEther(text.includes('e') ? eth.toFixed(18) : text);
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
