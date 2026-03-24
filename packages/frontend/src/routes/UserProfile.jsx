// src/routes/UserProfile.jsx
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAccount } from "wagmi";
import { Card, CardContent } from "@/components/ui/card";
import ProfileContent from "@/components/account/ProfileContent";

const UserProfile = () => {
  const { t } = useTranslation("account");
  const { address: addressParam } = useParams();
  const { address: myAddress } = useAccount();

  const address = addressParam || myAddress;
  const isOwnProfile =
    !!myAddress &&
    !!address &&
    myAddress.toLowerCase() === address.toLowerCase();

  // No address available — prompt to connect
  if (!address) {
    return (
      <div className="container mx-auto p-4">
        <h1 className="text-2xl font-bold text-foreground mb-4">
          {t("userProfile")}
        </h1>
        <Card>
          <CardContent className="pt-6">
            <p className="text-center text-muted-foreground">
              {t("connectWalletToViewAccount")}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-4">
      <ProfileContent address={address} isOwnProfile={isOwnProfile} />
    </div>
  );
};

export default UserProfile;
