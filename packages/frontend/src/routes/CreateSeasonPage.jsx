// src/routes/CreateSeasonPage.jsx
// Route for /create-season — renders mobile or desktop flow based on platform.
import { useTranslation } from "react-i18next";
import { usePlatform } from "@/hooks/usePlatform";
import { CreateSeasonWorkflow } from "@/components/sponsor/CreateSeasonWorkflow";
import MobileCreateSeason from "@/components/mobile/MobileCreateSeason";

const CreateSeasonPage = () => {
  const { t } = useTranslation("raffle");
  const { isMobile, isMobileBrowser } = usePlatform();

  if (isMobile || isMobileBrowser) {
    return <MobileCreateSeason />;
  }

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">{t("createSeasonPageTitle")}</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {t("createSeasonPageDesc")}
        </p>
      </div>
      <CreateSeasonWorkflow />
    </div>
  );
};

export default CreateSeasonPage;
