// src/components/mobile/MobileCreatorTab.jsx
import { useTranslation } from "react-i18next";
import { CreateSeasonWorkflow } from "@/components/sponsor/CreateSeasonWorkflow";

/**
 * MobileCreatorTab - Creator tools for the mobile Portfolio UI.
 * Shows the Create Season workflow directly (no accordion wrapper).
 */
const MobileCreatorTab = () => {
  const { t } = useTranslation(["account", "raffle"]);

  return (
    <div className="mt-3 space-y-3">
      <p className="text-sm text-muted-foreground">
        {t("raffle:createSeasonPageDesc")}
      </p>
      <CreateSeasonWorkflow />
    </div>
  );
};

export default MobileCreatorTab;
