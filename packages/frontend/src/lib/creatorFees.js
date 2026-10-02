// src/lib/creatorFees.js
//
// Creator fees: what a launch's fee recipient has earned, and the calls that
// claim or hand it on. Pure, so every zero / non-zero combination is tested
// without a chain (tests/lib/creatorFees.test.js).
//
// How the placer (UniV4LiquidityPlacer) pays fees:
//   - Swap fees accrue to the LP position the placer owns, in ETH (buys) and
//     the launch token (sells). `collectFees(token)` — permissionless — moves
//     them out of the pool and credits CREATOR_FEE_BPS (88%) to the launch's
//     current fee recipient, the rest to the treasury, floored per side.
//   - Credits are keyed by account, and claimed by THAT account as msg.sender:
//     `claimEth(to)` takes the caller's ETH from every launch on the placer
//     (pooled), `claimToken(token, to)` the caller's fees in one token. Both
//     revert NothingToClaim on zero, so a call is only built when the amount
//     it will find is non-zero.
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

const BPS = 10_000n;
const ONE_TOKEN = 10n ** 18n;

/** Case-insensitive address equality; false when either side is missing. */
export const sameAddress = (a, b) => Boolean(a && b) && String(a).toLowerCase() === String(b).toLowerCase();

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
export const claimEthCall = (placer, to) => call(placer, 'claimEth', [to]);
export const claimTokenCall = (placer, token, to) => call(placer, 'claimToken', [token, to]);
export const setFeeRecipientCall = (placer, token, recipient) =>
  call(placer, 'setFeeRecipient', [token, recipient]);

/**
 * @typedef {Object} LaunchFees  one launch, as useCreatorFees reads it
 * @property {string} token
 * @property {string} placer                 TokenLaunchpad.placerOf(token)
 * @property {string | null} recipient       feeRecipientOf(token)
 * @property {Record<string, bigint>} claimableToken  lowercased account -> credited tokens
 * @property {bigint | null} uncollectedEth  a simulated collectFees, whole (both
 * @property {bigint | null} uncollectedTokens shares); null when it would revert
 *
 * @typedef {Object} PlacerFees
 * @property {string} address
 * @property {bigint} creatorFeeBps
 * @property {Record<string, bigint>} claimableEth  lowercased account -> credited ETH
 */

const lc = (a) => String(a).toLowerCase();

/**
 * What `account` has earned from one launch, as the token page shows it.
 * ETH is pooled per placer, so `ethClaimable` is the account's ETH from every
 * launch on that placer — it is what claimEth will send.
 *
 * @param {LaunchFees} launch
 * @param {PlacerFees} placerFees
 * @param {string} account
 */
export function launchEarnings(launch, placerFees, account) {
  const bps = placerFees?.creatorFeeBps ?? 0n;
  const isRecipient = sameAddress(launch.recipient, account);
  const ethClaimable = placerFees?.claimableEth?.[lc(account)] ?? 0n;
  const tokensClaimable = launch.claimableToken?.[lc(account)] ?? 0n;
  // Uncollected fees will be credited to whoever is the recipient when they are
  // collected, so they count only for the current recipient.
  const ethInPool = isRecipient ? recipientShare(launch.uncollectedEth, bps) : 0n;
  const tokensInPool = isRecipient ? recipientShare(launch.uncollectedTokens, bps) : 0n;
  return {
    isRecipient,
    ethClaimable,
    tokensClaimable,
    ethInPool,
    tokensInPool,
    eth: ethClaimable + ethInPool,
    tokens: tokensClaimable + tokensInPool,
  };
}

const hasUncollected = (launch) => (launch.uncollectedEth ?? 0n) > 0n || (launch.uncollectedTokens ?? 0n) > 0n;

/**
 * The token page's claim: [collectFees] + [claimEth] + [claimToken], each only
 * when it does something — collect when the pool holds fees, a claim only when
 * the amount it will find is non-zero (else NothingToClaim reverts the batch).
 *
 * @param {LaunchFees} launch
 * @param {PlacerFees} placerFees
 * @param {string} account  the claimant: the batch must be sent from it
 */
export function buildLaunchClaimCalls(launch, placerFees, account) {
  const earned = launchEarnings(launch, placerFees, account);
  const calls = [];
  if (earned.isRecipient && hasUncollected(launch)) calls.push(collectFeesCall(launch.placer, launch.token));
  if (earned.eth > 0n) calls.push(claimEthCall(launch.placer, account));
  if (earned.tokens > 0n) calls.push(claimTokenCall(launch.placer, launch.token, account));
  return { calls, eth: earned.eth, tokens: earned.tokens };
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
 * The profile's "Claim all ETH": one batch that, per placer, collects every
 * launch whose pool holds ETH for `account`, then claims. The batch must be
 * sent from `account`, the claimant.
 *
 * @param {{ launches: LaunchFees[], placers: Record<string, PlacerFees> }} fees
 * @param {string | null | undefined} account
 * @returns {{ calls: object[], eth: bigint }} no calls when there is nothing to claim
 */
export function planClaimAllEth({ launches, placers }, account) {
  const calls = [];
  let eth = 0n;
  if (!account) return { calls, eth };
  for (const placerFees of Object.values(placers)) {
    const placer = placerFees.address;
    let expected = placerFees.claimableEth?.[lc(account)] ?? 0n;
    const collects = [];
    for (const launch of launches) {
      if (!sameAddress(launch.placer, placer) || !sameAddress(launch.recipient, account)) continue;
      if ((launch.uncollectedEth ?? 0n) <= 0n) continue;
      expected += recipientShare(launch.uncollectedEth, placerFees.creatorFeeBps);
      collects.push(collectFeesCall(launch.placer, launch.token));
    }
    if (expected <= 0n) continue;
    calls.push(...collects, claimEthCall(placer, account));
    eth += expected;
  }
  return { calls, eth };
}

/**
 * The profile's per-launch "Claim {SYMBOL}": [collectFees if the pool holds
 * tokens for `account`] + claimToken, when `account` has fees in this token.
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
  calls.push(claimTokenCall(launch.placer, launch.token, account));
  return { calls, tokens: earned.tokens };
}

/**
 * The profile's totals and rows. A launch is listed while `account` earns from
 * it (it is the current recipient) or still holds tokens credited from it —
 * handing fees on does not move what was already credited.
 *
 * @param {{ launches: LaunchFees[], placers: Record<string, PlacerFees> }} fees
 * @param {string | null | undefined} account
 */
export function summarizeCreatorFees({ launches, placers }, account) {
  let ethInPool = 0n;
  let ethCollected = 0n;
  const rows = [];
  if (!account) return { rows, ethCollected, ethInPool, eth: 0n };
  for (const launch of launches) {
    const placerFees = placers[lc(launch.placer)];
    const earned = launchEarnings(launch, placerFees, account);
    if (!earned.isRecipient && earned.tokens === 0n) continue;
    ethInPool += earned.ethInPool;
    rows.push({ launch, isRecipient: earned.isRecipient, ethInPool: earned.ethInPool, tokens: earned.tokens });
  }
  for (const placerFees of Object.values(placers)) {
    ethCollected += placerFees.claimableEth?.[lc(account)] ?? 0n;
  }
  return { rows, ethCollected, ethInPool, eth: ethCollected + ethInPool };
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
