// src/hooks/useCurve.js
// Hook for interacting with the SOFBondingCurve contract.

import { useMutation } from '@tanstack/react-query';
import { encodeFunctionData } from 'viem';
import { SOFBondingCurveAbi, ERC20Abi } from '@/utils/abis';
import { useSmartTransactions } from '@/hooks/useSmartTransactions';
import { useSeasonQuoteToken } from '@/hooks/useSeasonQuoteToken';

/**
 * @notice Hook for SOFBondingCurve contract interactions.
 * @param {string} bondingCurveAddress - The address of the season-specific bonding curve contract.
 * @returns {object} An object containing mutation functions for curve actions.
 */
export function useCurve(bondingCurveAddress) {
  const { executeBatch } = useSmartTransactions();
  // Approve the token this curve actually accepts. Each season names its own
  // quote token, so a platform-wide address would approve the wrong ERC-20 and
  // every buy would revert.
  const { quoteToken } = useSeasonQuoteToken(bondingCurveAddress);

  /**
   * @notice Approves the bonding curve to spend the user's quote tokens.
   */
  const approveMutation = useMutation({
    mutationFn: async ({ amount }) => {
      return await executeBatch([{
        to: quoteToken,
        data: encodeFunctionData({
          abi: ERC20Abi,
          functionName: 'approve',
          args: [bondingCurveAddress, amount],
        }),
      }], { sofAmount: 0n });
    },
  });

  /**
   * @notice Buys raffle tickets from the bonding curve.
   * @dev Sets explicit gas limit to ensure InfoFi market creation has enough gas.
   * The Raffle contract needs 900K+ gas to forward 800K to InfoFiMarketFactory.
   * BondingCurve uses ~600K gas before calling Raffle, so we need 1.5M total.
   */
  const buyTokensMutation = useMutation({
    mutationFn: async ({ tokenAmount, maxSofAmount }) => {
      return await executeBatch([{
        to: bondingCurveAddress,
        data: encodeFunctionData({
          abi: SOFBondingCurveAbi,
          functionName: 'buyTokens',
          args: [tokenAmount, maxSofAmount],
        }),
      }], { sofAmount: maxSofAmount });
    },
  });

  /**
   * @notice Buys raffle tickets using an ERC-2612 permit signature (atomic approve + buy).
   */
  const buyTokensWithPermitMutation = useMutation({
    mutationFn: async ({ tokenAmount, maxSofAmount, deadline, v, r, s }) => {
      return await executeBatch([{
        to: bondingCurveAddress,
        data: encodeFunctionData({
          abi: SOFBondingCurveAbi,
          functionName: 'buyTokensWithPermit',
          args: [tokenAmount, maxSofAmount, deadline, v, r, s],
        }),
      }], { sofAmount: maxSofAmount });
    },
  });

  /**
   * @notice Sells raffle tickets back to the bonding curve.
   */
  const sellTokensMutation = useMutation({
    mutationFn: async ({ tokenAmount, minSofAmount }) => {
      return await executeBatch([{
        to: bondingCurveAddress,
        data: encodeFunctionData({
          abi: SOFBondingCurveAbi,
          functionName: 'sellTokens',
          args: [tokenAmount, minSofAmount],
        }),
      }], { sofAmount: 0n });
    },
  });

  return {
    approve: approveMutation,
    buyTokens: buyTokensMutation,
    buyTokensWithPermit: buyTokensWithPermitMutation,
    sellTokens: sellTokensMutation,
  };
}
