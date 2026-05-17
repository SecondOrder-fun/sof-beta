// src/hooks/usePlayerPosition.js
// Reads a player's ticket position for a raffle season.
//
// Self (connected SMA) → ultra-fresh on-chain reads so post-tx balance
// updates are instant and always accurate.
//
// Others → warm backend index via /api/raffle/positions/:user/:season
// (avoids hammering the RPC for leaderboard / viewer contexts).

import { useCallback, useEffect, useState } from "react";
import { useRaffleAccount } from "@/hooks/useRaffleAccount";
import { useUltraFreshRead } from "@/hooks/chain/useUltraFreshRead";
import { useWarmRead } from "@/hooks/chain/useWarmRead";
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
 * @param {string} [options.playerAddress]  — if provided and differs from the connected SMA,
 *   reads from the warm backend index instead of the chain.
 * @param {string|number} [options.seasonId] — required when playerAddress is an "other" user
 * @returns {{ position: {tickets:bigint, probBps:number, total:bigint}|null, isRefreshing:boolean, refreshNow:()=>Promise<void>, setPosition:(p)=>void }}
 */
export function usePlayerPosition(bondingCurveAddress, { seasonDetails, playerAddress, seasonId } = {}) {
  // Position reads resolve at the user's smart account, not the EOA (spec §4.3).
  const { sma, isReady } = useRaffleAccount();

  // Determine whether the query is for the connected user's own position.
  const isSelf =
    !playerAddress ||
    (!!sma && playerAddress.toLowerCase() === sma.toLowerCase());

  // ── Self path: ultra-fresh on-chain via playerTickets() on the curve ──
  const selfUltraFresh = useUltraFreshRead({
    contract: {
      address: bondingCurveAddress,
      abi: curveAbi,
    },
    fn: "playerTickets",
    args: sma ? [sma] : [],
    touches: bondingCurveAddress ? [bondingCurveAddress] : [],
    enabled: isSelf && !!bondingCurveAddress && !!sma,
  });

  // Also fetch the curve total supply (curveConfig) for probability calculation.
  const selfCurveConfig = useUltraFreshRead({
    contract: {
      address: bondingCurveAddress,
      abi: curveAbi,
    },
    fn: "curveConfig",
    args: [],
    touches: bondingCurveAddress ? [bondingCurveAddress] : [],
    enabled: isSelf && !!bondingCurveAddress && !!sma,
  });

  // ── Others path: warm backend index ──
  const othersWarm = useWarmRead({
    path: "/raffle/positions/:user/:season",
    params: { user: playerAddress, season: seasonId },
    enabled: !isSelf && !!playerAddress && seasonId != null,
  });

  // ── Local state for the imperative self path (ERC20 fallback) ──
  // The ultra-fresh hook handles the happy path (curve's playerTickets).
  // When that resolves, we derive position directly from it.
  // We keep the legacy imperative refreshNow for cases where the curve
  // reverts (ERC20 fallback) and for the event-driven refresh in RaffleDetails.
  const [localPosition, setLocalPosition] = useState(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Sync ultra-fresh result into localPosition for self reads (happy path).
  useEffect(() => {
    if (!isSelf) return;
    if (selfUltraFresh.data == null) return;

    const tickets = BigInt(selfUltraFresh.data ?? 0n);
    const cfg = selfCurveConfig.data;
    const total = BigInt(cfg?.[0] ?? cfg?.totalSupply ?? 0n);
    const probBps = total > 0n ? Number((tickets * 10000n) / total) : 0;
    setLocalPosition({ tickets, probBps, total });
  }, [isSelf, selfUltraFresh.data, selfCurveConfig.data]);

  // Sync warm result into localPosition for others reads.
  useEffect(() => {
    if (isSelf) return;
    const raw = othersWarm.data;
    if (!raw) return;
    const tickets = BigInt(raw.ticketBalance ?? raw.ticket_balance ?? 0n);
    // Probability data from the backend index is optional.
    const probBps = typeof raw.probBps === "number" ? raw.probBps : 0;
    const total = BigInt(raw.totalSupply ?? raw.total_supply ?? 0n);
    setLocalPosition({ tickets, probBps, total });
  }, [isSelf, othersWarm.data]);

  // ── Imperative refresh (used by event-driven triggers in RaffleDetails) ──
  // Falls back to the legacy manual viem path; handles ERC20 fallback discovery.
  const refreshNow = useCallback(async () => {
    if (!isSelf || !sma || !bondingCurveAddress) return;
    try {
      setIsRefreshing(true);
      const netKey = getStoredNetworkKey();
      const client = buildPublicClient(netKey);
      if (!client) return;

      // 1) Try the curve's public mapping playerTickets(address) (authoritative)
      try {
        const [pt, cfg] = await Promise.all([
          client.readContract({
            address: bondingCurveAddress,
            abi: curveAbi,
            functionName: "playerTickets",
            args: [sma],
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
        setLocalPosition({ tickets, probBps, total });
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
          args: [sma],
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
      setLocalPosition({ tickets, probBps, total });
    } catch {
      // ignore — position stays at previous value
    } finally {
      setIsRefreshing(false);
    }
  }, [isSelf, sma, bondingCurveAddress, seasonDetails]);

  // Initial load for self: fetch when wallet + curve address are available.
  // Deliberately omit refreshNow from deps — it changes reference when
  // seasonDetails changes (new object from React Query on every render),
  // which would cause an infinite RPC polling loop → 429 rate limit.
  useEffect(() => {
    if (isSelf && isReady && sma && bondingCurveAddress) {
      refreshNow();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSelf, isReady, sma, bondingCurveAddress]);

  return {
    position: localPosition,
    isRefreshing,
    setIsRefreshing,
    setPosition: setLocalPosition,
    refreshNow,
  };
}
