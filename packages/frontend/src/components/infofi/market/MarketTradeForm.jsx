import PropTypes from "prop-types";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * MarketTradeForm - Trading input and submit button
 */
const MarketTradeForm = ({
  amount,
  onAmountChange,
  selectedSide,
  isConnected,
  isSettled,
  isActive,
  isPending,
  onSubmit,
}) => {
  const { t } = useTranslation("market");
  const isLocked = isSettled || isActive === false;

  return (
    <div className="relative space-y-2">
      <div className="flex gap-2">
        <Input
          placeholder={t("amountSof")}
          value={amount}
          onChange={(e) => onAmountChange(e.target.value)}
          className="flex-1"
          disabled={isLocked}
        />
        <Button
          onClick={onSubmit}
          disabled={
            !isConnected ||
            !amount ||
            isPending ||
            isLocked
          }
          className={`min-w-[100px] ${
            selectedSide === "YES"
              ? "bg-emerald-600 hover:bg-emerald-700"
              : "bg-rose-600 hover:bg-rose-700"
          }`}
        >
          {isPending ? t("submitting") : t("trade")}
        </Button>
      </div>

      {/* Trading Locked Overlay */}
      {isLocked && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/80 backdrop-blur-sm rounded-lg">
          <div className="text-center px-4 py-3 bg-card border-2 border-muted rounded-lg shadow-lg">
            <div className="text-lg font-semibold text-muted-foreground mb-1">
              {t("tradingLocked", "Trading is Locked")}
            </div>
            <div className="text-sm text-muted-foreground">
              {isSettled
                ? t("seasonEnded", "Season has ended")
                : t("marketInactive", "Market is no longer active")}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

MarketTradeForm.propTypes = {
  amount: PropTypes.string.isRequired,
  onAmountChange: PropTypes.func.isRequired,
  selectedSide: PropTypes.oneOf(["YES", "NO"]).isRequired,
  isConnected: PropTypes.bool.isRequired,
  isSettled: PropTypes.bool,
  isActive: PropTypes.bool,
  isPending: PropTypes.bool.isRequired,
  onSubmit: PropTypes.func.isRequired,
};

export default MarketTradeForm;
