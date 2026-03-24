// src/components/airdrop/AirdropBanner.jsx
import { useState, useEffect, useRef } from "react";
import { useAccount } from "wagmi";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAirdrop } from "@/hooks/useAirdrop";
import { useAppIdentity } from "@/hooks/useAppIdentity";
import { useToast } from "@/hooks/useToast";

/**
 * AirdropBanner
 *
 * Shown to connected users who have not yet claimed their initial $SOF.
 * Fetches an EIP-712 attestation from the backend, then submits claimInitial().
 *
 * Hidden once dismissed (session-scoped) or after a successful claim.
 */
const AirdropBanner = () => {
  const { t } = useTranslation("airdrop");
  const { isConnected } = useAccount();
  const { fid } = useAppIdentity();

  const {
    hasClaimed,
    initialAmount,
    basicAmount,
    claimInitial,
    claimInitialBasic,
    claimInitialState,
    resetInitialState,
  } = useAirdrop();

  const { toast } = useToast();
  const toastRef = useRef(toast);
  toastRef.current = toast;
  const tRef = useRef(t);
  tRef.current = t;

  const [dismissed, setDismissed] = useState(false);

  const { isPending, isSuccess, isError, error } = claimInitialState;

  // Show errors via toast — refs prevent re-render loop from unstable toast/t
  useEffect(() => {
    if (isError && error) {
      toastRef.current({
        title: tRef.current("claimError"),
        description: error,
        variant: "destructive",
      });
    }
  }, [isError, error]);

  // Show success via toast
  useEffect(() => {
    if (isSuccess) {
      toastRef.current({ title: tRef.current("claimed") });
    }
  }, [isSuccess]);

  // Only render if wallet connected and user has not yet claimed
  // isSuccess covers the window between tx confirmation and hasClaimed refetch
  if (!isConnected || hasClaimed || isSuccess || dismissed) return null;

  const hasFarcaster = Boolean(fid);

  // If basicAmount isn't available (old contract), fall back to Farcaster-only flow
  const hasBasicClaim = basicAmount > 0;

  const handleClaim = () => {
    if (hasFarcaster) {
      claimInitial(fid);
    } else if (hasBasicClaim) {
      claimInitialBasic();
    }
  };

  const handleDismiss = () => {
    resetInitialState();
    setDismissed(true);
  };

  const formattedAmount = hasFarcaster
    ? initialAmount.toLocaleString()
    : (hasBasicClaim ? basicAmount : initialAmount).toLocaleString();

  return (
    <Card className="border-primary bg-card mb-6">
      <CardContent className="pt-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <h3 className="font-semibold text-foreground text-base mb-1">
              {t("welcomeTitle")}
            </h3>
            <p className="text-sm text-muted-foreground mb-4">
              {t("welcomeMessage")}
            </p>

            {isSuccess ? (
              <p className="text-sm font-medium text-primary">
                {t("claimed")}
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                {hasFarcaster ? (
                  <Button
                    onClick={handleClaim}
                    disabled={isPending}
                    variant="farcaster"
                    className="w-full sm:w-auto"
                  >
                    {isPending
                      ? t("claiming")
                      : t("claimInitial", { amount: formattedAmount })}
                  </Button>
                ) : hasBasicClaim ? (
                  <Button
                    onClick={handleClaim}
                    disabled={isPending}
                    className="w-full sm:w-auto"
                  >
                    {isPending
                      ? t("claiming")
                      : t("claimBasic", { amount: formattedAmount })}
                  </Button>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {t("connectFarcaster")}
                  </p>
                )}
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={handleDismiss}
            aria-label={t("dismiss")}
            className="text-muted-foreground hover:text-foreground transition-colors mt-0.5 shrink-0"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </CardContent>
    </Card>
  );
};

AirdropBanner.propTypes = {};

export default AirdropBanner;
