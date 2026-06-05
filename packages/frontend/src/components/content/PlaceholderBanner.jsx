// src/components/content/PlaceholderBanner.jsx
// Prominent non-binding notice shown at the top of placeholder legal docs
// (Terms, Privacy, Disclaimer). These documents are scaffolding only and
// will be replaced before any production/mainnet launch.
import { useTranslation } from "react-i18next";
import { AlertTriangle } from "lucide-react";

const PlaceholderBanner = () => {
  const { t } = useTranslation("legal");
  return (
    <div
      role="note"
      className="mb-8 flex items-start gap-3 rounded-md border-2 border-warning bg-warning/10 p-4"
    >
      <AlertTriangle
        className="mt-0.5 h-6 w-6 shrink-0 text-warning"
        aria-hidden="true"
      />
      <div className="space-y-1">
        <p className="text-base font-bold text-foreground">
          {t("placeholderBanner.title", {
            defaultValue: "Placeholder document — not legally binding",
          })}
        </p>
        <p className="text-sm text-muted-foreground">
          {t("placeholderBanner.body", {
            defaultValue:
              "This document is a non-binding placeholder provided for development purposes only. It does not constitute a legal agreement, is not final, and is subject to change at any time without notice.",
          })}
        </p>
      </div>
    </div>
  );
};

export default PlaceholderBanner;
