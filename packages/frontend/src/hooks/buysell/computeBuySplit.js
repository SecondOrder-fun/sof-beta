/**
 * Split a requested ticket purchase across rollover SOF + wallet SOF.
 *
 *   rolloverTickets   = floor(tokenAmount × rolloverAmount / estBuyWithFees)
 *   walletTopupTickets= tokenAmount − rolloverTickets
 *   walletTopupSofBase= estBuyWithFees − rolloverAmount      (positive only)
 *
 * Rounds rolloverTickets DOWN so the curve is never under-paid; the wallet
 * top-up picks up the rounding slack.
 *
 * `walletTopupSofBase` is the pre-slippage SOF the wallet needs to cover.
 * The caller applies its slippage policy on top of this before passing
 * `walletTopupMaxSof` to executeBuy.
 *
 * @param {object} p
 * @param {bigint} p.tokenAmount - total tickets requested (base units)
 * @param {bigint} p.estBuyWithFees - SOF cost (wei) the curve will charge for tokenAmount
 * @param {bigint} p.rolloverAmount - SOF (wei) the user wants to draw from rollover
 * @returns {{rolloverTickets: bigint, walletTopupTickets: bigint, walletTopupSofBase: bigint}}
 */
export function computeBuySplit({ tokenAmount, estBuyWithFees, rolloverAmount }) {
  if (tokenAmount <= 0n || estBuyWithFees <= 0n || rolloverAmount <= 0n) {
    return {
      rolloverTickets: 0n,
      walletTopupTickets: tokenAmount,
      walletTopupSofBase: estBuyWithFees,
    };
  }

  if (rolloverAmount >= estBuyWithFees) {
    return {
      rolloverTickets: tokenAmount,
      walletTopupTickets: 0n,
      walletTopupSofBase: 0n,
    };
  }

  const rolloverTickets = (tokenAmount * rolloverAmount) / estBuyWithFees;
  const walletTopupTickets = tokenAmount - rolloverTickets;
  const walletTopupSofBase = estBuyWithFees - rolloverAmount;

  return { rolloverTickets, walletTopupTickets, walletTopupSofBase };
}
