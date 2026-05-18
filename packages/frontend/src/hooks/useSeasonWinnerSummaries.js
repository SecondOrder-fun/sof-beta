// src/hooks/useSeasonWinnerSummaries.js
//
// D13: Split active (warm) vs completed (cold) data sources.
//
// Completed seasons (status 4 or 5): winner addresses and prize amounts are
// immutable on-chain data. The on-chain queryFn uses staleTime: Infinity so
// the data is effectively cold — never re-fetched after first load.
//
// Usernames: resolved via a separate useWarmRead call that batch-fetches
// Farcaster usernames from the backend index. Joined into the summaries
// after both queries settle.
//
// Active seasons: this hook does not read active-season data — it only
// processes completedSeasonIds (status 4 or 5).

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { usePublicClient } from "wagmi";
import { getStoredNetworkKey } from "@/lib/wagmi";
import { getContractAddresses } from "@/config/contracts";
import { RaffleAbi, RafflePrizeDistributorAbi } from "@/utils/abis";
import { useWarmRead } from "@/hooks/chain/useWarmRead";
import { getPrizeDistributor } from "@/services/onchainRaffleDistributor";

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
 * Get winner summaries for completed seasons.
 *
 * Completed/settled is determined by on-chain SeasonStatus.Completed === 5.
 * This hook only fetches data for seasons where `status === 4 or 5`.
 *
 * On-chain data (winners, prize amounts) uses staleTime: Infinity — completed
 * season data is immutable. Username resolution uses useWarmRead (20 s stale).
 *
 * @param {{ id: number, status: number }[]} seasons
 * @param {object} [options]
 * @param {boolean} [options.enabled=true] — gate the on-chain + warm reads.
 *   Callers viewing a non-Complete tab should pass `false` so the two
 *   multicalls (winners + payouts) don't fire on every page mount when the
 *   user may never open the Complete tab.
 * @returns {{ data: SeasonWinnerSummaryMap | undefined, isLoading: boolean, error: unknown }}
 */
export function useSeasonWinnerSummaries(seasons, { enabled = true } = {}) {
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

  // ── Cold on-chain query: winner addresses + prize amounts ──
  // Completed season data is immutable — staleTime: Infinity prevents
  // any re-fetch after the first successful load.
  const onChainQuery = useQuery({
    queryKey: [
      "seasonWinnerSummaries",
      "onchain",
      addr.RAFFLE,
      completedSeasonIds
        .slice()
        .sort((a, b) => a - b)
        .join(","),
    ],
    enabled:
      Boolean(enabled) &&
      Boolean(addr.RAFFLE && client && completedSeasonIds.length > 0),
    staleTime: Infinity, // Completed season data never changes — treat as cold.
    queryFn: async () => {
      /** @type {Record<number, { winnerAddress: string; grandPrizeWei: bigint }>} */
      const raw = {};

      // Discover distributor via the module-cached helper (single RPC read
      // per network for the entire app lifetime — not once per mount).
      let distributor;
      try {
        distributor = await getPrizeDistributor({ networkKey: netKey });
      } catch {
        distributor = await client.readContract({
          address: addr.RAFFLE,
          abi: RaffleAbi,
          functionName: "prizeDistributor",
          args: [],
        });
      }

      if (
        !distributor ||
        distributor === "0x0000000000000000000000000000000000000000"
      ) {
        return raw;
      }

      // Batch getWinners() and getSeason() across every completed season
      // via two multicalls. Previously this loop did 2 sequential RPC reads
      // per season — 2N reads total. Now 2 RPC HTTP requests total.
      const winnersBatch = await client.multicall({
        contracts: completedSeasonIds.map((sid) => ({
          address: addr.RAFFLE,
          abi: RaffleAbi,
          functionName: "getWinners",
          args: [BigInt(sid)],
        })),
        allowFailure: true,
      });

      const payoutsBatch = await client.multicall({
        contracts: completedSeasonIds.map((sid) => ({
          address: distributor,
          abi: RafflePrizeDistributorAbi,
          functionName: "getSeason",
          args: [BigInt(sid)],
        })),
        allowFailure: true,
      });

      for (let i = 0; i < completedSeasonIds.length; i++) {
        const seasonId = completedSeasonIds[i];
        const winnersRes = winnersBatch[i];
        const payoutsRes = payoutsBatch[i];
        if (winnersRes?.status !== "success") continue;
        const winners = winnersRes.result;
        const winnerAddress = Array.isArray(winners) ? winners[0] : undefined;
        if (!winnerAddress) continue;

        const payouts = payoutsRes?.status === "success" ? payoutsRes.result : null;
        const grandPrizeWei =
          payouts?.grandAmount ??
          payouts?.[2] ??
          payouts?.["grandAmount"] ??
          0n;

        raw[seasonId] = {
          winnerAddress,
          grandPrizeWei: BigInt(grandPrizeWei || 0n),
        };
      }

      return raw;
    },
  });

  // ── Warm username batch: resolved from backend index ──
  // Collect all unique winner addresses to batch-resolve usernames.
  const winnerAddresses = useMemo(() => {
    if (!onChainQuery.data) return [];
    return Object.values(onChainQuery.data)
      .map((s) => s?.winnerAddress?.toLowerCase())
      .filter(Boolean);
  }, [onChainQuery.data]);

  const usernamesWarm = useWarmRead({
    path: "/usernames/batch",
    params: winnerAddresses.length > 0 ? { addresses: winnerAddresses.join(",") } : {},
    enabled: winnerAddresses.length > 0,
    staleTime: 5 * 60_000, // Usernames can change; 5 min warm cache.
  });

  // ── Join on-chain data with warm username lookups ──
  const data = useMemo(() => {
    if (!onChainQuery.data) return undefined;

    /** @type {SeasonWinnerSummaryMap} */
    const summaries = {};
    const usernames = usernamesWarm.data ?? {};

    for (const [seasonIdStr, entry] of Object.entries(onChainQuery.data)) {
      const id = Number(seasonIdStr);
      summaries[id] = {
        winnerAddress: entry.winnerAddress,
        winnerUsername: usernames[entry.winnerAddress?.toLowerCase()] ?? null,
        grandPrizeWei: entry.grandPrizeWei,
      };
    }

    return summaries;
  }, [onChainQuery.data, usernamesWarm.data]);

  return {
    data,
    isLoading: onChainQuery.isLoading,
    error: onChainQuery.error,
  };
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
