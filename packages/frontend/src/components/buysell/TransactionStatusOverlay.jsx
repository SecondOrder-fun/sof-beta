import PropTypes from "prop-types";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, CheckCircle2, XCircle, ExternalLink, X } from "lucide-react";
import { getStoredNetworkKey } from "@/lib/wagmi";
import { getNetworkByKey } from "@/config/networks";
import { extractErrorDetails } from "@/lib/contractErrors";

const SUCCESS_DECAY_MS = 4000;

/**
 * Buy/Sell transaction status as an overlay covering the BuySellWidget
 * (the widget container is `relative`). Replaces the center-screen
 * TransactionModal for user-facing trades. Success auto-decays after 4s;
 * errors persist until dismissed. Blocks pointer events while visible.
 */
const TransactionStatusOverlay = ({ status, title }) => {
  const { t } = useTranslation(["transactions", "common"]);
  const [dismissed, setDismissed] = useState(false);

  const hash = typeof status?.hash === "string" ? status.hash : null;
  const receiptStatus = status?.receipt?.status;
  const isSuccess = Boolean(status?.isConfirmed && receiptStatus === "success");
  const isReverted = Boolean(status?.isConfirmed && receiptStatus && receiptStatus !== "success");
  const isError = Boolean(status?.isError) || isReverted;
  const isPending = Boolean((status?.isPending || status?.isConfirming) && !status?.isConfirmed && !status?.isError);
  const phase = isError ? "error" : isSuccess ? "success" : isPending ? "pending" : "idle";

  // A new transaction (new hash) clears a prior dismissal. Keying on hash
  // alone means a stale isPending flap on the SAME hash won't resurrect an
  // overlay the user explicitly dismissed.
  useEffect(() => {
    setDismissed(false);
  }, [hash]);

  // Auto-decay success only.
  useEffect(() => {
    if (phase !== "success") return undefined;
    const id = setTimeout(() => setDismissed(true), SUCCESS_DECAY_MS);
    return () => clearTimeout(id);
  }, [phase, hash]);

  if (phase === "idle" || dismissed) return null;

  const netCfg = getNetworkByKey(getStoredNetworkKey());
  const explorerUrl =
    netCfg?.explorer && hash ? `${netCfg.explorer.replace(/\/$/, "")}/tx/${hash}` : "";
  const errorDetails = isError ? extractErrorDetails(status?.error) : null;

  return (
    <div
      className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 rounded-md bg-background/90 px-4 text-center backdrop-blur-sm"
      role={phase === "error" ? "alert" : "status"}
    >
      <button
        type="button"
        onClick={() => setDismissed(true)}
        className="absolute right-2 top-2 text-muted-foreground hover:text-foreground"
        aria-label={t("common:close", { defaultValue: "Close" })}
      >
        <X className="h-4 w-4" />
      </button>

      {phase === "pending" && (
        <>
          <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" />
          <div className="font-medium">{title}</div>
          <div className="text-xs text-muted-foreground">
            {t("transactions:confirmInWallet", { defaultValue: "Confirm in wallet" })}
          </div>
        </>
      )}

      {phase === "success" && (
        <>
          <CheckCircle2 className="h-8 w-8 text-success" />
          <div className="font-medium">{title}</div>
          {explorerUrl && (
            <a
              href={explorerUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs text-primary underline"
            >
              {t("common:viewOnExplorer", { defaultValue: "View on explorer" })}
              <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </>
      )}

      {phase === "error" && (
        <>
          <XCircle className="h-8 w-8 text-destructive" />
          <div className="font-medium">{title}</div>
          <div className="max-w-[260px] text-xs text-muted-foreground">
            {errorDetails?.reason ||
              errorDetails?.headline ||
              t("transactions:txFailed", { defaultValue: "Transaction failed" })}
          </div>
        </>
      )}
    </div>
  );
};

TransactionStatusOverlay.propTypes = {
  status: PropTypes.shape({
    isPending: PropTypes.bool,
    isConfirming: PropTypes.bool,
    isConfirmed: PropTypes.bool,
    isError: PropTypes.bool,
    hash: PropTypes.string,
    error: PropTypes.any,
    receipt: PropTypes.any,
  }),
  title: PropTypes.string.isRequired,
};

export default TransactionStatusOverlay;
