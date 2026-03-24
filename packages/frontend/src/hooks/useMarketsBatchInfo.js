// src/hooks/useMarketsBatchInfo.js
import { useQuery } from "@tanstack/react-query";

/**
 * Batch fetch market info (pool reserves + volume) for multiple markets
 * Replaces N individual useMarketInfo() calls with a single batch request
 *
 * @param {string[]} marketIds - Array of market ID strings
 * @returns {{ data: Record<string, { totalYesPool: bigint, totalNoPool: bigint, volume: bigint }>, isLoading: boolean }}
 */
export const useMarketsBatchInfo = (marketIds = []) => {
  const query = useQuery({
    queryKey: ["marketsBatchInfo", ...marketIds],
    enabled: marketIds.length > 0,
    queryFn: async () => {
      const apiUrl =
        import.meta.env.VITE_API_BASE_URL || "http://localhost:3000/api";
      const response = await fetch(
        `${apiUrl}/infofi/markets/batch-info?ids=${marketIds.join(",")}`
      );

      if (!response.ok) {
        throw new Error("Failed to fetch batch market info");
      }

      const { results } = await response.json();
      const parsed = {};

      for (const [id, info] of Object.entries(results || {})) {
        parsed[id] = {
          totalYesPool: BigInt(info.totalYesPool || 0),
          totalNoPool: BigInt(info.totalNoPool || 0),
          volume: BigInt(info.volume || 0),
        };
      }

      return parsed;
    },
    staleTime: 15_000,
    refetchInterval: 20_000,
  });

  return {
    data: query.data || {},
    isLoading: query.isLoading,
  };
};
