// src/hooks/useAirdrop.js
import { useState, useEffect, useCallback, useContext } from "react";
import { useAccount, useReadContract, useWalletClient } from "wagmi";
import { useQueryClient } from "@tanstack/react-query";
import { formatUnits } from "viem";
import { getContractAddresses } from "@/config/contracts";
import { getStoredNetworkKey } from "@/lib/wagmi";
import { SOFAirdropAbi } from "@/utils/abis";
import FarcasterContext from "@/context/farcasterContext";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "";

/**
 * Poll an on-chain read until a condition is met or timeout expires.
 * @param {Function} refetchFn - wagmi refetch that returns { data }
 * @param {Function} checkFn  - (data) => boolean, true when confirmed
 * @param {number}   timeoutMs - max wait (default 30s)
 * @returns {Promise<boolean>} true if confirmed, false if timed out
 */
async function waitForOnChain(refetchFn, checkFn, timeoutMs = 30_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const { data } = await refetchFn();
    if (checkFn(data)) return true;
    await new Promise((r) => setTimeout(r, 2000));
  }
  return false;
}

/**
 * Format a seconds-remaining value into "Xh Ym" countdown string.
 * @param {number} remaining - seconds until next claim
 * @returns {string}
 */
function formatCountdown(remaining) {
  if (remaining <= 0) return "";
  const hours = Math.floor(remaining / 3600);
  const minutes = Math.floor((remaining % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  const seconds = remaining % 60;
  return `${minutes}m ${seconds}s`;
}

/**
 * Hook for interacting with the SOFAirdrop contract.
 *
 * Claims are relayed via the backend (gasless for users).
 * The backend wallet submits transactions using the paymaster.
 */
export function useAirdrop() {
  const { address, isConnected } = useAccount();
  const queryClient = useQueryClient();
  const farcasterAuth = useContext(FarcasterContext);
  const { data: walletClient } = useWalletClient();
  const netKey = getStoredNetworkKey();
  const contracts = getContractAddresses(netKey);
  const airdropAddress = contracts.SOF_AIRDROP;

  const isEnabled = Boolean(address && isConnected && airdropAddress);

  // ── Contract reads ──────────────────────────────────────────────────────────

  const { data: hasClaimed, refetch: refetchHasClaimed } = useReadContract({
    address: airdropAddress,
    abi: SOFAirdropAbi,
    functionName: "hasClaimed",
    args: [address],
    query: { enabled: isEnabled },
  });

  const { data: lastDailyClaim, refetch: refetchLastDaily } = useReadContract({
    address: airdropAddress,
    abi: SOFAirdropAbi,
    functionName: "lastDailyClaim",
    args: [address],
    query: { enabled: isEnabled },
  });

  const { data: cooldownSeconds } = useReadContract({
    address: airdropAddress,
    abi: SOFAirdropAbi,
    functionName: "cooldown",
    query: { enabled: Boolean(airdropAddress) },
  });

  const { data: initialAmountRaw } = useReadContract({
    address: airdropAddress,
    abi: SOFAirdropAbi,
    functionName: "initialAmount",
    query: { enabled: Boolean(airdropAddress) },
  });

  const { data: basicAmountRaw } = useReadContract({
    address: airdropAddress,
    abi: SOFAirdropAbi,
    functionName: "basicAmount",
    query: { enabled: Boolean(airdropAddress) },
  });

  const { data: dailyAmountRaw } = useReadContract({
    address: airdropAddress,
    abi: SOFAirdropAbi,
    functionName: "dailyAmount",
    query: { enabled: Boolean(airdropAddress) },
  });

  // ── Derived values ──────────────────────────────────────────────────────────

  const cooldown = cooldownSeconds ? Number(cooldownSeconds) : 0;
  const lastClaimTs = lastDailyClaim ? Number(lastDailyClaim) : 0;
  const nowSecs = Math.floor(Date.now() / 1000);

  const nextClaimAtSecs = lastClaimTs > 0 ? lastClaimTs + cooldown : 0;
  const canClaimDaily =
    Boolean(hasClaimed) &&
    (lastClaimTs === 0 || nowSecs >= nextClaimAtSecs);

  const nextClaimAt = nextClaimAtSecs > 0 ? nextClaimAtSecs * 1000 : null;

  // ── Live countdown ticker ────────────────────────────────────────────────────

  const [timeUntilClaim, setTimeUntilClaim] = useState("");

  useEffect(() => {
    const update = () => {
      if (canClaimDaily || nextClaimAtSecs === 0) {
        setTimeUntilClaim("");
        return;
      }
      const remaining = nextClaimAtSecs - Math.floor(Date.now() / 1000);
      setTimeUntilClaim(formatCountdown(remaining));
    };

    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [canClaimDaily, nextClaimAtSecs]);

  // ── Write state ────────────────────────────────────────────────────────────

  const [claimInitialState, setClaimInitialState] = useState({
    isPending: false,
    isSuccess: false,
    isError: false,
    error: null,
  });

  const [claimDailyState, setClaimDailyState] = useState({
    isPending: false,
    isSuccess: false,
    isError: false,
    error: null,
  });

  // ── On-chain verification after backend relay ───────────────────────────

  const verifyInitialClaim = useCallback(async () => {
    const confirmed = await waitForOnChain(
      refetchHasClaimed,
      (data) => data === true,
    );
    if (confirmed) {
      queryClient.invalidateQueries({ queryKey: ["sofBalance"] });
      void refetchLastDaily();
      setClaimInitialState({ isPending: false, isSuccess: true, isError: false, error: null });
    } else {
      setClaimInitialState({
        isPending: false, isSuccess: false, isError: true,
        error: "Transaction submitted but not confirmed on-chain — check your wallet",
      });
    }
  }, [queryClient, refetchHasClaimed, refetchLastDaily]);

  const verifyDailyClaim = useCallback(async (prevLastClaimTs) => {
    const confirmed = await waitForOnChain(
      refetchLastDaily,
      (data) => data && Number(data) > prevLastClaimTs,
    );
    if (confirmed) {
      queryClient.invalidateQueries({ queryKey: ["sofBalance"] });
      void refetchHasClaimed();
      setClaimDailyState({ isPending: false, isSuccess: true, isError: false, error: null });
    } else {
      setClaimDailyState({
        isPending: false, isSuccess: false, isError: true,
        error: "Transaction submitted but not confirmed on-chain — check your wallet",
      });
    }
  }, [queryClient, refetchHasClaimed, refetchLastDaily]);

  // ── Write: claimInitial (Farcaster-verified, via backend relay) ───────────

  const claimInitial = useCallback(
    async (fid) => {
      if (!address || !airdropAddress || !fid) return;

      setClaimInitialState({ isPending: true, isSuccess: false, isError: false, error: null });

      try {
        const authHeaders = farcasterAuth?.getAuthHeaders?.() ?? {};
        const res = await fetch(`${API_BASE}/airdrop/claim`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders },
          body: JSON.stringify({ address, fid, type: "initial" }),
        });

        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `Claim failed: ${res.status}`);
        }

        // Backend confirmed the tx — verify on-chain state
        await verifyInitialClaim();
      } catch (err) {
        setClaimInitialState({
          isPending: false,
          isSuccess: false,
          isError: true,
          error: err.message || "Claim failed",
        });
      }
    },
    [address, airdropAddress, farcasterAuth, verifyInitialClaim]
  );

  // ── Write: claimInitialBasic (no Farcaster, wallet signature proof) ───────

  const claimInitialBasic = useCallback(async () => {
    if (!address || !airdropAddress) return;

    setClaimInitialState({ isPending: true, isSuccess: false, isError: false, error: null });

    try {
      // Sign message to prove wallet ownership
      if (!walletClient) {
        throw new Error("Wallet not connected");
      }

      const message = `Claim SOF airdrop for ${address}`;
      const signature = await walletClient.signMessage({ message });

      const res = await fetch(`${API_BASE}/airdrop/claim`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address, type: "basic", signature }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Claim failed: ${res.status}`);
      }

      // Backend confirmed — verify on-chain
      await verifyInitialClaim();
    } catch (err) {
      setClaimInitialState({
        isPending: false,
        isSuccess: false,
        isError: true,
        error: err.message || "Claim failed",
      });
    }
  }, [address, airdropAddress, walletClient, verifyInitialClaim]);

  // ── Write: claimDaily (via backend relay) ─────────────────────────────────

  const claimDaily = useCallback(async () => {
    if (!address || !airdropAddress || !canClaimDaily) return;

    setClaimDailyState({ isPending: true, isSuccess: false, isError: false, error: null });
    const prevLastClaimTs = lastClaimTs;

    try {
      // Sign-message wallet-ownership proof (matches the basic-claim flow
      // server-side). Backend recovers the signer and rejects if the
      // address doesn't match — no JWT required.
      if (!walletClient) {
        throw new Error("Wallet not connected");
      }
      const message = `Claim daily SOF airdrop for ${address}`;
      const signature = await walletClient.signMessage({ message });

      const res = await fetch(`${API_BASE}/airdrop/claim`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address, type: "daily", signature }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Daily claim failed: ${res.status}`);
      }

      // Backend confirmed — verify on-chain
      await verifyDailyClaim(prevLastClaimTs);
    } catch (err) {
      setClaimDailyState({
        isPending: false,
        isSuccess: false,
        isError: true,
        error: err.message || "Daily claim failed",
      });
    }
  }, [address, airdropAddress, canClaimDaily, walletClient, verifyDailyClaim, lastClaimTs]);

  const resetDailyState = useCallback(() => {
    setClaimDailyState({ isPending: false, isSuccess: false, isError: false, error: null });
  }, []);

  const resetInitialState = useCallback(() => {
    setClaimInitialState({ isPending: false, isSuccess: false, isError: false, error: null });
  }, []);

  // ── Formatted amounts ────────────────────────────────────────────────────────

  const initialAmount = initialAmountRaw
    ? parseFloat(formatUnits(initialAmountRaw, 18))
    : 0;

  const basicAmount = basicAmountRaw
    ? parseFloat(formatUnits(basicAmountRaw, 18))
    : 0;

  const dailyAmount = dailyAmountRaw
    ? parseFloat(formatUnits(dailyAmountRaw, 18))
    : 0;

  return {
    // Contract state
    hasClaimed: hasClaimed ?? false,
    lastDailyClaim: lastClaimTs,
    cooldown,
    initialAmount,
    basicAmount,
    dailyAmount,
    // Derived
    canClaimDaily,
    nextClaimAt,
    timeUntilClaim,
    // Actions
    claimInitial,
    claimInitialBasic,
    claimInitialState,
    resetInitialState,
    claimDaily,
    claimDailyState,
    resetDailyState,
    // General
    airdropAddress,
  };
}

export default useAirdrop;
