/**
 * SlippageSettings Component
 * Shared slippage tolerance configuration panel
 */

import PropTypes from "prop-types";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { Input } from "@/components/ui/input";
import { ContentBox } from "@/components/ui/content-box";

export const SlippageSettings = ({
  slippagePct,
  onSlippageChange,
  onClose,
  variant = "desktop",
}) => {
  const { t } = useTranslation(["common"]);

  const presets = [
    { value: "0.5", label: "\u00BD" },
    { value: "1", label: "1" },
    { value: "2", label: "2" },
  ];

  // Desktop variant: dropdown/popover style
  if (variant === "desktop") {
    return (
      <div className="absolute right-0 top-8 z-10 w-64 border rounded-md bg-card p-3 shadow">
        <div className="text-sm font-medium mb-2">
          {t("common:slippage", { defaultValue: "Slippage tolerance" })}
        </div>
        <div className="text-xs text-muted-foreground mb-2">
          {t("common:slippageDescription", {
            defaultValue:
              "Maximum percentage you are willing to lose due to unfavorable price changes.",
          })}
        </div>
        <div className="flex gap-2 mb-2">
          {presets.map((preset) => (
            <Button
              key={preset.value}
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onSlippageChange(preset.value)}
            >
              {preset.label}%
            </Button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Input
            type="number"
            value={slippagePct}
            onChange={(e) => onSlippageChange(e.target.value)}
            className="w-24"
          />
          <Button type="button" size="sm" onClick={onClose}>
            {t("common:save")}
          </Button>
        </div>
      </div>
    );
  }

  // Mobile variant: single-row with ButtonGroup presets + input + save
  return (
    <ContentBox className="mt-3">
      <div className="text-xs text-muted-foreground mb-2">
        {t("common:slippage", { defaultValue: "Slippage tolerance" })}
      </div>
      <div className="flex items-center gap-2">
        <ButtonGroup className="flex-[3]">
          {presets.map((preset) => (
            <Button
              key={preset.value}
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onSlippageChange(preset.value)}
              className="flex-1"
            >
              {preset.label}%
            </Button>
          ))}
        </ButtonGroup>
        <Input
          type="number"
          value={slippagePct}
          onChange={(e) => onSlippageChange(e.target.value)}
          placeholder="1.0"
          className="flex-1 text-center"
        />
        <Button
          type="button"
          size="sm"
          onClick={onClose}
          className="flex-1"
        >
          {t("common:save", { defaultValue: "Save" })}
        </Button>
      </div>
    </ContentBox>
  );
};

SlippageSettings.propTypes = {
  slippagePct: PropTypes.string.isRequired,
  onSlippageChange: PropTypes.func.isRequired,
  onClose: PropTypes.func.isRequired,
  variant: PropTypes.oneOf(["desktop", "mobile"]),
};
