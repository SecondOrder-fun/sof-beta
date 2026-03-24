import { useAccount, useReadContract } from 'wagmi';
import { getContractAddresses, RAFFLE_ABI } from '@/config/contracts';
import { getStoredNetworkKey } from '@/lib/wagmi';
import { useRaffleWrite } from '@/hooks/useRaffleWrite';

/**
 * useRaffleAdmin
 * Delegates the end-season write flow to `useRaffleWrite().requestSeasonEnd` to ensure
 * a single, consistent code path with simulation, error decoding, and cache invalidation.
 */
export function useRaffleAdmin(seasonId) {
  const { address } = useAccount();
  const netKey = getStoredNetworkKey();
  const { RAFFLE } = getContractAddresses(netKey);

  const SEASON_CREATOR_ROLE = '0x2a2244d3406b63b21b0521e100ecb30349b863d375b5b7588e3a09552a454c54'; // keccak256("SEASON_CREATOR_ROLE")

  const { data: isAdmin, isLoading: isLoadingAdminRole } = useReadContract({
    address: RAFFLE,
    abi: RAFFLE_ABI,
    functionName: 'hasRole',
    args: [SEASON_CREATOR_ROLE, address],
    query: {
      enabled: !!address,
    },
  });

  // Delegate writes to the central hook
  const { requestSeasonEnd } = useRaffleWrite();

  // Expose a stable callback with the delegated mutation
  const handleRequestSeasonEnd = async () => {
    await requestSeasonEnd.mutateAsync({ seasonId: typeof seasonId === 'bigint' ? seasonId : BigInt(seasonId) });
  };

  return {
    isAdmin,
    isLoadingAdminRole,
    requestSeasonEnd: handleRequestSeasonEnd,
    isConfirming: requestSeasonEnd.isPending || requestSeasonEnd.isConfirming,
    isConfirmed: requestSeasonEnd.isConfirmed,
    error: requestSeasonEnd.error,
  };
}
