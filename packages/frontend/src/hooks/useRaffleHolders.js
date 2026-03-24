// src/hooks/useRaffleHolders.js
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";

const API_BASE =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:3000/api";

/**
 * Fetch current raffle token holders from backend API (Supabase-backed)
 * @param {string} bondingCurveAddress - The bonding curve contract address (used for cache key)
 * @param {number} seasonId - The season ID
 * @returns {object} Query result with holders data
 */
export const useRaffleHolders = (bondingCurveAddress, seasonId) => {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["raffleHolders", bondingCurveAddress, seasonId],
    queryFn: async () => {
      if (!seasonId) return [];

      const url = `${API_BASE}/raffle/holders/season/${seasonId}`;
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`Failed to fetch holders: ${res.status}`);
      }

      const { holders: apiHolders, totalTickets: apiTotalTickets } =
        await res.json();
      if (!apiHolders || apiHolders.length === 0) return [];

      const totalTickets = apiTotalTickets || 0;

      return apiHolders.map((h, index) => ({
        player: h.user_address,
        ticketCount: BigInt(h.current_tickets),
        lastUpdate: h.last_block_timestamp
          ? Math.floor(new Date(h.last_block_timestamp).getTime() / 1000)
          : null,
        blockNumber: h.last_block_number,
        rank: index + 1,
        winProbabilityBps:
          totalTickets > 0
            ? Math.floor((h.current_tickets * 10000) / totalTickets)
            : 0,
      }));
    },
    enabled: !!bondingCurveAddress && !!seasonId,
    staleTime: 60000,
    refetchInterval: 60000,
  });

  /**
   * Manually refetch holders
   */
  const refetch = () => {
    queryClient.invalidateQueries({
      queryKey: ["raffleHolders", bondingCurveAddress, seasonId],
    });
  };

  /**
   * Get total holder count
   */
  const totalHolders = query.data?.length || 0;

  /**
   * Get total tickets across all holders
   */
  const totalTickets = useMemo(() => {
    if (!query.data || query.data.length === 0) return 0n;
    return query.data.reduce((sum, holder) => sum + holder.ticketCount, 0n);
  }, [query.data]);

  return {
    ...query,
    holders: query.data || [],
    totalHolders,
    totalTickets,
    refetch,
  };
};
