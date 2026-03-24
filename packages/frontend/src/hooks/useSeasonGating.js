// src/hooks/useSeasonGating.js
// Hook for reading season gating status and verifying passwords.
//
// Secure Event-Driven Verification:
// This hook uses a defense-in-depth approach for password verification:
//
// 1. Event Verification: Checks that the UserVerified event was emitted in the transaction receipt
//    - SECURITY: Throws error if event not found (fails loudly, not silently)
//
// 2. On-Chain Confirmation: Polls isUserVerified() until it returns true
//    - SECURITY: Verifies the state change actually occurred on-chain
//    - Includes 10-second timeout with explicit error if verification doesn't complete
//
// 3. Cache Update: Only proceeds with cache invalidation after both checks pass
//    - Faster than arbitrary delays: responds as soon as verification is confirmed
//    - More reliable: dual verification (event + on-chain state)
//    - Secure: fails loudly on any verification failure

import { useMemo, useCallback } from "react";
import { createPublicClient, http, keccak256, toHex, getAddress } from "viem";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAccount, useWriteContract } from "wagmi";
import { getStoredNetworkKey } from "@/lib/wagmi";
import { getNetworkByKey } from "@/config/networks";
import { getContractAddresses, SEASON_GATING_ABI } from "@/config/contracts";

/**
 * Gate type enum matching ISeasonGating.GateType
 */
export const GateType = {
  NONE: 0,
  PASSWORD: 1,
  ALLOWLIST: 2,
  TOKEN_GATE: 3,
  SIGNATURE: 4,
};

/**
 * Hash a password the same way the contract does:
 * keccak256(abi.encodePacked(password))
 * @param {string} password
 * @returns {`0x${string}`}
 */
export function hashPassword(password) {
  return keccak256(toHex(password));
}

/**
 * @notice Hook for reading gating status and submitting password verification.
 * @param {number|string|null} seasonId
 * @param {object} [options]
 * @param {boolean} [options.isGated] - Hint from season config (avoids an extra read)
 * @returns {{
 *   isGated: boolean,
 *   isVerified: boolean | null,
 *   gateCount: number,
 *   gates: Array,
 *   isLoading: boolean,
 *   verifyPassword: (password: string) => Promise<string>,
 *   refetch: () => void,
 * }}
 */
export function useSeasonGating(seasonId, options = {}) {
  const { isGated: isGatedHint } = options;
  const netKey = getStoredNetworkKey();
  const net = getNetworkByKey(netKey);
  const addr = getContractAddresses(netKey);
  const { address: connectedAddress } = useAccount();
  const { writeContractAsync } = useWriteContract();
  const queryClient = useQueryClient();

  const client = useMemo(() => {
    if (!net?.rpcUrl) return null;
    return createPublicClient({
      chain: {
        id: net.id,
        name: net.name,
        nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
        rpcUrls: { default: { http: [net.rpcUrl] } },
      },
      transport: http(net.rpcUrl),
    });
  }, [net?.id, net?.name, net?.rpcUrl]);

  // Ensure address is properly checksummed (viem requires strict EIP-55 validation)
  const gatingAddress = addr.SEASON_GATING ? getAddress(addr.SEASON_GATING) : null;
  const sid = seasonId != null ? BigInt(seasonId) : null;

  // ── Read gate count + gates ──
  const gatesQuery = useQuery({
    queryKey: ["seasonGating", netKey, "gates", String(seasonId), gatingAddress],
    queryFn: async () => {
      if (!client || !gatingAddress || sid == null) return null;
      const [count, gates] = await Promise.all([
        client.readContract({
          address: gatingAddress,
          abi: SEASON_GATING_ABI,
          functionName: "getGateCount",
          args: [sid],
        }),
        client.readContract({
          address: gatingAddress,
          abi: SEASON_GATING_ABI,
          functionName: "getSeasonGates",
          args: [sid],
        }),
      ]);
      return { count: Number(count), gates };
    },
    enabled: Boolean(client && gatingAddress && sid != null && isGatedHint),
    staleTime: 30_000,
    retry: false,
  });

  // ── Read user verification status ──
  // Once verified, stop polling — verification never reverts on-chain.
  // Also skip polling entirely for non-gated seasons.
  const verifiedQuery = useQuery({
    queryKey: [
      "seasonGating",
      netKey,
      "isVerified",
      String(seasonId),
      connectedAddress,
      gatingAddress,
    ],
    queryFn: async () => {
      if (!client || !gatingAddress || sid == null || !connectedAddress)
        return null;
      const result = await client.readContract({
        address: gatingAddress,
        abi: SEASON_GATING_ABI,
        functionName: "isUserVerified",
        args: [sid, connectedAddress],
      });
      return Boolean(result);
    },
    enabled: Boolean(
      client && gatingAddress && sid != null && connectedAddress && isGatedHint,
    ),
    staleTime: 10_000,
    // React Query supports a function for refetchInterval that receives the query.
    // Stop polling when: season is not gated, or user is already verified.
    refetchInterval: (query) => {
      if (!isGatedHint) return false;
      if (query.state.data === true) return false;
      return 15_000;
    },
    retry: false,
  });

  // ── verifyPassword write ──
  const verifyPassword = useCallback(
    async (password) => {
      if (!gatingAddress || sid == null) {
        throw new Error("Gating contract or season not available");
      }
      if (!connectedAddress) {
        throw new Error("Wallet not connected");
      }

      const hash = await writeContractAsync({
        address: gatingAddress,
        abi: SEASON_GATING_ABI,
        functionName: "verifyPassword",
        args: [sid, 0n, password],
      });

      // Wait for tx confirmation and verify UserVerified event was emitted
      if (client && hash) {
        const receipt = await client.waitForTransactionReceipt({ 
          hash, 
          confirmations: 1 
        });
        
        // Verify that the UserVerified event was emitted in this transaction
        // Event signature: UserVerified(uint256 indexed seasonId, uint256 indexed gateIndex, address indexed user, GateType gateType)
        const userVerifiedEvent = receipt.logs.find(log => {
          // Check if this log is from the SeasonGating contract
          if (log.address.toLowerCase() !== gatingAddress.toLowerCase()) {
            return false;
          }
          
          // Check topics: [eventSignature, seasonId, gateIndex, user]
          // UserVerified has 3 indexed parameters (seasonId, gateIndex, user)
          if (log.topics.length !== 4) {
            return false;
          }
          
          // Verify this is for the correct user (topic[3] is the indexed user address)
          const eventUser = `0x${log.topics[3].slice(26)}`.toLowerCase();
          return eventUser === connectedAddress.toLowerCase();
        });

        // SECURITY: Fail loudly if verification event was not emitted
        if (!userVerifiedEvent) {
          throw new Error(
            "Password verification failed: UserVerified event not found in transaction receipt. " +
            "This indicates the verification was rejected by the contract."
          );
        }

        // SECURITY: Poll on-chain state until isUserVerified returns true
        // Don't rely solely on event emission - verify the state change actually occurred
        const POLL_INTERVAL_MS = 500;
        const POLL_TIMEOUT_MS = 10000; // 10 seconds
        const startTime = Date.now();

        let isVerified = false;
        while (!isVerified) {
          // Check if we've exceeded the timeout
          if (Date.now() - startTime > POLL_TIMEOUT_MS) {
            throw new Error(
              "Password verification timeout: UserVerified event was emitted but " +
              "on-chain verification status did not update within 10 seconds. " +
              "Please refresh and check your verification status."
            );
          }

          // Poll the on-chain verification status
          const verified = await client.readContract({
            address: gatingAddress,
            abi: SEASON_GATING_ABI,
            functionName: "isUserVerified",
            args: [sid, connectedAddress],
          });

          if (verified) {
            isVerified = true;
            break;
          }

          // Wait before next poll
          await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
        }

        // At this point, we have confirmed:
        // 1. UserVerified event was emitted
        // 2. isUserVerified() on-chain returns true
        // Safe to proceed with cache invalidation
      }

      // Invalidate and refetch verification query to ensure UI has latest state
      await queryClient.invalidateQueries({
        queryKey: [
          "seasonGating",
          netKey,
          "isVerified",
          String(seasonId),
          connectedAddress,
          gatingAddress,
        ],
      });
      
      // Force an immediate refetch to ensure cache is updated
      await queryClient.refetchQueries({
        queryKey: [
          "seasonGating",
          netKey,
          "isVerified",
          String(seasonId),
          connectedAddress,
          gatingAddress,
        ],
      });

      return hash;
    },
    [
      gatingAddress,
      sid,
      writeContractAsync,
      client,
      queryClient,
      netKey,
      seasonId,
      connectedAddress,
    ],
  );

  // ── verifySignature write ──
  const verifySignature = useCallback(
    async (gateIndex, deadline, v, r, s) => {
      if (!gatingAddress || sid == null) {
        throw new Error("Gating contract or season not available");
      }
      if (!connectedAddress) {
        throw new Error("Wallet not connected");
      }

      const hash = await writeContractAsync({
        address: gatingAddress,
        abi: SEASON_GATING_ABI,
        functionName: "verifySignature",
        args: [sid, BigInt(gateIndex), BigInt(deadline), v, r, s],
      });

      // Same dual-verification pattern as verifyPassword
      if (client && hash) {
        const receipt = await client.waitForTransactionReceipt({
          hash,
          confirmations: 1,
        });

        // Verify UserVerified event
        const userVerifiedEvent = receipt.logs.find(log => {
          if (log.address.toLowerCase() !== gatingAddress.toLowerCase()) return false;
          if (log.topics.length !== 4) return false;
          const eventUser = `0x${log.topics[3].slice(26)}`.toLowerCase();
          return eventUser === connectedAddress.toLowerCase();
        });

        if (!userVerifiedEvent) {
          throw new Error(
            "Signature verification failed: UserVerified event not found in transaction receipt."
          );
        }

        // Poll on-chain state
        const POLL_INTERVAL_MS = 500;
        const POLL_TIMEOUT_MS = 10000;
        const startTime = Date.now();

        let isVerified = false;
        while (!isVerified) {
          if (Date.now() - startTime > POLL_TIMEOUT_MS) {
            throw new Error(
              "Signature verification timeout: event emitted but on-chain status did not update."
            );
          }
          const verified = await client.readContract({
            address: gatingAddress,
            abi: SEASON_GATING_ABI,
            functionName: "isUserVerified",
            args: [sid, connectedAddress],
          });
          if (verified) {
            isVerified = true;
            break;
          }
          await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
        }
      }

      // Invalidate and refetch cache
      await queryClient.invalidateQueries({
        queryKey: ["seasonGating", netKey, "isVerified", String(seasonId), connectedAddress, gatingAddress],
      });
      await queryClient.refetchQueries({
        queryKey: ["seasonGating", netKey, "isVerified", String(seasonId), connectedAddress, gatingAddress],
      });

      return hash;
    },
    [gatingAddress, sid, writeContractAsync, client, queryClient, netKey, seasonId, connectedAddress],
  );

  const refetch = useCallback(async () => {
    await Promise.all([
      verifiedQuery.refetch(),
      gatesQuery.refetch(),
    ]);
  }, [verifiedQuery, gatesQuery]);

  return {
    isGated: Boolean(isGatedHint),
    isVerified: verifiedQuery.data ?? null,
    gateCount: gatesQuery.data?.count ?? 0,
    gates: gatesQuery.data?.gates ?? [],
    isLoading: verifiedQuery.isLoading || gatesQuery.isLoading,
    verifyPassword,
    verifySignature,
    refetch,
  };
}
