import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import { buildClaimCalls } from "@/services/claimService";
import { useSmartTransactions } from "@/hooks/useSmartTransactions";
import { getStoredNetworkKey } from "@/lib/wagmi";

/**
 * Custom hook for managing claim state and mutations.
 * Each returned mutation is wagmi-shaped — wrap with useTransactionStatus
 * at the call site and feed TransactionModal for UI feedback.
 */
export function useClaims() {
  const qc = useQueryClient();
  const { address } = useAccount();
  const { executeBatch } = useSmartTransactions();
  const netKey = getStoredNetworkKey();

  const [pendingClaims, setPendingClaims] = useState(new Set());
  const [successfulClaims, setSuccessfulClaims] = useState(new Set());

  // Helper to generate claim keys
  const getClaimKey = (type, params) => {
    switch (type) {
      case "raffle-grand":
        return `raffle-grand-${params.seasonId}`;
      case "raffle-consolation":
        return `raffle-consolation-${params.seasonId}`;
      case "infofi":
        return `infofi-${params.marketId}-${params.prediction}`;
      case "fpmm":
        return `fpmm-${params.seasonId}-${params.player}`;
      default:
        return `unknown-${JSON.stringify(params)}`;
    }
  };

  // InfoFi claim mutation
  const claimInfoFiOne = useMutation({
    mutationFn: async ({ marketId, prediction, contractAddress }) => {
      const claimKey = getClaimKey("infofi", { marketId, prediction });
      setPendingClaims((prev) => new Set(prev).add(claimKey));

      const result = await buildClaimCalls({
        type: "infofi-payout",
        params: { marketId, prediction, account: address, contractAddress },
        networkKey: netKey,
      });
      if (result.error) throw new Error(result.error);
      const batchId = await executeBatch(result.calls);
      return { hash: batchId, claimKey };
    },
    onSuccess: (data) => {
      const { claimKey } = data;
      setPendingClaims((prev) => {
        const next = new Set(prev);
        next.delete(claimKey);
        return next;
      });
      setSuccessfulClaims((prev) => new Set(prev).add(claimKey));
      qc.invalidateQueries({ queryKey: ["claimcenter_claimables"] });
    },
    onError: (_error, variables) => {
      const claimKey = getClaimKey("infofi", variables);
      setPendingClaims((prev) => {
        const next = new Set(prev);
        next.delete(claimKey);
        return next;
      });
      qc.invalidateQueries({ queryKey: ["claimcenter_claimables"] });
    },
  });

  // FPMM claim mutation
  const claimFPMMOne = useMutation({
    mutationFn: async ({ seasonId, player, fpmmAddress }) => {
      const claimKey = getClaimKey("fpmm", { seasonId, player });
      setPendingClaims((prev) => new Set(prev).add(claimKey));

      const result = await buildClaimCalls({
        type: "fpmm-position",
        params: { seasonId, player, fpmmAddress },
        networkKey: netKey,
      });
      if (result.error) throw new Error(result.error);
      const batchId = await executeBatch(result.calls);
      return { hash: batchId, claimKey };
    },
    onSuccess: (data) => {
      const { claimKey } = data;
      setPendingClaims((prev) => {
        const next = new Set(prev);
        next.delete(claimKey);
        return next;
      });
      setSuccessfulClaims((prev) => new Set(prev).add(claimKey));
      qc.invalidateQueries({ queryKey: ["claimcenter_fpmm_claimables"] });
      qc.invalidateQueries({ queryKey: ["infoFiPositions"] });
    },
    onError: (_error, variables) => {
      const claimKey = getClaimKey("fpmm", variables);
      setPendingClaims((prev) => {
        const next = new Set(prev);
        next.delete(claimKey);
        return next;
      });
      qc.invalidateQueries({ queryKey: ["claimcenter_fpmm_claimables"] });
    },
  });

  // Raffle consolation claim
  const claimRaffleConsolation = useMutation({
    mutationFn: async ({ seasonId }) => {
      const claimKey = getClaimKey("raffle-consolation", { seasonId });
      setPendingClaims((prev) => new Set(prev).add(claimKey));

      const result = await buildClaimCalls({
        type: "raffle-consolation",
        params: { seasonId },
        networkKey: netKey,
      });
      if (result.error) throw new Error(result.error);
      const batchId = await executeBatch(result.calls);
      return { hash: batchId, claimKey };
    },
    onSuccess: (data) => {
      const { claimKey } = data;
      setPendingClaims((prev) => {
        const next = new Set(prev);
        next.delete(claimKey);
        return next;
      });
      setSuccessfulClaims((prev) => new Set(prev).add(claimKey));
      qc.invalidateQueries({ queryKey: ["raffle_claims"] });
    },
    onError: (_error, variables) => {
      const claimKey = getClaimKey("raffle-consolation", variables);
      setPendingClaims((prev) => {
        const next = new Set(prev);
        next.delete(claimKey);
        return next;
      });
      qc.invalidateQueries({ queryKey: ["raffle_claims"] });
    },
  });

  // Raffle grand prize claim
  const claimRaffleGrand = useMutation({
    mutationFn: async ({ seasonId }) => {
      const claimKey = getClaimKey("raffle-grand", { seasonId });
      setPendingClaims((prev) => new Set(prev).add(claimKey));

      const result = await buildClaimCalls({
        type: "raffle-grand",
        params: { seasonId },
        networkKey: netKey,
      });
      if (result.error) throw new Error(result.error);
      const batchId = await executeBatch(result.calls);
      return { hash: batchId, claimKey };
    },
    onSuccess: (data) => {
      const { claimKey } = data;
      setPendingClaims((prev) => {
        const next = new Set(prev);
        next.delete(claimKey);
        return next;
      });
      setSuccessfulClaims((prev) => new Set(prev).add(claimKey));
      qc.invalidateQueries({ queryKey: ["raffle_claims"] });
    },
    onError: (_error, variables) => {
      const claimKey = getClaimKey("raffle-grand", variables);
      setPendingClaims((prev) => {
        const next = new Set(prev);
        next.delete(claimKey);
        return next;
      });
      qc.invalidateQueries({ queryKey: ["raffle_claims"] });
    },
  });

  return {
    pendingClaims,
    successfulClaims,
    getClaimKey,
    claimInfoFiOne,
    claimFPMMOne,
    claimRaffleConsolation,
    claimRaffleGrand,
  };
}
