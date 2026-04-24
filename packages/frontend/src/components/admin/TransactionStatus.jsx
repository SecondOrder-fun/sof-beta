// src/components/admin/TransactionStatus.jsx
import { useState, useEffect, useMemo } from "react";
import PropTypes from "prop-types";
import { getStoredNetworkKey } from "@/lib/wagmi";
import { getNetworkByKey } from "@/config/networks";

const TransactionStatus = ({ mutation }) => {
  const netKey = getStoredNetworkKey();
  const netCfg = getNetworkByKey(netKey);
  // Guard against an ERC-5792 `{id}` object leaking through — executeBatch
  // normalizes the result, but never render an object as a React child.
  const hash = typeof mutation?.hash === "string" ? mutation.hash : null;
  const explorerUrl = useMemo(() => {
    if (!netCfg.explorer || !hash) return "";
    const base = netCfg.explorer.endsWith("/")
      ? netCfg.explorer.slice(0, -1)
      : netCfg.explorer;
    return `${base}/tx/${hash}`;
  }, [netCfg.explorer, hash]);

  // Pending warning if >60s
  const [pendingSince, setPendingSince] = useState(null);
  const [showPendingWarn, setShowPendingWarn] = useState(false);
  
  useEffect(() => {
    if (hash && !mutation.isConfirmed && !mutation.isError) {
      if (!pendingSince) setPendingSince(Date.now());
    } else {
      setPendingSince(null);
      setShowPendingWarn(false);
    }
  }, [hash, mutation.isConfirmed, mutation.isError, pendingSince]);

  useEffect(() => {
    if (!pendingSince) return;
    const t = setInterval(() => {
      if (Date.now() - pendingSince > 60000) setShowPendingWarn(true);
    }, 5000);
    return () => clearInterval(t);
  }, [pendingSince]);

  // Decide rendering after hooks are set
  const shouldRender =
    !!mutation && (mutation.isPending || mutation.isError || mutation.isSuccess || hash);
  if (!shouldRender) return null;

  return (
    <div className="mt-2 text-sm">
      {mutation.isPending && !mutation.isConfirming && (
        <p>Please confirm in your wallet...</p>
      )}
      {(mutation.isConfirming || (hash && !mutation.isConfirmed && !mutation.isError)) && (
        <p>Transaction submitted. Waiting for confirmation...</p>
      )}
      {mutation.isConfirmed && mutation.receipt?.status === "success" && (
        <p className="text-success">Transaction confirmed!</p>
      )}
      {mutation.isConfirmed && mutation.receipt?.status === "reverted" && (
        <p className="text-destructive">Transaction reverted on-chain.</p>
      )}
      {hash && (
        <p className="text-xs text-muted-foreground break-all">
          Hash: {hash}
          {explorerUrl && (
            <>
              {" "}
              <a
                className="underline"
                href={explorerUrl}
                target="_blank"
                rel="noreferrer"
              >
                View on explorer
              </a>
            </>
          )}
        </p>
      )}
      {showPendingWarn && (
        <p className="text-xs text-warning">
          Pending for over 60s. Verify you are on {netCfg.name} and the RAFFLE
          address matches this network. Check the explorer link above.
        </p>
      )}
      {mutation.isError && (
        <p className="text-destructive">
          Error: {mutation.error?.shortMessage || mutation.error?.message}
        </p>
      )}
    </div>
  );
};

TransactionStatus.propTypes = {
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
};

export default TransactionStatus;
