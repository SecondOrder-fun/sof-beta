// src/hooks/useCurveState.js
import { useCallback, useEffect, useRef, useState } from "react";
import { getStoredNetworkKey } from "@/lib/wagmi";
import { buildPublicClient } from "@/lib/viemClient";

/**
 * useCurveState keeps bonding curve state (supply, reserves, current step, steps tail) fresh.
 * - Exposes debounced refresh for tx success events
 * - Polls periodically while season is Active
 * - Bond steps are immutable once a season is created, so we skip re-fetching
 *   them after the first successful load.
 */
export function useCurveState(
  bondingCurveAddress,
  {
    isActive = false,
    pollMs = 12000,
    includeSteps = true,
    includeFees = true,
    enabled = true,
  } = {},
) {
  const [curveSupply, setCurveSupply] = useState(0n);
  const [curveReserves, setCurveReserves] = useState(0n);
  const [curveStep, setCurveStep] = useState(null); // { step, price, rangeTo }
  const [bondStepsPreview, setBondStepsPreview] = useState([]);
  const [allBondSteps, setAllBondSteps] = useState([]);
  const [curveFees, setCurveFees] = useState(0n);

  const refreshTimerRef = useRef(null);
  // Bond steps are immutable after season creation — skip re-fetching after first load
  const stepsLoadedRef = useRef(false);
  const prevCurveAddrRef = useRef(bondingCurveAddress);

  // Reset stepsLoadedRef when the bonding curve address changes (different season)
  if (prevCurveAddrRef.current !== bondingCurveAddress) {
    prevCurveAddrRef.current = bondingCurveAddress;
    stepsLoadedRef.current = false;
  }

  const refreshCurveState = useCallback(async () => {
    try {
      if (!bondingCurveAddress || !enabled) return;
      const netKey = getStoredNetworkKey();
      const client = buildPublicClient(netKey);
      if (!client) return;
      const { SOFBondingCurveABI: SOFBondingCurveAbi } =
        await import("@sof/contracts");

      // Should we fetch steps this cycle?
      const shouldFetchSteps = includeSteps && !stepsLoadedRef.current;

      const contracts = [
        {
          address: bondingCurveAddress,
          abi: SOFBondingCurveAbi,
          functionName: "curveConfig",
          args: [],
        },
        {
          address: bondingCurveAddress,
          abi: SOFBondingCurveAbi,
          functionName: "getCurrentStep",
          args: [],
        },
      ];

      if (shouldFetchSteps) {
        contracts.push({
          address: bondingCurveAddress,
          abi: SOFBondingCurveAbi,
          functionName: "getBondSteps",
          args: [],
        });
      }

      if (includeFees) {
        contracts.push({
          address: bondingCurveAddress,
          abi: SOFBondingCurveAbi,
          functionName: "accumulatedFees",
          args: [],
        });
      }

      let results;
      try {
        if (typeof client.multicall !== "function") {
          throw new Error("multicall unavailable");
        }
        results = await client.multicall({
          contracts,
          allowFailure: true,
        });
      } catch (_e) {
        // eslint-disable-next-line no-console
        console.debug(
          "useCurveState: multicall failed, falling back to readContract",
          _e,
        );
        const settled = await Promise.allSettled(
          contracts.map((c) =>
            client.readContract({
              address: c.address,
              abi: c.abi,
              functionName: c.functionName,
              args: c.args,
            }),
          ),
        );
        results = settled.map((r) =>
          r.status === "fulfilled"
            ? { status: "success", result: r.value }
            : { status: "failure", error: r.reason },
        );
      }

      const cfgResult =
        results[0]?.status === "success" ? results[0].result : null;
      const stepResult =
        results[1]?.status === "success" ? results[1].result : null;
      const stepsIndex = shouldFetchSteps ? 2 : -1;
      const feesIndex = includeFees ? (shouldFetchSteps ? 3 : 2) : -1;
      const stepsResult =
        stepsIndex >= 0 && results[stepsIndex]?.status === "success"
          ? results[stepsIndex].result
          : [];
      const feesResult =
        feesIndex >= 0 && results[feesIndex]?.status === "success"
          ? results[feesIndex].result
          : 0n;

      const steps = Array.isArray(stepsResult) ? stepsResult : [];

      setCurveSupply(cfgResult?.[0] ?? 0n);
      setCurveReserves(cfgResult?.[1] ?? 0n);
      setCurveStep({
        step: stepResult?.[0] ?? 0n,
        price: stepResult?.[1] ?? 0n,
        rangeTo: stepResult?.[2] ?? 0n,
      });
      if (shouldFetchSteps && steps.length > 0) {
        setBondStepsPreview(steps.slice(Math.max(0, steps.length - 3)));
        setAllBondSteps(steps);
        stepsLoadedRef.current = true;
      } else if (!includeSteps) {
        setBondStepsPreview([]);
        setAllBondSteps([]);
      }
      setCurveFees(includeFees ? (feesResult ?? 0n) : 0n);
    } catch (_e) {
      // silent
    }
  }, [bondingCurveAddress, enabled, includeSteps, includeFees]);

  const debouncedRefresh = useCallback(
    (delay = 600) => {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = setTimeout(() => {
        refreshTimerRef.current = null;
        void refreshCurveState();
      }, delay);
    },
    [refreshCurveState],
  );

  useEffect(() => {
    if (!isActive || !bondingCurveAddress || !enabled) return;
    let mounted = true;
    // initial prime
    void refreshCurveState();
    const id = setInterval(() => {
      if (!mounted) return;
      void refreshCurveState();
    }, pollMs);
    return () => {
      mounted = false;
      clearInterval(id);
    };
  }, [isActive, pollMs, bondingCurveAddress, enabled, refreshCurveState]);

  // One-time fetch for pre-start seasons (curve data is immutable once deployed)
  useEffect(() => {
    if (isActive || !enabled || !bondingCurveAddress) return;
    void refreshCurveState();
  }, [isActive, enabled, bondingCurveAddress, refreshCurveState]);

  return {
    curveSupply,
    curveReserves,
    curveFees,
    curveStep,
    bondStepsPreview,
    allBondSteps,
    refreshCurveState,
    debouncedRefresh,
  };
}
