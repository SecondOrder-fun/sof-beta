import PropTypes from "prop-types";
import { formatUnits } from "viem";
import { useTranslation } from "react-i18next";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import UsernameDisplay from "@/components/user/UsernameDisplay";

function formatSof(wei) {
  try {
    return `${Number(formatUnits(BigInt(wei || 0n), 18)).toFixed(2)} SOF`;
  } catch {
    return "0.00 SOF";
  }
}

function CompletedRaffleResults({
  winnerAddress,
  grandPrizeWei,
  consolationStatus,
  seasonStatus,
}) {
  const { t } = useTranslation("raffle");

  if (seasonStatus === 6) {
    return (
      <Card>
        <CardContent className="p-4 text-center">
          <div className="text-xs uppercase tracking-wide text-destructive font-semibold mb-2">
            {t("cancelled")}
          </div>
          <div className="font-semibold text-foreground">{t("seasonCancelled")}</div>
          <div className="text-sm text-muted-foreground mt-1">
            {t("noPayoutRefunded")}
          </div>
        </CardContent>
      </Card>
    );
  }

  const isVrfPending = !winnerAddress && seasonStatus === 4;
  const totalPoolFmt = formatSof(consolationStatus.totalPoolWei);
  const shareFmt = formatSof(consolationStatus.perLoserShareWei);
  const showConsolationDash = consolationStatus.totalPoolWei === 0n;

  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs uppercase tracking-wide text-primary font-semibold mb-2">
          {t("results")}
        </div>

        {/* Winner hero (centered, full width) */}
        <div className="text-center pb-3 mb-3 border-b border-border">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">
            {t("winner")}
          </div>
          {isVrfPending ? (
            <>
              <div className="text-base font-medium italic text-muted-foreground mt-1">
                {t("awaitingDraw")}
              </div>
              <Badge variant="outline" className="mt-1">
                {t("vrfPending")}
              </Badge>
            </>
          ) : winnerAddress ? (
            <div className="text-lg font-semibold text-foreground mt-1">
              <UsernameDisplay address={winnerAddress} className="text-lg" />
            </div>
          ) : (
            <div className="text-base text-muted-foreground mt-1">{t("dashEmpty")}</div>
          )}
        </div>

        {/* Grand Prize + Consolation 2-col split */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              {t("grandPrize")}
            </div>
            <div className="text-lg font-bold text-foreground mt-1">
              {grandPrizeWei > 0n ? formatSof(grandPrizeWei) : t("dashEmpty")}
            </div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              {t("consolationPrize")}
            </div>
            {showConsolationDash ? (
              <div className="text-lg font-semibold text-muted-foreground mt-1">
                {t("dashEmpty")}
              </div>
            ) : (
              <>
                <div className="text-sm font-semibold text-foreground mt-1">
                  {t("consolationPerLoser", { total: totalPoolFmt, share: shareFmt })}
                </div>
                {isVrfPending && (
                  <div className="text-xs text-muted-foreground mt-1">
                    {t("consolationClaimsOpenAfterDraw")}
                  </div>
                )}
                {!isVrfPending && consolationStatus.viewerEligible === null && (
                  <div className="text-xs text-muted-foreground mt-1">
                    {t("connectToCheckEligibility")}
                  </div>
                )}
                {!isVrfPending &&
                  consolationStatus.viewerEligible === true &&
                  consolationStatus.viewerClaimed && (
                    <Badge variant="outline" className="mt-1">
                      {t("youClaimed")}
                    </Badge>
                  )}
                {!isVrfPending &&
                  consolationStatus.viewerEligible === true &&
                  !consolationStatus.viewerClaimed && (
                    <Badge variant="default" className="mt-1">
                      {t("youClaimable")}
                    </Badge>
                  )}
              </>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

CompletedRaffleResults.propTypes = {
  winnerAddress: PropTypes.string,
  grandPrizeWei: PropTypes.any.isRequired,
  consolationStatus: PropTypes.shape({
    totalPoolWei: PropTypes.any.isRequired,
    perLoserShareWei: PropTypes.any.isRequired,
    viewerEligible: PropTypes.bool,
    viewerClaimed: PropTypes.bool,
    isLoading: PropTypes.bool,
  }).isRequired,
  seasonStatus: PropTypes.number.isRequired,
};

export default CompletedRaffleResults;
