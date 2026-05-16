/**
 * Split a requested ticket purchase across rollover SOF + wallet SOF.
 *
 *   rolloverTickets   = floor(tokenAmount × rolloverEffectiveSof / estBuyWithFees)
 *   walletTopupTickets= tokenAmount − rolloverTickets
 *   walletTopupSofBase= ceil(estBuyWithFees × walletTopupTickets / tokenAmount)
 *
 * Rounds rolloverTickets DOWN so the curve is never under-paid; the wallet
 * top-up picks up the rounding slack.
 *
 * IMPORTANT: walletTopupSofBase must be proportional to the WALLET TICKET
 * COUNT, not to (estBuyWithFees − rolloverEffectiveSof). With a curve
 * buy-fee (e.g. 0.1%), the fee scales with each portion's base, so the
 * wallet's actual curve charge is (estBuyWithFees × walletTopupTickets
 * / tokenAmount). Subtracting rolloverEffectiveSof instead under-charges
 * the wallet by the fee on the rollover portion, causing buyTokens to
 * revert SlippageExceeded. (Live testnet repro:
 * `SlippageExceeded(6.006, 5.5146)`.)
 *
 * `walletTopupSofBase` is the pre-slippage SOF the wallet needs to cover.
 * The caller applies its slippage policy on top of this before passing
 * `walletTopupMaxSof` to executeBuy.
 *
 * @param {object} p
 * @param {bigint} p.tokenAmount - total tickets requested (base units)
 * @param {bigint} p.estBuyWithFees - SOF cost (wei) the curve will charge for tokenAmount
 * @param {bigint} p.rolloverEffectiveSof - SOF (wei) the curve sees from rollover funding
 *                                          (= user's spendFromRollover sofAmount + treasury bonus
 *                                          when bonus-eligible; just sofAmount when bps=0).
 *                                          Pass this — NOT the raw escrow-deducted SOF — so the
 *                                          ticket-split correctly reflects bonus-funded coverage.
 * @returns {{rolloverTickets: bigint, walletTopupTickets: bigint, walletTopupSofBase: bigint}}
 */
export function computeBuySplit({ tokenAmount, estBuyWithFees, rolloverEffectiveSof }) {
  if (tokenAmount <= 0n || estBuyWithFees <= 0n || rolloverEffectiveSof <= 0n) {
    return {
      rolloverTickets: 0n,
      walletTopupTickets: tokenAmount,
      walletTopupSofBase: estBuyWithFees,
    };
  }

  if (rolloverEffectiveSof >= estBuyWithFees) {
    return {
      rolloverTickets: tokenAmount,
      walletTopupTickets: 0n,
      walletTopupSofBase: 0n,
    };
  }

  const rolloverTickets = (tokenAmount * rolloverEffectiveSof) / estBuyWithFees;
  const walletTopupTickets = tokenAmount - rolloverTickets;
  // Ceiling division so the wallet portion's cap covers the curve's actual
  // per-ticket charge (BigInt division floors otherwise — would under-fund
  // the wallet by up to 1 wei on the last fractional ticket).
  const walletTopupSofBase =
    (estBuyWithFees * walletTopupTickets + tokenAmount - 1n) / tokenAmount;

  return { rolloverTickets, walletTopupTickets, walletTopupSofBase };
}
