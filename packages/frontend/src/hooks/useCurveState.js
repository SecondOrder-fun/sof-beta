// src/hooks/useCurveState.js
import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useWarmRead } from '@/hooks/chain/useWarmRead';
import { useLiveSubscription } from '@/hooks/chain/useLiveSubscription';
import { buildPublicClient } from '@/lib/viemClient';
import { getStoredNetworkKey } from '@/lib/wagmi';
import { SOFBondingCurveAbi } from '@/utils/abis';

/**
 * Bonding curve state, served from backend cache populated by listeners.
 *
 *   isActive=true   → subscribe to /sse/raffle for PositionUpdate; on event,
 *                     invalidate the warm cache so the next render sees fresh data.
 *   isActive=false  → warm cache only (curve state changes only on trades).
 *
 * Steps are immutable post-creation and served by /api/curve/:addr/steps;
 * never refetched after first success.
 *
 * Bond-step RPC fallback: when the backend cache hasn't been seeded yet (e.g.
 * a season created before the seasonStatusListener.SeasonCreated handler ran,
 * or a transient listener gap), the warm read returns 404. Without a fallback
 * Upcoming raffle cards render with a blank curve graph and "0.0000 SOF"
 * starting price — even though the on-chain step ladder has been immutable
 * since season creation. So we read getBondSteps directly from the bonding
 * curve contract whenever the warm read finishes with no data. The on-chain
 * ladder is genuinely immutable, so the result is cached with
 * staleTime: Infinity.
 */
export function useCurveState(
  bondingCurveAddress,
  { isActive = false, includeSteps = true, includeFees = true, enabled = true } = {},
) {
  const queryClient = useQueryClient();
  const lowerAddr = bondingCurveAddress ? bondingCurveAddress.toLowerCase() : '';

  const stateQuery = useWarmRead({
    path: '/curve/:address/state',
    params: { address: lowerAddr },
    enabled: enabled && !!bondingCurveAddress,
    staleTime: isActive ? 5_000 : 60_000,
  });

  const stepsQuery = useWarmRead({
    path: '/curve/:address/steps',
    params: { address: lowerAddr },
    enabled: enabled && !!bondingCurveAddress && includeSteps,
    staleTime: Infinity, // immutable
  });

  // RPC fallback for the immutable bond-step ladder. Activates only after the
  // warm read has finished (success-with-empty OR error) and produced no
  // usable data.
  const warmStepsResolved =
    stepsQuery.isFetched || stepsQuery.isError;
  const warmStepsEmpty =
    warmStepsResolved &&
    (!Array.isArray(stepsQuery.data) || stepsQuery.data.length === 0);
  const netKey = getStoredNetworkKey();
  const chainStepsQuery = useQuery({
    queryKey: ['chainBondSteps', netKey, lowerAddr],
    enabled:
      enabled && includeSteps && !!bondingCurveAddress && warmStepsEmpty,
    staleTime: Infinity,
    retry: 1,
    queryFn: async () => {
      const client = buildPublicClient(netKey);
      if (!client) return [];
      const raw = await client.readContract({
        address: bondingCurveAddress,
        abi: SOFBondingCurveAbi,
        functionName: 'getBondSteps',
      });
      return (raw || []).map((s) => ({
        rangeTo: (s?.rangeTo ?? s?.[0] ?? 0n).toString(),
        price: (s?.price ?? s?.[1] ?? 0n).toString(),
      }));
    },
  });

  useLiveSubscription({
    channel: 'raffle',
    enabled: isActive && !!bondingCurveAddress,
    filter: (e) =>
      e.type === 'PositionUpdate' &&
      e.bondingCurveAddress?.toLowerCase() === lowerAddr,
    onEvent: () => {
      queryClient.invalidateQueries({
        queryKey: ['warm', '/curve/:address/state', { address: lowerAddr }],
      });
    },
  });

  const refreshCurveState = useCallback(() => {
    queryClient.invalidateQueries({
      queryKey: ['warm', '/curve/:address/state', { address: lowerAddr }],
    });
  }, [queryClient, lowerAddr]);

  const debouncedRefresh = useCallback(
    (delay = 600) => {
      const t = setTimeout(refreshCurveState, delay);
      return () => clearTimeout(t);
    },
    [refreshCurveState],
  );

  const state = stateQuery.data;
  const steps =
    Array.isArray(stepsQuery.data) && stepsQuery.data.length > 0
      ? stepsQuery.data
      : chainStepsQuery.data || [];
  const tail = steps.slice(Math.max(0, steps.length - 3));

  // Loading signal for the price-bearing cards (#150). The immutable step
  // ladder is "settled" once the warm cache returns steps, or — when the warm
  // cache is empty — the on-chain fallback has finished. A live currentStep
  // from the state cache also gives us a price to paint. Until one of those
  // holds we can't distinguish "still loading" from "genuinely no curve", so
  // consumers render a Skeleton instead of a premature 0.0000.
  const chainStepsResolved = chainStepsQuery.isFetched || chainStepsQuery.isError;
  const stepsSettled =
    (warmStepsResolved && !warmStepsEmpty) ||
    (warmStepsEmpty && chainStepsResolved);
  const isPriceLoading =
    enabled &&
    includeSteps &&
    !!bondingCurveAddress &&
    !state?.currentStep &&
    !stepsSettled;

  return {
    curveSupply: state?.currentSupply ? BigInt(state.currentSupply) : 0n,
    curveReserves: state?.sofReserves ? BigInt(state.sofReserves) : 0n,
    curveFees: includeFees && state?.accumulatedFees ? BigInt(state.accumulatedFees) : 0n,
    curveStep: state?.currentStep
      ? {
          step: BigInt(state.currentStep.index ?? 0),
          price: BigInt(state.currentStep.price ?? 0),
          rangeTo: BigInt(state.currentStep.rangeTo ?? 0),
        }
      : null,
    bondStepsPreview: tail.map((s) => ({
      rangeTo: BigInt(s.rangeTo),
      price: BigInt(s.price),
    })),
    allBondSteps: steps.map((s) => ({
      rangeTo: BigInt(s.rangeTo),
      price: BigInt(s.price),
    })),
    isPriceLoading,
    refreshCurveState,
    debouncedRefresh,
  };
}
