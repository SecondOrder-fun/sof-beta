// src/routes/AccountPage.jsx
import { useAccount } from "wagmi";
import { useTranslation } from "react-i18next";
import { Card, CardContent } from "@/components/ui/card";
import useIsMobile from "@/hooks/useIsMobile";
import MobilePortfolio from "@/components/mobile/MobilePortfolio";
import ProfileContent from "@/components/account/ProfileContent";
import { useRaffleAccount } from "@/hooks/useRaffleAccount";

const AccountPage = () => {
  const isMobile = useIsMobile();

  if (isMobile) {
    return <MobilePortfolio />;
  }

  return <DesktopAccountPage />;
};

const DesktopAccountPage = () => {
  const { isConnected } = useAccount();
  // SMA-bound read per spec §4.3 — gameplay state lives at the SMA.
  const { sma, isReady } = useRaffleAccount();
  const { t } = useTranslation(["account"]);

  if (!isConnected) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-foreground mb-4">
          {t("account:myAccount")}
        </h1>
        <Card className="mb-4">
          <CardContent className="pt-6">
            <p className="text-center text-muted-foreground">
              {t("account:connectWalletToViewAccount")}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!isReady || !sma) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-foreground mb-4">
          {t("account:myAccount")}
        </h1>
        <Card className="mb-4">
          <CardContent className="pt-6">
            <p className="text-center text-muted-foreground">
              {t("account:loadingAccount", { defaultValue: "Loading account..." })}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return <ProfileContent address={sma} isOwnProfile />;
};

export default AccountPage;
