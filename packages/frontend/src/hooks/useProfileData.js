// src/hooks/useProfileData.js
import { useQuery } from "@tanstack/react-query";
import { useViemClient } from "./useViemClient";
import { getContractAddresses } from "@/config/contracts";
import {
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

  // Raffle ticket balances across non-Upcoming seasons. The raffle-token
  // address per season is already in the warm-tier season_contracts table
  // (surfaced as season.config.raffleToken by useAllSeasons), so we skip
  // the on-chain raffleToken probe entirely and go straight to a single
  // multicall for (decimals, balanceOf) per resolved token.
  //
  // The previous impl fired TWO multicalls per Portfolio mount: one to
  // read raffleToken() on every curve, then one for the balances. The
  // first multicall was redundant — the value it returned never changes
  // and we already had it from the backend. Dropping it halves the POST
  // count and, more importantly, removes the multicall that was sometimes
  // 429ing first and leaving the balances query in a perpetually-empty
  // state (the token resolution never completed, balanceCalls stayed
  // empty, the query "succeeded" with [] data — hence "No ticket balances
  // found" even when the user did hold tickets).
  //
  // staleTime: 0 — every Portfolio mount fetches fresh. Buys/sells happen
  // on Raffle Detail (different mount); completed balances re-resolve to
  // the same multicall result so the cost is one round-trip per mount.
  const seasonsForBalance = seasons.filter(
    (s) =>
      s?.config?.raffleToken &&
      s.config.raffleToken !== "0x0000000000000000000000000000000000000000" &&
      Number(s?.status) !== 0,
  );
  const seasonBalancesQuery = useQuery({
    queryKey: [
      "raffleTokenBalances",
      netKey,
      address,
      seasonsForBalance.map((s) => s.id).join(","),
    ],
    enabled: !!client && !!address && seasonsForBalance.length > 0,
    staleTime: 0,
    queryFn: async () => {
      const balanceCalls = [];
      const seasonMeta = [];
      seasonsForBalance.forEach((s) => {
        const token = s.config.raffleToken;
        seasonMeta.push({ season: s, token });
        balanceCalls.push(
          { address: token, abi: ERC20Abi, functionName: "decimals" },
          { address: token, abi: ERC20Abi, functionName: "balanceOf", args: [address] },
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
    },
  });

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
