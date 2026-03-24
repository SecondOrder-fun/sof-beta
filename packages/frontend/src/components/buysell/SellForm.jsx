/**
 * SellForm Component (Mobile)
 * Handles ticket selling UI and validation
 */

import PropTypes from "prop-types";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { ContentBox } from "@/components/ui/content-box";
import { Separator } from "@/components/ui/separator";
import QuantityStepper from "@/components/mobile/QuantityStepper";

export const SellForm = ({
  quantityInput,
  onQuantityChange,
  maxSellable,
  estSellAfterFees,
  sellFeeBps,
  formatSOF,
  onSubmit,
  onMaxClick,
  isLoading,
  disabled,
  disabledReason,
  connectedAddress,
  settingsButton,
  settingsPanel,
  ticketPosition,
}) => {
  const { t } = useTranslation(["common", "transactions"]);

  return (
    <form onSubmit={onSubmit}>
      <div>
        <label className="text-sm font-medium mb-3 block text-muted-foreground">
          {t("common:amount", { defaultValue: "Tickets to Sell" })}
        </label>
        <QuantityStepper
          value={quantityInput}
          onChange={onQuantityChange}
          min={1}
          max={Number(maxSellable)}
          step={1}
          trailing={
            <>
              <Button
                type="button"
                variant="outline"
                onClick={onMaxClick}
                disabled={!connectedAddress}
                title={
                  connectedAddress
                    ? t("common:max", { defaultValue: "Max" })
                    : "Connect wallet"
                }
                className="h-12 px-3 text-xs font-semibold"
              >
                MAX
              </Button>
              {settingsButton}
            </>
          }
        />
        {settingsPanel}
      </div>

      <Separator className="my-4" />

      <div className="flex gap-2">
        <ContentBox className="flex-1">
          <div className="text-sm text-muted-foreground mb-1">
            {t("common:estimatedProceeds", {
              defaultValue: "Estimated proceeds",
            })}
          </div>
          <div className="text-2xl font-bold">
            {formatSOF(estSellAfterFees)} $SOF
          </div>
          {sellFeeBps > 0 && (
            <div className="text-xs text-muted-foreground mt-1">
              After {sellFeeBps / 100}% fee
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
        {isLoading ? t("transactions:selling") : "SELL NOW"}
      </Button>
    </form>
  );
};

SellForm.propTypes = {
  quantityInput: PropTypes.string.isRequired,
  onQuantityChange: PropTypes.func.isRequired,
  maxSellable: PropTypes.bigint.isRequired,
  estSellAfterFees: PropTypes.bigint.isRequired,
  sellFeeBps: PropTypes.number.isRequired,
  formatSOF: PropTypes.func.isRequired,
  onSubmit: PropTypes.func.isRequired,
  onMaxClick: PropTypes.func.isRequired,
  isLoading: PropTypes.bool.isRequired,
  disabled: PropTypes.bool.isRequired,
  disabledReason: PropTypes.string,
  connectedAddress: PropTypes.string,
  settingsButton: PropTypes.node,
  settingsPanel: PropTypes.node,
  ticketPosition: PropTypes.shape({
    tickets: PropTypes.bigint,
    total: PropTypes.bigint,
    probBps: PropTypes.number,
  }),
};
