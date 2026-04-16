import { useState } from "react";
import PropTypes from "prop-types";
import { useTranslation } from "react-i18next";
import { formatUnits, parseUnits } from "viem";
import { Switch } from "@/components/ui/switch";

export default function RolloverBanner({
  rolloverBalance,
  bonusBps,
  bonusAmount,
  sourceSeasonId,
  enabled,
  onEnabledChange,
  rolloverAmount,
  onRolloverAmountChange,
}) {
  const { t } = useTranslation(["raffle"]);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const bonusPercent = Number(bonusBps) / 100;
  const balanceFormatted = formatUnits(rolloverBalance, 18);
  const rolloverFormatted = formatUnits(rolloverAmount, 18);
  const bonusFormatted = formatUnits(bonusAmount(rolloverAmount), 18);

  return (
    <div
      className={`rounded-lg border p-3 mb-3 transition-colors ${
        enabled
          ? "bg-emerald-500/10 border-emerald-500/25"
          : "bg-muted/30 border-border"
      }`}
    >
      <div className="flex items-center justify-between">
        <div>
          <div className={`font-semibold text-sm ${enabled ? "text-emerald-500" : "text-muted-foreground"}`}>
            {t("raffle:rolloverAvailable")}
          </div>
          <div className="text-muted-foreground text-xs">
            {t("raffle:rolloverFromSeason", {
              amount: balanceFormatted,
              season: String(sourceSeasonId),
            })}{" "}
            · {t("raffle:bonusLabel", { percent: bonusPercent })}
          </div>
        </div>
        <Switch checked={enabled} onCheckedChange={onEnabledChange} />
      </div>

      {enabled && (
        <div className="mt-2">
          {!adjustOpen ? (
            <button
              type="button"
              onClick={() => setAdjustOpen(true)}
              className="text-xs text-muted-foreground underline hover:text-foreground"
            >
              {t("raffle:adjust")}
            </button>
          ) : (
            <div className="flex items-center gap-2 mt-1">
              <span className="text-xs text-muted-foreground">{t("raffle:adjust")}:</span>
              <input
                type="number"
                value={rolloverFormatted}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val === "" || isNaN(Number(val))) return;
                  const parsed = parseUnits(val, 18);
                  const clamped = parsed > rolloverBalance ? rolloverBalance : parsed;
                  onRolloverAmountChange(clamped);
                }}
                className="w-24 bg-background border border-border rounded px-2 py-1 text-sm"
                min="0"
                max={balanceFormatted}
              />
              <span className="text-xs text-muted-foreground">
                {t("raffle:useOfRollover", { used: rolloverFormatted, total: balanceFormatted })}
              </span>
            </div>
          )}
        </div>
      )}

      {enabled && (
        <div className="mt-2 space-y-1 text-xs">
          <div className="flex justify-between text-muted-foreground">
            <span>{t("raffle:fromRollover")}</span>
            <span>{rolloverFormatted} SOF</span>
          </div>
          <div className="flex justify-between text-emerald-500">
            <span>{t("raffle:bonusPercent", { percent: bonusPercent })}</span>
            <span>+{bonusFormatted} SOF</span>
          </div>
        </div>
      )}
    </div>
  );
}

RolloverBanner.propTypes = {
  rolloverBalance: PropTypes.any.isRequired,
  bonusBps: PropTypes.number.isRequired,
  bonusAmount: PropTypes.func.isRequired,
  sourceSeasonId: PropTypes.any.isRequired,
  enabled: PropTypes.bool.isRequired,
  onEnabledChange: PropTypes.func.isRequired,
  rolloverAmount: PropTypes.any.isRequired,
  onRolloverAmountChange: PropTypes.func.isRequired,
};
