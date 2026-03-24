/**
 * useSeasonValidation Hook
 * Validates season status and calculates remaining supply
 */

import { useEffect, useMemo, useState } from "react";
import { SOFBondingCurveAbi } from "@/utils/abis";

/**
 * Hook to validate season status and calculate max buyable
 * @param {Object} client - Viem public client
 * @param {string} bondingCurveAddress - Address of the bonding curve
 * @param {any} seasonStatus - Season status from parent
 * @param {any} seasonEndTime - Season end timestamp
 * @param {boolean} open - Whether sheet is open
 * @returns {Object} Validation results
 */
export function useSeasonValidation(
  client,
  bondingCurveAddress,
  seasonStatus,
  seasonEndTime,
  open
) {
  const [maxBuyable, setMaxBuyable] = useState(null);
  const [nowSec, setNowSec] = useState(() => Math.floor(Date.now() / 1000));

  const seasonEndTimeSec = useMemo(() => {
    if (seasonEndTime == null) return null;
    const asNumber = Number(seasonEndTime);
    if (!Number.isFinite(asNumber)) return null;
    return asNumber;
  }, [seasonEndTime]);

  const seasonStatusNumber = useMemo(() => {
    if (typeof seasonStatus === "number") return seasonStatus;
    const asNumber = Number(seasonStatus);
    if (!Number.isFinite(asNumber)) return null;
    return asNumber;
  }, [seasonStatus]);

  const seasonNotActive = seasonStatusNumber !== null && seasonStatusNumber !== 1;
  const seasonEndedByTime =
    seasonEndTimeSec !== null && Number.isFinite(nowSec)
      ? nowSec >= seasonEndTimeSec
      : false;
  const seasonTimeNotActive = seasonNotActive || seasonEndedByTime;

  // Update clock for countdown
  useEffect(() => {
    if (!open || seasonEndTimeSec == null) return;

    setNowSec(Math.floor(Date.now() / 1000));
    const id = setInterval(() => {
      setNowSec(Math.floor(Date.now() / 1000));
    }, 1000);

    return () => clearInterval(id);
  }, [open, seasonEndTimeSec]);

  // Calculate remaining supply
  useEffect(() => {
    let cancelled = false;

    const loadRemainingSupply = async () => {
      try {
        if (!open || !client || !bondingCurveAddress) return;

        const cfg = await client.readContract({
          address: bondingCurveAddress,
          abi: SOFBondingCurveAbi,
          functionName: "curveConfig",
          args: [],
        });

        const totalSupply = cfg?.[0] ?? 0n;

        const steps = await client.readContract({
          address: bondingCurveAddress,
          abi: SOFBondingCurveAbi,
          functionName: "getBondSteps",
          args: [],
        });

        const lastRangeTo = Array.isArray(steps)
          ? steps[steps.length - 1]?.rangeTo ?? 0n
          : 0n;

        const remaining = lastRangeTo > totalSupply ? lastRangeTo - totalSupply : 0n;
        const remainingAsNumber = Number(remaining);

        if (!Number.isFinite(remainingAsNumber) || remainingAsNumber < 0) {
          if (!cancelled) setMaxBuyable(0);
          return;
        }

        if (!cancelled) setMaxBuyable(Math.floor(remainingAsNumber));
      } catch {
        if (!cancelled) setMaxBuyable(0);
      }
    };

    void loadRemainingSupply();

    return () => {
      cancelled = true;
    };
  }, [open, client, bondingCurveAddress]);

  return {
    maxBuyable,
    seasonTimeNotActive,
    nowSec,
    seasonEndTimeSec,
  };
}
