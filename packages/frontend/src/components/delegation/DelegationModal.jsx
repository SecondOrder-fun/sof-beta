import { useState, useCallback, useRef, useEffect } from 'react';
import PropTypes from 'prop-types';
import { useTranslation } from 'react-i18next';
import { useWalletClient, useChainId } from 'wagmi';
import { getBytecode, getWalletClient } from '@wagmi/core';
import { config } from '@/lib/wagmiConfig';
import { getContractAddresses } from '@/config/contracts';
import { getStoredNetworkKey } from '@/lib/wagmi';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Loader2, CheckCircle2, XCircle, Zap } from 'lucide-react';

const OPT_OUT_PREFIX = 'sof:delegation-opt-out:';
const DELEGATION_PREFIX = '0xef0100';
const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 30000;

/**
 * Modal shown to non-smart-wallet EOAs on connect, prompting a one-time
 * ERC-7702 delegation to SOFSmartAccount for gasless transactions.
 */
export function DelegationModal({ open, onOpenChange, onDelegated }) {
  const { t } = useTranslation();
  const { data: walletClient } = useWalletClient();
  const chainId = useChainId();
  const [status, setStatus] = useState('idle'); // idle | signing | submitting | confirming | success | error
  const [errorMsg, setErrorMsg] = useState('');
  const apiBase = import.meta.env.VITE_API_BASE_URL || '';
  const mountedRef = useRef(true);

  useEffect(() => {
    // Reset on every mount so React 18 StrictMode's mount→unmount→remount
    // dance doesn't leave the ref permanently false (cleanup sets false but
    // the bare initial value never gets set on the second mount).
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const handleEnable = useCallback(async () => {
    // useWalletClient() is async — on early modal mount its `data` is still
    // undefined even though the wallet is connected. Fall back to fetching
    // the client imperatively from wagmi/core, which reaches into the
    // already-provisioned connector state. Avoids a silent bail when the
    // user clicks Enable before the React-query has resolved.
    let wc = walletClient;
    if (!wc) {
      try {
        wc = await getWalletClient(config);
      } catch {
        wc = null;
      }
    }
    if (!wc?.account?.address) {
      setStatus('error');
      setErrorMsg(
        'Wallet not ready. Please disconnect and reconnect, then try again.',
      );
      return;
    }

    const contracts = getContractAddresses(getStoredNetworkKey());
    const sofSmartAccount = contracts.SOF_SMART_ACCOUNT;
    if (!sofSmartAccount) {
      setStatus('error');
      setErrorMsg('SOFSmartAccount not configured for this network');
      return;
    }

    try {
      const userAddress = wc.account.address;
      const jwt = localStorage.getItem('sof:jwt');
      const isLocalChain = chainId === 31337;

      // eslint-disable-next-line no-console
      console.log('[DelegationModal] handleEnable start', { userAddress, isLocalChain, chainId, apiBase });

      let res;
      if (isLocalChain) {
        // Local Anvil: MetaMask doesn't expose eth_signAuthorization for
        // arbitrary delegates and viem's signAuthorization is unimplemented
        // for JSON-RPC accounts. Skip the wallet sig entirely and have the
        // backend inject the 7702 designator via anvil_setCode. The EVM
        // treats it identically to a real delegation, so everything past
        // this point exercises the production code path.
        setStatus('submitting');
        res = await fetch(`${apiBase}/wallet/delegate-shortcut`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}),
          },
          body: JSON.stringify({ userAddress }),
        });
      } else {
        // Testnet / mainnet: real EIP-7702 with wallet signature.
        setStatus('signing');
        const authorization = await wc.signAuthorization({
          contractAddress: sofSmartAccount,
          chainId,
        });

        setStatus('submitting');
        res = await fetch(`${apiBase}/wallet/delegate`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}),
          },
          body: JSON.stringify({ authorization, userAddress }),
        });
      }

      // eslint-disable-next-line no-console
      console.log('[DelegationModal] fetch returned', { ok: res.ok, status: res.status });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Relay failed (${res.status})`);
      }

      // 3. Poll getBytecode until delegation appears
      // eslint-disable-next-line no-console
      console.log('[DelegationModal] entering confirming poll', { mounted: mountedRef.current });
      if (!mountedRef.current) return;
      setStatus('confirming');
      const start = Date.now();
      let pollIter = 0;
      while (Date.now() - start < POLL_TIMEOUT_MS && mountedRef.current) {
        const code = await getBytecode(config, { address: wc.account.address });
        // eslint-disable-next-line no-console
        console.log('[DelegationModal] poll iter', pollIter++, { code, mounted: mountedRef.current });
        if (!mountedRef.current) return;
        if (code && code.toLowerCase().startsWith(DELEGATION_PREFIX)) {
          setStatus('success');
          // Wake useDelegationStatus immediately so the next executeBatch
          // call sees isSOFDelegate=true without waiting for its 5s tick.
          window.dispatchEvent(new Event("sof:delegation-changed"));
          onDelegated?.();
          return;
        }
        await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
      }

      // Tx was submitted but confirmation not yet detected — close modal
      // and let useDelegationStatus detect it on next check
      if (mountedRef.current) {
        window.dispatchEvent(new Event("sof:delegation-changed"));
        onDelegated?.();
      }
    } catch (err) {
      if (!mountedRef.current) return;
      setStatus('error');
      setErrorMsg(err?.shortMessage || err?.message || t('delegation_error'));
    }
  }, [walletClient, chainId, apiBase, t, onDelegated]);

  const handleDecline = useCallback(() => {
    if (walletClient?.account?.address) {
      localStorage.setItem(`${OPT_OUT_PREFIX}${walletClient.account.address.toLowerCase()}`, 'true');
    }
    onOpenChange(false);
  }, [onOpenChange, walletClient]);

  const handleClose = useCallback(() => {
    if (status === 'success') {
      onOpenChange(false);
    }
  }, [status, onOpenChange]);

  const isProcessing = ['signing', 'submitting', 'confirming'].includes(status);

  return (
    <Dialog open={open} onOpenChange={isProcessing ? undefined : onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Zap className="h-5 w-5 text-primary" />
            {t('delegation_title')}
          </DialogTitle>
          <DialogDescription>
            {t('delegation_description')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {status === 'idle' && (
            <>
              <div className="rounded-lg bg-muted p-3">
                <p className="text-sm font-medium text-foreground">
                  {t('delegation_what_happens')}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {t('delegation_explanation')}
                </p>
              </div>

              <div className="flex flex-col gap-2">
                <Button variant="primary" onClick={handleEnable}>
                  {t('delegation_enable')}
                </Button>
                <button
                  type="button"
                  className="text-sm text-muted-foreground underline hover:text-foreground"
                  onClick={handleDecline}
                >
                  {t('delegation_decline')}
                </button>
              </div>
            </>
          )}

          {status === 'signing' && (
            <div className="flex items-center gap-3 py-4">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
              <p className="text-sm text-foreground">{t('delegation_signing')}</p>
            </div>
          )}

          {status === 'submitting' && (
            <div className="flex items-center gap-3 py-4">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
              <p className="text-sm text-foreground">{t('delegation_submitting')}</p>
            </div>
          )}

          {status === 'confirming' && (
            <div className="flex items-center gap-3 py-4">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
              <p className="text-sm text-foreground">{t('delegation_confirming')}</p>
            </div>
          )}

          {status === 'success' && (
            <div className="flex flex-col items-center gap-3 py-4">
              <CheckCircle2 className="h-8 w-8 text-success" />
              <p className="text-sm font-medium text-foreground">{t('delegation_success')}</p>
              <Button variant="primary" onClick={handleClose}>
                {t('close')}
              </Button>
            </div>
          )}

          {status === 'error' && (
            <div className="flex flex-col items-center gap-3 py-4">
              <XCircle className="h-8 w-8 text-destructive" />
              <p className="text-sm text-foreground">{errorMsg}</p>
              <div className="flex gap-2">
                <Button variant="primary" onClick={() => setStatus('idle')}>
                  {t('retry')}
                </Button>
                <Button variant="cancel" onClick={() => onOpenChange(false)}>
                  {t('close')}
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

DelegationModal.propTypes = {
  open: PropTypes.bool.isRequired,
  onOpenChange: PropTypes.func.isRequired,
  onDelegated: PropTypes.func,
};
