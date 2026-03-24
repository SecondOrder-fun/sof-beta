import { useQuery } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import { getStoredNetworkKey } from "@/lib/wagmi";
import {
  getTierConfigs,
  getTierWinners,
  getWinnerTier,
  getSponsoredERC20,
  getSponsoredERC721,
} from "@/services/onchainRaffleDistributor";

/**
 * Hook to read sponsored prizes and tier configuration for a season.
 * Used for display purposes (not claiming).
 */
export function useSponsoredPrizes(seasonId) {
  const netKey = getStoredNetworkKey();
  const { address } = useAccount();

  const tierConfigsQuery = useQuery({
    queryKey: ["tierConfigs", netKey, seasonId],
    queryFn: () => getTierConfigs({ seasonId, networkKey: netKey }),
    enabled: Boolean(seasonId),
    staleTime: 30_000,
  });

  const sponsoredERC20Query = useQuery({
    queryKey: ["sponsoredERC20", netKey, seasonId],
    queryFn: () => getSponsoredERC20({ seasonId, networkKey: netKey }),
    enabled: Boolean(seasonId),
    staleTime: 15_000,
  });

  const sponsoredERC721Query = useQuery({
    queryKey: ["sponsoredERC721", netKey, seasonId],
    queryFn: () => getSponsoredERC721({ seasonId, networkKey: netKey }),
    enabled: Boolean(seasonId),
    staleTime: 15_000,
  });

  const winnerTierQuery = useQuery({
    queryKey: ["winnerTier", netKey, seasonId, address],
    queryFn: () => getWinnerTier({ seasonId, account: address, networkKey: netKey }),
    enabled: Boolean(seasonId) && Boolean(address),
    staleTime: 30_000,
  });

  // Build tier winners map
  const tiers = tierConfigsQuery.data || [];
  const tierWinnersQueries = useQuery({
    queryKey: ["allTierWinners", netKey, seasonId, tiers.length],
    queryFn: async () => {
      const results = {};
      for (let i = 0; i < tiers.length; i++) {
        results[i] = await getTierWinners({ seasonId, tierIndex: i, networkKey: netKey });
      }
      return results;
    },
    enabled: Boolean(seasonId) && tiers.length > 0,
    staleTime: 30_000,
  });

  const hasSponsoredPrizes =
    (sponsoredERC20Query.data?.length || 0) > 0 ||
    (sponsoredERC721Query.data?.length || 0) > 0;

  return {
    tierConfigs: tiers,
    sponsoredERC20: sponsoredERC20Query.data || [],
    sponsoredERC721: sponsoredERC721Query.data || [],
    tierWinners: tierWinnersQueries.data || {},
    winnerTier: winnerTierQuery.data || { isTierWinner: false, tierIndex: 0 },
    hasSponsoredPrizes,
    isLoading:
      tierConfigsQuery.isLoading ||
      sponsoredERC20Query.isLoading ||
      sponsoredERC721Query.isLoading,
  };
}
