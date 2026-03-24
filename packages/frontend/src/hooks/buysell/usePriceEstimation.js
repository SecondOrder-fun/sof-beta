/**
 * usePriceEstimation Hook
 * Fetches and calculates buy/sell price estimates from bonding curve
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { SOFBondingCurveAbi } from "@/utils/abis";
import {
  calculateAmountWithFees,
  calculateAmountAfterFees,
} from "@/utils/buysell/slippage";

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
  const [buyEstBase, setBuyEstBase] = useState(0n);
  const [sellEstBase, setSellEstBase] = useState(0n);

  const loadEstimate = useCallback(
    async (fnName, amount) => {
      try {
        if (!client) return 0n;
        return await client.readContract({
          address: bondingCurveAddress,
          abi: SOFBondingCurveAbi,
          functionName: fnName,
          args: [BigInt(amount || "0")],
        });
      } catch {
        return 0n;
      }
    },
    [client, bondingCurveAddress]
  );

  // Update buy estimate when amount changes
  useEffect(() => {
    let stop = false;
    (async () => {
      if (!bondingCurveAddress) return;
      const est = await loadEstimate("calculateBuyPrice", buyAmount);
      if (!stop) setBuyEstBase(est);
    })();
    return () => {
      stop = true;
    };
  }, [bondingCurveAddress, buyAmount, loadEstimate]);

  // Update sell estimate when amount changes
  useEffect(() => {
    let stop = false;
    (async () => {
      if (!bondingCurveAddress) return;
      const est = await loadEstimate("calculateSellPrice", sellAmount);
      if (!stop) setSellEstBase(est);
    })();
    return () => {
      stop = true;
    };
  }, [bondingCurveAddress, sellAmount, loadEstimate]);

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
