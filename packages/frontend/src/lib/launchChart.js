// src/lib/launchChart.js
//
// Turns the backend's chart response (GET /api/launchpad/tokens/:address/chart)
// into the series the price chart draws. Pure, so the rules are testable
// without rendering a chart.
//
// The chart plots FDV in the launch's quote token (ETH, USDC, …) — the unit
// every other number on the token page uses. Prices arrive as `priceE18`: quote
// raw units per whole token × 1e18, so a 6-decimal quote keeps its precision
// (a 2,500 USDC launch is 2.5 raw units per token). Each point is turned into a
// valuation straight away; price per token and the multiple since launch ride
// along on each point for the tooltip rather than getting a second axis.
// "Launch" means the valuation the pool opened at (as the header's multiple
// does), not the requested one.

import { formatUnits, parseUnits } from 'viem';

/** Range tabs, in display order. Values match the backend's `range` param. */
export const CHART_RANGES = ['1h', '6h', '24h', 'all'];

/** Whole tokens per launch (TOKEN_SUPPLY / 1e18); same default as useLaunchMarkets. */
export const DEFAULT_WHOLE_SUPPLY = 1_000_000_000n;

/** The fixed-point scale of the backend's `priceE18` / `startPriceE18`. */
export const PRICE_E18_SCALE = 10n ** 18n;

/**
 * The valuation a backend price implies, in quote raw units: the whole supply
 * at that price. Multiplies before dividing, so nothing finer than one raw unit
 * of valuation is lost.
 * @param {bigint | string} priceE18  quote raw units per whole token × 1e18
 * @param {bigint} [wholeSupply]
 * @returns {bigint}
 */
export function fdvFromPriceE18(priceE18, wholeSupply = DEFAULT_WHOLE_SUPPLY) {
  return (BigInt(priceE18) * BigInt(wholeSupply)) / PRICE_E18_SCALE;
}

/** A valuation in raw quote units as a float in whole units, for plotting only. */
const toUnits = (raw, decimals) => Number(formatUnits(raw, decimals));

/**
 * @param {object} p
 * @param {{ tradeCount: number, launch: { t: number, priceE18: string }, points: { t: number, priceE18: string }[] }} p.chart
 *   prices in quote raw units per whole token × 1e18
 * @param {bigint} [p.launchFdv]   the valuation the pool actually opened at
 *   (useLaunchMarkets' market.launchFdv). The backend's `launch.priceE18` is the
 *   creator's REQUESTED start price, which the placer snaps to a tick, so an
 *   untraded pool never sits exactly on it. Falls back to the requested price
 *   only while the pool has not been read.
 * @param {bigint} [p.currentFdv]  live pool valuation (market.fdv); extends the
 *   line to "now"
 * @param {number} p.nowSec
 * @param {bigint} [p.wholeSupply]
 * @param {number} [p.decimals=18]   the quote token's decimals
 * @returns {{
 *   series: { t: number, fdv: number, fdvRaw: bigint, multiple: number }[],
 *   launchFdv: number,
 *   launchFdvRaw: bigint,
 *   changePct: number | null,
 *   hasTrades: boolean,
 * }}
 */
export function buildChartSeries({
  chart,
  launchFdv: poolLaunchFdv,
  currentFdv,
  nowSec,
  wholeSupply = DEFAULT_WHOLE_SUPPLY,
  decimals = 18,
}) {
  const requestedPriceE18 = BigInt(chart.launch.priceE18);
  const launchFdvRaw = poolLaunchFdv != null ? BigInt(poolLaunchFdv) : fdvFromPriceE18(requestedPriceE18, wholeSupply);
  const launchFdv = toUnits(launchFdvRaw, decimals);
  const points = chart.points ?? [];
  const raw = points.map((p) => ({ t: p.t, fdvRaw: fdvFromPriceE18(p.priceE18, wholeSupply) }));

  // The backend enters the line at the requested start price when no trade
  // precedes the range (always, for "all"). That point stands for the launch,
  // so draw it at the valuation the pool really opened at — otherwise the line
  // would open with a step that never traded.
  if (raw.length > 0 && BigInt(points[0].priceE18) === requestedPriceE18) {
    raw[0] = { ...raw[0], fdvRaw: launchFdvRaw };
  }

  // No trade in the range, the line enters at the launch valuation, and the
  // live pool still sits there: nothing has ever traded, so there is no line to
  // draw. (A quiet range after earlier trades enters at the last traded price
  // instead, and still draws. A live valuation off the launch one means the pool
  // has traded even if the indexer has not caught up — without it the headline
  // would show a move while the chart said "No trades yet".) At the same pool
  // price a traded point and the pool's own valuation (v4PoolMath.fdvAt) are the
  // same integer: with a 1e9 supply both floor sqrt-price × 1e27, so this
  // compares like with like.
  const current = currentFdv != null ? BigInt(currentFdv) : null;
  const hasTrades =
    chart.tradeCount > 0 ||
    (raw.length > 0 && raw[0].fdvRaw !== launchFdvRaw) ||
    (current != null && current !== launchFdvRaw);

  // Carry the line to "now" at the live valuation, so a quiet stretch reads as
  // flat instead of stopping at the last trade.
  const last = raw[raw.length - 1];
  if (last && nowSec > last.t) {
    raw.push({ t: nowSec, fdvRaw: current ?? last.fdvRaw });
  }

  const series = raw.map(({ t, fdvRaw }) => ({
    t,
    // `fdv` is what the chart plots; `fdvRaw` is what labels print, exactly.
    fdv: toUnits(fdvRaw, decimals),
    fdvRaw,
    multiple: launchFdvRaw > 0n ? Number((fdvRaw * 10_000n) / launchFdvRaw) / 10_000 : 0,
  }));

  const first = series[0]?.fdv;
  const end = series[series.length - 1]?.fdv;
  const changePct = first > 0 && end != null ? ((end - first) / first) * 100 : null;

  return { series, launchFdv, launchFdvRaw, changePct, hasTrades };
}

/**
 * An amount the chart library hands back as a float in whole quote units (an
 * axis tick) as raw units, so it prints through the same formatter as every
 * other valuation. Goes through 15 significant digits so float noise
 * (0.3 -> 0.29999…) does not survive into a truncating formatter.
 * @param {number} value
 * @param {number} [decimals=18]
 * @returns {bigint}
 */
export function unitsToRaw(value, decimals = 18) {
  if (!Number.isFinite(value) || value <= 0) return 0n;
  const text = value.toPrecision(15);
  const plain = text.includes('e') ? value.toFixed(decimals) : text;
  // Drop digits finer than the quote can hold rather than refuse them.
  const [whole, fraction = ''] = plain.split('.');
  return parseUnits(fraction ? `${whole}.${fraction.slice(0, decimals)}` : whole, decimals);
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
