// src/lib/creatorFees.js
//
// Creator fees: what a launch's fee recipient has earned, and the calls that
// claim or hand it on. Pure, so every zero / non-zero combination is tested
// without a chain (tests/lib/creatorFees.test.js).
//
// How the placer (UniV4LiquidityPlacer) pays fees:
//   - The placer is each launch pool's v4 hook and takes the launch's trade fee on
//     every buy and sell, always in the launch's QUOTE token (ETH or an
//     allowlisted ERC-20 such as USDC) — never in the launch token. Taken fees
//     wait in `pendingFees(token)` until `collectFees(token)` — permissionless —
//     credits CREATOR_FEE_BPS (88%) of them to the launch's current fee
//     recipient and the rest to the treasury, the recipient's share floored.
//     An early buy's snipe tax (its rate above the trade fee) waits apart, in
//     `pendingSurcharge`, and goes to the treasury alone, so it is never in
//     pendingFees or a recipient's share.
//   - Credits are per currency and account (`claimable(currency, account)`,
//     address 0 = ETH), and claimed by THAT account as msg.sender with
//     `claim(currency, to)`. A quote currency's credits pool across every launch
//     on the placer paired with it, so one claim takes them all. `claim` reverts
//     NothingToClaim on zero, so a call is only built when the amount it will
//     find is non-zero.
//
// So "earned" = already credited + the recipient's floored share of
// pendingFees, and a claim batch collects first.
//
// Who sends the batch matters (msg.sender is the claimant). useSmartTransactions
// sends from the connected wallet, so the in-app claimant is always that
// address: every plan below is built for it.

import { encodeFunctionData, isAddress } from 'viem';
import { UniV4LiquidityPlacerAbi } from '@/utils/abis';
import { NATIVE_QUOTE, isNativeQuote } from '@/config/launchQuoteTokens';

const BPS = 10_000n;

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
/** Claim the caller's credits in `currency` (address 0 = ETH, else the ERC-20 quote). */
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
 * @property {bigint | null} pendingFees     pendingFees(token): taken, not yet collected
 *                                           (both shares), in the quote; null when unread
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

const hasPending = (launch) => (launch.pendingFees ?? 0n) > 0n;

/**
 * What `account` has earned from one launch, as the token page shows it — all in
 * the launch's quote. Credits are pooled per currency per placer, so
 * `quoteClaimable` is the account's credits in this launch's quote from every
 * launch on that placer paired with it — what claim(quote) will send.
 *
 * @param {LaunchFees} launch
 * @param {PlacerFees} placerFees
 * @param {string} account
 */
export function launchEarnings(launch, placerFees, account) {
  const bps = placerFees?.creatorFeeBps ?? 0n;
  const isRecipient = sameAddress(launch.recipient, account);
  const quoteClaimable = creditedIn(placerFees, launch.quoteToken, account);
  // Pending fees will be credited to whoever is the recipient when they are
  // collected, so they count only for the current recipient.
  const quotePending = isRecipient ? recipientShare(launch.pendingFees, bps) : 0n;
  return { isRecipient, quoteClaimable, quotePending, quote: quoteClaimable + quotePending };
}

/**
 * The token page's claim: [collectFees] + [claim(quote)], each only when it does
 * something — collect when fees are pending, the claim only when the amount it
 * will find is non-zero (else NothingToClaim reverts the batch).
 *
 * @param {LaunchFees} launch
 * @param {PlacerFees} placerFees
 * @param {string} account  the claimant: the batch must be sent from it
 */
export function buildLaunchClaimCalls(launch, placerFees, account) {
  const earned = launchEarnings(launch, placerFees, account);
  const calls = [];
  if (earned.isRecipient && hasPending(launch)) calls.push(collectFeesCall(launch.placer, launch.token));
  if (earned.quote > 0n) calls.push(claimCall(launch.placer, launch.quoteToken, account));
  return { calls, quote: earned.quote };
}

/**
 * Hand a launch's future fees to `newRecipient`. Collects first when fees are
 * pending: collectFees credits whoever is the recipient AT collection, so
 * without it fees earned before the transfer would go to the new address.
 *
 * @param {LaunchFees} launch
 * @param {string} newRecipient
 */
export function buildTransferCalls(launch, newRecipient) {
  const calls = [];
  if (hasPending(launch)) calls.push(collectFeesCall(launch.placer, launch.token));
  calls.push(setFeeRecipientCall(launch.placer, launch.token, newRecipient));
  return calls;
}

/**
 * The profile's "Claim all <SYMBOL>" for one quote currency: one batch that, per
 * placer, collects every launch paired with `currency` that has fees pending for
 * `account` (it is the recipient), then claims that currency. The batch must be
 * sent from `account`, the claimant.
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
      if (!hasPending(launch)) continue;
      expected += recipientShare(launch.pendingFees, placerFees.creatorFeeBps);
      collects.push(collectFeesCall(launch.placer, launch.token));
    }
    if (expected <= 0n) continue;
    calls.push(...collects, claimCall(placer, currency, account));
    amount += expected;
  }
  return { calls, amount };
}

/**
 * The profile's totals and rows. A launch is listed while `account` is its fee
 * recipient: fees already collected sit in the per-currency balances, not with
 * the launch, so one handed on has nothing left to show.
 *
 * Quote fees are totalled per currency: one entry for each quote a listed
 * launch is paired with, plus any other currency the account has collected
 * credits in — ETH first, then in order of appearance.
 *
 * @param {{ launches: LaunchFees[], placers: Record<string, PlacerFees> }} fees
 * @param {string | null | undefined} account
 * @returns {{
 *   rows: { launch: LaunchFees, quotePending: bigint }[],
 *   currencies: { currency: string, collected: bigint, pending: bigint, total: bigint, launchCount: number }[],
 * }}
 */
export function summarizeCreatorFees({ launches, placers }, account) {
  const rows = [];
  /** @type {Map<string, { currency: string, collected: bigint, pending: bigint, total: bigint, launchCount: number }>} */
  const byCurrency = new Map();
  const entry = (currency) => {
    const key = currencyKey(currency);
    if (!byCurrency.has(key)) byCurrency.set(key, { currency: key, collected: 0n, pending: 0n, total: 0n, launchCount: 0 });
    return byCurrency.get(key);
  };
  if (!account) return { rows, currencies: [] };

  for (const launch of launches) {
    const placerFees = placers[lc(launch.placer)];
    const earned = launchEarnings(launch, placerFees, account);
    if (!earned.isRecipient) continue;
    const e = entry(launch.quoteToken);
    e.pending += earned.quotePending;
    e.launchCount += 1;
    rows.push({ launch, quotePending: earned.quotePending });
  }
  for (const placerFees of Object.values(placers)) {
    for (const [currency, byAccount] of Object.entries(placerFees.claimable ?? {})) {
      const amount = byAccount?.[lc(account)] ?? 0n;
      if (amount > 0n) entry(currency).collected += amount;
    }
  }

  const currencies = [...byCurrency.values()]
    .map((e) => ({ ...e, total: e.collected + e.pending }))
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
