// src/hooks/useUserPositionsBatch.js
import { useQuery } from "@tanstack/react-query";
import { useRaffleAccount } from "@/hooks/useRaffleAccount";

/**
 * Batch fetch user net positions across multiple markets
 * Replaces N individual useUserMarketPosition() calls with a single batch request
 *
 * Resolves at the user's smart account (spec §4.3) — InfoFi positions are
 * tracked by SMA, not the connected EOA.
 *
 * @param {string[]} marketIds - Array of market ID strings
 * @returns {{ data: Record<string, { yesAmount: bigint, noAmount: bigint, netPosition: bigint, isHedged: boolean }>, isLoading: boolean }}
 */
export const useUserPositionsBatch = (marketIds = []) => {
  const { sma: address } = useRaffleAccount();

  const query = useQuery({
    queryKey: ["userPositionsBatch", address, ...marketIds],
    enabled: !!address && marketIds.length > 0,
    queryFn: async () => {
      const apiUrl =
        import.meta.env.VITE_API_BASE_URL || "http://localhost:3000/api";
      const response = await fetch(
        `${apiUrl}/infofi/positions/${address}/batch?marketIds=${marketIds.join(",")}`
      );

      if (!response.ok) {
        throw new Error("Failed to fetch batch positions");
      }

      const { results } = await response.json();
      const parsed = {};

      for (const [id, pos] of Object.entries(results || {})) {
        parsed[id] = {
          yesAmount: BigInt(pos.yes || 0),
          noAmount: BigInt(pos.no || 0),
          netPosition: BigInt(pos.net || 0),
          isHedged: pos.isHedged || false,
          numTradesYes: pos.numTradesYes || 0,
          numTradesNo: pos.numTradesNo || 0,
        };
      }

      return parsed;
    },
    staleTime: 10_000,
    refetchInterval: 15_000,
  });

  return {
    data: query.data || {},
    isLoading: query.isLoading,
  };
};
