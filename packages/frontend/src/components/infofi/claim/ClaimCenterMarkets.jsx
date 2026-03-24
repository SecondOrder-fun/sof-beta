import PropTypes from "prop-types";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { formatUnits } from "viem";

/**
 * ClaimCenterMarkets - Display and claim InfoFi market winnings (legacy + FPMM)
 */
const ClaimCenterMarkets = ({
  discovery,
  claimsQuery,
  fpmmClaimsQuery,
  pendingClaims,
  successfulClaims,
  getClaimKey,
  claimInfoFiOne,
  claimFPMMOne,
}) => {
  const { t } = useTranslation(["market", "common", "transactions"]);

  // Merge all InfoFi claims (legacy + FPMM) by season
  const allInfoFiClaims = [
    ...(claimsQuery.data || []),
    ...(fpmmClaimsQuery.data || []),
  ];

  const infoFiGrouped = (() => {
    const out = new Map();
    for (const c of allInfoFiClaims) {
      const key = String(c.seasonId ?? "—");
      if (!out.has(key)) out.set(key, []);
      out.get(key).push(c);
    }
    return out;
  })();

  if (
    discovery.isLoading ||
    claimsQuery.isLoading ||
    fpmmClaimsQuery.isLoading
  ) {
    return <p className="text-muted-foreground">{t("common:loading")}</p>;
  }

  if (claimsQuery.error || fpmmClaimsQuery.error) {
    return (
      <p className="text-red-500">
        {t("common:error")}:{" "}
        {String(
          claimsQuery.error?.message ||
            fpmmClaimsQuery.error?.message ||
            "Unknown error",
        )}
      </p>
    );
  }

  if (allInfoFiClaims.length === 0) {
    return (
      <p className="text-muted-foreground">
        {t("errors:nothingToClaim", { defaultValue: "Nothing to claim" })}
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {Array.from(infoFiGrouped.entries()).map(([season, rows]) => (
        <div key={season} className="border rounded">
          <div className="flex items-center justify-between px-3 py-2 bg-muted/50">
            <div className="text-sm font-medium">
              {t("raffle:seasonNumber", { number: season, defaultValue: `Season ${season}` })}
            </div>
            <div className="text-xs text-muted-foreground">
              {t("common:subtotal", {
                defaultValue: "Subtotal",
              })}
              :{" "}
              <span className="font-mono">
                {(() => {
                  try {
                    return formatUnits(
                      rows.reduce((acc, r) => {
                        const amount =
                          r.type === "fpmm"
                            ? (r.netPayout ?? 0n)
                            : (r.payout ?? 0n);
                        return acc + amount;
                      }, 0n),
                      18,
                    );
                  } catch {
                    return "0";
                  }
                })()}
              </span>{" "}
              SOF
            </div>
          </div>
          <div className="p-2 space-y-2">
            {rows.map((r) => {
              if (r.type === "fpmm") {
                // FPMM claim (CTF redemption)
                const totalAmount = (r.yesAmount ?? 0n) + (r.noAmount ?? 0n);
                const fpmmClaimKey = getClaimKey("fpmm", {
                  seasonId: r.seasonId,
                  player: r.player,
                });
                const isFpmmPending = pendingClaims.has(fpmmClaimKey);
                const isFpmmSuccessful = successfulClaims.has(fpmmClaimKey);

                return (
                  <div
                    key={`fpmm-${r.player}`}
                    className="flex items-center justify-between border rounded p-2 text-sm bg-blue-50/50"
                  >
                    <div className="text-xs text-muted-foreground">
                      <span className="font-semibold text-blue-600">
                        FPMM Market
                      </span>{" "}
                      • Player:{" "}
                      <span className="font-mono">
                        {String(r.player).slice(0, 6)}...
                        {String(r.player).slice(-4)}
                      </span>{" "}
                      • YES:{" "}
                      <span className="font-mono">
                        {formatUnits(r.yesAmount ?? 0n, 18)}
                      </span>{" "}
                      • NO:{" "}
                      <span className="font-mono">
                        {formatUnits(r.noAmount ?? 0n, 18)}
                      </span>{" "}
                      • Total:{" "}
                      <span className="font-mono">
                        {formatUnits(totalAmount, 18)}
                      </span>{" "}
                      SOF
                    </div>
                    {isFpmmSuccessful ? (
                      <span className="text-sm text-green-600 font-medium">
                        ✓{" "}
                        {t("transactions:confirmed", {
                          defaultValue: "Claimed",
                        })}
                      </span>
                    ) : (
                      <Button
                        variant="outline"
                        onClick={() =>
                          claimFPMMOne.mutate({
                            seasonId: r.seasonId,
                            player: r.player,
                            fpmmAddress: r.contractAddress,
                          })
                        }
                        disabled={isFpmmPending}
                      >
                        {isFpmmPending
                          ? t("transactions:claimInProgress", {
                              defaultValue: "Claiming...",
                            })
                          : t("common:redeem")}
                      </Button>
                    )}
                  </div>
                );
              } else {
                // Old InfoFi claim
                const infofiClaimKey = getClaimKey("infofi", {
                  marketId: r.marketId,
                  prediction: r.prediction,
                });
                const isInfofiPending = pendingClaims.has(infofiClaimKey);
                const isInfofiSuccessful =
                  successfulClaims.has(infofiClaimKey);

                return (
                  <div
                    key={`${r.marketId}-${String(r.prediction)}`}
                    className="flex items-center justify-between border rounded p-2 text-sm"
                  >
                    <div className="text-xs text-muted-foreground">
                      {t("market:market")}:{" "}
                      <span className="font-mono">
                        {String(r.marketId)}
                      </span>{" "}
                      •{" "}
                      {t("common:side", {
                        defaultValue: "Side",
                      })}
                      : {r.prediction ? "YES" : "NO"} •{" "}
                      {t("market:potentialPayout")}:{" "}
                      <span className="font-mono">
                        {formatUnits(r.payout ?? 0n, 18)}
                      </span>{" "}
                      SOF
                    </div>
                    {isInfofiSuccessful ? (
                      <span className="text-sm text-green-600 font-medium">
                        ✓{" "}
                        {t("transactions:confirmed", {
                          defaultValue: "Claimed",
                        })}
                      </span>
                    ) : (
                      <Button
                        variant="outline"
                        onClick={() =>
                          claimInfoFiOne.mutate({
                            marketId: r.marketId,
                            prediction: r.prediction,
                            contractAddress: r.contractAddress,
                          })
                        }
                        disabled={isInfofiPending}
                      >
                        {isInfofiPending
                          ? t("transactions:claimInProgress", {
                              defaultValue: "Claiming...",
                            })
                          : t("common:claim")}
                      </Button>
                    )}
                  </div>
                );
              }
            })}
          </div>
        </div>
      ))}
    </div>
  );
};

ClaimCenterMarkets.propTypes = {
  discovery: PropTypes.object.isRequired,
  claimsQuery: PropTypes.object.isRequired,
  fpmmClaimsQuery: PropTypes.object.isRequired,
  pendingClaims: PropTypes.instanceOf(Set).isRequired,
  successfulClaims: PropTypes.instanceOf(Set).isRequired,
  getClaimKey: PropTypes.func.isRequired,
  claimInfoFiOne: PropTypes.object.isRequired,
  claimFPMMOne: PropTypes.object.isRequired,
};

export default ClaimCenterMarkets;
