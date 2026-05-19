import { useEffect, useState } from 'react';
import { usePublicClient } from 'wagmi';

/**
 * Adapter that turns any wagmi `useMutation` whose `mutationFn` returns a
 * transaction hash string into the shape `TransactionModal` consumes:
 *   { isPending, isConfirming, isConfirmed, isError, hash, error, receipt }
 *
 * Lifecycle:
 *   mutation.isPending true            → isPending=true  (wallet sign / batch dispatch)
 *   mutation.isSuccess true, no receipt → isConfirming=true (waiting for block)
 *   receipt arrives                     → isConfirmed=true with receipt.status
 *   mutation throws                     → isError=true (no receipt poll)
 *   waitForTransactionReceipt throws    → isError=true with hash retained
 *
 * The mutationFn MUST return a string hash (e.g. the return of executeBatch).
 * Returning anything else short-circuits the receipt poll.
 */
export function useTransactionStatus(mutation) {
  const client = usePublicClient();
  const [receipt, setReceipt] = useState(null);
  const [waitError, setWaitError] = useState(null);

  const hash = typeof mutation?.data === 'string' ? mutation.data : null;

  useEffect(() => {
    if (!hash || !client) return;
    let cancelled = false;
    setReceipt(null);
    setWaitError(null);
    client
      .waitForTransactionReceipt({ hash, confirmations: 1 })
      .then((r) => {
        if (!cancelled) setReceipt(r);
      })
      .catch((e) => {
        if (!cancelled) setWaitError(e);
      });
    return () => {
      cancelled = true;
    };
  }, [hash, client]);

  // Reset local state when mutation resets (idle).
  useEffect(() => {
    if (mutation?.status === 'idle') {
      setReceipt(null);
      setWaitError(null);
    }
  }, [mutation?.status]);

  const isPending = !!mutation?.isPending;
  const isConfirming = !!hash && !receipt && !waitError && !mutation?.isError;
  const isConfirmed = !!receipt;
  const isError = !!(mutation?.isError || waitError);

  return {
    isPending,
    isConfirming,
    isConfirmed,
    isError,
    hash,
    error: mutation?.error ?? waitError ?? null,
    receipt,
  };
}
