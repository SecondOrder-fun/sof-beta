// src/components/admin/TransactionModal.jsx
import { useState, useEffect, useMemo, useCallback } from "react";
import PropTypes from "prop-types";
import { X, Loader2, CheckCircle2, XCircle, ExternalLink } from "lucide-react";
import { getStoredNetworkKey } from "@/lib/wagmi";
import { getNetworkByKey } from "@/config/networks";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

const TransactionModal = ({ mutation, title = "Transaction Status" }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [pendingSince, setPendingSince] = useState(null);
  const [showPendingWarn, setShowPendingWarn] = useState(false);

  const netKey = getStoredNetworkKey();
  const netCfg = getNetworkByKey(netKey);

  // useSmartTransactions.executeBatch normalizes the result to a hash string,
  // but defend against a future regression that leaks the ERC-5792 `{id}`
  // object through — rendering that as a React child would hard-crash.
  const hash = typeof mutation?.hash === "string" ? mutation.hash : null;

  const explorerUrl = useMemo(() => {
    if (!netCfg.explorer || !hash) return "";
    const base = netCfg.explorer.endsWith("/")
      ? netCfg.explorer.slice(0, -1)
      : netCfg.explorer;
    return `${base}/tx/${hash}`;
  }, [netCfg.explorer, hash]);

  // Determine if modal should be shown
  const shouldShow = useMemo(() => {
    return (
      mutation?.isPending ||
      mutation?.isConfirming ||
      (hash && !mutation?.isConfirmed && !mutation?.isError) ||
      mutation?.isConfirmed ||
      mutation?.isError
    );
  }, [mutation?.isPending, mutation?.isConfirming, hash, mutation?.isConfirmed, mutation?.isError]);

  // Open modal when transaction activity starts (but not if user manually dismissed)
  useEffect(() => {
    if (shouldShow && !isOpen && !dismissed) {
      setIsOpen(true);
    }
    // Reset dismissed flag when a new transaction starts
    if (mutation?.isPending && dismissed) {
      setDismissed(false);
      setIsOpen(true);
    }
  }, [shouldShow, isOpen, dismissed, mutation?.isPending]);

  // No auto-close — user closes manually

  // Track pending duration for warning
  useEffect(() => {
    if (hash && !mutation?.isConfirmed && !mutation?.isError) {
      if (!pendingSince) setPendingSince(Date.now());
    } else {
      setPendingSince(null);
      setShowPendingWarn(false);
    }
  }, [hash, mutation?.isConfirmed, mutation?.isError, pendingSince]);

  useEffect(() => {
    if (!pendingSince) return;
    const t = setInterval(() => {
      if (Date.now() - pendingSince > 60000) setShowPendingWarn(true);
    }, 5000);
    return () => clearInterval(t);
  }, [pendingSince]);

  const handleClose = useCallback(() => {
    setIsOpen(false);
    setDismissed(true);
  }, []);

  // Prevent link click from closing modal
  const handleLinkClick = useCallback((e) => {
    e.stopPropagation();
  }, []);

  // Determine status icon and color
  const getStatusDisplay = () => {
    if (mutation?.isPending && !mutation?.isConfirming) {
      return {
        icon: <Loader2 className="h-8 w-8 animate-spin text-info" />,
        text: "Waiting for wallet confirmation...",
        color: "text-info",
      };
    }
    if (mutation?.isConfirming || (hash && !mutation?.isConfirmed && !mutation?.isError)) {
      return {
        icon: <Loader2 className="h-8 w-8 animate-spin text-warning" />,
        text: "Transaction submitted. Waiting for confirmation...",
        color: "text-warning",
      };
    }
    if (mutation?.isConfirmed && mutation?.receipt?.status === "success") {
      return {
        icon: <CheckCircle2 className="h-8 w-8 text-success" />,
        text: "Transaction confirmed!",
        color: "text-success",
      };
    }
    if (mutation?.isConfirmed && mutation?.receipt?.status === "reverted") {
      return {
        icon: <XCircle className="h-8 w-8 text-destructive" />,
        text: "Transaction reverted on-chain.",
        color: "text-destructive",
      };
    }
    if (mutation?.isError) {
      return {
        icon: <XCircle className="h-8 w-8 text-destructive" />,
        text: mutation?.error?.shortMessage || mutation?.error?.message || "Transaction failed",
        color: "text-destructive",
      };
    }
    return null;
  };

  const status = getStatusDisplay();

  if (!shouldShow && !isOpen) return null;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { setIsOpen(open); if (!open) setDismissed(true); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between">
            {title}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0 rounded-full"
              onClick={handleClose}
            >
              <X className="h-4 w-4" />
              <span className="sr-only">Close</span>
            </Button>
          </DialogTitle>
          <DialogDescription>
            Track your transaction progress below.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center gap-4 py-4">
          {status && (
            <>
              {status.icon}
              <p className={`text-center font-medium ${status.color}`}>
                {status.text}
              </p>
            </>
          )}

          {hash && (
            <div className="w-full rounded border bg-muted/30 p-3">
              <p className="text-xs text-muted-foreground mb-1">Transaction Hash:</p>
              <p className="text-xs font-mono break-all">{hash}</p>
              {explorerUrl && (
                <a
                  href={explorerUrl}
                  target="_blank"
                  rel="noreferrer"
                  onClick={handleLinkClick}
                  className="mt-2 inline-flex items-center gap-1 text-sm text-info hover:text-info/80 underline"
                >
                  View on explorer
                  <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
          )}

          {showPendingWarn && (
            <p className="text-xs text-warning text-center">
              Transaction pending for over 60s. Verify you are on {netCfg.name} and
              the contract address matches this network.
            </p>
          )}
        </div>

        <div className="flex justify-end">
          <Button
            type="button"
            variant="outline"
            onClick={handleClose}
          >
            {mutation?.isConfirmed || mutation?.isError ? "Close" : "Dismiss"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

TransactionModal.propTypes = {
  mutation: PropTypes.shape({
    isPending: PropTypes.bool,
    isError: PropTypes.bool,
    isSuccess: PropTypes.bool,
    isConfirming: PropTypes.bool,
    isConfirmed: PropTypes.bool,
    hash: PropTypes.string,
    receipt: PropTypes.shape({
      status: PropTypes.string,
    }),
    error: PropTypes.shape({
      shortMessage: PropTypes.string,
      message: PropTypes.string,
    }),
  }),
  title: PropTypes.string,
};

export default TransactionModal;
