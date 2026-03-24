import PropTypes from "prop-types";
import { useTranslation } from "react-i18next";

/**
 * MarketOutcomeButtons - Polymarket-style YES/NO outcome buttons with percentages
 */
const MarketOutcomeButtons = ({
  percent,
  selectedSide,
  onSelectSide,
  betAmount,
  calculatePayout,
  calculateProfit,
}) => {
  const { t } = useTranslation("market");

  const formatPayout = (amount) => {
    if (amount >= 1000) return `${(amount / 1000).toFixed(2)}k`;
    if (amount >= 100) return amount.toFixed(0);
    return amount.toFixed(2);
  };

  return (
    <div className="grid grid-cols-2 gap-2">
      {/* YES Button */}
      <button
        onClick={() => onSelectSide("YES")}
        className={`relative overflow-hidden rounded-lg border-2 transition-all ${
          selectedSide === "YES"
            ? "border-emerald-500 bg-emerald-50"
            : "border-gray-200 hover:border-emerald-300 bg-white"
        }`}
      >
        <div
          className="absolute inset-0 bg-emerald-100"
          style={{ width: `${percent}%` }}
        />
        <div className="relative px-4 py-3 flex flex-col items-center">
          <span className="text-2xl font-bold text-emerald-700">
            {percent}%
          </span>
          <span className="text-xs font-medium text-emerald-900 mt-1">
            {t("yes")}
          </span>
          <div className="mt-2 text-xs text-emerald-600">
            {betAmount && Number(betAmount) > 0 ? (
              <>
                <div className="font-semibold">
                  {formatPayout(calculatePayout(betAmount, true))} SOF
                </div>
                <div className="text-[10px] opacity-75">
                  +{formatPayout(calculateProfit(betAmount, true))} profit
                </div>
              </>
            ) : (
              <>
                <div className="font-semibold">
                  {formatPayout(calculatePayout(1, true))} SOF
                </div>
                <div className="text-[10px] opacity-75">per 1 SOF bet</div>
              </>
            )}
          </div>
        </div>
      </button>

      {/* NO Button */}
      <button
        onClick={() => onSelectSide("NO")}
        className={`relative overflow-hidden rounded-lg border-2 transition-all ${
          selectedSide === "NO"
            ? "border-rose-500 bg-rose-50"
            : "border-gray-200 hover:border-rose-300 bg-white"
        }`}
      >
        <div
          className="absolute inset-0 bg-rose-100"
          style={{ width: `${100 - Number(percent)}%` }}
        />
        <div className="relative px-4 py-3 flex flex-col items-center">
          <span className="text-2xl font-bold text-rose-700">
            {(100 - Number(percent)).toFixed(1)}%
          </span>
          <span className="text-xs font-medium text-rose-900 mt-1">
            {t("no")}
          </span>
          <div className="mt-2 text-xs text-rose-600">
            {betAmount && Number(betAmount) > 0 ? (
              <>
                <div className="font-semibold">
                  {formatPayout(calculatePayout(betAmount, false))} SOF
                </div>
                <div className="text-[10px] opacity-75">
                  +{formatPayout(calculateProfit(betAmount, false))} profit
                </div>
              </>
            ) : (
              <>
                <div className="font-semibold">
                  {formatPayout(calculatePayout(1, false))} SOF
                </div>
                <div className="text-[10px] opacity-75">per 1 SOF bet</div>
              </>
            )}
          </div>
        </div>
      </button>
    </div>
  );
};

MarketOutcomeButtons.propTypes = {
  percent: PropTypes.string.isRequired,
  selectedSide: PropTypes.oneOf(["YES", "NO"]).isRequired,
  onSelectSide: PropTypes.func.isRequired,
  betAmount: PropTypes.string.isRequired,
  calculatePayout: PropTypes.func.isRequired,
  calculateProfit: PropTypes.func.isRequired,
};

export default MarketOutcomeButtons;
