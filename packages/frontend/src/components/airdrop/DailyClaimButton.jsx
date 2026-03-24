// src/components/airdrop/DailyClaimButton.jsx
import { useEffect } from "react";
import { useAccount } from "wagmi";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { useAirdrop } from "@/hooks/useAirdrop";

/**
 * DailyClaimButton
 *
 * Renders only for users who have completed the initial airdrop claim.
 *
 * - When the cooldown has elapsed: shows "Claim X $SOF" button
 * - While on cooldown: shows countdown timer "Next claim in Xh Ym"
 * - During transaction: shows loading state
 */
const DailyClaimButton = () => {
  const { t } = useTranslation("airdrop");
  const { isConnected } = useAccount();

  const {
    hasClaimed,
    dailyAmount,
    canClaimDaily,
    timeUntilClaim,
    claimDaily,
    claimDailyState,
    resetDailyState,
  } = useAirdrop();

  const { isPending, isSuccess, isError, error } = claimDailyState;

  // Auto-reset success state after 3 seconds so the button re-enables on next cooldown
  useEffect(() => {
    if (!isSuccess) return;
    const timer = setTimeout(() => resetDailyState(), 3000);
    return () => clearTimeout(timer);
  }, [isSuccess, resetDailyState]);

  // Only render for users who have completed the initial claim
  if (!isConnected || !hasClaimed) return null;

  const formattedAmount = dailyAmount.toLocaleString();

  const handleClaim = () => {
    if (canClaimDaily && !isPending) {
      claimDaily();
    }
  };

  if (!canClaimDaily && timeUntilClaim) {
    return (
      <div className="flex flex-col items-center gap-1">
        <span className="text-xs text-muted-foreground">{t("dailyCooldown")}</span>
        <span className="text-sm font-medium text-foreground tabular-nums">
          {timeUntilClaim}
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-1">
      <span className="text-xs text-muted-foreground">{t("dailyDrip")}</span>
      <Button
        size="sm"
        onClick={handleClaim}
        disabled={!canClaimDaily || isPending || isSuccess}
        variant="outline"
      >
        {isPending
          ? t("claiming")
          : isSuccess
          ? t("claimed")
          : t("claimDaily", { amount: formattedAmount })}
      </Button>
      {isError && (
        <span className="text-xs text-destructive">{error || t("claimError")}</span>
      )}
    </div>
  );
};

DailyClaimButton.propTypes = {};

export default DailyClaimButton;
