/**
 * Transaction Handlers Hook
 *
 * Orchestrates buy/sell validation + invocation. Pre-flight checks are bundled
 * into a `validation` object passed to the mutation, which throws inside its
 * mutationFn so the modal can surface the reason via mutation.error.
 *
 * Gating checks remain a special early return because they trigger a separate
 * modal (SignatureGateModal / PasswordGateModal), not an error display.
 */

import { useCallback } from "react";
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
  buyMutation,
  sellMutation,
  estBuyWithFees,
  estSellAfterFees,
  slippagePct,
  isGated = false,
  isVerified = null,
  onGatingRequired,
  rolloverEnabled = false,
  rolloverAmount = 0n,
  rolloverSeasonId,
  walletTopupTickets = 0n,
  walletTopupMaxSof = 0n,
  rolloverMaxTotalSof = 0n,
}) {
  /**
   * Handle buy transaction. Gating bails early; everything else flows through
   * the mutation, which surfaces validation + execution errors via mutation.error.
   */
  const handleBuy = useCallback(
    async (tokenAmount, onComplete) => {
      if (!tokenAmount || !bondingCurveAddress) return { success: false };

      // Gating bails out without firing the mutation.
      if (isGated && isVerified !== true) {
        onGatingRequired?.("buy");
        return { success: false };
      }

      const validation = {
        seasonTimeNotActive,
        tradingLocked,
        hasZeroBalance,
        hasInsufficientBalance,
        needed: hasInsufficientBalance ? formatSOF(estBuyWithFees) : null,
      };

      const params = {
        tokenAmount,
        maxSofAmount: estBuyWithFees,
        slippagePct,
        validation,
      };

      if (rolloverEnabled && rolloverAmount > 0n && rolloverSeasonId) {
        Object.assign(params, {
          rolloverSeasonId,
          rolloverAmount,
          walletTopupTickets,
          walletTopupMaxSof,
          rolloverMaxTotalSof,
        });
      }

      try {
        const hash = await buyMutation.mutateAsync(params);
        onComplete?.();
        return { success: true, hash };
      } catch (err) {
        return { success: false, error: err?.message || "Buy failed" };
      }
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
      buyMutation,
      slippagePct,
      rolloverEnabled,
      rolloverAmount,
      rolloverSeasonId,
      walletTopupTickets,
      walletTopupMaxSof,
      rolloverMaxTotalSof,
    ],
  );

  const handleSell = useCallback(
    async (tokenAmount, onComplete) => {
      if (!tokenAmount || !bondingCurveAddress) return { success: false };

      if (isGated && isVerified !== true) {
        onGatingRequired?.("sell");
        return { success: false };
      }

      const validation = { seasonTimeNotActive, tradingLocked };

      try {
        const hash = await sellMutation.mutateAsync({
          tokenAmount,
          minSofAmount: estSellAfterFees,
          slippagePct,
          validation,
        });
        onComplete?.();
        return { success: true, hash };
      } catch (err) {
        return { success: false, error: err?.message || "Sell failed" };
      }
    },
    [
      bondingCurveAddress,
      isGated,
      isVerified,
      onGatingRequired,
      seasonTimeNotActive,
      tradingLocked,
      sellMutation,
      estSellAfterFees,
      slippagePct,
    ],
  );

  /**
   * Fetch max sellable amount from contract.
   * Failure here is benign (returns 0); no modal needed — the MAX button just
   * stays at 0 and the user can still type a manual amount.
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
    } catch {
      return 0n;
    }
  }, [client, connectedAddress, bondingCurveAddress]);

  return {
    handleBuy,
    handleSell,
    fetchMaxSellable,
  };
}
