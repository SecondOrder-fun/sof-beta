// src/hooks/useMarketsBatchInfo.js
import { useQueryClient } from "@tanstack/react-query";
import { useWarmRead } from "@/hooks/chain/useWarmRead";
import { useLiveSubscription } from "@/hooks/chain/useLiveSubscription";

/**
 * Batch fetch market info (pool reserves + volume) for multiple markets
 * Replaces N individual useMarketInfo() calls with a single batch request
 *
 * @param {string[]} marketIds - Array of market ID strings
 * @returns {{ data: Record<string, { totalYesPool: bigint, totalNoPool: bigint, volume: bigint }>, isLoading: boolean }}
 */
export const useMarketsBatchInfo = (marketIds = []) => {
  const queryClient = useQueryClient();
  const warmPath = "/infofi/markets/batch-info";
  const warmParams = marketIds.length > 0 ? { ids: marketIds.join(",") } : {};

  const query = useWarmRead({
    path: warmPath,
    params: warmParams,
    enabled: marketIds.length > 0,
    staleTime: 15_000,
  });

  // Invalidate the batch cache when any trade lands on one of the tracked markets.
  useLiveSubscription({
    channel: "infofi",
    enabled: marketIds.length > 0,
    filter: (e) =>
      e.type === "Trade" && marketIds.includes(String(e.marketId)),
    onEvent: () =>
      queryClient.invalidateQueries({
        queryKey: ["warm", warmPath, warmParams],
      }),
  });

  const raw = query.data?.results || {};
  const parsed = {};
  for (const [id, info] of Object.entries(raw)) {
    parsed[id] = {
      totalYesPool: BigInt(info.totalYesPool || 0),
      totalNoPool: BigInt(info.totalNoPool || 0),
      volume: BigInt(info.volume || 0),
    };
  }

  return {
    data: parsed,
    isLoading: query.isLoading,
  };
};
