// src/hooks/useRaffleRead.js
// Read helpers for raffle contract. Wire ABI & function names when available.

import { useMemo } from "react";
import { createPublicClient, http } from "viem";
import { useQuery } from "@tanstack/react-query";
import { getStoredNetworkKey } from "@/lib/wagmi";
import { getNetworkByKey } from "@/config/networks";
import { getContractAddresses, RAFFLE_ABI } from "@/config/contracts";

export function useRaffleRead() {
  const netKey = getStoredNetworkKey();
  const net = getNetworkByKey(netKey);
  const addr = getContractAddresses(netKey);

  const client = useMemo(() => {
    return createPublicClient({
      chain: {
        id: net.id,
        name: net.name,
        nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
        rpcUrls: { default: { http: [net.rpcUrl] } },
      },
      transport: http(net.rpcUrl),
    });
  }, [net.id, net.name, net.rpcUrl]);

  const fetchCurrentSeasonId = async () => {
    if (!addr.RAFFLE) return null;
    const id = await client.readContract({
      address: addr.RAFFLE,
      abi: RAFFLE_ABI,
      functionName: "currentSeasonId",
      args: [],
    });
    // Ensure number for convenience in UI
    return Number(id);
  };

  const currentSeasonQuery = useQuery({
    queryKey: ["raffle", netKey, "currentSeasonId", addr.RAFFLE],
    queryFn: fetchCurrentSeasonId,
    enabled: Boolean(addr.RAFFLE),
    staleTime: 15_000,
    retry: false,
  });

  return {
    client,
    currentSeasonQuery,
  };
}

/**
 * useSeasonDetailsQuery
 * Custom React hook that reads season details for a given seasonId.
 * Ensures Hooks are called from a proper hook function per React Rules of Hooks.
 * @param {number|string|null} seasonId
 */
export function useSeasonDetailsQuery(seasonId) {
  const netKey = getStoredNetworkKey();
  const net = getNetworkByKey(netKey);
  const addr = getContractAddresses(netKey);

  const client = useMemo(() => {
    return createPublicClient({
      chain: {
        id: net.id,
        name: net.name,
        nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
        rpcUrls: { default: { http: [net.rpcUrl] } },
      },
      transport: http(net.rpcUrl),
    });
  }, [net.id, net.name, net.rpcUrl]);

  const fetchSeasonDetails = async () => {
    if (!addr.RAFFLE || seasonId == null) return null;
    const sid = typeof seasonId === "bigint" ? seasonId : BigInt(seasonId);
    return await client.readContract({
      address: addr.RAFFLE,
      abi: RAFFLE_ABI,
      functionName: "getSeasonDetails",
      args: [sid],
    });
  };

  return useQuery({
    queryKey: ["raffle", netKey, "season", seasonId, addr.RAFFLE],
    queryFn: fetchSeasonDetails,
    enabled: !!addr.RAFFLE && seasonId != null && String(seasonId).length > 0,
    staleTime: 5_000,
    refetchInterval: (query) =>
      query.state.status === "error" ? false : 10_000,
    retry: false,
  });
}
