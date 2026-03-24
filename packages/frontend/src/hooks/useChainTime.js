// src/hooks/useChainTime.js
// Shared hook for on-chain timestamp via React Query.
// Replaces raw setInterval patterns in RaffleDetails, AdminPanel, and CreateSeasonWorkflow.

import { useQuery } from "@tanstack/react-query";
import { getStoredNetworkKey } from "@/lib/wagmi";
import { buildPublicClient } from "@/lib/viemClient";

/**
 * Returns the latest on-chain block timestamp (seconds) and keeps it fresh.
 * Uses React Query so every consumer that calls useChainTime() shares a single
 * cached value keyed by `["chainTime", netKey]`.
 *
 * @param {object} [options]
 * @param {number} [options.refetchInterval=15000] - Polling interval in ms
 * @returns {number|null} chainNow — block.timestamp as a JS number, or null while loading
 */
export function useChainTime({ refetchInterval = 15_000 } = {}) {
  const netKey = getStoredNetworkKey();

  const { data: chainNow } = useQuery({
    queryKey: ["chainTime", netKey],
    queryFn: async () => {
      const client = buildPublicClient(netKey);
      if (!client) return null;
      const block = await client.getBlock();
      return Number(block.timestamp);
    },
    refetchInterval,
    staleTime: 10_000,
  });

  return chainNow ?? null;
}
