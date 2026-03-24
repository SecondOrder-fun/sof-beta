/**
 * useBalanceValidation Hook
 * Validates SOF balance against required amounts for buy operations
 */

import { useMemo } from "react";
import { parseUnits } from "viem";

/**
 * Hook to validate balance requirements
 * @param {string} sofBalance - Current SOF balance as string
 * @param {number} sofDecimals - SOF token decimals
 * @param {bigint} requiredAmount - Required amount in wei
 * @param {boolean} isBalanceLoading - Whether balance is still loading
 * @returns {Object} Validation results { hasInsufficientBalance, hasZeroBalance, sofBalanceBigInt }
 */
export function useBalanceValidation(
  sofBalance,
  sofDecimals,
  requiredAmount,
  isBalanceLoading
) {
  const sofBalanceBigInt = useMemo(() => {
    try {
      return parseUnits(sofBalance ?? "0", sofDecimals);
    } catch {
      return 0n;
    }
  }, [sofBalance, sofDecimals]);

  const requiresBalance = requiredAmount > 0n;
  
  const hasInsufficientBalance =
    !isBalanceLoading && requiresBalance && sofBalanceBigInt < requiredAmount;
  
  const hasZeroBalance =
    !isBalanceLoading && requiresBalance && sofBalanceBigInt === 0n;

  return {
    sofBalanceBigInt,
    hasInsufficientBalance,
    hasZeroBalance,
  };
}
