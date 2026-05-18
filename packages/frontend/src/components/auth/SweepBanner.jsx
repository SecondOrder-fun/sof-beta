// src/components/auth/SweepBanner.jsx
//
// One-time migration prompt for desktop-EOA users who funded their EOA with
// SOF before the M5.4 airdrop relayer change. Going forward the relayer
// funds the SMA directly so this banner stays hidden, but existing users
// from the alpha cohort still need a way to move stranded SOF to the
// gameplay address.
//
// Important: this is a regular EOA-direct transfer, NOT a Path-A UserOp.
// The EOA holds the SOF — Path A would route from the SMA which doesn't
// have the funds yet, so the user pays gas for this one-time sweep.

import { useTranslation } from "react-i18next";
import {
  useReadContract,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import { formatUnits } from "viem";
import { useRaffleAccount } from "@/hooks/useRaffleAccount";
import { getContractAddresses } from "@/config/contracts";
import { getStoredNetworkKey } from "@/lib/wagmi";
import { ERC20Abi } from "@/utils/abis";

export const SweepBanner = () => {
  const { t } = useTranslation("onboarding");
  const { eoa, sma, walletType, isReady } = useRaffleAccount();
  const sofAddress = getContractAddresses(getStoredNetworkKey()).SOF;

  const enabled =
    isReady && walletType === "desktop-eoa" && !!eoa && !!sofAddress;

  // SweepBanner is mounted globally in App.jsx. With refetchInterval: 15s
  // it was firing a readContract every 15 seconds for the lifetime of the
  // session — ~240 RPC reads per hour just from this banner, even when the
  // EOA balance was zero (the common case). Drop the interval and let the
  // query run once per page navigation. SOF arriving mid-session won't show
  // until the next nav, which is fine for a one-time sweep prompt.
  const { data: eoaBalance } = useReadContract({
    abi: ERC20Abi,
    address: sofAddress,
    functionName: "balanceOf",
    args: eoa ? [eoa] : undefined,
    query: { enabled },
  });

  const { writeContract, data: hash, isPending } = useWriteContract();
  const { isLoading: isConfirming } = useWaitForTransactionReceipt({
    hash,
    query: { enabled: !!hash },
  });

  if (!enabled) return null;
  if (!eoaBalance || eoaBalance === 0n) return null;
  if (!sma) return null;

  const handleSweep = () => {
    writeContract({
      abi: ERC20Abi,
      address: sofAddress,
      functionName: "transfer",
      args: [sma, eoaBalance],
    });
  };

  const buttonLabel = isPending
    ? t("sweep.pending")
    : isConfirming
      ? t("sweep.confirming")
      : t("sweep.confirmBtn");

  return (
    <div
      role="status"
      className="container mx-auto mt-4 px-4"
      data-testid="sweep-banner"
    >
      <div className="rounded-md border border-warning/40 bg-warning/10 p-4 text-foreground">
        <h2 className="text-base font-semibold">{t("sweep.title")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("sweep.body", { amount: formatUnits(eoaBalance, 18) })}
        </p>
        <div className="mt-3">
          <button
            type="button"
            onClick={handleSweep}
            disabled={isPending || isConfirming}
            className="rounded-md border border-warning/40 bg-warning px-3 py-1.5 text-sm font-medium text-warning-foreground hover:bg-warning/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {buttonLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

export default SweepBanner;
