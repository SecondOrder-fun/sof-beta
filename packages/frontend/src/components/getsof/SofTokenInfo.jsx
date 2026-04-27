// src/components/getsof/SofTokenInfo.jsx
import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Copy, Check, ExternalLink } from 'lucide-react';
import { getContractAddresses } from '@/config/contracts';
import { getStoredNetworkKey } from '@/lib/wagmi';
import { getNetworkByKey } from '@/config/networks';
import AddToMetamaskButton from './AddToMetamaskButton';

/**
 * SofTokenInfo — footer card with the $SOF token address (copy + explorer
 * link), decimals, and an AddToMetamask shortcut. Useful for users who
 * want to import the token into other wallets manually.
 */
const SofTokenInfo = () => {
  const { t } = useTranslation('getsof');
  const netKey = getStoredNetworkKey();
  const network = getNetworkByKey(netKey);
  const contracts = getContractAddresses(netKey);
  const sofAddress = contracts.SOF || '';

  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    if (!sofAddress) return;
    try {
      await navigator.clipboard.writeText(sofAddress);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard write can fail in private browsing or older browsers — silent
      // here is fine; the explorer link is always the fallback.
    }
  }, [sofAddress]);

  const explorerUrl = network?.blockExplorer && sofAddress
    ? `${network.blockExplorer.replace(/\/$/, '')}/address/${sofAddress}`
    : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('tokenInfoTitle')}</CardTitle>
        <CardDescription>{t('tokenInfoDescription')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            {t('contractAddress')}
          </p>
          <div className="flex items-center gap-2">
            <code className="font-mono text-xs text-foreground break-all">
              {sofAddress || t('addressNotConfigured')}
            </code>
            {sofAddress ? (
              <>
                <Button
                  size="icon"
                  variant="outline"
                  onClick={handleCopy}
                  aria-label={t('copyAddress')}
                  className="shrink-0"
                >
                  {copied ? (
                    <Check className="h-4 w-4" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </Button>
                {explorerUrl && (
                  <Button
                    size="icon"
                    variant="outline"
                    asChild
                    className="shrink-0"
                  >
                    <a
                      href={explorerUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={t('viewOnExplorer')}
                    >
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  </Button>
                )}
              </>
            ) : null}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              {t('symbol')}
            </p>
            <p className="text-foreground">$SOF</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              {t('decimals')}
            </p>
            <p className="text-foreground tabular-nums">18</p>
          </div>
        </div>

        <AddToMetamaskButton />
      </CardContent>
    </Card>
  );
};

export default SofTokenInfo;
