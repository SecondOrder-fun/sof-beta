// src/config/launchQuoteTokens.js
//
// What a launch can be paired with, per network.
//
// TokenLaunchpad keeps an allowlist of quote tokens (`quoteConfig(quote)`), but
// it cannot be enumerated on-chain, so the candidates live here and the launch
// form keeps only those the launchpad reports `allowed` — with that quote's own
// valuation bounds, read from `quoteConfig`. Native ETH (address 0) is always a
// candidate; an ERC-20 is listed only where it is (or will be) on the allowlist.
//
// symbol and decimals here are for display before a read lands and for the
// creator-fee currencies a launch list does not name. A launch paired with a
// token missing from this list still works: useLaunchMarkets and
// useTokenLaunches read its symbol and decimals from the token itself.

/** The quote-token address that means native ETH (TokenLaunchpad.NATIVE). */
export const NATIVE_QUOTE = '0x0000000000000000000000000000000000000000';

/**
 * @typedef {Object} LaunchQuote
 * @property {string} address
 * @property {string} symbol
 * @property {number} decimals
 * @property {string[]} [buyPresets]  the buy panel's quick amounts, in whole units
 */

/** Quick buy amounts for a quote this file does not list. */
export const DEFAULT_BUY_PRESETS = Object.freeze(['1', '10', '100', '1000']);

/** @type {LaunchQuote} */
export const ETH_QUOTE = Object.freeze({
  address: NATIVE_QUOTE,
  symbol: 'ETH',
  decimals: 18,
  buyPresets: Object.freeze(['0.05', '0.1', '0.5', '1']),
});

/** @type {Record<string, LaunchQuote[]>} keyed by network key (LOCAL / TESTNET / MAINNET) */
const QUOTES_BY_NETWORK = {
  LOCAL: [ETH_QUOTE],
  TESTNET: [
    ETH_QUOTE,
    // Circle's USDC on Base Sepolia. Allowlisted at 2,500 – 2,500,000 USDC FDV.
    Object.freeze({
      address: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
      symbol: 'USDC',
      decimals: 6,
      buyPresets: Object.freeze(['10', '50', '100', '500']),
    }),
  ],
  MAINNET: [ETH_QUOTE],
};

/**
 * The candidate quote tokens for a network, ETH first.
 * @param {string | undefined} networkKey
 * @returns {LaunchQuote[]}
 */
export function getLaunchQuoteTokens(networkKey) {
  return QUOTES_BY_NETWORK[String(networkKey || '').toUpperCase()] ?? [ETH_QUOTE];
}

/** True for native ETH (address 0) — and for a missing quote, which predates the field. */
export function isNativeQuote(address) {
  return !address || /^0x0{40}$/i.test(String(address));
}

/**
 * The listed entry for a quote address on a network, or null when it is not listed.
 * ETH is always known.
 * @param {string | undefined} address
 * @param {string | undefined} networkKey
 * @returns {LaunchQuote | null}
 */
export function findLaunchQuote(address, networkKey) {
  if (isNativeQuote(address)) return ETH_QUOTE;
  const lc = String(address).toLowerCase();
  return getLaunchQuoteTokens(networkKey).find((q) => q.address.toLowerCase() === lc) ?? null;
}

/**
 * The quote a backend launchpad object names (token, trade, chart, activity
 * item): `quoteToken`, `quoteSymbol`, `quoteDecimals`. An object without them
 * predates quote tokens, when every launch was ETH-paired.
 * @param {{ quoteToken?: string, quoteSymbol?: string, quoteDecimals?: number } | null | undefined} obj
 * @returns {LaunchQuote}
 */
export function quoteFromApi(obj) {
  if (!obj || isNativeQuote(obj.quoteToken)) return ETH_QUOTE;
  return {
    address: obj.quoteToken,
    symbol: obj.quoteSymbol || '',
    decimals: Number(obj.quoteDecimals ?? 18),
  };
}
