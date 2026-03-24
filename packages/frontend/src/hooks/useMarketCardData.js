import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { buildPublicClient } from "@/lib/viemClient";
import { getAddress } from "viem";
import { SOFBondingCurveAbi, ERC20Abi } from "@/utils/abis";
import { useSeasonDetailsQuery } from "@/hooks/useRaffleRead";

/**
 * Custom hook for market card data
 * Extracts data fetching logic from InfoFiMarketCard
 */
export function useMarketCardData(market, seasonId) {
  const netKey = (
    import.meta.env.VITE_DEFAULT_NETWORK || "LOCAL"
  ).toUpperCase();
  const publicClient = useMemo(() => {
    return buildPublicClient(netKey);
  }, [netKey]);

  const isWinnerPrediction =
    market.market_type === "WINNER_PREDICTION" &&
    market.player &&
    seasonId != null;

  // Normalize probability from database (in basis points)
  const normalizeBps = useMemo(() => {
    return (value) => {
      if (value == null) return null;
      if (typeof value === "bigint") {
        const num = Number(value);
        if (Number.isNaN(num)) return null;
        return Math.max(0, Math.min(10000, Math.round(num)));
      }
      const num = Number(value);
      if (Number.isNaN(num)) return null;
      return Math.max(0, Math.min(10000, Math.round(num)));
    };
  }, []);

  const probabilityBps = normalizeBps(
    market?.current_probability_bps ?? market?.current_probability,
  );

  // Get season details for bonding curve
  const seasonDetailsQuery = useSeasonDetailsQuery(seasonId);
  const bondingCurveAddressRaw =
    seasonDetailsQuery?.data?.[0]?.[2] ||
    seasonDetailsQuery?.data?.config?.bondingCurve;
  const bondingCurveAddress = useMemo(() => {
    if (!bondingCurveAddressRaw) return null;
    const addr = getAddress
      ? getAddress(bondingCurveAddressRaw)
      : bondingCurveAddressRaw;
    const zero = "0x0000000000000000000000000000000000000000";
    return addr?.toLowerCase() === zero ? null : addr;
  }, [bondingCurveAddressRaw]);

  // Check if player has raffle tickets
  const playerTicketBalance = useQuery({
    queryKey: [
      "playerTicketBalance",
      seasonId,
      market?.player,
      bondingCurveAddress,
    ],
    enabled:
      isWinnerPrediction && Boolean(bondingCurveAddress) && !!market?.player,
    queryFn: async () => {
      try {
        const raffleTokenAddr = await publicClient.readContract({
          address: bondingCurveAddress,
          abi: SOFBondingCurveAbi,
          functionName: "raffleToken",
          args: [],
        });

        const balance = await publicClient.readContract({
          address: raffleTokenAddr,
          abi: ERC20Abi,
          functionName: "balanceOf",
          args: [market.player],
        });

        return balance;
      } catch (error) {
        if (import.meta.env.DEV) {
          // eslint-disable-next-line no-console
          console.error("Failed to fetch player ticket balance:", error);
        }
        return 0n;
      }
    },
    staleTime: 10_000,
    refetchInterval: 10_000,
  });

  const playerHasTickets = playerTicketBalance?.data
    ? playerTicketBalance.data > 0n
    : null;

  // Display percent from database
  const percent = useMemo(() => {
    if (probabilityBps != null) {
      return (probabilityBps / 100).toFixed(1);
    }
    return null;
  }, [probabilityBps]);

  const isLoadingPlayer =
    market.market_type === "WINNER_PREDICTION" && !market.player;
  const isLoadingOracle = isWinnerPrediction && probabilityBps === null;

  return {
    isLoadingPlayer,
    isLoadingOracle,
    playerHasTickets,
    percent,
    probabilityBps,
  };
}
