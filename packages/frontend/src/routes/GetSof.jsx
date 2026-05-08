// src/routes/GetSof.jsx
//
// "Get $SOF" reference page. The legacy SOFAirdrop merkle-drop UI was
// removed in the gasless rewrite (spec §5.1) — universal SIWE-on-connect
// fires the airdrop relayer server-side now. This page is the swap +
// token-info + testnet faucet onramp.
import { useTranslation } from 'react-i18next';
import SofTokenInfo from '@/components/getsof/SofTokenInfo';
import SwapWidget from '@/components/swap/SwapWidget';
import TestnetEthFaucetLinks from '@/components/getsof/TestnetEthFaucetLinks';

const GetSof = () => {
  const { t } = useTranslation('getsof');

  return (
    <div>
      <h1 className="text-2xl font-bold text-foreground mb-4">
        {t('pageTitle')}
      </h1>

      <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
        <div className="space-y-6">
          <SofTokenInfo />
        </div>
        <div>
          <SwapWidget />
        </div>
      </div>

      <div className="mt-6">
        <TestnetEthFaucetLinks />
      </div>
    </div>
  );
};

export default GetSof;
