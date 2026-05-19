/**
 * useTradingLockStatus Hook
 * Monitors trading lock status and fee configuration from bonding curve
 */

import { useQuery } from "@tanstack/react-query";
import { SOFBondingCurveAbi } from "@/utils/abis";

/**
 * Hook to check trading lock status and fees.
 *
 * Wrapped in react-query so multiple components reading the same curve
 * share a single cached RPC call instead of each firing a fresh
 * readContract. The previous useState+useEffect implementation fired
 * one RPC per mount — easy to multiply into Tenderly 429s.
 *
 * @param {Object} client - Viem public client
 * @param {string} bondingCurveAddress
 * @returns {Object} { tradingLocked, buyFeeBps, sellFeeBps }
 */
export function useTradingLockStatus(client, bondingCurveAddress) {
  const { data } = useQuery({
    queryKey: ["tradingLockStatus", bondingCurveAddress?.toLowerCase()],
    enabled: !!client && !!bondingCurveAddress,
    staleTime: 30_000,
    retry: 1,
    queryFn: async () => {
      const config = await client.readContract({
        address: bondingCurveAddress,
        abi: SOFBondingCurveAbi,
        functionName: "curveConfig",
        args: [],
      });
      // curveConfig returns: [totalSupply, sofReserves, currentStep, buyFee,
      // sellFee, tradingLocked, initialized, initialPrice]
      return {
        tradingLocked: Boolean(config[5]),
        buyFeeBps: Number(config[3] ?? 0),
        sellFeeBps: Number(config[4] ?? 0),
      };
    },
  });

  return {
    tradingLocked: data?.tradingLocked ?? false,
    buyFeeBps: data?.buyFeeBps ?? 0,
    sellFeeBps: data?.sellFeeBps ?? 0,
  };
}
