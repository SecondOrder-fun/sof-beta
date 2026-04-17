import PropTypes from "prop-types";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { formatUnits } from "viem";
import { useRollover } from "@/hooks/useRollover";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const PHASE_BADGES = {
  open: { label: "rolloverPending", defaultValue: "Pending", variant: "secondary", className: "" },
  active: { label: "rolloverReady", defaultValue: "Ready", variant: "default", className: "bg-emerald-600" },
  closed: { label: "rolloverClosed", defaultValue: "Closed", variant: "outline", className: "" },
  expired: { label: "rolloverExpired", defaultValue: "Expired", variant: "destructive", className: "" },
};

export default function RolloverPortfolioCard({ seasonId }) {
  const { t } = useTranslation(["account", "raffle"]);
  const {
    rolloverBalance,
    cohortPhase,
    bonusPercent,
    nextSeasonId,
    refundRollover,
    isLoading,
  } = useRollover(seasonId);

  if (isLoading || rolloverBalance === 0n || cohortPhase === "none") return null;

  const badge = PHASE_BADGES[cohortPhase] || PHASE_BADGES.closed;
  const balanceFormatted = formatUnits(rolloverBalance, 18);

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm">
            {t("account:rolloverBalance", { defaultValue: "Rollover Balance" })}
          </CardTitle>
          <Badge variant={badge.variant} className={badge.className}>
            {t(`account:${badge.label}`, { defaultValue: badge.defaultValue })}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div>
          <div className="text-2xl font-bold">{balanceFormatted} SOF</div>
          <div className="text-xs text-muted-foreground">
            {t("account:fromSeason", {
              season: String(seasonId),
              defaultValue: `From Season ${String(seasonId)}`,
            })}{" "}
            ·{" "}
            {t("account:rolloverBonusRate", {
              percent: bonusPercent,
              defaultValue: `+${bonusPercent}% bonus`,
            })}
          </div>
        </div>

        {cohortPhase === "active" && nextSeasonId > 0n && (
          <Link
            to={`/raffles/${String(nextSeasonId)}`}
            className="text-sm text-emerald-500 hover:text-emerald-400 underline"
          >
            {t("account:buyTicketsInSeason", {
              season: String(nextSeasonId),
              defaultValue: `Buy Tickets in Season ${String(nextSeasonId)} →`,
            })}
          </Link>
        )}

        {rolloverBalance > 0n &&
          (cohortPhase === "active" ||
            cohortPhase === "closed" ||
            cohortPhase === "expired") && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => refundRollover.mutate({ seasonId })}
              disabled={refundRollover.isPending}
            >
              {refundRollover.isPending
                ? t("common:loading", { defaultValue: "Loading..." })
                : t("account:refundToWallet", { defaultValue: "Refund to Wallet" })}
            </Button>
          )}
      </CardContent>
    </Card>
  );
}

RolloverPortfolioCard.propTypes = {
  seasonId: PropTypes.any.isRequired,
};
