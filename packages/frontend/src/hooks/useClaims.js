import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useToast } from "@/hooks/useToast";
import { executeClaim } from "@/services/claimService";
import { getStoredNetworkKey } from "@/lib/wagmi";

/**
 * Parse claim errors into user-friendly messages
 */
function parseClaimError(error) {
  const msg = error?.message || error?.toString() || "Unknown error";

  if (msg.includes("already claimed") || msg.includes("AlreadyClaimed")) {
    return "This prize has already been claimed.";
  }
  if (msg.includes("not eligible") || msg.includes("NotEligible")) {
    return "You are not eligible to claim this prize.";
  }
  if (msg.includes("not finalized") || msg.includes("SeasonNotFinalized")) {
    return "The season has not been finalized yet. Please wait for the raffle to complete.";
  }
  if (msg.includes("not funded") || msg.includes("NotFunded")) {
    return "The prize pool has not been funded yet.";
  }
  if (msg.includes("User rejected") || msg.includes("user rejected")) {
    return "Transaction was cancelled.";
  }
  if (msg.includes("insufficient funds")) {
    return "Insufficient funds for gas fees.";
  }

  if (msg.length > 150) {
    return msg.substring(0, 150) + "...";
  }

  return msg;
}

/**
 * Custom hook for managing claim state and mutations
 * Tracks pending and successful claims, provides mutation functions
 */
export function useClaims() {
  const { t } = useTranslation(["market", "raffle", "common"]);
  const qc = useQueryClient();
  const { toast } = useToast();
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

      const result = await executeClaim({
        type: "infofi-payout",
        params: { marketId, prediction, contractAddress },
        networkKey: netKey,
      });
      if (!result.success) throw new Error(result.error);
      return { hash: result.hash, claimKey };
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
      qc.invalidateQueries({ queryKey: ["sofBalance"] });
    },
    onError: (error, variables) => {
      const claimKey = getClaimKey("infofi", variables);
      setPendingClaims((prev) => {
        const next = new Set(prev);
        next.delete(claimKey);
        return next;
      });
      const message = parseClaimError(error);
      toast({
        title: t("common:error"),
        description: message,
        variant: "destructive",
      });
      qc.invalidateQueries({ queryKey: ["claimcenter_claimables"] });
    },
  });

  // FPMM claim mutation
  const claimFPMMOne = useMutation({
    mutationFn: async ({ seasonId, player, fpmmAddress }) => {
      const claimKey = getClaimKey("fpmm", { seasonId, player });
      setPendingClaims((prev) => new Set(prev).add(claimKey));

      const result = await executeClaim({
        type: "fpmm-position",
        params: { seasonId, player, fpmmAddress },
        networkKey: netKey,
      });
      if (!result.success) throw new Error(result.error);
      return { hash: result.hash, claimKey };
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
      qc.invalidateQueries({ queryKey: ["sofBalance"] });
    },
    onError: (error, variables) => {
      const claimKey = getClaimKey("fpmm", variables);
      setPendingClaims((prev) => {
        const next = new Set(prev);
        next.delete(claimKey);
        return next;
      });
      const message = parseClaimError(error);
      toast({
        title: t("common:error"),
        description: message,
        variant: "destructive",
      });
      qc.invalidateQueries({ queryKey: ["claimcenter_fpmm_claimables"] });
    },
  });

  // Raffle consolation claim
  const claimRaffleConsolation = useMutation({
    mutationFn: async ({ seasonId }) => {
      const claimKey = getClaimKey("raffle-consolation", { seasonId });
      setPendingClaims((prev) => new Set(prev).add(claimKey));

      const result = await executeClaim({
        type: "raffle-consolation",
        params: { seasonId },
        networkKey: netKey,
      });
      if (!result.success) throw new Error(result.error);
      return { hash: result.hash, claimKey };
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
      qc.invalidateQueries({ queryKey: ["sofBalance"] });
    },
    onError: (error, variables) => {
      const claimKey = getClaimKey("raffle-consolation", variables);
      setPendingClaims((prev) => {
        const next = new Set(prev);
        next.delete(claimKey);
        return next;
      });
      const message = parseClaimError(error);
      toast({
        title: t("common:error"),
        description: message,
        variant: "destructive",
      });
      qc.invalidateQueries({ queryKey: ["raffle_claims"] });
    },
  });

  // Raffle grand prize claim
  const claimRaffleGrand = useMutation({
    mutationFn: async ({ seasonId }) => {
      const claimKey = getClaimKey("raffle-grand", { seasonId });
      setPendingClaims((prev) => new Set(prev).add(claimKey));

      const result = await executeClaim({
        type: "raffle-grand",
        params: { seasonId },
        networkKey: netKey,
      });
      if (!result.success) throw new Error(result.error);
      return { hash: result.hash, claimKey };
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
      qc.invalidateQueries({ queryKey: ["sofBalance"] });
    },
    onError: (error, variables) => {
      const claimKey = getClaimKey("raffle-grand", variables);
      setPendingClaims((prev) => {
        const next = new Set(prev);
        next.delete(claimKey);
        return next;
      });
      const message = parseClaimError(error);
      toast({
        title: t("common:error"),
        description: message,
        variant: "destructive",
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
