import { useEffect } from 'react';
import { useAccount } from 'wagmi';
import { encodeFunctionData, formatEther } from 'viem';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { SOFBondingCurveAbi } from '@/utils/abis';
import { useSmartTransactions } from '@/hooks/useSmartTransactions';
import { useWarmRead } from '@/hooks/chain/useWarmRead';
import { useUltraFreshRead } from '@/hooks/chain/useUltraFreshRead';

const MANAGER_ROLE_HASH =
  '0x03b4459c543e7fe245e8e148c6cab46a28e66bba7ee09988335c0dc88457fac2';

/**
 * Hook for treasury management operations.
 *
 * Treasury state (accumulated fees, SOF reserves, treasury address) comes
 * from the backend warm cache populated by tradeListener.
 * Manager-role check is ultra-fresh (RPC), invalidated by executeBatch
 * touching the curve.
 *
 * @param {string|number} seasonId  - retained for logging / API stability
 * @param {string} bondingCurveAddress - REQUIRED; caller resolves via useAllSeasons or season-detail
 */
export function useTreasury(seasonId, bondingCurveAddress) {
  const { address } = useAccount();
  const queryClient = useQueryClient();
  const { executeBatch } = useSmartTransactions();
  const lowerAddr = bondingCurveAddress ? bondingCurveAddress.toLowerCase() : '';

  const treasuryQuery = useWarmRead({
    path: '/curve/:address/treasury',
    params: { address: lowerAddr },
    enabled: !!bondingCurveAddress,
    refetchInterval: 30_000,
  });

  const roleQuery = useUltraFreshRead({
    contract: { address: bondingCurveAddress, abi: SOFBondingCurveAbi },
    fn: 'hasRole',
    args: [MANAGER_ROLE_HASH, address],
    touches: bondingCurveAddress ? [bondingCurveAddress] : [],
    enabled: !!(bondingCurveAddress && address),
  });

  const accumulatedFees = treasuryQuery.data?.accumulatedFees
    ? BigInt(treasuryQuery.data.accumulatedFees)
    : 0n;
  const sofReserves = treasuryQuery.data?.sofReserves
    ? BigInt(treasuryQuery.data.sofReserves)
    : 0n;
  const treasuryAddress = treasuryQuery.data?.treasuryAddress ?? null;
  const hasManagerRole = !!roleQuery.data;

  const extractMutation = useMutation({
    mutationFn: async () => {
      if (!bondingCurveAddress) throw new Error('Bonding curve address unavailable');
      const call = {
        to: bondingCurveAddress,
        data: encodeFunctionData({
          abi: SOFBondingCurveAbi,
          functionName: 'extractFeesToTreasury',
          args: [],
        }),
      };
      return executeBatch([call]);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['warm', '/curve/:address/treasury'],
      });
    },
  });

  const handleExtractFees = async () => {
    if (!bondingCurveAddress || !address) return;
    try { await extractMutation.mutateAsync(); } catch { /* surfaced via extractError */ }
  };

  useEffect(() => {
    if (!bondingCurveAddress) return;
    if (import.meta?.env?.DEV) {
      // eslint-disable-next-line no-console
      console.debug('[Treasury] season', seasonId, {
        bondingCurveAddress,
        accumulatedFees: accumulatedFees.toString(),
        sofReserves: sofReserves.toString(),
        treasuryAddress,
      });
    }
  }, [seasonId, bondingCurveAddress, accumulatedFees, sofReserves, treasuryAddress]);

  return {
    accumulatedFees: formatEther(accumulatedFees),
    accumulatedFeesRaw: accumulatedFees,
    sofReserves: formatEther(sofReserves),
    sofReservesRaw: sofReserves,
    treasuryAddress,
    hasManagerRole,
    canExtractFees: hasManagerRole && accumulatedFees > 0n,
    extractFees: handleExtractFees,
    isExtracting: extractMutation.isPending,
    isExtractConfirmed: extractMutation.isSuccess,
    extractError: extractMutation.error,
    refetchAccumulatedFees: treasuryQuery.refetch,
    bondingCurveAddress,
  };
}
