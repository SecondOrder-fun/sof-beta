// src/lib/curveMath.js
// Utility functions for bonding curve math and slippage helpers

/**
 * Calculate simulated SOF returned for selling `amount` tokens across stepped curve.
 * @param {bigint} amount - ticket tokens to sell (BigInt)
 * @param {bigint} currentSupply - current total supply (BigInt)
 * @param {{price: bigint|number|string, rangeTo: bigint|number|string}[]} steps - ordered ascending steps
 * @returns {bigint}
 */
export function simSellCurve(amount, currentSupply, steps) {
  try {
    const amt = BigInt(amount ?? 0n);
    if (amt === 0n || !Array.isArray(steps) || steps.length === 0) return 0n;
    const supply = BigInt(currentSupply ?? 0n);
    if (amt > supply) return 0n;
    let targetSupply = supply - amt;
    let total = 0n;
    for (let i = steps.length - 1; i >= 0; i--) {
      const prevRangeTo = i === 0 ? 0n : BigInt(steps[i - 1].rangeTo);
      const stepEnd = BigInt(steps[i].rangeTo);
      const price = BigInt(steps[i].price);
      if (targetSupply >= stepEnd) continue;
      if (supply <= prevRangeTo) break;
      const sellStart = targetSupply > prevRangeTo ? targetSupply : prevRangeTo;
      const sellEnd = supply < stepEnd ? supply : stepEnd;
      const tokensInStep = sellEnd - sellStart;
      if (tokensInStep > 0n) total += tokensInStep * price;
    }
    return total;
  } catch {
    return 0n;
  }
}

/**
 * Calculate simulated SOF cost for buying `amount` tokens across stepped curve.
 * @param {bigint} amount - ticket tokens to buy (BigInt)
 * @param {bigint} currentSupply - current total supply (BigInt)
 * @param {{price: bigint|number|string, rangeTo: bigint|number|string}[]} steps - ordered ascending steps
 * @returns {bigint}
 */
export function simBuyCurve(amount, currentSupply, steps) {
  try {
    const amt = BigInt(amount ?? 0n);
    if (amt === 0n || !Array.isArray(steps) || steps.length === 0) return 0n;
    let current = BigInt(currentSupply ?? 0n);
    const target = current + amt;
    let total = 0n;
    for (let i = 0; i < steps.length; i++) {
      const prevRangeTo = i === 0 ? 0n : BigInt(steps[i - 1].rangeTo);
      const stepEnd = BigInt(steps[i].rangeTo);
      const price = BigInt(steps[i].price);
      if (current >= stepEnd) continue; // already past this step
      if (target <= prevRangeTo) break; // doesn't reach this step
      const buyStart = current > prevRangeTo ? current : prevRangeTo;
      const buyEnd = target < stepEnd ? target : stepEnd;
      const tokensInStep = buyEnd - buyStart;
      if (tokensInStep > 0n) total += tokensInStep * price;
    }
    return total;
  } catch {
    return 0n;
  }
}

/**
 * Compute minimum expected amount after slippage percent (string).
 * @param {bigint} estimate
 * @param {string|number} pctStr e.g. "1" for 1%
 * @returns {bigint}
 */
export function computeMinAfterSlippage(estimate, pctStr) {
  try {
    const est = BigInt(estimate ?? 0n);
    const pctFloat = Number.parseFloat(String(pctStr ?? '0'));
    if (!Number.isFinite(pctFloat) || pctFloat < 0) return est;
    const clamped = Math.max(0, Math.min(100, pctFloat));
    const bps = BigInt(Math.round(clamped * 100));
    const deduction = (est * bps) / 10000n;
    const minAmt = est - deduction;
    return minAmt < 0n ? 0n : minAmt;
  } catch {
    return BigInt(estimate ?? 0n);
  }
}

/**
 * Compute maximum spend including slippage percent (string).
 * @param {bigint} estimate
 * @param {string|number} pctStr
 * @returns {bigint}
 */
export function computeMaxWithSlippage(estimate, pctStr) {
  try {
    const est = BigInt(estimate ?? 0n);
    const pctFloat = Number.parseFloat(String(pctStr ?? '0'));
    if (!Number.isFinite(pctFloat) || pctFloat < 0) return est;
    const clamped = Math.max(0, Math.min(100, pctFloat));
    const bps = BigInt(Math.round(clamped * 100));
    const add = (est * bps) / 10000n;
    return est + add;
  } catch {
    return BigInt(estimate ?? 0n);
  }
}
