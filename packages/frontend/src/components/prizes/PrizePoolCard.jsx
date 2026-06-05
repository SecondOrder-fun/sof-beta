import PropTypes from "prop-types";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useFormatSOF } from "@/hooks/buysell";
import { useSofDecimals } from "@/hooks/useSofDecimals";
import { splitPrizePool, perLoserShareWei, GRAND_PRIZE_BPS } from "@/lib/prizeMath";

/**
 * Combined Grand + Consolation prize card for the active right column.
 * Pure/presentational: reserves and participant count are supplied by the
 * parent (RaffleDetails), which sources them live (curve reserves via
 * useCurveState, participant count via useLiveParticipantCount).
 */
const PrizePoolCard = ({ curveReservesWei, totalParticipants }) => {
  const { t } = useTranslation("raffle");
  const decimals = useSofDecimals();
  const formatSOF = useFormatSOF(decimals);

  const grandPct = Number(GRAND_PRIZE_BPS) / 100;
  const consolationPct = (10000 - Number(GRAND_PRIZE_BPS)) / 100;

  const { grandWei, consolationWei } = splitPrizePool(curveReservesWei);
  const shareWei = perLoserShareWei(consolationWei, totalParticipants);
  const participants = Number(totalParticipants) || 0;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">
          {t("prizePool", { defaultValue: "Prize Pool" })}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div>
          <div className="flex items-baseline justify-between">
            <span className="font-medium">
              🏆 {t("grandPrize", { defaultValue: "Grand Prize" })}
            </span>
            <span className="text-xs text-muted-foreground">{grandPct}%</span>
          </div>
          <div className="font-mono text-lg font-bold">{formatSOF(grandWei)} SOF</div>
        </div>

        <div className="border-t border-border pt-3">
          <div className="flex items-baseline justify-between">
            <span className="font-medium">
              🎁 {t("consolationPool", { defaultValue: "Consolation Pool" })}
            </span>
            <span className="text-xs text-muted-foreground">{consolationPct}%</span>
          </div>
          <div className="font-mono text-lg font-bold">{formatSOF(consolationWei)} SOF</div>

          <div className="mt-2 flex justify-between text-sm">
            <span className="text-muted-foreground">
              {t("perPlayerShare", { defaultValue: "Per-player share" })}
            </span>
            <span className="font-mono">{formatSOF(shareWei)} SOF</span>
          </div>
          <div className="mt-1 flex justify-between text-sm">
            <span className="text-muted-foreground">
              {t("players", { defaultValue: "Players" })}
            </span>
            <span className="font-mono">{participants}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

PrizePoolCard.propTypes = {
  curveReservesWei: PropTypes.oneOfType([PropTypes.string, PropTypes.bigint]),
  totalParticipants: PropTypes.oneOfType([PropTypes.number, PropTypes.string, PropTypes.bigint]),
};

export default PrizePoolCard;
