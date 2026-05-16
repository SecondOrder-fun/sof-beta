import { useCallback } from "react";
import { usePublicClient } from "wagmi";
import { useQuery } from "@tanstack/react-query";
import { useRaffleAccount } from "@/hooks/useRaffleAccount";
import { getStoredNetworkKey } from "@/lib/wagmi";
import { getContractAddresses } from "@/config/contracts";
import {
  readCohortState,
  readAvailableBalance,
} from "@/services/onchainRolloverEscrow";

/**
 * For a user buying tickets in `currentSeasonId`, finds the rollover cohort
 * (if any) that can fund the spend. Rollover qualifies N→N+1 only, so we look
 * at exactly one cohort: `currentSeasonId - 1n`.
 *
 * Eligibility:
 *   cohort.phase === "active"
 *   && cohort.nextSeasonId === currentSeasonId
 *   && available > 0n
 *
 * @param {bigint} currentSeasonId - the season the user is buying tickets in
 * @returns {{
 *   cohortSeasonId: bigint | null,
 *   available: bigint,
 *   bonusBps: number,
 *   bonusAmount: (sofAmount: bigint) => bigint,
 *   isEligible: boolean,
 *   isLoading: boolean,
 *   error: Error | null,
 * }}
 */
export function useEligibleRolloverCohort(currentSeasonId) {
  if (typeof currentSeasonId !== "bigint") {
    throw new TypeError(
      `useEligibleRolloverCohort: currentSeasonId must be bigint (got ${typeof currentSeasonId})`
    );
  }

  const { sma } = useRaffleAccount();
  const publicClient = usePublicClient();
  const netKey = getStoredNetworkKey();
  const contracts = getContractAddresses(netKey);

  const candidate = currentSeasonId > 1n ? currentSeasonId - 1n : null;

  const enabled = Boolean(
    sma && publicClient && candidate && contracts.ROLLOVER_ESCROW
  );

  const { data, isLoading, error } = useQuery({
    queryKey: ["rollover-eligible", sma, String(currentSeasonId), netKey],
    queryFn: async () => {
      const [cohort, available] = await Promise.all([
        readCohortState({ publicClient, seasonId: candidate, networkKey: netKey }),
        readAvailableBalance({
          publicClient,
          seasonId: candidate,
          address: sma,
          networkKey: netKey,
        }),
      ]);
      return { cohort, available };
    },
    enabled,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const cohort = data?.cohort;
  const available = data?.available ?? 0n;
  const bonusBps = cohort?.bonusBps ?? 0;

  const bonusAmount = useCallback(
    (sofAmount) => (sofAmount * BigInt(bonusBps)) / 10000n,
    [bonusBps]
  );

  const isEligible = Boolean(
    enabled &&
      cohort?.phase === "active" &&
      cohort?.nextSeasonId === currentSeasonId &&
      available > 0n
  );

  return {
    cohortSeasonId: isEligible ? candidate : null,
    available,
    bonusBps,
    bonusAmount,
    isEligible,
    isLoading,
    error: error ?? null,
  };
}
