// src/hooks/useCurveState.js
import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useWarmRead } from '@/hooks/chain/useWarmRead';
import { useLiveSubscription } from '@/hooks/chain/useLiveSubscription';

/**
 * Bonding curve state, served from backend cache populated by listeners.
 *
 *   isActive=true   → subscribe to /sse/raffle for PositionUpdate; on event,
 *                     invalidate the warm cache so the next render sees fresh data.
 *   isActive=false  → warm cache only (curve state changes only on trades).
 *
 * Steps are immutable post-creation and served by /api/curve/:addr/steps;
 * never refetched after first success.
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
  const steps = stepsQuery.data || [];
  const tail = steps.slice(Math.max(0, steps.length - 3));

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
    refreshCurveState,
    debouncedRefresh,
  };
}
