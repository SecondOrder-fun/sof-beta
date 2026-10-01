// src/components/mobile/MobileCreatorTab.jsx
import { useTranslation } from "react-i18next";
import { CreateSeasonWorkflow } from "@/components/sponsor/CreateSeasonWorkflow";
import CreatorFeesSection from "@/components/launchpad/CreatorFeesSection";

/**
 * MobileCreatorTab - Creator tools for the mobile Portfolio UI: the creator
 * fees from the user's launches (nothing when they have none), then the Create
 * Season workflow directly (no accordion wrapper).
 */
const MobileCreatorTab = () => {
  const { t } = useTranslation(["account", "raffle"]);

  return (
    <div className="mt-3 space-y-3">
      <CreatorFeesSection />
      <p className="text-sm text-muted-foreground">
        {t("raffle:createSeasonPageDesc")}
      </p>
      <CreateSeasonWorkflow />
    </div>
  );
};

export default MobileCreatorTab;
