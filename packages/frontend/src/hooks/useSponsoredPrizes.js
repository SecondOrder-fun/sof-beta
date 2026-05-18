import { useQuery } from "@tanstack/react-query";
import { useRaffleAccount } from "@/hooks/useRaffleAccount";
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
 *
 * @param {string|number} seasonId
 * @param {object} [options]
 * @param {boolean} [options.enabled=true] — gate all on-chain reads. Callers
 *   should pass `false` for raffles where this data is not displayable
 *   (e.g., Active/Upcoming seasons where no sponsor activity is shown), so
 *   the 3-4 cold-load RPC reads (tier configs + ERC20/721 prize lists +
 *   winner tier) don't fire for the typical empty case.
 */
export function useSponsoredPrizes(seasonId, { enabled = true } = {}) {
  const netKey = getStoredNetworkKey();
  // SMA-bound read per spec §4.3 — tier-winner status keyed by SMA.
  const { sma: address } = useRaffleAccount();

  const baseEnabled = Boolean(enabled) && Boolean(seasonId);

  const tierConfigsQuery = useQuery({
    queryKey: ["tierConfigs", netKey, seasonId],
    queryFn: () => getTierConfigs({ seasonId, networkKey: netKey }),
    enabled: baseEnabled,
    staleTime: 30_000,
  });

  const sponsoredERC20Query = useQuery({
    queryKey: ["sponsoredERC20", netKey, seasonId],
    queryFn: () => getSponsoredERC20({ seasonId, networkKey: netKey }),
    enabled: baseEnabled,
    staleTime: 15_000,
  });

  const sponsoredERC721Query = useQuery({
    queryKey: ["sponsoredERC721", netKey, seasonId],
    queryFn: () => getSponsoredERC721({ seasonId, networkKey: netKey }),
    enabled: baseEnabled,
    staleTime: 15_000,
  });

  const winnerTierQuery = useQuery({
    queryKey: ["winnerTier", netKey, seasonId, address],
    queryFn: () => getWinnerTier({ seasonId, account: address, networkKey: netKey }),
    enabled: baseEnabled && Boolean(address),
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
    enabled: baseEnabled && tiers.length > 0,
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
