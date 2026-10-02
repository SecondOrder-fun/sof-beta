// src/routes/AccountPage.jsx
import { useAccount } from "wagmi";
import { useTranslation } from "react-i18next";
import { Card, CardContent } from "@/components/ui/card";
import PageTitle from "@/components/layout/PageTitle";
import { usePlatform } from "@/hooks/usePlatform";
import MobilePortfolio from "@/components/mobile/MobilePortfolio";
import ProfileContent from "@/components/account/ProfileContent";

const AccountPage = () => {
  const { isMobile } = usePlatform();

  if (isMobile) {
    return <MobilePortfolio />;
  }

  return <DesktopAccountPage />;
};

const DesktopAccountPage = () => {
  const { address, isConnected } = useAccount();
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

  if (!address) {
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

  return <ProfileContent address={address} isOwnProfile />;
};

export default AccountPage;
