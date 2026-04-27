// src/routes/GetSof.jsx
//
// Consolidated "Get $SOF" page — replaces the legacy /swap and /faucet
// routes. Same surface for every acquisition path (airdrop claim, swap,
// testnet ETH onramp), plus the token-info reference panel.
//
// Layout: token-info + airdrop on the left, balance + swap on the right,
// testnet ETH onramp below. Putting balance immediately above the swap
// widget answers "how much $SOF do I have?" right where the user decides
// to swap more in or out.
import { useTranslation } from 'react-i18next';
import SofTokenInfo from '@/components/getsof/SofTokenInfo';
import AirdropClaimCard from '@/components/getsof/AirdropClaimCard';
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
          <AirdropClaimCard />
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
