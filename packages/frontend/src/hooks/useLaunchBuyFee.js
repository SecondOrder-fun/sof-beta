// src/hooks/useLaunchBuyFee.js
//
// The rate a buy in a launch's pool pays right now, live: the launch's trade fee,
// or more inside its snipe window (lib/v4PoolMath buyFeeAt, from the schedule
// useLaunchMarkets reads with snipeTaxOf). Computed here rather than read with
// currentBuyFeeOf, so it moves every second between the market's 15 s polls.
//
// The clock is the chain's: the backend's latest block time (useChainTimeAnchor),
// run forward on the wall clock between polls; the wall clock alone until that
// arrives. A local clock can be off by anything, and a quote from a clock AHEAD of
// the chain would charge too little.
//
// Which way to err. The rate only ever falls with time, and a buy is charged at
// the block it lands in — after the quote, at a rate no higher than the one
// quoted. So the rate at the latest known chain time is already an upper bound;
// SNIPE_CLOCK_MARGIN_SEC more behind it covers a clock that is a block or so
// ahead (Base blocks are 2 s; the rate steps every second). Quoting high only
// makes the tokens-out estimate, and the minimum-out from it, low: the trade
// fills and delivers more. Quoting low would set a minimum-out above the fill
// and the buy would revert. The countdown runs on the same clock, so the warning
// clears exactly when the quoted rate reaches the trade fee.

import { useEffect, useState } from 'react';

import { useChainTimeAnchor } from '@/hooks/useChainTime';
import { buyFeeAt, snipeWindowEnd } from '@/lib/v4PoolMath';

/** Seconds the quoting clock is held behind the chain's, so a buy is never quoted below its rate. */
export const SNIPE_CLOCK_MARGIN_SEC = 2;
/** How long after the window (by the wall clock) to keep reading chain time, for a fast local clock. */
const CLOCK_SKEW_SLACK_SEC = 600;

/**
 * @param {{ tradeFee?: number, snipeTax?: { startBps: number, duration: number, launchedAt: number } | null } | null | undefined} market
 *   from useLaunchMarkets
 * @returns {{
 *   buyFee: number | null,
 *   snipe: { rate: number, endsInSec: number } | null,
 * }} `buyFee` in pips, null without a market; `snipe` while the window is open:
 *   the rate (= buyFee) and the seconds until it is the trade fee
 */
export function useLaunchBuyFee(market) {
  const tradeFee = market?.tradeFee ?? null;
  const snipeTax = market?.snipeTax ?? null;
  const end = tradeFee == null ? null : snipeWindowEnd(tradeFee, snipeTax);

  const [wallMs, setWallMs] = useState(() => Date.now());
  const anchor = useChainTimeAnchor({ enabled: end != null && wallMs / 1000 < end + CLOCK_SKEW_SLACK_SEC });
  const chainNow = anchor
    ? anchor.timestamp + Math.max(0, wallMs - anchor.receivedAtMs) / 1000
    : wallMs / 1000;
  const quoteAt = Math.floor(chainNow) - SNIPE_CLOCK_MARGIN_SEC;
  const open = end != null && quoteAt < end;

  // Tick only while the rate is moving; time only runs forward, so once closed it stays so.
  useEffect(() => {
    if (!open) return undefined;
    const id = setInterval(() => setWallMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [open]);

  if (tradeFee == null) return { buyFee: null, snipe: null };
  const buyFee = buyFeeAt(tradeFee, snipeTax, quoteAt);
  return { buyFee, snipe: open ? { rate: buyFee, endsInSec: end - quoteAt } : null };
}
