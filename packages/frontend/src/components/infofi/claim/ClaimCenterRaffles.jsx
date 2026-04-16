import PropTypes from "prop-types";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { formatUnits } from "viem";
import { useRollover } from "@/hooks/useRollover";

/**
 * ClaimCenterRaffles - Display and claim raffle prizes (grand + consolation)
 */
const ClaimCenterRaffles = ({
  raffleClaimsQuery,
  pendingClaims,
  successfulClaims,
  getClaimKey,
  claimRaffleGrand,
  claimRaffleConsolation,
}) => {
  const { t } = useTranslation(["raffle", "transactions"]);

  // Must be called unconditionally (Rules of Hooks) — we resolve seasonId below
  const claims = raffleClaimsQuery.data || [];
  const firstConsolation = claims.find((c) => c.type !== "raffle-grand");
  const { hasClaimableRollover, bonusBps, bonusAmount, claimToRollover } =
    useRollover(firstConsolation?.seasonId);

  if (raffleClaimsQuery.isLoading) {
    return <p className="text-muted-foreground">{t("raffle:loading", { defaultValue: "Loading..." })}</p>;
  }

  if (raffleClaimsQuery.error) {
    return (
      <p className="text-red-500">
        {t("raffle:error", { defaultValue: "Error" })}:{" "}
        {String(raffleClaimsQuery.error?.message || raffleClaimsQuery.error)}
      </p>
    );
  }

  if (claims.length === 0) {
    return (
      <p className="text-muted-foreground">
        {t("raffle:noActiveSeasons", { defaultValue: "No claimable raffle prizes" })}
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {claims.map((row) => {
        const isGrand = row.type === "raffle-grand";
        const labelKey = isGrand ? "raffle:grandPrize" : "raffle:consolationPrize";
        const claimKey = getClaimKey(
          isGrand ? "raffle-grand" : "raffle-consolation",
          { seasonId: row.seasonId },
        );
        const isThisPending = pendingClaims.has(claimKey);
        const isThisSuccessful = successfulClaims.has(claimKey);
        const showRollover = !isGrand && hasClaimableRollover;

        return (
          <div
            key={`${String(row.seasonId)}-${row.type}`}
            className="border rounded p-3"
          >
            <div className="flex items-center justify-between">
              <div className="text-sm font-medium">
                {t("raffle:season")} #{String(row.seasonId)}
              </div>
              <div className="text-xs text-muted-foreground">
                {t(labelKey)}:{" "}
                <span className="font-mono">
                  {formatUnits(row.amount ?? 0n, 18)}
                </span>{" "}
                SOF
              </div>
            </div>
            <div className="mt-2">
              {isThisSuccessful ? (
                <p className="text-sm text-green-600 font-medium text-center py-2">
                  ✓{" "}
                  {t("transactions:confirmed", {
                    defaultValue: "Claim Successful",
                  })}
                </p>
              ) : showRollover ? (
                <div className="space-y-2">
                  {/* Rollover highlight box */}
                  <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-emerald-500 font-semibold text-sm">
                          {t("raffle:rolloverToNextSeason")}
                        </div>
                        <div className="text-muted-foreground text-xs">
                          {t("raffle:earnBonusPercent", {
                            percent: Number(bonusBps) / 100,
                          })}
                        </div>
                      </div>
                      <div className="text-emerald-500 text-sm font-bold">
                        +{formatUnits(bonusAmount(row.amount ?? 0n), 18)} SOF
                      </div>
                    </div>
                  </div>
                  {/* Primary rollover button */}
                  <Button
                    onClick={() =>
                      claimToRollover.mutate({ seasonId: row.seasonId })
                    }
                    disabled={isThisPending}
                    className="w-full bg-emerald-600 hover:bg-emerald-700"
                  >
                    {isThisPending
                      ? t("transactions:claimInProgress", {
                          defaultValue: "Claim in Progress...",
                        })
                      : t("raffle:rolloverAmount", {
                          amount: formatUnits(row.amount ?? 0n, 18),
                        })}
                  </Button>
                  {/* Secondary wallet link */}
                  <div className="text-center">
                    <button
                      onClick={() =>
                        claimRaffleConsolation.mutate({ seasonId: row.seasonId })
                      }
                      className="text-muted-foreground text-sm underline hover:text-foreground"
                      disabled={isThisPending}
                    >
                      {t("raffle:claimToWalletInstead")}
                    </button>
                  </div>
                </div>
              ) : (
                <Button
                  onClick={() => {
                    if (isGrand) {
                      claimRaffleGrand.mutate({
                        seasonId: row.seasonId,
                      });
                    } else {
                      claimRaffleConsolation.mutate({
                        seasonId: row.seasonId,
                      });
                    }
                  }}
                  disabled={isThisPending}
                  className="w-full"
                >
                  {isThisPending
                    ? t("transactions:claimInProgress", {
                        defaultValue: "Claim in Progress...",
                      })
                    : t("raffle:claimPrize")}
                </Button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};

ClaimCenterRaffles.propTypes = {
  raffleClaimsQuery: PropTypes.object.isRequired,
  pendingClaims: PropTypes.instanceOf(Set).isRequired,
  successfulClaims: PropTypes.instanceOf(Set).isRequired,
  getClaimKey: PropTypes.func.isRequired,
  claimRaffleGrand: PropTypes.object.isRequired,
  claimRaffleConsolation: PropTypes.object.isRequired,
};

export default ClaimCenterRaffles;
