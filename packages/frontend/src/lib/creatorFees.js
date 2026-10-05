// src/lib/creatorFees.js
//
// Creator fees: what a launch's fee recipient has earned, and the calls that
// claim or hand it on. Pure, so every zero / non-zero combination is tested
// without a chain (tests/lib/creatorFees.test.js).
//
// How the placer (UniV4LiquidityPlacer) pays fees:
//   - Swap fees accrue to the LP position the placer owns, in the launch's QUOTE
//     token (buys: ETH or an allowlisted ERC-20 such as USDC) and the launch token
//     (sells). `collectFees(token)` — permissionless — moves them out of the pool
//     and credits CREATOR_FEE_BPS (88%) to the launch's current fee recipient,
//     the rest to the treasury, floored per side.
//   - Credits are per currency and account (`claimable(currency, account)`,
//     address 0 = ETH), and claimed by THAT account as msg.sender with
//     `claim(currency, to)`. A quote currency's credits pool across every launch
//     on the placer paired with it, so one claim takes them all; each launch
//     token is its own currency. `claim` reverts NothingToClaim on zero, so a
//     call is only built when the amount it will find is non-zero.
//
// So "earned" = already credited + the recipient's floored share of what a
// simulated collectFees would pay out now, and a claim batch collects first.
//
// Who sends the batch matters (msg.sender is the claimant). useSmartTransactions
// sends from the connected wallet, so the in-app claimant is always that
// address: every plan below is built for it.

import { encodeFunctionData, isAddress } from 'viem';
import { UniV4LiquidityPlacerAbi } from '@/utils/abis';
import { formatSupply, formatTokenAmount } from '@/lib/launchFormat';
import { NATIVE_QUOTE, isNativeQuote } from '@/config/launchQuoteTokens';

const BPS = 10_000n;
const ONE_TOKEN = 10n ** 18n;

/** Case-insensitive address equality; false when either side is missing. */
export const sameAddress = (a, b) => Boolean(a && b) && String(a).toLowerCase() === String(b).toLowerCase();

/** A currency's key in the claimable maps: lowercased, with ETH as the zero address. */
export const currencyKey = (currency) => (isNativeQuote(currency) ? NATIVE_QUOTE : String(currency).toLowerCase());

/**
 * The fee recipient's share of a collection, floored exactly as the placer does.
 * @param {bigint | null | undefined} amount
 * @param {bigint} bps CREATOR_FEE_BPS read from the placer
 */
export function recipientShare(amount, bps) {
  if (!amount || amount <= 0n || !bps) return 0n;
  return (amount * bps) / BPS;
}

const call = (to, functionName, args) => ({
  to,
  data: encodeFunctionData({ abi: UniV4LiquidityPlacerAbi, functionName, args }),
});

export const collectFeesCall = (placer, token) => call(placer, 'collectFees', [token]);
/** Claim the caller's credits in `currency` (address 0 = ETH, else an ERC-20 or a launch token). */
export const claimCall = (placer, currency, to) =>
  call(placer, 'claim', [isNativeQuote(currency) ? NATIVE_QUOTE : currency, to]);
export const setFeeRecipientCall = (placer, token, recipient) =>
  call(placer, 'setFeeRecipient', [token, recipient]);

/**
 * @typedef {Object} LaunchFees  one launch, as useCreatorFees reads it
 * @property {string} token
 * @property {string} placer                 TokenLaunchpad.placerOf(token)
 * @property {string} quoteToken             TokenLaunchpad.quoteTokenOf(token); address 0 = ETH
 * @property {string | null} recipient       feeRecipientOf(token)
 * @property {Record<string, bigint>} claimableTokens  lowercased account -> credited launch tokens
 * @property {bigint | null} uncollectedQuote  a simulated collectFees, whole (both
 * @property {bigint | null} uncollectedTokens shares); null when it would revert
 *
 * @typedef {Object} PlacerFees
 * @property {string} address
 * @property {bigint} creatorFeeBps
 * @property {Record<string, Record<string, bigint>>} claimable
 *   currencyKey -> lowercased account -> credited amount, for the quote currencies read
 */

const lc = (a) => String(a).toLowerCase();

/** What `account` has credited in `currency` on a placer. */
const creditedIn = (placerFees, currency, account) =>
  placerFees?.claimable?.[currencyKey(currency)]?.[lc(account)] ?? 0n;

/**
 * What `account` has earned from one launch, as the token page shows it.
 * The quote side is pooled per currency per placer, so `quoteClaimable` is the
 * account's credits in this launch's quote from every launch on that placer
 * paired with it — what claim(quote) will send.
 *
 * @param {LaunchFees} launch
 * @param {PlacerFees} placerFees
 * @param {string} account
 */
export function launchEarnings(launch, placerFees, account) {
  const bps = placerFees?.creatorFeeBps ?? 0n;
  const isRecipient = sameAddress(launch.recipient, account);
  const quoteClaimable = creditedIn(placerFees, launch.quoteToken, account);
  const tokensClaimable = launch.claimableTokens?.[lc(account)] ?? 0n;
  // Uncollected fees will be credited to whoever is the recipient when they are
  // collected, so they count only for the current recipient.
  const quoteInPool = isRecipient ? recipientShare(launch.uncollectedQuote, bps) : 0n;
  const tokensInPool = isRecipient ? recipientShare(launch.uncollectedTokens, bps) : 0n;
  return {
    isRecipient,
    quoteClaimable,
    tokensClaimable,
    quoteInPool,
    tokensInPool,
    quote: quoteClaimable + quoteInPool,
    tokens: tokensClaimable + tokensInPool,
  };
}

const hasUncollected = (launch) => (launch.uncollectedQuote ?? 0n) > 0n || (launch.uncollectedTokens ?? 0n) > 0n;

/**
 * The token page's claim: [collectFees] + [claim(quote)] + [claim(token)], each
 * only when it does something — collect when the pool holds fees, a claim only
 * when the amount it will find is non-zero (else NothingToClaim reverts the batch).
 *
 * @param {LaunchFees} launch
 * @param {PlacerFees} placerFees
 * @param {string} account  the claimant: the batch must be sent from it
 */
export function buildLaunchClaimCalls(launch, placerFees, account) {
  const earned = launchEarnings(launch, placerFees, account);
  const calls = [];
  if (earned.isRecipient && hasUncollected(launch)) calls.push(collectFeesCall(launch.placer, launch.token));
  if (earned.quote > 0n) calls.push(claimCall(launch.placer, launch.quoteToken, account));
  if (earned.tokens > 0n) calls.push(claimCall(launch.placer, launch.token, account));
  return { calls, quote: earned.quote, tokens: earned.tokens };
}

/**
 * Hand a launch's future fees to `newRecipient`. Collects first when the pool
 * holds fees: collectFees credits whoever is the recipient AT collection, so
 * without it fees earned before the transfer would go to the new address.
 *
 * @param {LaunchFees} launch
 * @param {string} newRecipient
 */
export function buildTransferCalls(launch, newRecipient) {
  const calls = [];
  if (hasUncollected(launch)) calls.push(collectFeesCall(launch.placer, launch.token));
  calls.push(setFeeRecipientCall(launch.placer, launch.token, newRecipient));
  return calls;
}

/**
 * The profile's "Claim all <SYMBOL>" for one quote currency: one batch that, per
 * placer, collects every launch paired with `currency` whose pool holds quote
 * fees for `account`, then claims that currency. The batch must be sent from
 * `account`, the claimant.
 *
 * @param {{ launches: LaunchFees[], placers: Record<string, PlacerFees> }} fees
 * @param {string | null | undefined} account
 * @param {string} currency  address 0 for ETH
 * @returns {{ calls: object[], amount: bigint }} no calls when there is nothing to claim
 */
export function planClaimAllQuote({ launches, placers }, account, currency) {
  const calls = [];
  let amount = 0n;
  if (!account) return { calls, amount };
  for (const placerFees of Object.values(placers)) {
    const placer = placerFees.address;
    let expected = creditedIn(placerFees, currency, account);
    const collects = [];
    for (const launch of launches) {
      if (!sameAddress(launch.placer, placer) || !sameAddress(launch.recipient, account)) continue;
      if (currencyKey(launch.quoteToken) !== currencyKey(currency)) continue;
      if ((launch.uncollectedQuote ?? 0n) <= 0n) continue;
      expected += recipientShare(launch.uncollectedQuote, placerFees.creatorFeeBps);
      collects.push(collectFeesCall(launch.placer, launch.token));
    }
    if (expected <= 0n) continue;
    calls.push(...collects, claimCall(placer, currency, account));
    amount += expected;
  }
  return { calls, amount };
}

/**
 * The profile's per-launch "Claim {SYMBOL}": [collectFees if the pool holds
 * tokens for `account`] + claim(token), when `account` has fees in this token.
 *
 * @param {LaunchFees} launch
 * @param {PlacerFees} placerFees
 * @param {string | null | undefined} account
 * @returns {{ calls: object[], tokens: bigint }} no calls when there is nothing to claim
 */
export function planClaimToken(launch, placerFees, account) {
  const calls = [];
  if (!account) return { calls, tokens: 0n };
  const earned = launchEarnings(launch, placerFees, account);
  if (earned.tokens <= 0n) return { calls, tokens: 0n };
  if (earned.isRecipient && (launch.uncollectedTokens ?? 0n) > 0n) {
    calls.push(collectFeesCall(launch.placer, launch.token));
  }
  calls.push(claimCall(launch.placer, launch.token, account));
  return { calls, tokens: earned.tokens };
}

/**
 * The profile's totals and rows. A launch is listed while `account` earns from
 * it (it is the current recipient) or still holds tokens credited from it —
 * handing fees on does not move what was already credited.
 *
 * Quote fees are totalled per currency: one entry for each quote a listed
 * launch is paired with, plus any other currency the account has collected
 * credits in — ETH first, then in order of appearance.
 *
 * @param {{ launches: LaunchFees[], placers: Record<string, PlacerFees> }} fees
 * @param {string | null | undefined} account
 * @returns {{
 *   rows: { launch: LaunchFees, isRecipient: boolean, quoteInPool: bigint, tokens: bigint }[],
 *   currencies: { currency: string, collected: bigint, inPool: bigint, total: bigint, launchCount: number }[],
 * }}
 */
export function summarizeCreatorFees({ launches, placers }, account) {
  const rows = [];
  /** @type {Map<string, { currency: string, collected: bigint, inPool: bigint, total: bigint, launchCount: number }>} */
  const byCurrency = new Map();
  const entry = (currency) => {
    const key = currencyKey(currency);
    if (!byCurrency.has(key)) byCurrency.set(key, { currency: key, collected: 0n, inPool: 0n, total: 0n, launchCount: 0 });
    return byCurrency.get(key);
  };
  if (!account) return { rows, currencies: [] };

  for (const launch of launches) {
    const placerFees = placers[lc(launch.placer)];
    const earned = launchEarnings(launch, placerFees, account);
    if (!earned.isRecipient && earned.tokens === 0n) continue;
    const e = entry(launch.quoteToken);
    e.inPool += earned.quoteInPool;
    e.launchCount += 1;
    rows.push({ launch, isRecipient: earned.isRecipient, quoteInPool: earned.quoteInPool, tokens: earned.tokens });
  }
  for (const placerFees of Object.values(placers)) {
    for (const [currency, byAccount] of Object.entries(placerFees.claimable ?? {})) {
      const amount = byAccount?.[lc(account)] ?? 0n;
      if (amount > 0n) entry(currency).collected += amount;
    }
  }

  const currencies = [...byCurrency.values()]
    .map((e) => ({ ...e, total: e.collected + e.inPool }))
    .sort((a, b) => (a.currency === NATIVE_QUOTE ? -1 : b.currency === NATIVE_QUOTE ? 1 : 0));
  return { rows, currencies };
}

/**
 * Check a typed new fee recipient the way setFeeRecipient will, so the dialog
 * never sends a transfer that reverts (ZeroAddress) or does nothing.
 * @param {string} input
 * @param {string | null | undefined} current  the current recipient
 * @returns {'invalid' | 'zero' | 'same' | null} an error key, or null when valid
 */
export function validateNewRecipient(input, current) {
  const value = String(input ?? '').trim();
  if (!isAddress(value)) return 'invalid';
  if (/^0x0{40}$/i.test(value)) return 'zero';
  if (sameAddress(value, current)) return 'same';
  return null;
}

/**
 * Fee amounts in a launch token: abbreviated like supply ("1.24M"), but a
 * fraction of a token keeps its decimals instead of reading "0".
 * @param {bigint | null | undefined} raw
 */
export function formatFeeTokens(raw) {
  if (raw == null) return '—';
  return raw > 0n && raw < ONE_TOKEN ? formatTokenAmount(raw, 4) : formatSupply(raw);
}
