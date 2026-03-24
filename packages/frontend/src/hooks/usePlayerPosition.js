// src/hooks/usePlayerPosition.js
// Reads the connected wallet's ticket position from the bonding curve.
// Extracted from RaffleDetails.jsx to keep the route component lean.

import { useCallback, useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { getStoredNetworkKey } from "@/lib/wagmi";
import { buildPublicClient } from "@/lib/viemClient";
import { SOFBondingCurveAbi, ERC20Abi } from "@/utils/abis";

const curveAbi = Array.isArray(SOFBondingCurveAbi)
  ? SOFBondingCurveAbi
  : (SOFBondingCurveAbi?.abi ?? SOFBondingCurveAbi);
const erc20Abi = Array.isArray(ERC20Abi)
  ? ERC20Abi
  : (ERC20Abi?.abi ?? ERC20Abi);

/**
 * @param {string|undefined} bondingCurveAddress
 * @param {object} [options]
 * @param {object} [options.seasonDetails] — seasonDetailsQuery.data (for ERC20 fallback discovery)
 * @returns {{ position: {tickets:bigint, probBps:number, total:bigint}|null, isRefreshing:boolean, refreshNow:()=>Promise<void>, setPosition:(p)=>void }}
 */
export function usePlayerPosition(bondingCurveAddress, { seasonDetails } = {}) {
  const { address, isConnected } = useAccount();
  const [position, setPosition] = useState(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const refreshNow = useCallback(async () => {
    try {
      if (!isConnected || !address || !bondingCurveAddress) return;
      const netKey = getStoredNetworkKey();
      const client = buildPublicClient(netKey);
      if (!client) return;

      // 1) Try the curve's public mapping playerTickets(address) first (authoritative)
      try {
        const [pt, cfg] = await Promise.all([
          client.readContract({
            address: bondingCurveAddress,
            abi: curveAbi,
            functionName: "playerTickets",
            args: [address],
          }),
          client.readContract({
            address: bondingCurveAddress,
            abi: curveAbi,
            functionName: "curveConfig",
            args: [],
          }),
        ]);
        const tickets = BigInt(pt ?? 0n);
        const total = BigInt(cfg?.[0] ?? cfg?.totalSupply ?? 0n);
        const probBps = total > 0n ? Number((tickets * 10000n) / total) : 0;
        setPosition({ tickets, probBps, total });
        return;
      } catch {
        // fallback to ERC20 path below
      }

      // 2) Fallback: discover ERC20 tickets token from the curve
      let tokenAddress =
        seasonDetails?.ticketToken ||
        seasonDetails?.config?.ticketToken ||
        seasonDetails?.config?.token ||
        bondingCurveAddress;
      for (const fn of [
        "token",
        "raffleToken",
        "ticketToken",
        "tickets",
        "asset",
      ]) {
        try {
          // eslint-disable-next-line no-await-in-loop
          const addr = await client.readContract({
            address: bondingCurveAddress,
            abi: curveAbi,
            functionName: fn,
            args: [],
          });
          if (
            typeof addr === "string" &&
            /^0x[a-fA-F0-9]{40}$/.test(addr) &&
            addr !== "0x0000000000000000000000000000000000000000"
          ) {
            tokenAddress = addr;
            break;
          }
        } catch {
          // continue trying other function names
        }
      }

      const [bal, supply] = await Promise.all([
        client.readContract({
          address: tokenAddress,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [address],
        }),
        client.readContract({
          address: tokenAddress,
          abi: erc20Abi,
          functionName: "totalSupply",
          args: [],
        }),
      ]);
      const tickets = BigInt(bal ?? 0n);
      const total = BigInt(supply ?? 0n);
      const probBps = total > 0n ? Number((tickets * 10000n) / total) : 0;
      setPosition({ tickets, probBps, total });
    } catch {
      // ignore — position stays at previous value
    }
  }, [isConnected, address, bondingCurveAddress, seasonDetails]);

  // Initial load: fetch position when wallet + curve address are available.
  // Deliberately omit refreshNow from deps — it changes reference when
  // seasonDetails changes (new object from React Query on every render),
  // which would cause an infinite RPC polling loop → 429 rate limit.
  useEffect(() => {
    if (isConnected && address && bondingCurveAddress) {
      refreshNow();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConnected, address, bondingCurveAddress]);

  return { position, isRefreshing, setIsRefreshing, setPosition, refreshNow };
}
