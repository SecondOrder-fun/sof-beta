import { useMutation, useQueryClient } from "@tanstack/react-query";
import { getStoredNetworkKey } from "@/lib/wagmi";
import {
  buildClaimSponsoredERC20Call,
  buildClaimSponsoredERC721Call,
} from "@/services/onchainRaffleDistributor";
import { useSmartTransactions } from "@/hooks/useSmartTransactions";

/**
 * Hook for claiming sponsored prizes (ERC-20 and ERC-721).
 * Uses executeBatch for ERC-5792 gas sponsorship. Consumers wrap the returned
 * mutations with useTransactionStatus to drive TransactionModal for feedback.
 */
export function useSponsorPrizeClaim(seasonId) {
  const netKey = getStoredNetworkKey();
  const queryClient = useQueryClient();
  const { executeBatch } = useSmartTransactions();

  const claimERC20Mutation = useMutation({
    mutationFn: async () => {
      const call = await buildClaimSponsoredERC20Call({ seasonId, networkKey: netKey });
      return executeBatch([call]);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sponsoredERC20"] });
    },
  });

  const claimERC721Mutation = useMutation({
    mutationFn: async () => {
      const call = await buildClaimSponsoredERC721Call({ seasonId, networkKey: netKey });
      return executeBatch([call]);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sponsoredERC721"] });
    },
  });

  const claimAll = async () => {
    // Run independently so one failure doesn't block the other.
    const results = await Promise.allSettled([
      claimERC20Mutation.mutateAsync(),
      claimERC721Mutation.mutateAsync(),
    ]);
    return results;
  };

  return {
    claimERC20Mutation,
    claimERC721Mutation,
    claimERC20: claimERC20Mutation.mutate,
    claimERC721: claimERC721Mutation.mutate,
    claimAll,
    isClaimingERC20: claimERC20Mutation.isPending,
    isClaimingERC721: claimERC721Mutation.isPending,
    isClaiming: claimERC20Mutation.isPending || claimERC721Mutation.isPending,
  };
}
