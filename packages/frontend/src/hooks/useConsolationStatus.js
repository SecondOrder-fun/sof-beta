import { useReadContract } from "wagmi";
import { useRafflePrizes } from "@/hooks/useRafflePrizes";
import { useRaffleAccount } from "@/hooks/useRaffleAccount";
import { RafflePrizeDistributorAbi } from "@/utils/abis";

/**
 * @typedef {Object} ConsolationStatus
 * @property {bigint} totalPoolWei
 * @property {bigint} perLoserShareWei
 * @property {boolean | null} viewerEligible
 * @property {boolean} viewerClaimed
 * @property {boolean} isLoading
 */

/**
 * Read the consolation pool for a completed season plus the connected
 * viewer's eligibility/claim status. Wraps useRafflePrizes (which already
 * holds the distributor's getSeason snapshot) and adds two extra reads.
 *
 * @param {number} seasonId
 * @returns {ConsolationStatus}
 */
export function useConsolationStatus(seasonId) {
  const { sma: viewerAddress } = useRaffleAccount();
  const prizes = useRafflePrizes(seasonId);
  const distributorAddress = prizes.distributorAddress;
  const seasonPayouts = prizes.seasonPayouts;

  const enabled = Boolean(
    distributorAddress && viewerAddress && seasonId !== undefined && seasonId !== null,
  );

  const { data: eligible } = useReadContract({
    address: distributorAddress,
    abi: RafflePrizeDistributorAbi,
    functionName: "isEligibleForConsolation",
    args: [BigInt(seasonId ?? 0), viewerAddress],
    query: { enabled },
  });

  const { data: claimed } = useReadContract({
    address: distributorAddress,
    abi: RafflePrizeDistributorAbi,
    functionName: "hasClaimedConsolation",
    args: [BigInt(seasonId ?? 0), viewerAddress],
    query: { enabled },
  });

  const totalPoolWei = seasonPayouts?.consolationAmount ?? 0n;
  const totalParticipants = BigInt(seasonPayouts?.totalParticipants ?? 0n);
  const loserCount = totalParticipants > 1n ? totalParticipants - 1n : 0n;
  const perLoserShareWei =
    totalPoolWei > 0n && loserCount > 0n ? totalPoolWei / loserCount : 0n;

  return {
    totalPoolWei,
    perLoserShareWei,
    viewerEligible: viewerAddress ? Boolean(eligible) : null,
    viewerClaimed: Boolean(claimed),
    isLoading: Boolean(prizes.isLoading),
  };
}
