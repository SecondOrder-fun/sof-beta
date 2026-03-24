// src/hooks/useRaffleTransactions.js
import { useQuery, useQueryClient } from "@tanstack/react-query";

const API_BASE =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:3000/api";

/**
 * Fetch raffle transactions from the backend API (Supabase-backed)
 * @param {string} bondingCurveAddress - The bonding curve contract address (used for cache key only)
 * @param {number} seasonId - The season ID
 * @param {object} options - Query options (enablePolling)
 * @returns {object} Query result with transactions data
 */
export const useRaffleTransactions = (
  bondingCurveAddress,
  seasonId,
  options = {},
) => {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["raffleTransactions", bondingCurveAddress, seasonId],
    queryFn: async () => {
      if (!seasonId) return [];

      const url = `${API_BASE}/raffle/transactions/season/${seasonId}?limit=500&order=desc`;
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`Failed to fetch transactions: ${res.status}`);
      }

      const { transactions } = await res.json();
      if (!transactions || transactions.length === 0) return [];

      return transactions.map((tx) => {
        const ticketsDelta =
          tx.transaction_type === "BUY"
            ? tx.ticket_amount
            : -tx.ticket_amount;

        return {
          txHash: tx.tx_hash,
          blockNumber: tx.block_number,
          timestamp: tx.block_timestamp
            ? Math.floor(new Date(tx.block_timestamp).getTime() / 1000)
            : null,
          player: tx.user_address,
          oldTickets: BigInt(tx.tickets_before ?? 0),
          newTickets: BigInt(tx.tickets_after ?? 0),
          ticketsDelta: BigInt(ticketsDelta),
          totalTickets: BigInt(tx.tickets_after ?? 0),
          probabilityBps: 0,
          type: tx.transaction_type === "BUY" ? "buy" : "sell",
        };
      });
    },
    enabled: !!bondingCurveAddress && !!seasonId,
    staleTime: 30000,
    refetchInterval: options.enablePolling !== false ? 30000 : false,
  });

  const refetch = () => {
    queryClient.invalidateQueries({
      queryKey: ["raffleTransactions", bondingCurveAddress, seasonId],
    });
  };

  return {
    ...query,
    transactions: query.data || [],
    refetch,
  };
};
