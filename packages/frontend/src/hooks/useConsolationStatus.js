import { useRafflePrizes } from "@/hooks/useRafflePrizes";
import { useRaffleAccount } from "@/hooks/useRaffleAccount";
import { useUltraFreshRead } from "@/hooks/chain/useUltraFreshRead";
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
 * Cache semantics (per Raffle Detail spec):
 *  - Active season: data is functionally stable for the lifetime of the
 *    view (eligibility flips only when the user buys/sells tickets, and
 *    nothing on the page reads it until VRF lands). Fetch once on mount.
 *  - Completed season: data is immutable. Fetch once on mount and cache
 *    for the rest of the session.
 *
 * Both cases collapse to staleTime: Infinity — react-query will reuse
 * the cached value across remounts in the same session. The two reads
 * still get invalidated by the existing `touches: [distributorAddress]`
 * post-tx invalidation in executeBatch, so a successful claim immediately
 * refreshes claim status without a poll loop.
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

  const distributorContract = {
    address: distributorAddress,
    abi: RafflePrizeDistributorAbi,
  };

  const { data: eligible, isLoading: isLoadingEligible } = useUltraFreshRead({
    contract: distributorContract,
    fn: "isEligibleForConsolation",
    args: [BigInt(seasonId ?? 0), viewerAddress],
    touches: distributorAddress ? [distributorAddress] : [],
    enabled,
    staleTime: Infinity,
  });

  const { data: claimed, isLoading: isLoadingClaimed } = useUltraFreshRead({
    contract: distributorContract,
    fn: "hasClaimedConsolation",
    args: [BigInt(seasonId ?? 0), viewerAddress],
    touches: distributorAddress ? [distributorAddress] : [],
    enabled,
    staleTime: Infinity,
  });

  const totalPoolWei = seasonPayouts?.consolationAmount ?? 0n;
  const totalParticipants = seasonPayouts?.totalParticipants ?? 0n;
  const loserCount = totalParticipants > 1n ? totalParticipants - 1n : 0n;
  const perLoserShareWei =
    totalPoolWei > 0n && loserCount > 0n ? totalPoolWei / loserCount : 0n;

  return {
    totalPoolWei,
    perLoserShareWei,
    viewerEligible: viewerAddress ? Boolean(eligible) : null,
    viewerClaimed: Boolean(claimed),
    isLoading: Boolean(prizes.isLoading || isLoadingEligible || isLoadingClaimed),
  };
}
