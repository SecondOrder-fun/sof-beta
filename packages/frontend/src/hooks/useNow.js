// src/hooks/useNow.js
//
// The wall clock, as state: Date.now() refreshed on an interval, so relative
// labels ("Opens in 2h 10m", "3d left") move on their own instead of freezing
// at the value they had on first render. Local time only — for the chain's
// clock use useChainTime.

import { useEffect, useState } from 'react';

/**
 * @param {number} [intervalMs=30000] how often to refresh
 * @returns {number} milliseconds since the epoch
 */
export function useNow(intervalMs = 30_000) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);

  return now;
}
