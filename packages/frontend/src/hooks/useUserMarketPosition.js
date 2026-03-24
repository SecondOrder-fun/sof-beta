// src/hooks/useUserMarketPosition.js
import { useQuery } from "@tanstack/react-query";
import { useAccount } from "wagmi";

/**
 * Hook to fetch user's position in a specific InfoFi market from backend API
 * @param {number|string} marketId - Market ID
 * @returns {Object} Query result with position data
 */
export const useUserMarketPosition = (marketId) => {
  const { address } = useAccount();

  return useQuery({
    queryKey: ["userMarketPosition", marketId, address],
    enabled: !!address && !!marketId,
    queryFn: async () => {
      const apiUrl =
        import.meta.env.VITE_API_BASE_URL || "http://localhost:3000/api";
      const response = await fetch(
        `${apiUrl}/infofi/positions/${address}/net?marketId=${marketId}`
      );

      if (!response.ok) {
        throw new Error("Failed to fetch user position");
      }

      const data = await response.json();

      // Backend returns: { yes, no, net, isHedged, numTradesYes, numTradesNo }
      return {
        yesAmount: BigInt(data.yes || 0),
        noAmount: BigInt(data.no || 0),
        netPosition: BigInt(data.net || 0),
        isHedged: data.isHedged || false,
        numTradesYes: data.numTradesYes || 0,
        numTradesNo: data.numTradesNo || 0,
      };
    },
    staleTime: 10_000, // 10 seconds
    refetchInterval: 15_000, // Refetch every 15 seconds
  });
};

/**
 * Hook to fetch market info (pools, volume) from backend API
 * @param {number|string} marketId - Market ID
 * @returns {Object} Query result with market info
 */
export const useMarketInfo = (marketId) => {
  return useQuery({
    queryKey: ["marketInfo", marketId],
    enabled: !!marketId,
    queryFn: async () => {
      const apiUrl =
        import.meta.env.VITE_API_BASE_URL || "http://localhost:3000/api";
      const response = await fetch(`${apiUrl}/infofi/markets/${marketId}/info`);

      if (!response.ok) {
        // If endpoint doesn't exist yet, return default values
        return {
          totalYesPool: 0n,
          totalNoPool: 0n,
          volume: 0n,
        };
      }

      const data = await response.json();

      return {
        totalYesPool: BigInt(data.totalYesPool || 0),
        totalNoPool: BigInt(data.totalNoPool || 0),
        volume: BigInt(data.volume || 0),
      };
    },
    staleTime: 15_000, // 15 seconds
    refetchInterval: 20_000, // Refetch every 20 seconds
  });
};
