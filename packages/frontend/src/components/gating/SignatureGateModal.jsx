/**
 * SignatureGateModal
 * Automatically fetches an allowlist signature from the backend and submits
 * on-chain verification. No user input required beyond wallet confirmation.
 * Uses Dialog (centered modal) on all platforms for consistency with PasswordGateModal.
 */

import PropTypes from "prop-types";
import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { ShieldCheck, Loader2, XCircle, CheckCircle2 } from "lucide-react";
import { parseSignature } from "viem";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

const API_BASE = import.meta.env.VITE_API_BASE_URL;

const SignatureGateModal = ({
  open,
  onOpenChange,
  seasonId,
  seasonName,
  userAddress,
  verifySignature,
  onVerified,
}) => {
  const { t } = useTranslation(["common", "raffle"]);
  const [status, setStatus] = useState("loading"); // loading | signing | success | not_allowed | error
  const [errorMsg, setErrorMsg] = useState("");

  const doVerify = useCallback(async () => {
    if (!userAddress || !seasonId) return;

    try {
      setStatus("loading");
      setErrorMsg("");

      // Fetch signature from backend
      const res = await fetch(
        `${API_BASE}/gating/signature/${seasonId}/${userAddress}`
      );

      if (res.status === 404) {
        setStatus("not_allowed");
        return;
      }
      if (!res.ok) throw new Error("Failed to fetch allowlist");

      const { signature, deadline, gateIndex } = await res.json();
      const { v, r, s } = parseSignature(signature);

      setStatus("signing");
      await verifySignature(gateIndex, deadline, Number(v), r, s);

      setStatus("success");
      setTimeout(() => {
        onVerified?.();
        onOpenChange(false);
      }, 1500);
    } catch (err) {
      if (err?.name === "UserRejectedRequestError" || err?.code === 4001) {
        setErrorMsg(t("common:txRejected", { defaultValue: "Transaction was rejected." }));
      } else if (err?.message?.includes("AlreadyVerified")) {
        setStatus("success");
        setTimeout(() => {
          onVerified?.();
          onOpenChange(false);
        }, 600);
        return;
      } else {
        setErrorMsg(err.message || t("common:txFailed", { defaultValue: "Verification failed" }));
      }
      setStatus("error");
    }
  }, [userAddress, seasonId, verifySignature, onVerified, onOpenChange, t]);

  useEffect(() => {
    if (open) {
      doVerify();
    }
  }, [open, doVerify]);

  const handleOpenChange = useCallback((v) => {
    if (!v) {
      setStatus("loading");
      setErrorMsg("");
    }
    onOpenChange(v);
  }, [onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="bg-background border border-primary sm:max-w-md">
        <DialogHeader className="mb-4">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-primary" />
            <DialogTitle className="text-xl font-bold">
              {t("raffle:allowlistVerification", { defaultValue: "Allowlist Verification" })}
            </DialogTitle>
          </div>
          <DialogDescription className="text-sm text-muted-foreground mt-1">
            {seasonName
              ? t("raffle:allowlistDescNamed", {
                  defaultValue: '"{{name}}" requires allowlist verification to participate.',
                  name: seasonName,
                })
              : t("raffle:allowlistDesc", {
                  defaultValue: "This season requires allowlist verification to participate.",
                })}
          </DialogDescription>
        </DialogHeader>

        <div className="py-4 text-center">
          {status === "loading" && (
            <div className="flex flex-col items-center gap-2">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">
                {t("raffle:checkingAllowlist", { defaultValue: "Checking allowlist..." })}
              </p>
            </div>
          )}

          {status === "signing" && (
            <div className="flex flex-col items-center gap-2">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">
                {t("common:confirmWallet", { defaultValue: "Confirm the transaction in your wallet..." })}
              </p>
            </div>
          )}

          {status === "success" && (
            <div className="flex flex-col items-center gap-2">
              <CheckCircle2 className="w-8 h-8 text-green-500" />
              <p className="text-sm font-medium">
                {t("raffle:verified", { defaultValue: "Verified!" })}
              </p>
            </div>
          )}

          {status === "not_allowed" && (
            <div className="flex flex-col items-center gap-2">
              <XCircle className="w-8 h-8 text-destructive" />
              <p className="text-sm text-muted-foreground">
                {t("raffle:notOnAllowlist", { defaultValue: "You are not on the allowlist for this season." })}
              </p>
            </div>
          )}

          {status === "error" && (
            <div className="flex flex-col items-center gap-3">
              <XCircle className="w-8 h-8 text-destructive" />
              <p className="text-sm text-destructive">{errorMsg}</p>
              <Button
                variant="outline"
                size="sm"
                onClick={doVerify}
              >
                {t("common:tryAgain", { defaultValue: "Try Again" })}
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

SignatureGateModal.propTypes = {
  open: PropTypes.bool.isRequired,
  onOpenChange: PropTypes.func.isRequired,
  seasonId: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired,
  seasonName: PropTypes.string,
  userAddress: PropTypes.string,
  verifySignature: PropTypes.func.isRequired,
  onVerified: PropTypes.func,
};

export default SignatureGateModal;
