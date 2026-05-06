// src/components/auth/FirstConnectBanner.jsx
//
// One-time welcome shown to desktop-EOA wallets the first time they connect,
// explaining that gameplay routes through their deterministic smart account
// (SMA) while ownership stays at the connected EOA. Coinbase Smart Wallet and
// Farcaster MiniApp users skip this banner — for those wallets the connected
// address IS the smart account, so there's no separate identity to surface.
//
// The dismissal flag is keyed on the EOA, not the device, so a user who
// connects the same wallet on a new browser still gets reminded once there.

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useRaffleAccount } from "@/hooks/useRaffleAccount";
import { shortAddress } from "@/lib/format";

const dismissKey = (eoa) => `sof:welcomed:${eoa.toLowerCase()}`;

export const FirstConnectBanner = () => {
  const { t } = useTranslation("onboarding");
  const { eoa, sma, walletType, isReady } = useRaffleAccount();
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!isReady || walletType !== "desktop-eoa" || !eoa) {
      setShow(false);
      return;
    }
    try {
      if (localStorage.getItem(dismissKey(eoa))) {
        setShow(false);
        return;
      }
    } catch {
      // Storage disabled / quota exceeded — fall through and show the banner.
    }
    setShow(true);
  }, [eoa, isReady, walletType]);

  if (!show) return null;

  const handleDismiss = () => {
    try {
      if (eoa) localStorage.setItem(dismissKey(eoa), "1");
    } catch {
      // Best-effort persistence; banner still hides this session.
    }
    setShow(false);
  };

  return (
    <div
      role="status"
      className="container mx-auto mt-4 px-4"
      data-testid="first-connect-banner"
    >
      <div className="rounded-md border border-info/40 bg-info/10 p-4 text-foreground">
        <h2 className="text-base font-semibold">{t("firstConnect.title")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("firstConnect.body", {
            sma: shortAddress(sma),
            eoa: shortAddress(eoa),
          })}
        </p>
        <div className="mt-3">
          <button
            type="button"
            onClick={handleDismiss}
            className="rounded-md border border-info/40 bg-info px-3 py-1.5 text-sm font-medium text-info-foreground hover:bg-info/90"
          >
            {t("firstConnect.dismiss")}
          </button>
        </div>
      </div>
    </div>
  );
};

export default FirstConnectBanner;
