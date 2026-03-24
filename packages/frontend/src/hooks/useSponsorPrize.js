import { useMutation, useQueryClient } from "@tanstack/react-query";
import { getStoredNetworkKey } from "@/lib/wagmi";
import {
  buildClaimSponsoredERC20Call,
  buildClaimSponsoredERC721Call,
} from "@/services/onchainRaffleDistributor";
import { useSmartTransactions } from "@/hooks/useSmartTransactions";

/**
 * Hook for claiming sponsored prizes (ERC-20 and ERC-721).
 * Uses executeBatch for ERC-5792 gas sponsorship.
 * Toast messages are handled by the component via onSuccess/onError callbacks.
 */
export function useSponsorPrizeClaim(seasonId, { onSuccess, onError } = {}) {
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
      onSuccess?.("erc20");
    },
    onError: (error) => {
      onError?.("erc20", error);
    },
  });

  const claimERC721Mutation = useMutation({
    mutationFn: async () => {
      const call = await buildClaimSponsoredERC721Call({ seasonId, networkKey: netKey });
      return executeBatch([call]);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sponsoredERC721"] });
      onSuccess?.("erc721");
    },
    onError: (error) => {
      onError?.("erc721", error);
    },
  });

  const claimAll = async () => {
    // Run independently so one failure doesn't block the other
    const results = await Promise.allSettled([
      claimERC20Mutation.mutateAsync(),
      claimERC721Mutation.mutateAsync(),
    ]);
    return results;
  };

  return {
    claimERC20: claimERC20Mutation.mutate,
    claimERC721: claimERC721Mutation.mutate,
    claimAll,
    isClaimingERC20: claimERC20Mutation.isPending,
    isClaimingERC721: claimERC721Mutation.isPending,
    isClaiming: claimERC20Mutation.isPending || claimERC721Mutation.isPending,
  };
}
