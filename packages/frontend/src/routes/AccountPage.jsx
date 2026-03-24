// src/routes/AccountPage.jsx
import { useAccount } from "wagmi";
import { useTranslation } from "react-i18next";
import { Card, CardContent } from "@/components/ui/card";
import useIsMobile from "@/hooks/useIsMobile";
import MobilePortfolio from "@/components/mobile/MobilePortfolio";
import ProfileContent from "@/components/account/ProfileContent";

const AccountPage = () => {
  const isMobile = useIsMobile();

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

  return <ProfileContent address={address} isOwnProfile />;
};

export default AccountPage;
