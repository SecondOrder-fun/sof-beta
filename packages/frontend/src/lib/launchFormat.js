// src/lib/launchFormat.js
//
// Presentation rules for launch valuations and prices.
//
// Kept separate from format.js because the choice of unit here is a judgement
// about what a creator or buyer can actually reason about, not a generic number
// format. A launch is paired with a quote token — native ETH or an allowlisted
// ERC-20 such as USDC — and every amount is shown in that quote, with its own
// decimals and symbol. Two decisions worth stating:
//
//   - **Valuations come first.** FDV is the number that governs how a launch
//     behaves; the per-token price is a derived detail. The contract's bounds
//     are chosen in FDV for the same reason.
//
//   - **Per-token prices are shown in gwei for ETH.** At the ETH floor — a 1 ETH
//     valuation against a 1e9 supply — the price is exactly 1 gwei per token, and
//     the ceiling is 1000 gwei. In ETH those are 0.000000001 and 0.000001, which
//     no one can compare at a glance. Other quotes show the price in the quote
//     itself, to four significant digits ("0.0000025 USDC").

import { formatUnits, parseUnits } from 'viem';

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
 * A raw amount with `decimals` as a grouped decimal string, at most `maxDecimals`.
 * @param {bigint} raw
 * @param {number} maxDecimals
 * @param {number} [decimals=18]
 */
function formatDecimal(raw, maxDecimals, decimals = 18) {
  const trimmed = trimDecimals(formatUnits(raw, decimals), maxDecimals);
  const [whole, fraction] = trimmed.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return fraction ? `${grouped}.${fraction}` : grouped;
}

/**
 * A valuation in its quote's raw units, rendered in whole quote units with
 * thousands separators.
 * @param {bigint | null | undefined} raw
 * @param {number} [decimals=18]   the quote's decimals (18 for ETH, 6 for USDC)
 * @param {number} [maxDecimals=4]
 * @returns {string} e.g. "1", "12.5", "1,000", "2,500"
 */
export function formatFdv(raw, decimals = 18, maxDecimals = 4) {
  if (raw == null) return '—';
  return formatDecimal(BigInt(raw), maxDecimals, decimals);
}

/**
 * A valuation in wei, rendered as ETH with thousands separators.
 * @param {bigint | null | undefined} wei
 * @param {number} [maxDecimals=4]
 * @returns {string} e.g. "1", "12.5", "1,000"
 */
export function formatFdvEth(wei, maxDecimals = 4) {
  return formatFdv(wei, 18, maxDecimals);
}

/**
 * An amount in a quote's raw units — a trade, a fee balance, a prize's
 * equivalent — with at most two decimals from 0.01 up, and three significant
 * digits below that, so a small amount reads "0.004" or "0.0000472" rather
 * than rounding to "0".
 * @param {bigint | string | null | undefined} raw
 * @param {number} [decimals=18]
 * @returns {string} e.g. "1,250", "0.4", "0.004", "0.0000472"
 */
export function formatQuoteAmount(raw, decimals = 18) {
  if (raw == null) return '—';
  const value = BigInt(raw);
  const magnitude = value < 0n ? -value : value;
  const cent = decimals >= 2 ? 10n ** BigInt(decimals - 2) : 1n;
  if (magnitude === 0n || magnitude >= cent) return formatDecimal(value, 2, decimals);
  const [whole, fraction] = formatUnits(value, decimals).split('.');
  const firstDigit = fraction.search(/[1-9]/);
  return `${whole}.${fraction.slice(0, firstDigit + 3).replace(/0+$/, '')}`;
}

/**
 * An ETH amount in wei — formatQuoteAmount for an 18-decimal quote.
 * @param {bigint | string | null | undefined} wei
 */
export function formatEthAmount(wei) {
  return formatQuoteAmount(wei, 18);
}

/**
 * Parse a typed amount of a quote ("2.5") into its raw units. Null for anything
 * that is not a usable positive number — including more decimals than the
 * quote has — so callers can tell "not filled in yet" from zero.
 * @param {string} input
 * @param {number} [decimals=18]
 * @returns {bigint | null}
 */
export function parseQuoteAmount(input, decimals = 18) {
  const trimmed = String(input ?? '').trim();
  if (!trimmed || !/^\d*\.?\d*$/.test(trimmed) || trimmed === '.') return null;
  const fraction = trimmed.split('.')[1] ?? '';
  if (fraction.length > decimals) return null;
  try {
    const raw = parseUnits(trimmed, decimals);
    return raw > 0n ? raw : null;
  } catch {
    return null;
  }
}

/**
 * A launch's trade fee, in pips (10_000 = 1%, as UniV4LiquidityPlacer stores it),
 * as a percentage without the sign: 10_000 → "1", 5_000 → "0.5", 25_000 → "2.5".
 * @param {number | bigint | null | undefined} pips
 */
export function formatTradeFee(pips) {
  if (pips == null) return '—';
  return formatUnits(BigInt(pips), 4);
}

/**
 * A moving fee rate in pips (a snipe-taxed buy's) as a percentage to at most two
 * decimals, rounded UP so it never reads below the rate: 589_334 → "58.94",
 * 10_000 → "1".
 * @param {number | bigint | null | undefined} pips
 */
export function formatFeeRate(pips) {
  if (pips == null) return '—';
  return formatUnits(BigInt(Math.ceil(Number(pips) / 100)), 2);
}

/**
 * Seconds as a short duration for a countdown: 12 → { seconds: 12 },
 * 125 → { minutes: 2, seconds: 5 }. The component picks the string.
 * @param {number} totalSeconds
 * @returns {{ minutes: number, seconds: number }}
 */
export function splitSeconds(totalSeconds) {
  const s = Math.max(0, Math.ceil(totalSeconds));
  return { minutes: Math.floor(s / 60), seconds: s % 60 };
}

/**
 * Parse a typed trade-fee percentage ("1", "0.5") into pips. Null for anything
 * that is not a usable positive number or is finer than a pip (four decimals).
 * @param {string} input
 * @returns {number | null}
 */
export function parseTradeFeePct(input) {
  const pips = parseQuoteAmount(String(input ?? '').replace(/%\s*$/, ''), 4);
  return pips == null ? null : Number(pips);
}

/** The fixed-point digits kept when dividing a valuation down to a per-token price. */
const PRICE_SCALE_DIGITS = 18;

/**
 * Four significant digits of a decimal string; at most four decimals once the
 * value reaches 1.
 * @param {string} value
 */
function significant(value) {
  const [whole, fraction = ''] = value.split('.');
  if (whole !== '0') return trimDecimals(value, 4);
  const firstDigit = fraction.search(/[1-9]/);
  if (firstDigit === -1) return '0';
  return `0.${fraction.slice(0, firstDigit + 4).replace(/0+$/, '')}`;
}

/**
 * A per-token price, from the valuation it implies, in the unit people read
 * it in: gwei for ETH, the quote itself otherwise. Taking the valuation (not a
 * floored per-token price) keeps a 6-decimal quote's precision.
 * @param {bigint | string | null | undefined} fdvRaw  valuation, quote raw units
 * @param {{ symbol: string, decimals: number } | null | undefined} quote  null → ETH
 * @param {bigint} [wholeSupply=1_000_000_000n]
 * @returns {{ value: string, unit: string }} e.g. { value: "1", unit: "gwei" },
 *   { value: "0.0000025", unit: "USDC" }
 */
export function formatTokenPrice(fdvRaw, quote, wholeSupply = 1_000_000_000n) {
  const isEth = !quote || (quote.symbol === 'ETH' && Number(quote.decimals) === 18);
  const unit = isEth ? 'gwei' : quote.symbol;
  if (fdvRaw == null || !wholeSupply) return { value: '—', unit };
  const unitDecimals = isEth ? 9 : Number(quote.decimals);
  const scaled = (BigInt(fdvRaw) * 10n ** BigInt(PRICE_SCALE_DIGITS)) / BigInt(wholeSupply);
  return { value: significant(formatUnits(scaled, unitDecimals + PRICE_SCALE_DIGITS)), unit };
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
  return formatDecimal(BigInt(raw), maxDecimals);
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
