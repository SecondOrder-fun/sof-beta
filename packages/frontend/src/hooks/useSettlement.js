// src/hooks/useSettlement.js
import { useQuery } from "@tanstack/react-query";
import { usePublicClient } from "wagmi";
import { readContract } from "@wagmi/core";
import { getStoredNetworkKey } from "@/lib/wagmi";
import { getNetworkByKey } from "@/config/networks";
import { getContractAddress } from "@/config/contracts";
import { InfoFiSettlementAbi } from "@/utils/abis";
import { queryLogsInChunks } from "@/utils/blockRangeQuery";

/**
 * Hook to interact with the InfoFiSettlement contract
 * @param {string|number} marketId - The ID of the market to check settlement status for
 * @returns {Object} Settlement status and functions
 */
export function useSettlement(marketId) {
  const networkKey = getStoredNetworkKey();
  const publicClient = usePublicClient();

  const settlementAddress = getContractAddress("INFOFI_SETTLEMENT", networkKey);

  // Convert marketId to bytes32 if it's a string or number
  const marketIdBytes32 =
    typeof marketId === "string" && !marketId.startsWith("0x")
      ? `0x${marketId.padStart(64, "0")}`
      : marketId;

  // Query to get the outcome for the market
  const outcomeQuery = useQuery({
    queryKey: ["settlement_outcome", networkKey, marketIdBytes32],
    queryFn: async () => {
      if (!settlementAddress || !marketIdBytes32) return null;

      try {
        // Read the outcome from the contract
        const outcome = await readContract({
          address: settlementAddress,
          abi: InfoFiSettlementAbi,
          functionName: "outcomes",
          args: [marketIdBytes32],
        });

        return {
          winner: outcome[0],
          settled: outcome[1],
          settledAt: Number(outcome[2]),
        };
      } catch (error) {
        // Handle error silently and return null
        return null;
      }
    },
    enabled: !!settlementAddress && !!marketIdBytes32,
    refetchInterval: 10000, // Refetch every 10 seconds
  });

  // Listen for MarketsSettled events
  const eventsQuery = useQuery({
    queryKey: ["settlement_events", networkKey, marketIdBytes32],
    queryFn: async () => {
      if (!settlementAddress || !marketIdBytes32 || !publicClient) return [];

      try {
        // Get current block for lookback range
        const chain = getNetworkByKey(networkKey);
        const currentBlock = await publicClient.getBlockNumber();
        const lookbackBlocks = chain.lookbackBlocks;
        const fromBlock =
          currentBlock > lookbackBlocks ? currentBlock - lookbackBlocks : 0n;

        // Get MarketsSettled events using chunked query
        const eventAbi = InfoFiSettlementAbi.find(
          (e) => e.type === "event" && e.name === "MarketsSettled"
        );
        const events = await queryLogsInChunks(
          publicClient,
          {
            address: settlementAddress,
            event: {
              name: "MarketsSettled",
              type: "event",
              inputs: eventAbi?.inputs || [],
            },
            fromBlock,
            toBlock: "latest",
          },
          10000n
        );

        // Filter events that include this market ID
        return events.filter((event) => {
          const marketIds = event.args?.marketIds || [];
          return marketIds.includes(marketIdBytes32);
        });
      } catch (error) {
        // Handle error silently and return empty array
        return [];
      }
    },
    enabled: !!settlementAddress && !!marketIdBytes32 && !!publicClient,
    refetchInterval: 15000, // Refetch every 15 seconds
  });

  // Check if the market is settled
  const isSettledQuery = useQuery({
    queryKey: ["settlement_is_settled", networkKey, marketIdBytes32],
    queryFn: async () => {
      if (!settlementAddress || !marketIdBytes32) return false;

      try {
        return await readContract({
          address: settlementAddress,
          abi: InfoFiSettlementAbi,
          functionName: "isSettled",
          args: [marketIdBytes32],
        });
      } catch (error) {
        // Handle error silently and return false
        return false;
      }
    },
    enabled: !!settlementAddress && !!marketIdBytes32,
    refetchInterval: 10000, // Refetch every 10 seconds
  });

  // Calculate the settlement status
  const settlementStatus = (() => {
    if (!outcomeQuery.data) return "unknown";
    if (outcomeQuery.data.settled) return "settled";
    if (eventsQuery.data?.length > 0) return "settling";
    return "pending";
  })();

  return {
    outcome: outcomeQuery.data,
    events: eventsQuery.data || [],
    isSettled: isSettledQuery.data,
    settlementStatus,
    isLoading:
      outcomeQuery.isLoading ||
      eventsQuery.isLoading ||
      isSettledQuery.isLoading,
    error: outcomeQuery.error || eventsQuery.error || isSettledQuery.error,
    refetch: () => {
      outcomeQuery.refetch();
      eventsQuery.refetch();
      isSettledQuery.refetch();
    },
  };
}
