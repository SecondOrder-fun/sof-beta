// src/routes/AccountPage.jsx
import { useAccount } from "wagmi";
import { useTranslation } from "react-i18next";
import { Card, CardContent } from "@/components/ui/card";
import PageTitle from "@/components/layout/PageTitle";
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
        <PageTitle title={t("account:myAccount")} />
        <div className="px-6">
          <Card className="mb-4">
            <CardContent className="pt-6">
              <p className="text-center text-muted-foreground">
                {t("account:connectWalletToViewAccount")}
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (!isReady || !sma) {
    return (
      <div>
        <PageTitle title={t("account:myAccount")} />
        <div className="px-6">
          <Card className="mb-4">
            <CardContent className="pt-6">
              <p className="text-center text-muted-foreground">
                {t("account:loadingAccount", { defaultValue: "Loading account..." })}
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return <ProfileContent address={sma} isOwnProfile />;
};

export default AccountPage;
