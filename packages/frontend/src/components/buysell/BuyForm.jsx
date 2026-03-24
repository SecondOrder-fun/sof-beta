/**
 * BuyForm Component (Mobile)
 * Handles ticket purchase UI and validation
 */

import PropTypes from "prop-types";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { ContentBox } from "@/components/ui/content-box";
import { Separator } from "@/components/ui/separator";
import QuantityStepper from "@/components/mobile/QuantityStepper";

export const BuyForm = ({
  quantityInput,
  onQuantityChange,
  maxBuyable,
  estBuyWithFees,
  buyFeeBps,
  formatSOF,
  onSubmit,
  isLoading,
  disabled,
  disabledReason,
  settingsButton,
  settingsPanel,
  ticketPosition,
}) => {
  const { t } = useTranslation(["common", "transactions"]);

  return (
    <form onSubmit={onSubmit}>
      <div>
        <label className="text-sm font-medium mb-3 block text-muted-foreground">
          {t("common:amount", { defaultValue: "Tickets to Buy" })}
        </label>
        <QuantityStepper
          value={quantityInput}
          onChange={onQuantityChange}
          min={1}
          max={maxBuyable ?? 0}
          maxValidationMessage={
            maxBuyable !== null
              ? t("transactions:maxValueMessage", {
                  defaultValue:
                    "Value must be less than or equal to {{max}}",
                  max: maxBuyable,
                })
              : undefined
          }
          step={1}
          trailing={settingsButton}
        />
        {settingsPanel}
      </div>

      <Separator className="my-4" />

      <div className="flex gap-2">
        <ContentBox className="flex-1">
          <div className="text-sm text-muted-foreground mb-1">
            {t("common:estimatedCost", {
              defaultValue: "Estimated cost",
            })}
          </div>
          <div className="text-2xl font-bold">
            {formatSOF(estBuyWithFees)} $SOF
          </div>
          {buyFeeBps > 0 && (
            <div className="text-xs text-muted-foreground mt-1">
              Includes {buyFeeBps / 100}% fee
            </div>
          )}
        </ContentBox>
        {ticketPosition && (
          <ContentBox className="flex-1">
            <div className="text-sm text-muted-foreground mb-1">
              {t("common:yourTickets", { defaultValue: "Your Tickets" })}
            </div>
            <div className="text-2xl font-bold">
              {Number(ticketPosition.tickets)}
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              {t("common:winChance", { defaultValue: "Win chance" })}:{" "}
              {(ticketPosition.probBps / 100).toFixed(2)}%
            </div>
          </ContentBox>
        )}
      </div>

      <Separator className="my-4" />

      <Button
        type="submit"
        disabled={disabled}
        size="lg"
        className="w-full"
        title={disabledReason}
      >
        {isLoading ? t("transactions:buying") : "BUY NOW"}
      </Button>
    </form>
  );
};

BuyForm.propTypes = {
  quantityInput: PropTypes.string.isRequired,
  onQuantityChange: PropTypes.func.isRequired,
  maxBuyable: PropTypes.number,
  estBuyWithFees: PropTypes.bigint.isRequired,
  buyFeeBps: PropTypes.number.isRequired,
  formatSOF: PropTypes.func.isRequired,
  onSubmit: PropTypes.func.isRequired,
  isLoading: PropTypes.bool.isRequired,
  disabled: PropTypes.bool.isRequired,
  disabledReason: PropTypes.string,
  settingsButton: PropTypes.node,
  settingsPanel: PropTypes.node,
  ticketPosition: PropTypes.shape({
    tickets: PropTypes.bigint,
    total: PropTypes.bigint,
    probBps: PropTypes.number,
  }),
};
