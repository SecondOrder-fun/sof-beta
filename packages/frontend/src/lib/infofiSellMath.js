// src/lib/infofiSellMath.js
//
// Selling outcome shares back to a SimpleFPMM. The contract's sell takes the exact
// collateral to receive (`sell(sellYes, amountOut, maxAmountIn)`) and works out the
// shares it needs with calcSellAmount:
//
//   amountOutPlusFee = amountOut × 10000 / (10000 − FEE_BPS)
//   sellYes: newNo = no − amountOutPlusFee;  sharesIn = k / newNo − yes   (k = yes × no)
//   sellNo:  newYes = yes − amountOutPlusFee; sharesIn = k / newYes − no
//
// People think in shares ("sell my 10 YES"), so the form takes a share count and this
// inverts that: the collateral those shares fetch, rounded down at each step so the
// contract never needs more shares than were offered.

/**
 * Collateral (net of the fee) that selling `sharesIn` would pay out, in raw units.
 * @param {{ yesReserve: bigint, noReserve: bigint, feeBps: bigint, sellYes: boolean, sharesIn: bigint }} p
 * @returns {bigint}
 */
export function quoteSellCollateral({ yesReserve, noReserve, feeBps, sellYes, sharesIn }) {
  if (sharesIn <= 0n || yesReserve <= 0n || noReserve <= 0n) return 0n;
  const k = yesReserve * noReserve;
  const [same, other] = sellYes ? [yesReserve, noReserve] : [noReserve, yesReserve];
  const newSame = same + sharesIn;
  // Round the other side's new reserve UP, so the pay-out it implies rounds down.
  const newOther = (k + newSame - 1n) / newSame;
  if (newOther >= other) return 0n;
  const outPlusFee = other - newOther;
  return (outPlusFee * (10000n - feeBps)) / 10000n;
}

/**
 * The collateral to ask the contract for: the quote less the slippage allowance.
 * Asking for less means the contract takes fewer shares than offered, so a price
 * moved by someone else's trade still fills within `sharesIn`.
 * @param {bigint} quote
 * @param {number} slippageBps
 * @returns {bigint}
 */
export function minCollateralOut(quote, slippageBps) {
  if (quote <= 0n) return 0n;
  return (quote * (10000n - BigInt(slippageBps))) / 10000n;
}
