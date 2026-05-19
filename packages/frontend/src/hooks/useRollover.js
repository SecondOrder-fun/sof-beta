import { useCallback } from "react";
import { usePublicClient } from "wagmi";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSmartTransactions } from "./useSmartTransactions";
import { useRaffleAccount } from "@/hooks/useRaffleAccount";
import { useLiveSubscription } from "@/hooks/chain/useLiveSubscription";
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

export function useRollover(seasonId) {
  // SMA-bound read per spec §4.3 — rollover deposits live at the SMA.
  const { sma: address } = useRaffleAccount();
  const publicClient = usePublicClient();
  const { executeBatch } = useSmartTransactions();
  const qc = useQueryClient();
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
  });

  // Invalidate on-chain rollover state when the backend sees a relevant event.
  useLiveSubscription({
    channel: "rollover",
    enabled: !!address,
    filter: (e) =>
      e.user?.toLowerCase() === address?.toLowerCase() ||
      e.type === "ConsolationFunded",
    onEvent: () => qc.invalidateQueries({ queryKey }),
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
      qc.invalidateQueries({ queryKey });
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
      qc.invalidateQueries({ queryKey: ["sofTransactions"] });
    },
  });

  const refundRollover = useMutation({
    mutationFn: async ({ seasonId: sid }) => {
      const call = buildRefundCall({ seasonId: sid, networkKey: netKey });
      return executeBatch([call]);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey });
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
