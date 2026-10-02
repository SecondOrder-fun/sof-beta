// src/routes/UserProfile.jsx
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAccount } from "wagmi";
import { Card, CardContent } from "@/components/ui/card";
import PageTitle from "@/components/layout/PageTitle";
import ProfileContent from "@/components/account/ProfileContent";
import { usePlatform } from "@/hooks/usePlatform";

const UserProfile = () => {
  const { t } = useTranslation("account");
  const { address: addressParam } = useParams();
  const { address: myAddress } = useAccount();
  // The mobile shell already provides the side gutter; the desktop page adds
  // its own container padding on top of <main>'s.
  const { isMobile } = usePlatform();
  const pageClass = isMobile ? "" : "container mx-auto p-4";
  const titleClass = isMobile ? "px-0 pt-2" : undefined;
  const bodyClass = isMobile ? "" : "px-6";

  // The route param is the wallet address to show; with no param, the
  // connected wallet's own profile.
  const resolvedAddress = addressParam || myAddress;

  const isOwnProfile =
    !!myAddress &&
    !!resolvedAddress &&
    myAddress.toLowerCase() === resolvedAddress.toLowerCase();

  // No address available — prompt to connect
  if (!resolvedAddress) {
    return (
      <div className={pageClass}>
        <PageTitle title={t("userProfile")} className={titleClass} />
        <div className={bodyClass}>
          <Card>
            <CardContent className="pt-6">
              <p className="text-center text-muted-foreground">
                {t("connectWalletToViewAccount")}
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className={pageClass}>
      <ProfileContent address={resolvedAddress} isOwnProfile={isOwnProfile} />
    </div>
  );
};

export default UserProfile;
