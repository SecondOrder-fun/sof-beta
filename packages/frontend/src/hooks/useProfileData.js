// src/hooks/useProfileData.js
import { useQuery } from "@tanstack/react-query";
import { useViemClient } from "./useViemClient";
import { getContractAddresses } from "@/config/contracts";
import {
  ERC20Abi,
  SOFBondingCurveAbi,
  RaffleAbi,
  RafflePrizeDistributorAbi as PrizeDistributorAbi,
} from "@/utils/abis";
import { useAllSeasons } from "./useAllSeasons";
import { getPrizeDistributor } from "@/services/onchainRaffleDistributor";

/**
 * useProfileData - Consolidates SOF balance, raffle token balances, and winning seasons
 * queries for a given address. Works for both own profile and other users.
 *
 * @param {string} address - The wallet address to fetch data for
 * @returns {{ sofBalanceQuery, seasonBalancesQuery, winningSeasonsQuery, client, netKey, contracts, seasons, allSeasonsQuery }}
 */
export function useProfileData(address) {
  const { client, netKey } = useViemClient();
  const contracts = getContractAddresses(netKey);
  const allSeasonsQuery = useAllSeasons();
  const seasons = allSeasonsQuery.data || [];

  // SOF balance query
  const sofBalanceQuery = useQuery({
    queryKey: ["sofBalance", netKey, contracts.SOF, address],
    enabled: !!client && !!contracts.SOF && !!address,
    queryFn: async () => {
      const bal = await client.readContract({
        address: contracts.SOF,
        abi: ERC20Abi,
        functionName: "balanceOf",
        args: [address],
      });
      return bal; // BigInt
    },
    staleTime: 15_000,
  });

  // Raffle ticket balances across seasons
  const seasonBalancesQuery = useQuery({
    queryKey: [
      "raffleTokenBalances",
      netKey,
      address,
      seasons.map((s) => s.id).join(","),
    ],
    enabled: !!client && !!address && seasons.length > 0,
    queryFn: async () => {
      const results = [];
      for (const s of seasons) {
        const curveAddr = s?.config?.bondingCurve;
        if (!curveAddr) continue;
        try {
          const raffleTokenAddr = await client.readContract({
            address: curveAddr,
            abi: SOFBondingCurveAbi,
            functionName: "raffleToken",
            args: [],
          });
          const [decimals, bal] = await Promise.all([
            client.readContract({
              address: raffleTokenAddr,
              abi: ERC20Abi,
              functionName: "decimals",
              args: [],
            }),
            client.readContract({
              address: raffleTokenAddr,
              abi: ERC20Abi,
              functionName: "balanceOf",
              args: [address],
            }),
          ]);
          if ((bal ?? 0n) > 0n) {
            const base = 10n ** BigInt(decimals);
            const ticketCount = (bal / base).toString();
            results.push({
              seasonId: s.id,
              name: s?.config?.name,
              token: raffleTokenAddr,
              bondingCurve: curveAddr,
              balance: bal,
              decimals,
              ticketCount,
            });
          }
        } catch {
          // Skip problematic season gracefully
        }
      }
      return results;
    },
    staleTime: 15_000,
  });

  // Winning seasons for Completed Season Prizes carousel
  const winningSeasonsQuery = useQuery({
    queryKey: [
      "winningSeasons",
      netKey,
      address,
      seasons.map((s) => s.id).join(","),
    ],
    enabled: !!client && !!address && seasons.length > 0,
    queryFn: async () => {
      // Discover prize distributor address
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

      const lowerAddr = address?.toLowerCase();
      const checks = await Promise.all(
        seasons.map(async (s) => {
          try {
            const seasonData = await client.readContract({
              address: distributorAddress,
              abi: PrizeDistributorAbi,
              functionName: "getSeason",
              args: [BigInt(s.id)],
            });
            const gw = seasonData?.grandWinner;
            if (
              gw &&
              typeof gw === "string" &&
              lowerAddr &&
              gw.toLowerCase() === lowerAddr
            ) {
              return s;
            }
          } catch {
            // ignore failing season
          }
          return null;
        })
      );

      return checks.filter(Boolean);
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
