// src/hooks/useStaggeredRefresh.js
// Encapsulates the staggered refresh pattern for on-chain value updates.
// After a transaction succeeds, we need multiple refresh passes because
// indexers and RPC nodes may lag behind the chain tip.

import { useCallback, useEffect, useRef } from "react";

/**
 * Returns a stable `trigger()` function that, when called, executes all
 * provided refresh functions immediately, then again at 1.5 s and 4 s.
 *
 * @param {Array<Function>} refreshFns - Functions to call at each refresh pass
 * @param {Object} [opts]
 * @param {Function} [opts.onStart] - Called once at the beginning (e.g. setIsRefreshing(true))
 * @param {Function} [opts.onEnd]   - Called after the final pass (e.g. setIsRefreshing(false))
 */
export function useStaggeredRefresh(refreshFns, { onStart, onEnd } = {}) {
  const timersRef = useRef([]);
  const fnsRef = useRef(refreshFns);
  const onStartRef = useRef(onStart);
  const onEndRef = useRef(onEnd);

  // Keep refs pointing at latest values without triggering re-renders
  useEffect(() => {
    fnsRef.current = refreshFns;
    onStartRef.current = onStart;
    onEndRef.current = onEnd;
  });

  // Clean up pending timers on unmount
  useEffect(() => {
    return () => {
      timersRef.current.forEach(clearTimeout);
      timersRef.current = [];
    };
  }, []);

  const trigger = useCallback(() => {
    // Clear any previously scheduled follow-ups
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];

    const fns = fnsRef.current || [];
    onStartRef.current?.();

    // Pass 1: immediate
    fns.forEach((fn) => fn?.());

    // Pass 2: 1.5 s — catches most indexer lag
    timersRef.current.push(
      setTimeout(() => {
        fns.forEach((fn) => fn?.());
      }, 1500),
    );

    // Pass 3: 4 s — final catch-up + signal completion
    timersRef.current.push(
      setTimeout(() => {
        fns.forEach((fn) => fn?.());
        onEndRef.current?.();
      }, 4000),
    );
  }, []);

  return trigger;
}
