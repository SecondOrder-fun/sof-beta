import { useCallback } from "react";
import { useAccount, usePublicClient } from "wagmi";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useSmartTransactions } from "./useSmartTransactions";
import { getStoredNetworkKey } from "@/lib/wagmi";
import { getContractAddresses } from "@/config/contracts";
import {
  readUserPosition,
  readCohortState,
  readAvailableBalance,
  buildSpendFromRolloverCall,
  buildRefundCall,
} from "@/services/onchainRolloverEscrow";
import { buildClaimConsolationCall } from "@/services/onchainRaffleDistributor";
import { useToast } from "@/hooks/useToast";

export function useRollover(seasonId) {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { executeBatch } = useSmartTransactions();
  const qc = useQueryClient();
  const { t } = useTranslation(["raffle", "common"]);
  const { toast } = useToast();
  const netKey = getStoredNetworkKey();
  const contracts = getContractAddresses(netKey);

  // --- Read state ---
  const queryKey = ["rollover", address, seasonId, netKey];

  const { data, isLoading, error } = useQuery({
    queryKey,
    queryFn: async () => {
      if (!address || !publicClient || !seasonId) return null;

      const [position, cohort, available] = await Promise.all([
        readUserPosition({ publicClient, seasonId, address, networkKey: netKey }),
        readCohortState({ publicClient, seasonId, networkKey: netKey }),
        readAvailableBalance({ publicClient, seasonId, address, networkKey: netKey }),
      ]);

      return { position, cohort, available };
    },
    enabled: Boolean(address && publicClient && seasonId && contracts.ROLLOVER_ESCROW),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  // --- Computed ---
  const position = data?.position;
  const cohort = data?.cohort;

  const rolloverDeposited = position?.deposited ?? 0n;
  const rolloverSpent = position?.spent ?? 0n;
  const isRefunded = position?.refunded ?? false;
  const rolloverBalance = data?.available ?? 0n;

  const cohortPhase = cohort?.phase ?? "none";
  const bonusBps = cohort?.bonusBps ?? 0;
  const nextSeasonId = cohort?.nextSeasonId ?? 0n;

  const isRolloverAvailable = rolloverBalance > 0n && cohortPhase === "active";
  const hasClaimableRollover = cohortPhase === "open";
  const bonusPercent = `${Number(bonusBps) / 100}%`;

  const bonusAmount = useCallback(
    (sofAmount) => (sofAmount * BigInt(bonusBps)) / 10000n,
    [bonusBps]
  );

  // --- Mutations ---
  const claimToRollover = useMutation({
    mutationFn: async ({ seasonId: sid }) => {
      const call = await buildClaimConsolationCall({
        seasonId: sid,
        toRollover: true,
        networkKey: netKey,
      });
      return executeBatch([call]);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["raffle_claims"] });
      qc.invalidateQueries({ queryKey: ["sofBalance"] });
      qc.invalidateQueries({ queryKey });
      toast({ title: t("raffle:rolloverSuccess", { defaultValue: "Rollover confirmed" }) });
    },
    onError: (err) => {
      toast({ title: t("common:error"), description: err.message, variant: "destructive" });
    },
  });

  const spendFromRollover = useMutation({
    mutationFn: async ({ seasonId: sid, sofAmount, ticketAmount, maxTotalSof }) => {
      const call = buildSpendFromRolloverCall({
        seasonId: sid,
        sofAmount,
        ticketAmount,
        maxTotalSof,
        networkKey: netKey,
      });
      return executeBatch([call]);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey });
      qc.invalidateQueries({ queryKey: ["sofBalance"] });
      qc.invalidateQueries({ queryKey: ["sofTransactions"] });
    },
    onError: (err) => {
      toast({ title: t("common:error"), description: err.message, variant: "destructive" });
    },
  });

  const refundRollover = useMutation({
    mutationFn: async ({ seasonId: sid }) => {
      const call = buildRefundCall({ seasonId: sid, networkKey: netKey });
      return executeBatch([call]);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey });
      qc.invalidateQueries({ queryKey: ["sofBalance"] });
      toast({ title: t("raffle:refundSuccess", { defaultValue: "Refund confirmed" }) });
    },
    onError: (err) => {
      toast({ title: t("common:error"), description: err.message, variant: "destructive" });
    },
  });

  return {
    // State
    rolloverBalance,
    rolloverDeposited,
    rolloverSpent,
    isRefunded,
    cohortPhase,
    bonusBps,
    nextSeasonId,

    // Computed
    bonusAmount,
    isRolloverAvailable,
    hasClaimableRollover,
    bonusPercent,

    // Mutations
    claimToRollover,
    spendFromRollover,
    refundRollover,

    // Loading
    isLoading,
    error,
  };
}
