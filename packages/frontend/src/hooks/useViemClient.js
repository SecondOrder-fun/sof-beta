// src/hooks/useViemClient.js
import { useMemo } from "react";
import { createPublicClient, http } from "viem";
import { getStoredNetworkKey } from "@/lib/wagmi";
import { getNetworkByKey } from "@/config/networks";

/**
 * useViemClient - Creates a memoized viem public client for the current network.
 * Returns { client, netKey, net }
 */
export function useViemClient() {
  const netKey = getStoredNetworkKey();
  const net = getNetworkByKey(netKey);

  const client = useMemo(
    () =>
      createPublicClient({
        chain: {
          id: net.id,
          name: net.name,
          nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
          rpcUrls: { default: { http: [net.rpcUrl] } },
        },
        transport: http(net.rpcUrl),
      }),
    [net.id, net.name, net.rpcUrl]
  );

  return { client, netKey, net };
}
