/**
 * useTradingLockStatus Hook
 * Monitors trading lock status and fee configuration from bonding curve
 */

import { useEffect, useState } from "react";
import { SOFBondingCurveAbi } from "@/utils/abis";

/**
 * Hook to check trading lock status and fees
 * @param {Object} client - Viem public client
 * @param {string} bondingCurveAddress - Address of the bonding curve contract
 * @returns {Object} Trading status { tradingLocked, buyFeeBps, sellFeeBps }
 */
export function useTradingLockStatus(client, bondingCurveAddress) {
  const [tradingLocked, setTradingLocked] = useState(false);
  const [buyFeeBps, setBuyFeeBps] = useState(0);
  const [sellFeeBps, setSellFeeBps] = useState(0);

  useEffect(() => {
    let cancelled = false;

    const checkTradingStatus = async () => {
      if (!client || !bondingCurveAddress) return;

      try {
        const config = await client.readContract({
          address: bondingCurveAddress,
          abi: SOFBondingCurveAbi,
          functionName: "curveConfig",
          args: [],
        });

        // curveConfig returns: [totalSupply, sofReserves, currentStep, buyFee, sellFee, tradingLocked, initialized]
        const isLocked = config[5]; // tradingLocked is at index 5
        const buyFee = Number(config[3] ?? 0);
        const sellFee = Number(config[4] ?? 0);

        if (!cancelled) {
          setTradingLocked(isLocked);
          setBuyFeeBps(buyFee);
          setSellFeeBps(sellFee);
        }
      } catch {
        // Silent fail - keep default values
      }
    };

    void checkTradingStatus();

    return () => {
      cancelled = true;
    };
  }, [client, bondingCurveAddress]);

  return { tradingLocked, buyFeeBps, sellFeeBps };
}
