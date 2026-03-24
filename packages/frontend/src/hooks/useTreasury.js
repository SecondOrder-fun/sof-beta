import { useEffect } from 'react';
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { formatEther } from 'viem';
import { useQueryClient } from '@tanstack/react-query';
import { SOFTokenAbi, SOFBondingCurveAbi } from '@/utils/abis';
import { getContractAddresses } from '@/config/contracts';
import { getStoredNetworkKey } from '@/lib/wagmi';

/**
 * Hook for treasury management operations
 * @param {string} seasonId - The season ID to manage treasury for
 * @param {string} bondingCurveAddress - The bonding curve address for the season (optional, will be fetched if not provided)
 * @returns {Object} Treasury management functions and state
 */
export function useTreasury(seasonId, bondingCurveAddress) {
  const { address } = useAccount();
  const queryClient = useQueryClient();
  const networkKey = getStoredNetworkKey();
  const contracts = getContractAddresses(networkKey);

  // Use provided bondingCurveAddress or fetch it from the raffle contract
  const { data: fetchedBondingCurveAddress } = useReadContract({
    address: contracts.RAFFLE,
    abi: [
      {
        inputs: [{ name: 'seasonId', type: 'uint256' }],
        name: 'seasons',
        outputs: [
          { name: 'name', type: 'string' },
          { name: 'startTime', type: 'uint256' },
          { name: 'endTime', type: 'uint256' },
          { name: 'winnerCount', type: 'uint16' },
          { name: 'grandPrizeBps', type: 'uint16' },
          { name: 'bondingCurve', type: 'address' },
          { name: 'raffleToken', type: 'address' },
          { name: 'isActive', type: 'bool' },
          { name: 'isCompleted', type: 'bool' },
        ],
        stateMutability: 'view',
        type: 'function',
      },
    ],
    functionName: 'seasons',
    args: [BigInt(seasonId)],
    query: {
      enabled: !!contracts.RAFFLE && !!seasonId && !bondingCurveAddress, // Only fetch if not provided
      select: (data) => {
        if (!data) return undefined;
        if (typeof data.bondingCurve === 'string') return data.bondingCurve;
        if (Array.isArray(data) && data.length > 5) return data[5];
        return undefined;
      },
    },
  });

  // Use provided address or fetched address
  const resolvedBondingCurveAddress = bondingCurveAddress || fetchedBondingCurveAddress;

  // Get accumulated fees from bonding curve
  const { data: accumulatedFees, refetch: refetchAccumulatedFees } = useReadContract({
    address: resolvedBondingCurveAddress,
    abi: SOFBondingCurveAbi,
    functionName: 'accumulatedFees',
    query: {
      enabled: !!resolvedBondingCurveAddress,
    },
  });

  // Get SOF reserves from bonding curve
  const { data: sofReserves } = useReadContract({
    address: resolvedBondingCurveAddress,
    abi: SOFBondingCurveAbi,
    functionName: 'getSofReserves',
    query: {
      enabled: !!resolvedBondingCurveAddress,
    },
  });

  // Get SOF token contract balance (accumulated fees in treasury system)
  const { data: treasuryBalance, refetch: refetchTreasuryBalance } = useReadContract({
    address: contracts.SOF,
    abi: SOFTokenAbi,
    functionName: 'getContractBalance',
    query: {
      enabled: !!contracts.SOF,
    },
  });

  // Get treasury address
  const { data: treasuryAddress } = useReadContract({
    address: contracts.SOF,
    abi: SOFTokenAbi,
    functionName: 'treasuryAddress',
    query: {
      enabled: !!contracts.SOF,
    },
  });

  // Get total fees collected (cumulative)
  const { data: totalFeesCollected } = useReadContract({
    address: contracts.SOF,
    abi: SOFTokenAbi,
    functionName: 'totalFeesCollected',
    query: {
      enabled: !!contracts.SOF,
    },
  });

  // Get RAFFLE_MANAGER_ROLE hash from contract
  const { data: managerRoleHash } = useReadContract({
    address: resolvedBondingCurveAddress,
    abi: SOFBondingCurveAbi,
    functionName: 'RAFFLE_MANAGER_ROLE',
    query: {
      enabled: !!resolvedBondingCurveAddress,
    },
  });

  // Check if user has RAFFLE_MANAGER_ROLE on bonding curve
  const { data: hasManagerRole } = useReadContract({
    address: resolvedBondingCurveAddress,
    abi: SOFBondingCurveAbi,
    functionName: 'hasRole',
    args: [
      managerRoleHash || '0x03b4459c543e7fe245e8e148c6cab46a28e66bba7ee09988335c0dc88457fac2', // Fallback to hardcoded hash
      address,
    ],
    query: {
      enabled: !!(resolvedBondingCurveAddress && address && managerRoleHash),
      staleTime: 0,
      refetchInterval: 5000,
    },
    watch: true,
  });

  // Check if user has TREASURY_ROLE on SOF token
  const { data: hasTreasuryRole } = useReadContract({
    address: contracts.SOF,
    abi: SOFTokenAbi,
    functionName: 'hasRole',
    args: [
      '0xe1dcbdb91df27212a29bc27177c840cf2f819ecf2187432e1fac86c2dd5dfca9', // TREASURY_ROLE
      address,
    ],
    query: {
      enabled: !!address,
      staleTime: 0,
      refetchInterval: 5000,
    },
    watch: true,
  });

  // Extract fees from bonding curve to SOF token
  const {
    writeContract: extractFees,
    data: extractHash,
    isPending: isExtracting,
    error: extractError,
  } = useWriteContract();

  const { isLoading: isExtractConfirming, isSuccess: isExtractConfirmed } =
    useWaitForTransactionReceipt({
      hash: extractHash,
    });

  // Transfer fees from SOF token to treasury
  const {
    writeContract: transferToTreasury,
    data: transferHash,
    isPending: isTransferring,
    error: transferError,
  } = useWriteContract();

  const { isLoading: isTransferConfirming, isSuccess: isTransferConfirmed } =
    useWaitForTransactionReceipt({
      hash: transferHash,
    });

  // Update treasury address on SOF token
  const {
    writeContract: updateTreasuryAddress,
    data: updateHash,
    isPending: isUpdatingTreasury,
    error: updateError,
  } = useWriteContract();

  const { isLoading: isUpdateConfirming, isSuccess: isUpdateConfirmed } =
    useWaitForTransactionReceipt({
      hash: updateHash,
    });

  // Extract fees from bonding curve
  const handleExtractFees = async () => {
    if (!resolvedBondingCurveAddress || !address) return;

    try {
      await extractFees({
        address: resolvedBondingCurveAddress,
        abi: SOFBondingCurveAbi,
        functionName: 'extractFeesToTreasury',
        account: address,
      });

      queryClient.setQueryData(
        ['readContract', { address: resolvedBondingCurveAddress, functionName: 'accumulatedFees' }],
        0n,
      );
    } catch (error) {
      // Error is handled by wagmi
      return;
    }
  };

  // Transfer fees to treasury
  const handleTransferToTreasury = async (amount) => {
    if (!address) return;

    try {
      await transferToTreasury({
        address: contracts.SOF,
        abi: SOFTokenAbi,
        functionName: 'transferToTreasury',
        args: [amount],
        account: address,
      });

      queryClient.setQueryData(
        ['readContract', { address: contracts.SOF, functionName: 'getContractBalance' }],
        0n,
      );
    } catch (error) {
      // Error is handled by wagmi
      return;
    }
  };

  // Update treasury address
  const handleUpdateTreasuryAddress = async (newAddress) => {
    if (!address || !newAddress) return;

    try {
      await updateTreasuryAddress({
        address: contracts.SOF,
        abi: SOFTokenAbi,
        functionName: 'setTreasuryAddress',
        args: [newAddress],
        account: address,
      });
    } catch (error) {
      // Error is handled by wagmi
      return;
    }
  };

  useEffect(() => {
    if (!isExtractConfirmed) return;
    void Promise.all([
      refetchAccumulatedFees(),
      refetchTreasuryBalance(),
      queryClient.invalidateQueries({ queryKey: ['sofBalance'] }),
    ]);
  }, [isExtractConfirmed, refetchAccumulatedFees, refetchTreasuryBalance, queryClient]);

  useEffect(() => {
    if (!isTransferConfirmed) return;
    void Promise.all([
      refetchTreasuryBalance(),
      refetchAccumulatedFees(),
      queryClient.invalidateQueries({ queryKey: ['sofBalance'] }),
    ]);
  }, [isTransferConfirmed, refetchTreasuryBalance, refetchAccumulatedFees, queryClient]);

  useEffect(() => {
    if (!resolvedBondingCurveAddress) return;
    if (import.meta?.env?.DEV) {
      // Reason: surface live on-chain fee/reserve readings for debugging discrepancies in UI
      // eslint-disable-next-line no-console
      console.debug('[Treasury] season', seasonId, {
        bondingCurveAddress: resolvedBondingCurveAddress,
        accumulatedFees: accumulatedFees?.toString?.() ?? '0',
        sofReserves: sofReserves?.toString?.() ?? '0',
        treasuryBalance: treasuryBalance?.toString?.() ?? '0',
        totalFeesCollected: totalFeesCollected?.toString?.() ?? '0',
      });
    }
  }, [seasonId, resolvedBondingCurveAddress, accumulatedFees, sofReserves, treasuryBalance, totalFeesCollected]);

  return {
    // Balances
    accumulatedFees: accumulatedFees ? formatEther(accumulatedFees) : '0',
    accumulatedFeesRaw: accumulatedFees,
    sofReserves: sofReserves ? formatEther(sofReserves) : '0',
    sofReservesRaw: sofReserves,
    treasuryBalance: treasuryBalance !== undefined ? formatEther(treasuryBalance) : '0',
    treasuryBalanceRaw: treasuryBalance,
    totalFeesCollected: totalFeesCollected ? formatEther(totalFeesCollected) : '0',
    treasuryAddress,

    // Permissions
    hasManagerRole: hasManagerRole || false,
    hasTreasuryRole: hasTreasuryRole || false,
    canExtractFees: hasManagerRole && accumulatedFees > 0n,
    canTransferToTreasury: hasTreasuryRole && treasuryBalance > 0n,

    // Actions
    extractFees: handleExtractFees,
    transferToTreasury: handleTransferToTreasury,
    updateTreasuryAddress: handleUpdateTreasuryAddress,

    // States
    isExtracting: isExtracting || isExtractConfirming,
    isExtractConfirmed,
    extractError,
    isTransferring: isTransferring || isTransferConfirming,
    isTransferConfirmed,
    transferError,
    isUpdatingTreasury: isUpdatingTreasury || isUpdateConfirming,
    isUpdateConfirmed,
    updateError,

    // Refetch functions
    refetchAccumulatedFees,
    refetchTreasuryBalance,
    bondingCurveAddress,
  };
}
