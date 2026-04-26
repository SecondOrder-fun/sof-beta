import { useEffect } from 'react';
import { useAccount, useReadContract } from 'wagmi';
import { encodeFunctionData, formatEther } from 'viem';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { SOFBondingCurveAbi } from '@/utils/abis';
import { getContractAddresses } from '@/config/contracts';
import { getStoredNetworkKey } from '@/lib/wagmi';
import { useSmartTransactions } from '@/hooks/useSmartTransactions';

/**
 * Hook for treasury management operations.
 *
 * Treasury lives on SOFBondingCurve (one per season) — fees accumulate via
 * buy/sell and are extracted in one step straight to the curve's configured
 * treasury address. SOFToken itself has no treasury surface.
 *
 * @param {string|number} seasonId
 * @param {string} [bondingCurveAddress] - optional; fetched from Raffle if omitted
 */
export function useTreasury(seasonId, bondingCurveAddress) {
  const { address } = useAccount();
  const queryClient = useQueryClient();
  const networkKey = getStoredNetworkKey();
  const contracts = getContractAddresses(networkKey);
  const { executeBatch } = useSmartTransactions();

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
      enabled: !!contracts.RAFFLE && !!seasonId && !bondingCurveAddress,
      select: (data) => {
        if (!data) return undefined;
        if (typeof data.bondingCurve === 'string') return data.bondingCurve;
        if (Array.isArray(data) && data.length > 5) return data[5];
        return undefined;
      },
    },
  });

  const resolvedBondingCurveAddress = bondingCurveAddress || fetchedBondingCurveAddress;

  const { data: accumulatedFees, refetch: refetchAccumulatedFees } = useReadContract({
    address: resolvedBondingCurveAddress,
    abi: SOFBondingCurveAbi,
    functionName: 'accumulatedFees',
    query: { enabled: !!resolvedBondingCurveAddress },
  });

  const { data: sofReserves } = useReadContract({
    address: resolvedBondingCurveAddress,
    abi: SOFBondingCurveAbi,
    functionName: 'getSofReserves',
    query: { enabled: !!resolvedBondingCurveAddress },
  });

  // Treasury address lives on the curve — read-only, set at curve construction.
  const { data: treasuryAddress } = useReadContract({
    address: resolvedBondingCurveAddress,
    abi: SOFBondingCurveAbi,
    functionName: 'treasuryAddress',
    query: { enabled: !!resolvedBondingCurveAddress },
  });

  const { data: managerRoleHash } = useReadContract({
    address: resolvedBondingCurveAddress,
    abi: SOFBondingCurveAbi,
    functionName: 'RAFFLE_MANAGER_ROLE',
    query: { enabled: !!resolvedBondingCurveAddress },
  });

  const { data: hasManagerRole } = useReadContract({
    address: resolvedBondingCurveAddress,
    abi: SOFBondingCurveAbi,
    functionName: 'hasRole',
    args: [
      managerRoleHash || '0x03b4459c543e7fe245e8e148c6cab46a28e66bba7ee09988335c0dc88457fac2',
      address,
    ],
    query: {
      enabled: !!(resolvedBondingCurveAddress && address && managerRoleHash),
      staleTime: 0,
      refetchInterval: 5000,
    },
    watch: true,
  });

  // Route admin treasury ops through executeBatch (ERC-5792) per CLAUDE.md —
  // same gasless/batched path as every other on-chain op.
  const extractMutation = useMutation({
    mutationFn: async () => {
      if (!resolvedBondingCurveAddress) throw new Error('Bonding curve address unavailable');
      const call = {
        to: resolvedBondingCurveAddress,
        data: encodeFunctionData({
          abi: SOFBondingCurveAbi,
          functionName: 'extractFeesToTreasury',
          args: [],
        }),
      };
      return executeBatch([call]);
    },
    onSuccess: () => {
      queryClient.setQueryData(
        ['readContract', { address: resolvedBondingCurveAddress, functionName: 'accumulatedFees' }],
        0n,
      );
    },
  });

  const handleExtractFees = async () => {
    if (!resolvedBondingCurveAddress || !address) return;
    try {
      await extractMutation.mutateAsync();
    } catch {
      // surfaced via extractError
    }
  };

  useEffect(() => {
    if (!extractMutation.isSuccess) return;
    void Promise.all([
      refetchAccumulatedFees(),
      queryClient.invalidateQueries({ queryKey: ['sofBalance'] }),
    ]);
  }, [extractMutation.isSuccess, refetchAccumulatedFees, queryClient]);

  useEffect(() => {
    if (!resolvedBondingCurveAddress) return;
    if (import.meta?.env?.DEV) {
      // eslint-disable-next-line no-console
      console.debug('[Treasury] season', seasonId, {
        bondingCurveAddress: resolvedBondingCurveAddress,
        accumulatedFees: accumulatedFees?.toString?.() ?? '0',
        sofReserves: sofReserves?.toString?.() ?? '0',
        treasuryAddress,
      });
    }
  }, [seasonId, resolvedBondingCurveAddress, accumulatedFees, sofReserves, treasuryAddress]);

  return {
    // Balances
    accumulatedFees: accumulatedFees ? formatEther(accumulatedFees) : '0',
    accumulatedFeesRaw: accumulatedFees,
    sofReserves: sofReserves ? formatEther(sofReserves) : '0',
    sofReservesRaw: sofReserves,
    treasuryAddress,

    // Permissions
    hasManagerRole: hasManagerRole || false,
    canExtractFees: hasManagerRole && accumulatedFees > 0n,

    // Actions
    extractFees: handleExtractFees,

    // States
    isExtracting: extractMutation.isPending,
    isExtractConfirmed: extractMutation.isSuccess,
    extractError: extractMutation.error,

    // Refetch
    refetchAccumulatedFees,
    bondingCurveAddress: resolvedBondingCurveAddress,
  };
}
