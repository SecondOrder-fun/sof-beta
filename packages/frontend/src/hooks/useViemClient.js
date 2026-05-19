// src/hooks/useViemClient.js
//
// Thin hook wrapper around the shared buildPublicClient factory so
// callers can grab a properly-configured viem PublicClient inside a
// React tree. The factory gives us:
//   - batch.multicall aggregator (50ms window) — concurrent readContract
//     calls land in a single multicall3.aggregate3 POST instead of N
//     parallel POSTs
//   - retryCount: 0 on the http transport — a 429 is not doubled by
//     viem's default 3-retry middleware (which fires inside the same
//     rate-limit window)
//   - RPC fallback + temporary demotion of misbehaving URLs
//
// Earlier this hook used createPublicClient + http(url) directly, which
// bypassed all of the above. Every consumer (useProfileData and the
// queries it drives) was firing un-aggregated POSTs with the default
// transport-level retries, which blew through Tenderly's burst limit
// on every Portfolio open.

import { useMemo } from "react";
import { getStoredNetworkKey } from "@/lib/wagmi";
import { getNetworkByKey } from "@/config/networks";
import { buildPublicClient } from "@/lib/viemClient";

export function useViemClient() {
  const netKey = getStoredNetworkKey();
  const net = getNetworkByKey(netKey);
  const client = useMemo(() => buildPublicClient(netKey), [netKey]);
  return { client, netKey, net };
}
