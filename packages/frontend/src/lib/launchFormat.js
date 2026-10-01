// src/lib/launchFormat.js
//
// Presentation rules for launch valuations and prices.
//
// Kept separate from format.js because the choice of unit here is a judgement
// about what a creator or buyer can actually reason about, not a generic number
// format. Two decisions worth stating:
//
//   - **Valuations are shown in ETH.** FDV is the number that governs how a
//     launch behaves; the per-token price is a derived detail. The bounds on the
//     contract are chosen in FDV for the same reason.
//
//   - **Per-token prices are shown in gwei.** At the deployed floor — a 1 ETH
//     valuation against a 1e9 supply — the price is exactly 1 gwei per token, and
//     the ceiling is 1000 gwei. In ETH those are 0.000000001 and 0.000001, which
//     no one can compare at a glance.

import { formatEther, formatGwei, parseUnits } from 'viem';

import { timeUntil } from '@/lib/utils';

/**
 * Trim a fixed-point string to at most `maxDecimals`, dropping trailing zeros.
 * @param {string} value
 * @param {number} maxDecimals
 */
function trimDecimals(value, maxDecimals) {
  if (!value.includes('.')) return value;
  const [whole, fraction] = value.split('.');
  const kept = fraction.slice(0, maxDecimals).replace(/0+$/, '');
  return kept ? `${whole}.${kept}` : whole;
}

/**
 * An 18-decimal amount as a grouped decimal string, at most `maxDecimals`.
 * @param {bigint} raw
 * @param {number} maxDecimals
 */
function formatDecimal18(raw, maxDecimals) {
  const trimmed = trimDecimals(formatEther(raw), maxDecimals);
  const [whole, fraction] = trimmed.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return fraction ? `${grouped}.${fraction}` : grouped;
}

/**
 * A valuation in wei, rendered as ETH with thousands separators.
 * @param {bigint | null | undefined} wei
 * @param {number} [maxDecimals=4]
 * @returns {string} e.g. "1", "12.5", "1,000"
 */
export function formatFdvEth(wei, maxDecimals = 4) {
  if (wei == null) return '—';
  return formatDecimal18(wei, maxDecimals);
}

/**
 * An ETH amount in wei — a trade, a prize's ETH equivalent — with at most two
 * decimals from 0.01 ETH up, and three significant digits below that, so a
 * small amount reads "0.004" or "0.0000472" rather than rounding to "0".
 * @param {bigint | string | null | undefined} wei
 * @returns {string} e.g. "1,250", "0.4", "0.004", "0.0000472"
 */
export function formatEthAmount(wei) {
  if (wei == null) return '—';
  const value = BigInt(wei);
  const magnitude = value < 0n ? -value : value;
  if (magnitude === 0n || magnitude >= 10n ** 16n) return formatDecimal18(value, 2);
  const [whole, fraction] = formatEther(value).split('.');
  const firstDigit = fraction.search(/[1-9]/);
  return `${whole}.${fraction.slice(0, firstDigit + 3).replace(/0+$/, '')}`;
}

/**
 * What an amount of whole tokens — a ticket price typed into a form, say — is
 * worth in wei of ETH at a pool price.
 * @param {number} tokens  whole tokens (fractions kept to 6 decimals)
 * @param {bigint | null | undefined} priceWei  wei of ETH per whole token
 * @returns {bigint | null} null without a price or a usable amount
 */
export function tokensToEthWei(tokens, priceWei) {
  if (priceWei == null || !Number.isFinite(tokens) || tokens < 0) return null;
  return (parseUnits(tokens.toFixed(6), 18) * BigInt(priceWei)) / 10n ** 18n;
}

/**
 * A raw 18-decimal token amount — a ticket price, say — in whole tokens with
 * thousands separators, keeping the fraction formatSupply would drop.
 * @param {bigint | null | undefined} raw
 * @param {number} [maxDecimals=4]
 * @returns {string} e.g. "0.5", "12,000", "1,234.5678"
 */
export function formatTokenAmount(raw, maxDecimals = 4) {
  if (raw == null) return '—';
  return formatDecimal18(BigInt(raw), maxDecimals);
}

/**
 * A per-token starting price in wei, rendered as gwei.
 * @param {bigint | null | undefined} wei
 * @param {number} [maxDecimals=4]
 * @returns {string}
 */
export function formatPriceGwei(wei, maxDecimals = 4) {
  if (wei == null) return '—';
  return trimDecimals(formatGwei(wei), maxDecimals);
}

/**
 * Whole tokens from a raw 18-decimal amount, abbreviated.
 * A launch supply is 1,000,000,000 — "1B" is the only readable form on a card.
 * @param {bigint | null | undefined} raw
 * @returns {string}
 */
export function formatSupply(raw) {
  if (raw == null) return '—';
  const whole = raw / 10n ** 18n;
  if (whole >= 1_000_000_000n) return `${trimDecimals(String(Number(whole) / 1e9), 2)}B`;
  if (whole >= 1_000_000n) return `${trimDecimals(String(Number(whole) / 1e6), 2)}M`;
  if (whole >= 1_000n) return `${trimDecimals(String(Number(whole) / 1e3), 2)}K`;
  return whole.toLocaleString('en-US');
}

/**
 * Relative age of a unix-seconds timestamp, as a short label.
 * @param {bigint | number | null | undefined} unixSeconds
 * @param {number} [nowMs=Date.now()]
 * @returns {string} e.g. "3m", "5h", "2d"
 */
export function formatAge(unixSeconds, nowMs = Date.now()) {
  if (unixSeconds == null) return '—';
  const then = Number(unixSeconds) * 1000;
  const seconds = Math.max(0, Math.floor((nowMs - then) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

/**
 * A price multiple, e.g. 23.6 -> "23.6", 1.004 -> "1.00".
 * Two decimals below 10× so an early move is visible; one above.
 * @param {number | null | undefined} n
 */
export function formatMultiple(n) {
  if (n == null || !Number.isFinite(n)) return '—';
  return n < 10 ? n.toFixed(2) : n.toFixed(1);
}

/**
 * A 0..1 fraction as a percentage string without the sign.
 * One decimal under 10% (where small moves matter), whole numbers above.
 * @param {number | null | undefined} f
 */
export function formatPercent(f) {
  if (f == null || !Number.isFinite(f)) return '—';
  const pct = f * 100;
  return pct < 10 ? pct.toFixed(1) : pct.toFixed(0);
}

/**
 * Time until a unix-seconds timestamp, as a short label: the two largest units,
 * named through the launchpad namespace's `time.*` keys so the unit letters are
 * the reader's language. The split is timeUntil's (and so the CountdownTimer's).
 * @param {bigint | number | null | undefined} unixSeconds
 * @param {(key: string, opts?: object) => string} t  launchpad-namespace translator
 * @param {number} [nowMs=Date.now()]
 * @returns {string} e.g. "2d 4h", "2h 10m", "9m", "0m" once it has passed
 */
export function formatTimeLeft(unixSeconds, t, nowMs = Date.now()) {
  if (unixSeconds == null) return '—';
  const [first, second] = timeUntil(Number(unixSeconds), nowMs).map(({ unit, value }) =>
    t(`time.${unit}`, { count: value }),
  );
  return second ? t('time.pair', { first, second }) : first;
}
