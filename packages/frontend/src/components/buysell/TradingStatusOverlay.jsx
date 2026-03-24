/**
 * TradingStatusOverlay Component
 * Displays overlay when trading is locked or wallet not connected
 */

import PropTypes from "prop-types";
import { useTranslation } from "react-i18next";

export const TradingStatusOverlay = ({
  tradingLocked,
  walletNotConnected,
  variant = "desktop",
}) => {
  const { t } = useTranslation(["common"]);

  if (!tradingLocked && !walletNotConnected) {
    return null;
  }

  const baseClasses =
    "absolute inset-0 z-10 flex items-center justify-center bg-background/80 backdrop-blur-sm";
  const roundedClasses = variant === "mobile" ? "rounded-t-2xl" : "rounded-lg";

  if (tradingLocked) {
    return (
      <div className={`${baseClasses} ${roundedClasses}`}>
        <div className="text-center p-6 bg-card border border-border rounded-lg shadow-lg">
          <p className="text-lg font-semibold mb-2 text-foreground">
            {t("common:tradingLocked", { defaultValue: "Trading is Locked" })}
          </p>
          <p className="text-sm text-muted-foreground">
            {t("common:seasonEnded", { defaultValue: "Season has ended" })}
          </p>
        </div>
      </div>
    );
  }

  if (walletNotConnected) {
    return (
      <div className={`${baseClasses} ${roundedClasses}`}>
        <div className="text-center p-6 rounded-lg bg-card border border-border text-muted-foreground shadow-lg max-w-sm">
          <p className="text-lg font-semibold">
            {t("common:connectWalletToTrade", {
              defaultValue: "Connect your wallet to trade",
            })}
          </p>
        </div>
      </div>
    );
  }

  return null;
};

TradingStatusOverlay.propTypes = {
  tradingLocked: PropTypes.bool.isRequired,
  walletNotConnected: PropTypes.bool.isRequired,
  variant: PropTypes.oneOf(["desktop", "mobile"]),
};
