/**
 * useBalanceValidation Hook
 * Validates SOF balance against required amounts for buy operations.
 * When a rollover deposit is available + enabled, callers pass
 * `rolloverEffectiveAmount` (base + bonus) and the effective available
 * balance becomes wallet + rollover for purposes of the insufficient check.
 */

import { useMemo } from "react";
import { parseUnits } from "viem";

/**
 * @param {string}  sofBalance              current wallet SOF balance as string
 * @param {number}  sofDecimals             SOF token decimals
 * @param {bigint}  requiredAmount          required amount in wei
 * @param {boolean} isBalanceLoading        whether balance is still loading
 * @param {bigint}  [rolloverEffectiveAmount=0n] rollover SOF (base + bonus)
 * @returns {{hasInsufficientBalance: boolean, hasZeroBalance: boolean, sofBalanceBigInt: bigint}}
 */
export function useBalanceValidation(
  sofBalance,
  sofDecimals,
  requiredAmount,
  isBalanceLoading,
  rolloverEffectiveAmount = 0n
) {
  const sofBalanceBigInt = useMemo(() => {
    try {
      return parseUnits(sofBalance ?? "0", sofDecimals);
    } catch {
      return 0n;
    }
  }, [sofBalance, sofDecimals]);

  const requiresBalance = requiredAmount > 0n;
  const effectiveAvailable = sofBalanceBigInt + rolloverEffectiveAmount;

  const hasInsufficientBalance =
    !isBalanceLoading && requiresBalance && effectiveAvailable < requiredAmount;

  const hasZeroBalance =
    !isBalanceLoading && requiresBalance && effectiveAvailable === 0n;

  return {
    sofBalanceBigInt,
    hasInsufficientBalance,
    hasZeroBalance,
  };
}
