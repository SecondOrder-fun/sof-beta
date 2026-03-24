// src/hooks/useCurve.js
// Hook for interacting with the SOFBondingCurve contract.

import { useWriteContract } from 'wagmi';
import { useMutation } from '@tanstack/react-query';
import { getStoredNetworkKey } from '@/lib/wagmi';
import { getContractAddresses } from '@/config/contracts';
import { SOFBondingCurveAbi, ERC20Abi } from '@/utils/abis';

/**
 * @notice Hook for SOFBondingCurve contract interactions.
 * @param {string} bondingCurveAddress - The address of the season-specific bonding curve contract.
 * @returns {object} An object containing mutation functions for curve actions.
 */
export function useCurve(bondingCurveAddress) {
  const netKey = getStoredNetworkKey();
  const contracts = getContractAddresses(netKey);
  const { writeContractAsync } = useWriteContract();

  const curveContractConfig = {
    address: bondingCurveAddress,
    abi: SOFBondingCurveAbi,
  };

  /**
   * @notice Approves the bonding curve to spend the user's SOF tokens.
   */
  const approveMutation = useMutation({
    mutationFn: async ({ amount }) => {
      return await writeContractAsync({
        address: contracts.SOF,
        abi: ERC20Abi,
        functionName: 'approve',
        args: [bondingCurveAddress, amount],
      });
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
      return await writeContractAsync({
        ...curveContractConfig,
        functionName: 'buyTokens',
        args: [tokenAmount, maxSofAmount],
        gas: 1500000n, // Explicit gas limit: 1.5M to ensure 900K+ remains for InfoFi
      });
    },
  });

  /**
   * @notice Buys raffle tickets using an ERC-2612 permit signature (atomic approve + buy).
   */
  const buyTokensWithPermitMutation = useMutation({
    mutationFn: async ({ tokenAmount, maxSofAmount, deadline, v, r, s }) => {
      return await writeContractAsync({
        ...curveContractConfig,
        functionName: 'buyTokensWithPermit',
        args: [tokenAmount, maxSofAmount, deadline, v, r, s],
        gas: 1500000n,
      });
    },
  });

  /**
   * @notice Sells raffle tickets back to the bonding curve.
   */
  const sellTokensMutation = useMutation({
    mutationFn: async ({ tokenAmount, minSofAmount }) => {
      return await writeContractAsync({
        ...curveContractConfig,
        functionName: 'sellTokens',
        args: [tokenAmount, minSofAmount],
      });
    },
  });

  return {
    approve: approveMutation,
    buyTokens: buyTokensMutation,
    buyTokensWithPermit: buyTokensWithPermitMutation,
    sellTokens: sellTokensMutation,
  };
}
