// src/components/getsof/TestnetEthFaucetLinks.jsx
import { useTranslation } from 'react-i18next';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ExternalLink } from 'lucide-react';
import { getStoredNetworkKey } from '@/lib/wagmi';

const FAUCET_LINKS = [
  {
    key: 'alchemy',
    url: 'https://www.alchemy.com/faucets/ethereum-sepolia',
    requiresAccount: true,
  },
  {
    key: 'infura',
    url: 'https://www.infura.io/faucet/sepolia',
    requiresAccount: true,
  },
  {
    key: 'pow',
    url: 'https://sepolia-faucet.pk910.de/',
    requiresAccount: false,
  },
];

/**
 * TestnetEthFaucetLinks — onboarding helper for users who land on Get SOF
 * without enough Sepolia ETH for gas. Hidden on mainnet; only the testnet
 * audience needs these links.
 */
const TestnetEthFaucetLinks = () => {
  const { t } = useTranslation('getsof');
  const netKey = getStoredNetworkKey();

  // Hide on mainnet — production users acquire ETH through normal channels.
  if (netKey === 'MAINNET') return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('testnetEthTitle')}</CardTitle>
        <CardDescription>{t('testnetEthDescription')}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 sm:grid-cols-3">
          {FAUCET_LINKS.map((link) => (
            <div
              key={link.key}
              className="rounded-lg border bg-card p-3 flex flex-col gap-2"
            >
              <h3 className="font-medium text-foreground">
                {t(`${link.key}Faucet`)}
              </h3>
              <p className="text-xs text-muted-foreground flex-1">
                {t(`${link.key}FaucetDescription`)}
              </p>
              <Button asChild variant="outline" size="sm">
                <a
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5"
                >
                  {t(`${link.key}FaucetCta`)}
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                </a>
              </Button>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
};

export default TestnetEthFaucetLinks;
