// src/hooks/useSofDecimals.js
import { useEffect, useState } from "react";
import { getStoredNetworkKey } from "@/lib/wagmi";
import { getNetworkByKey } from "@/config/networks";
import { getContractAddresses } from "@/config/contracts";
import { buildPublicClient } from "@/lib/viemClient";
import { ERC20Abi } from "@/utils/abis";

/**
 * useSofDecimals
 * Reads the SOF token decimals once for the current network, with 18 fallback.
 */
export function useSofDecimals() {
  const [decimals, setDecimals] = useState(18);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const netKey = getStoredNetworkKey();
        const { SOF } = getContractAddresses(netKey);
        const net = getNetworkByKey(netKey);
        if (!SOF || !net?.rpcUrl) return; // Guard: no token or missing RPC
        const client = buildPublicClient(netKey);
        if (!client) return;
        const d = await client.readContract({
          address: SOF,
          abi: ERC20Abi,
          functionName: "decimals",
          args: [],
        });
        if (mounted) setDecimals(Number(d || 18));
      } catch (_) {
        if (mounted) setDecimals(18);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  return decimals;
}
