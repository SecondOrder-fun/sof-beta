import PropTypes from "prop-types";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { formatUnits } from "viem";

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

  const claims = raffleClaimsQuery.data || [];

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
