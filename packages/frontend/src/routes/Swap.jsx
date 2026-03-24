import SwapWidget from '@/components/swap/SwapWidget';
import AirdropBanner from '@/components/airdrop/AirdropBanner';

/**
 * Swap page — centered layout wrapping the SwapWidget.
 * AirdropBanner appears above the swap widget for first-time users.
 */
const Swap = () => {
  return (
    <div className="flex flex-col items-center py-8 px-4">
      <div className="w-full max-w-md">
        <AirdropBanner />
        <SwapWidget />
      </div>
    </div>
  );
};

export default Swap;
