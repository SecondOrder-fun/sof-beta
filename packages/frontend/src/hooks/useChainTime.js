// src/hooks/useChainTime.js
import { useWarmRead } from '@/hooks/chain/useWarmRead';

/**
 * Returns the latest chain block timestamp from /api/chain/time, populated
 * by backend listener polling. Refetches every 10s by default — pass
 * `refetchInterval: ms` to override.
 *
 * Returns `null` until the backend cache has been populated.
 *
 * @param {object} [opts]
 * @param {number} [opts.refetchInterval=10000] - Polling interval in ms
 * @returns {number|null} block.timestamp as a JS number (seconds), or null
 */
export function useChainTime(opts = {}) {
  const query = useWarmRead({
    path: '/chain/time',
    refetchInterval: opts.refetchInterval ?? 10_000,
    staleTime: 5_000,
  });
  if (!query.data) return null;
  return Number(query.data.timestamp);
}

/**
 * The same chain time, with when this client received it, so a caller can run
 * the chain's clock forward on the wall clock between polls:
 * `timestamp + (Date.now() - receivedAtMs) / 1000`. The backend's value is the
 * latest block it has seen, so a clock run from it is never ahead of the chain.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.enabled=true]
 * @param {number} [opts.refetchInterval=10000] - Polling interval in ms
 * @returns {{ timestamp: number, receivedAtMs: number } | null} null until read
 */
export function useChainTimeAnchor(opts = {}) {
  const query = useWarmRead({
    path: '/chain/time',
    refetchInterval: opts.refetchInterval ?? 10_000,
    staleTime: 5_000,
    enabled: opts.enabled ?? true,
  });
  if (!query.data) return null;
  return { timestamp: Number(query.data.timestamp), receivedAtMs: query.dataUpdatedAt };
}
