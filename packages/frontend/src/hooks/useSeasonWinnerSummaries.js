// src/hooks/useSeasonWinnerSummaries.js
import { useQuery } from "@tanstack/react-query";
import axios from "axios";
import { usePublicClient } from "wagmi";
import { getStoredNetworkKey } from "@/lib/wagmi";
import { getContractAddresses } from "@/config/contracts";
import { RaffleAbi, RafflePrizeDistributorAbi } from "@/utils/abis";

const API_BASE = import.meta.env.VITE_API_BASE_URL;

/**
 * @typedef {Object} SeasonWinnerSummary
 * @property {string} winnerAddress
 * @property {string | null} winnerUsername
 * @property {bigint} grandPrizeWei
 */

/**
 * @typedef {Record<number, SeasonWinnerSummary>} SeasonWinnerSummaryMap
 */

/**
 * Fetch a username map for a set of addresses.
 * @param {string[]} addresses
 * @returns {Promise<Record<string, string | null>>}
 */
async function fetchBatchUsernames(addresses) {
  if (!addresses || addresses.length === 0) return {};

  const validAddresses = addresses.filter(
    (addr) => addr && /^0x[a-fA-F0-9]{40}$/.test(addr),
  );

  if (validAddresses.length === 0) return {};

  const response = await axios.get(`${API_BASE}/usernames/batch`, {
    params: {
      addresses: validAddresses.join(","),
    },
  });

  return response.data;
}

/**
 * Get winner summaries for completed seasons.
 *
 * Completed/settled is determined by on-chain SeasonStatus.Completed === 5.
 * This hook only fetches data for seasons where `status === 5`.
 *
 * @param {{ id: number, status: number }[]} seasons
 * @returns {{ data: SeasonWinnerSummaryMap | undefined, isLoading: boolean, error: unknown }}
 */
export function useSeasonWinnerSummaries(seasons) {
  const client = usePublicClient();
  const netKey = getStoredNetworkKey();
  const addr = getContractAddresses(netKey);

  const completedSeasonIds = (seasons || [])
    .filter((s) => {
      const statusNum = Number(s?.status);
      return statusNum === 4 || statusNum === 5;
    })
    .map((s) => s.id)
    .filter((id) => typeof id === "number" && !Number.isNaN(id));

  return useQuery({
    queryKey: [
      "seasonWinnerSummaries",
      addr.RAFFLE,
      completedSeasonIds
        .slice()
        .sort((a, b) => a - b)
        .join(","),
    ],
    enabled: Boolean(addr.RAFFLE && client && completedSeasonIds.length > 0),
    staleTime: 60 * 60 * 1000,
    queryFn: async () => {
      /** @type {SeasonWinnerSummaryMap} */
      const summaries = {};

      // Discover distributor address once via RAFFLE
      const distributor = await client.readContract({
        address: addr.RAFFLE,
        abi: RaffleAbi,
        functionName: "prizeDistributor",
        args: [],
      });

      if (
        !distributor ||
        distributor === "0x0000000000000000000000000000000000000000"
      ) {
        return summaries;
      }

      const winnerAddresses = [];

      for (const seasonId of completedSeasonIds) {
        try {
          // Winner address
          // eslint-disable-next-line no-await-in-loop
          const winners = await client.readContract({
            address: addr.RAFFLE,
            abi: RaffleAbi,
            functionName: "getWinners",
            args: [BigInt(seasonId)],
          });

          const winnerAddress = Array.isArray(winners) ? winners[0] : undefined;
          if (!winnerAddress) continue;

          // Prize amount
          // eslint-disable-next-line no-await-in-loop
          const payouts = await client.readContract({
            address: distributor,
            abi: RafflePrizeDistributorAbi,
            functionName: "getSeason",
            args: [BigInt(seasonId)],
          });

          const grandPrizeWei =
            payouts?.grandAmount ??
            payouts?.[2] ??
            payouts?.["grandAmount"] ??
            0n;

          summaries[seasonId] = {
            winnerAddress,
            winnerUsername: null,
            grandPrizeWei: BigInt(grandPrizeWei || 0n),
          };

          winnerAddresses.push(winnerAddress);
        } catch {
          // Skip failures for individual seasons
        }
      }

      const usernames = await fetchBatchUsernames(
        winnerAddresses.map((a) => a?.toLowerCase()),
      );

      for (const seasonId of Object.keys(summaries)) {
        const id = Number(seasonId);
        const winnerAddress = summaries[id]?.winnerAddress;
        if (!winnerAddress) continue;
        summaries[id].winnerUsername =
          usernames?.[winnerAddress.toLowerCase()] ?? null;
      }

      return summaries;
    },
  });
}

/**
 * Convenience wrapper for a single season.
 * @param {number} seasonId
 * @param {number} status
 * @returns {SeasonWinnerSummary | null}
 */
export function useSeasonWinnerSummary(seasonId, status) {
  const summariesQuery = useSeasonWinnerSummaries(
    seasonId ? [{ id: seasonId, status }] : [],
  );

  const summary =
    seasonId && summariesQuery.data ? summariesQuery.data[seasonId] : null;

  return {
    ...summariesQuery,
    data: summary,
  };
}
