// src/hooks/useProfileData.js
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useViemClient } from "./useViemClient";
import { getContractAddresses } from "@/config/contracts";
import {
  SOFBondingCurveAbi,
  ERC20Abi,
  RaffleAbi,
  RafflePrizeDistributorAbi as PrizeDistributorAbi,
} from "@/utils/abis";
import { useAllSeasons } from "./useAllSeasons";
import { useSOFBalance } from "@/hooks/useSOFBalance";
import { getPrizeDistributor } from "@/services/onchainRaffleDistributor";

/**
 * useProfileData - Consolidates SOF balance, raffle token balances, and winning seasons
 * queries for a given address. Works for both own profile and other users.
 *
 * Per spec §4.3, callers should pass the user's SMA (smart account) address
 * rather than the EOA — gameplay balances live at the SMA.
 *
 * @param {string} address - The smart-account address to fetch data for
 * @returns {{ sofBalanceQuery, seasonBalancesQuery, winningSeasonsQuery, client, netKey, contracts, seasons, allSeasonsQuery }}
 */
export function useProfileData(address) {
  const { client, netKey } = useViemClient();
  const contracts = getContractAddresses(netKey);
  const allSeasonsQuery = useAllSeasons();
  const seasons = allSeasonsQuery.data || [];

  // SOF balance — useSOFBalance is canonical (ultra-fresh, central invalidation).
  // Exposed as sofBalanceQuery shim for backward compat with callers that
  // destructure { data, isLoading, refetch }.
  const _sofBalance = useSOFBalance();
  const sofBalanceQuery = {
    data: _sofBalance.balanceRaw,
    isLoading: _sofBalance.isLoading,
    refetch: _sofBalance.refetch,
  };

  // Raffle ticket balances. Split by season lifecycle so completed
  // raffles (immutable) cache forever, active/settling raffles refetch
  // on every Portfolio mount, and upcoming raffles (no possible balance)
  // are skipped entirely:
  //
  //   Upcoming  (0)     → skipped
  //   Active    (1)     → mount-only, staleTime: 0
  //   Settling  (2/3/4) → mount-only, staleTime: 0
  //   Completed (5/6)   → cached forever, staleTime: Infinity
  //
  // Each tier is one query firing two multicalls (raffleToken → then
  // decimals + balanceOf). Cache key is the sorted season-id list, so
  // completed-tier cache survives across navigations within a session.
  // Buys/sells happen on Raffle Detail (not Portfolio), so users always
  // see fresh balances on the next Portfolio mount via the active tier.
  const seasonsWithCurves = seasons.filter(
    (s) => s?.config?.bondingCurve && Number(s?.status) !== 0,
  );
  const activeSeasonsForBalance = seasonsWithCurves.filter((s) => {
    const n = Number(s.status);
    return n >= 1 && n <= 4;
  });
  const completedSeasonsForBalance = seasonsWithCurves.filter((s) => {
    const n = Number(s.status);
    return n === 5 || n === 6;
  });

  const ticketBalancesQueryFn = (bucket) => async () => {
    if (!bucket || bucket.length === 0) return [];
    const tokenResults = await client.multicall({
      contracts: bucket.map((s) => ({
        address: s.config.bondingCurve,
        abi: SOFBondingCurveAbi,
        functionName: "raffleToken",
      })),
      allowFailure: true,
    });

    const balanceCalls = [];
    const seasonMeta = [];
    tokenResults.forEach((r, i) => {
      if (r.status !== "success" || !r.result) return;
      const s = bucket[i];
      seasonMeta.push({ season: s, token: r.result });
      balanceCalls.push(
        { address: r.result, abi: ERC20Abi, functionName: "decimals" },
        { address: r.result, abi: ERC20Abi, functionName: "balanceOf", args: [address] },
      );
    });

    if (balanceCalls.length === 0) return [];

    const balanceResults = await client.multicall({
      contracts: balanceCalls,
      allowFailure: true,
    });

    const results = [];
    for (let i = 0; i < seasonMeta.length; i++) {
      const decRes = balanceResults[i * 2];
      const balRes = balanceResults[i * 2 + 1];
      if (decRes?.status !== "success" || balRes?.status !== "success") continue;
      const bal = balRes.result;
      if (!bal || bal === 0n) continue;
      const decimals = Number(decRes.result);
      const base = 10n ** BigInt(decimals);
      const { season: s, token } = seasonMeta[i];
      results.push({
        seasonId: s.id,
        name: s?.config?.name,
        token,
        bondingCurve: s.config.bondingCurve,
        balance: bal,
        decimals,
        ticketCount: (bal / base).toString(),
      });
    }
    return results;
  };

  const activeBalancesQuery = useQuery({
    queryKey: [
      "raffleTokenBalances",
      "active",
      netKey,
      address,
      activeSeasonsForBalance.map((s) => s.id).join(","),
    ],
    enabled: !!client && !!address && activeSeasonsForBalance.length > 0,
    queryFn: ticketBalancesQueryFn(activeSeasonsForBalance),
    // staleTime: 0 — every Portfolio mount refetches. Buys/sells on
    // Raffle Detail unmount this query; the next nav back fetches
    // fresh balances.
    staleTime: 0,
  });

  const completedBalancesQuery = useQuery({
    queryKey: [
      "raffleTokenBalances",
      "completed",
      netKey,
      address,
      completedSeasonsForBalance.map((s) => s.id).join(","),
    ],
    enabled: !!client && !!address && completedSeasonsForBalance.length > 0,
    queryFn: ticketBalancesQueryFn(completedSeasonsForBalance),
    // staleTime: Infinity — ticket balances for completed seasons are
    // frozen at finalize time. Subsequent mounts within the session
    // reuse the cached result.
    staleTime: Infinity,
  });

  // Combined shape so existing consumers (RaffleList, ProfileContent)
  // keep working without changes. data is the concatenated array;
  // loading/error reflect whichever sub-query is still in flight or
  // has errored.
  const seasonBalancesData = useMemo(() => {
    const a = activeBalancesQuery.data || [];
    const c = completedBalancesQuery.data || [];
    return [...a, ...c];
  }, [activeBalancesQuery.data, completedBalancesQuery.data]);

  const seasonBalancesQuery = {
    data: seasonBalancesData,
    isLoading: activeBalancesQuery.isLoading || completedBalancesQuery.isLoading,
    error: activeBalancesQuery.error || completedBalancesQuery.error,
    refetch: () => {
      activeBalancesQuery.refetch?.();
      completedBalancesQuery.refetch?.();
    },
  };

  // Winning seasons for Completed Season Prizes carousel. Only fire when
  // there's actually at least one completed season — otherwise we'd burn
  // N RPC reads to discover "no one won anything yet" on every page load.
  // Also batched via multicall.
  const completedSeasons = seasons.filter((s) => Number(s?.status) === 5);
  const winningSeasonsQuery = useQuery({
    queryKey: [
      "winningSeasons",
      netKey,
      address,
      completedSeasons.map((s) => s.id).join(","),
    ],
    enabled: !!client && !!address && completedSeasons.length > 0,
    queryFn: async () => {
      let distributorAddress;
      try {
        distributorAddress = await getPrizeDistributor({ networkKey: netKey });
      } catch {
        distributorAddress = undefined;
      }
      if (!distributorAddress && contracts.RAFFLE) {
        try {
          distributorAddress = await client.readContract({
            address: contracts.RAFFLE,
            abi: RaffleAbi,
            functionName: "prizeDistributor",
            args: [],
          });
        } catch {
          distributorAddress = undefined;
        }
      }
      if (
        !distributorAddress ||
        distributorAddress === "0x0000000000000000000000000000000000000000"
      ) {
        return [];
      }

      // Batch getSeason() across all completed seasons via multicall.
      const results = await client.multicall({
        contracts: completedSeasons.map((s) => ({
          address: distributorAddress,
          abi: PrizeDistributorAbi,
          functionName: "getSeason",
          args: [BigInt(s.id)],
        })),
        allowFailure: true,
      });

      const lowerAddr = address?.toLowerCase();
      const winners = [];
      results.forEach((r, i) => {
        if (r.status !== "success") return;
        const gw = r.result?.grandWinner;
        if (
          gw &&
          typeof gw === "string" &&
          lowerAddr &&
          gw.toLowerCase() === lowerAddr
        ) {
          winners.push(completedSeasons[i]);
        }
      });
      return winners;
    },
    staleTime: 15_000,
  });

  return {
    sofBalanceQuery,
    seasonBalancesQuery,
    winningSeasonsQuery,
    client,
    netKey,
    contracts,
    seasons,
    allSeasonsQuery,
  };
}
