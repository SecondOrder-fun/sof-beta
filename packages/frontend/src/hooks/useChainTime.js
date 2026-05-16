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
