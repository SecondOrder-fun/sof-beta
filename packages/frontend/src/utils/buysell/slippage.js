/**
 * Slippage Calculation Utilities
 * Shared logic for applying slippage tolerance to buy/sell estimates
 */

/**
 * Apply maximum slippage tolerance (for buy operations)
 * @param {bigint} amountWei - Base amount in wei
 * @param {string} slippagePct - Slippage percentage as string (e.g., "1" for 1%)
 * @returns {bigint} Amount with slippage applied
 */
export function applyMaxSlippage(amountWei, slippagePct) {
  try {
    const pct = Number(slippagePct || "0");
    const bps = Math.max(0, Math.min(10000, Math.floor(pct * 100)));
    return amountWei + (amountWei * BigInt(bps)) / 10000n;
  } catch {
    return amountWei;
  }
}

/**
 * Apply minimum slippage tolerance (for sell operations)
 * @param {bigint} amountWei - Base amount in wei
 * @param {string} slippagePct - Slippage percentage as string (e.g., "1" for 1%)
 * @returns {bigint} Amount with slippage applied
 */
export function applyMinSlippage(amountWei, slippagePct) {
  try {
    const pct = Number(slippagePct || "0");
    const bps = Math.max(0, Math.min(10000, Math.floor(pct * 100)));
    return amountWei - (amountWei * BigInt(bps)) / 10000n;
  } catch {
    return amountWei;
  }
}

/**
 * Calculate estimated cost with fees
 * @param {bigint} baseAmount - Base amount before fees
 * @param {number} feeBps - Fee in basis points
 * @returns {bigint} Total amount including fees
 */
export function calculateAmountWithFees(baseAmount, feeBps) {
  if (!baseAmount) return 0n;
  return baseAmount + (baseAmount * BigInt(feeBps)) / 10000n;
}

/**
 * Calculate estimated proceeds after fees
 * @param {bigint} baseAmount - Base amount before fees
 * @param {number} feeBps - Fee in basis points
 * @returns {bigint} Net amount after fees deducted
 */
export function calculateAmountAfterFees(baseAmount, feeBps) {
  if (!baseAmount) return 0n;
  const fee = (baseAmount * BigInt(feeBps)) / 10000n;
  if (fee > baseAmount) return 0n;
  return baseAmount - fee;
}
