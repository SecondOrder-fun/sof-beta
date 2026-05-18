/**
 * usePriceEstimation Hook
 * Fetches and calculates buy/sell price estimates from bonding curve
 */

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { SOFBondingCurveAbi } from "@/utils/abis";
import {
  calculateAmountWithFees,
  calculateAmountAfterFees,
} from "@/utils/buysell/slippage";

const PRICE_INPUT_DEBOUNCE_MS = 250;

// useDebouncedValue — defer rapid input changes so the price-estimate
// queryKey doesn't churn one new RPC call per keystroke. Each unique
// debounced value is still cached for 5s by react-query (staleTime).
function useDebouncedValue(value, delayMs) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

/**
 * Hook to estimate prices for buy/sell operations
 * @param {Object} client - Viem public client
 * @param {string} bondingCurveAddress - Address of the bonding curve contract
 * @param {string} buyAmount - Amount to buy (as string)
 * @param {string} sellAmount - Amount to sell (as string)
 * @param {number} buyFeeBps - Buy fee in basis points
 * @param {number} sellFeeBps - Sell fee in basis points
 * @returns {Object} Price estimates { buyEstBase, sellEstBase, estBuyWithFees, estSellAfterFees }
 */
export function usePriceEstimation(
  client,
  bondingCurveAddress,
  buyAmount,
  sellAmount,
  buyFeeBps,
  sellFeeBps
) {
  // Previously fired one fresh readContract per buy/sell input change with
  // useState+useEffect — every keystroke when typing an amount was a fresh
  // RPC call. Now both estimates run through react-query so identical
  // amounts dedupe across renders, and the queryKey caches results for
  // 5 seconds (curve config is read-only between trades on testnet).
  // Inputs are debounced so typing "1000" doesn't fire 4 separate
  // readContract calls — only the final settled value queries the chain.
  const buyKeyRaw = String(buyAmount ?? "0");
  const sellKeyRaw = String(sellAmount ?? "0");
  const buyKey = useDebouncedValue(buyKeyRaw, PRICE_INPUT_DEBOUNCE_MS);
  const sellKey = useDebouncedValue(sellKeyRaw, PRICE_INPUT_DEBOUNCE_MS);

  const { data: buyEstBase = 0n } = useQuery({
    queryKey: ["priceEstimate", "buy", bondingCurveAddress, buyKey],
    enabled: !!client && !!bondingCurveAddress,
    staleTime: 5_000,
    retry: 0,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      try {
        return await client.readContract({
          address: bondingCurveAddress,
          abi: SOFBondingCurveAbi,
          functionName: "calculateBuyPrice",
          args: [BigInt(buyKey)],
        });
      } catch {
        return 0n;
      }
    },
  });

  const { data: sellEstBase = 0n } = useQuery({
    queryKey: ["priceEstimate", "sell", bondingCurveAddress, sellKey],
    enabled: !!client && !!bondingCurveAddress,
    staleTime: 5_000,
    retry: 0,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      try {
        return await client.readContract({
          address: bondingCurveAddress,
          abi: SOFBondingCurveAbi,
          functionName: "calculateSellPrice",
          args: [BigInt(sellKey)],
        });
      } catch {
        return 0n;
      }
    },
  });

  const estBuyWithFees = useMemo(
    () => calculateAmountWithFees(buyEstBase, buyFeeBps),
    [buyEstBase, buyFeeBps]
  );

  const estSellAfterFees = useMemo(
    () => calculateAmountAfterFees(sellEstBase, sellFeeBps),
    [sellEstBase, sellFeeBps]
  );

  return {
    buyEstBase,
    sellEstBase,
    estBuyWithFees,
    estSellAfterFees,
  };
}
