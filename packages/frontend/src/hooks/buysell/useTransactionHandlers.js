/**
 * Transaction Handlers Hook
 * Consolidates buy/sell transaction validation and execution logic
 */

import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { SOFBondingCurveAbi } from "@/utils/abis";

export function useTransactionHandlers({
  client,
  bondingCurveAddress,
  connectedAddress,
  tradingLocked,
  seasonTimeNotActive = false,
  hasZeroBalance,
  hasInsufficientBalance,
  formatSOF,
  onNotify,
  executeBuy,
  executeSell,
  estBuyWithFees,
  estSellAfterFees,
  slippagePct,
  isGated = false,
  isVerified = null,
  onGatingRequired,
}) {
  const { t } = useTranslation(["common", "transactions"]);

  /**
   * Handle buy transaction with validation
   */
  const handleBuy = useCallback(
    async (tokenAmount, onComplete) => {
      if (!tokenAmount || !bondingCurveAddress) return { success: false };

      // Gating check
      if (isGated && isVerified !== true) {
        if (onGatingRequired) {
          onGatingRequired("buy");
        }
        return { success: false };
      }

      // Season time validation
      if (seasonTimeNotActive) {
        onNotify?.({
          type: "error",
          message: "Season is not active",
          hash: "",
        });
        return { success: false };
      }

      // Trading lock validation
      if (tradingLocked) {
        onNotify?.({
          type: "error",
          message: "Trading is locked - Season has ended",
          hash: "",
        });
        return { success: false };
      }

      // Balance validations
      if (hasZeroBalance) {
        onNotify?.({
          type: "error",
          message: t("transactions:insufficientSOF", {
            defaultValue:
              "You need $SOF to buy tickets. Visit the faucet or acquire tokens first.",
          }),
          hash: "",
        });
        return { success: false };
      }

      if (hasInsufficientBalance) {
        const needed = formatSOF(estBuyWithFees);
        onNotify?.({
          type: "error",
          message: t("transactions:insufficientSOFWithAmount", {
            defaultValue:
              "You need at least {{amount}} $SOF to complete this purchase.",
            amount: needed,
          }),
          hash: "",
        });
        return { success: false };
      }

      // Execute transaction
      return await executeBuy({
        tokenAmount,
        maxSofAmount: estBuyWithFees,
        slippagePct,
        onComplete,
      });
    },
    [
      bondingCurveAddress,
      isGated,
      isVerified,
      onGatingRequired,
      seasonTimeNotActive,
      tradingLocked,
      hasZeroBalance,
      hasInsufficientBalance,
      formatSOF,
      estBuyWithFees,
      onNotify,
      t,
      executeBuy,
      slippagePct,
    ]
  );

  /**
   * Handle sell transaction with validation
   */
  const handleSell = useCallback(
    async (tokenAmount, onComplete) => {
      if (!tokenAmount || !bondingCurveAddress) return { success: false };

      // Gating check
      if (isGated && isVerified !== true) {
        if (onGatingRequired) {
          onGatingRequired("sell");
        }
        return { success: false };
      }

      // Season time validation
      if (seasonTimeNotActive) {
        onNotify?.({
          type: "error",
          message: "Season is not active",
          hash: "",
        });
        return { success: false };
      }

      // Trading lock validation
      if (tradingLocked) {
        onNotify?.({
          type: "error",
          message: "Trading is locked - Season has ended",
          hash: "",
        });
        return { success: false };
      }

      // Execute transaction
      return await executeSell({
        tokenAmount,
        minSofAmount: estSellAfterFees,
        slippagePct,
        onComplete,
      });
    },
    [
      bondingCurveAddress,
      isGated,
      isVerified,
      onGatingRequired,
      seasonTimeNotActive,
      tradingLocked,
      onNotify,
      executeSell,
      estSellAfterFees,
      slippagePct,
    ]
  );

  /**
   * Fetch max sellable amount from contract
   */
  const fetchMaxSellable = useCallback(async () => {
    try {
      if (!client || !connectedAddress) return 0n;
      const bal = await client.readContract({
        address: bondingCurveAddress,
        abi: SOFBondingCurveAbi,
        functionName: "playerTickets",
        args: [connectedAddress],
      });
      return bal ?? 0n;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Unable to fetch ticket balance";
      onNotify?.({ type: "error", message, hash: "" });
      return 0n;
    }
  }, [client, connectedAddress, bondingCurveAddress, onNotify]);

  return {
    handleBuy,
    handleSell,
    fetchMaxSellable,
  };
}
