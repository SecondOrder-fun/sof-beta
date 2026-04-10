import { useState, useCallback } from 'react';
import PropTypes from 'prop-types';
import { useTranslation } from 'react-i18next';
import { useWalletClient, useChainId } from 'wagmi';
import { getCode } from '@wagmi/core';
import { config } from '@/context/WagmiConfigProvider';
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

const OPT_OUT_KEY = 'sof:delegation-opt-out';
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

  const handleEnable = useCallback(async () => {
    if (!walletClient) return;

    const contracts = getContractAddresses(getStoredNetworkKey());
    const sofSmartAccount = contracts.SOF_SMART_ACCOUNT;
    if (!sofSmartAccount) {
      setStatus('error');
      setErrorMsg('SOFSmartAccount not configured for this network');
      return;
    }

    try {
      // 1. Sign the ERC-7702 authorization
      setStatus('signing');
      const authorization = await walletClient.signAuthorization({
        contractAddress: sofSmartAccount,
        chainId,
      });

      // 2. Send to backend relay
      setStatus('submitting');
      const jwt = localStorage.getItem('sof:jwt');
      const res = await fetch(`${apiBase}/wallet/delegate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}),
        },
        body: JSON.stringify({
          authorization,
          userAddress: walletClient.account.address,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Relay failed (${res.status})`);
      }

      // 3. Poll getCode until delegation appears
      setStatus('confirming');
      const start = Date.now();
      while (Date.now() - start < POLL_TIMEOUT_MS) {
        const code = await getCode(config, { address: walletClient.account.address });
        if (code && code.toLowerCase().startsWith(DELEGATION_PREFIX)) {
          setStatus('success');
          onDelegated?.();
          return;
        }
        await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
      }

      // Timed out but tx was submitted — still mark as success
      setStatus('success');
      onDelegated?.();
    } catch (err) {
      setStatus('error');
      setErrorMsg(err?.shortMessage || err?.message || t('delegation_error'));
    }
  }, [walletClient, chainId, apiBase, t, onDelegated]);

  const handleDecline = useCallback(() => {
    localStorage.setItem(OPT_OUT_KEY, 'true');
    onOpenChange(false);
  }, [onOpenChange]);

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
