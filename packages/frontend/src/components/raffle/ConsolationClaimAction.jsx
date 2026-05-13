import PropTypes from "prop-types";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { formatUnits } from "viem";
import { useRollover } from "@/hooks/useRollover";

/**
 * ConsolationClaimAction — renders the rollover/claim UI for a consolation prize.
 *
 * When the rollover cohort is open (`hasClaimableRollover`), shows the green bonus
 * box plus a primary "Rollover" button and a secondary "Claim to wallet instead" link.
 * Otherwise shows a single "Claim Prize" button.
 *
 * Internally calls useRollover(seasonId) so callers don't need to wire that hook.
 * The only mutation wired from outside is `onClaimToWallet` (the traditional claim).
 */
const ConsolationClaimAction = ({ seasonId, amount, isPending, onClaimToWallet }) => {
  const { t } = useTranslation(["raffle", "transactions"]);
  const { hasClaimableRollover, bonusBps, bonusAmount, claimToRollover } =
    useRollover(seasonId);

  if (!hasClaimableRollover) {
    return (
      <Button
        onClick={() => onClaimToWallet({ seasonId })}
        disabled={isPending}
        className="w-full"
      >
        {isPending
          ? t("transactions:claimInProgress", { defaultValue: "Claim in Progress..." })
          : t("raffle:claimPrize")}
      </Button>
    );
  }

  return (
    <div className="space-y-2">
      {/* Rollover highlight box */}
      <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-emerald-500 font-semibold text-sm">
              {t("raffle:rolloverToNextSeason")}
            </div>
            <div className="text-muted-foreground text-xs">
              {t("raffle:earnBonusPercent", {
                percent: Number(bonusBps) / 100,
              })}
            </div>
          </div>
          <div className="text-emerald-500 text-sm font-bold">
            +{formatUnits(bonusAmount(amount ?? 0n), 18)} SOF
          </div>
        </div>
      </div>
      {/* Primary rollover button */}
      <Button
        onClick={() => claimToRollover.mutate({ seasonId })}
        disabled={isPending}
        className="w-full bg-emerald-600 hover:bg-emerald-700"
      >
        {isPending
          ? t("transactions:claimInProgress", { defaultValue: "Claim in Progress..." })
          : t("raffle:rolloverAmount", { amount: formatUnits(amount ?? 0n, 18) })}
      </Button>
      {/* Secondary wallet link */}
      <div className="text-center">
        <button
          onClick={() => onClaimToWallet({ seasonId })}
          className="text-muted-foreground text-sm underline hover:text-foreground"
          disabled={isPending}
        >
          {t("raffle:claimToWalletInstead")}
        </button>
      </div>
    </div>
  );
};

ConsolationClaimAction.propTypes = {
  seasonId: PropTypes.any.isRequired,
  amount: PropTypes.any,
  isPending: PropTypes.bool.isRequired,
  onClaimToWallet: PropTypes.func.isRequired,
};

export default ConsolationClaimAction;
