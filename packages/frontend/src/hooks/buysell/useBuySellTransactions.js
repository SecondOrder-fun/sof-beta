/**
 * useBuySellTransactions Hook
 *
 * Single-path buy/sell flow. All writes go through useSmartTransactions.executeBatch
 * which routes by wallet type:
 *   - desktop-EOA  → Path A: counterfactual SMA + EntryPoint v0.8 UserOp + paymaster
 *   - Coinbase     → wallet_sendCalls + CDP paymaster
 *   - Farcaster    → wallet_sendCalls + paymaster capability
 *
 * Exposes wagmi-mutation-shaped state so callers can wrap each mutation with
 * useTransactionStatus and feed TransactionModal. Pre-flight validation lives
 * INSIDE the mutationFn — failed checks throw, the mutation owns the error
 * channel, and the modal surfaces the reason.
 *
 * Consumers fire side-effects (refresh, input reset) by watching the wrapped
 * status for `isConfirmed === true` via useEffect.
 */

import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { encodeFunctionData } from "viem";
import { useSmartTransactions } from "@/hooks/useSmartTransactions";
import { applyMaxSlippage, applyMinSlippage } from "@/utils/buysell/slippage";
import { SOFBondingCurveAbi, ERC20Abi } from "@/utils/abis";
import { getContractAddresses } from "@/config/contracts";
import { getStoredNetworkKey } from "@/lib/wagmi";

/**
 * @param {string} bondingCurveAddress
 * @param {Object} client - Viem public client (used for pre-flight reserves check on sell)
 * @returns {{ buyMutation, sellMutation }} wagmi useMutation handles whose data is a tx hash string
 */
export function useBuySellTransactions(bondingCurveAddress, client) {
  const { t } = useTranslation(["common", "transactions"]);
  const contracts = getContractAddresses(getStoredNetworkKey());
  const { executeBatch } = useSmartTransactions();

  const buyMutation = useMutation({
    mutationFn: async ({
      tokenAmount,
      maxSofAmount,
      slippagePct,
      rolloverSeasonId,
      rolloverAmount,
      walletTopupTickets = 0n,
      walletTopupMaxSof = 0n,
      rolloverMaxTotalSof = 0n,
      validation,
    }) => {
      // Pre-flight validation — throw so the modal surfaces the reason.
      if (validation?.seasonTimeNotActive) {
        throw new Error(
          t("transactions:seasonNotActive", {
            defaultValue: "Season is not active",
          }),
        );
      }
      if (validation?.tradingLocked) {
        throw new Error(
          t("transactions:tradingLocked", {
            defaultValue: "Trading is locked — Season has ended",
          }),
        );
      }
      if (validation?.hasZeroBalance) {
        throw new Error(
          t("transactions:insufficientSOF", {
            defaultValue:
              "You need $SOF to buy tickets. Visit the faucet or acquire tokens first.",
          }),
        );
      }
      if (validation?.hasInsufficientBalance) {
        throw new Error(
          t("transactions:insufficientSOFWithAmount", {
            defaultValue:
              "You need at least {{amount}} $SOF to complete this purchase.",
            amount: validation.needed,
          }),
        );
      }

      const cap = applyMaxSlippage(maxSofAmount, slippagePct);
      const hasRollover = rolloverSeasonId && rolloverAmount > 0n;
      const hasWalletTopup = hasRollover && walletTopupTickets > 0n;
      const rolloverTickets = hasWalletTopup
        ? tokenAmount - walletTopupTickets
        : 0n;

      let calls;
      if (hasWalletTopup && rolloverTickets > 0n) {
        // Mixed batch: rollover funds part of the buy, wallet funds the rest.
        const { buildSpendFromRolloverCall } = await import(
          "@/services/onchainRolloverEscrow"
        );
        calls = [
          buildSpendFromRolloverCall({
            seasonId: rolloverSeasonId,
            sofAmount: rolloverAmount,
            ticketAmount: rolloverTickets,
            maxTotalSof:
              rolloverMaxTotalSof > 0n
                ? rolloverMaxTotalSof
                : rolloverAmount + (rolloverAmount * 1000n) / 10000n,
          }),
          {
            to: contracts.SOF,
            data: encodeFunctionData({
              abi: ERC20Abi,
              functionName: "approve",
              args: [bondingCurveAddress, walletTopupMaxSof],
            }),
          },
          {
            to: bondingCurveAddress,
            data: encodeFunctionData({
              abi: SOFBondingCurveAbi,
              functionName: "buyTokens",
              args: [walletTopupTickets, walletTopupMaxSof],
            }),
          },
        ];
      } else if (hasRollover && !hasWalletTopup) {
        // Rollover-only: escrow contract handles approve + buyTokensFor internally.
        const { buildSpendFromRolloverCall } = await import(
          "@/services/onchainRolloverEscrow"
        );
        calls = [
          buildSpendFromRolloverCall({
            seasonId: rolloverSeasonId,
            sofAmount: rolloverAmount,
            ticketAmount: tokenAmount,
            maxTotalSof: cap,
          }),
        ];
      } else {
        // Normal buy: SMA approves curve, SMA calls buyTokens.
        calls = [
          {
            to: contracts.SOF,
            data: encodeFunctionData({
              abi: ERC20Abi,
              functionName: "approve",
              args: [bondingCurveAddress, cap],
            }),
          },
          {
            to: bondingCurveAddress,
            data: encodeFunctionData({
              abi: SOFBondingCurveAbi,
              functionName: "buyTokens",
              args: [tokenAmount, cap],
            }),
          },
        ];
      }

      const hash = await executeBatch(calls, { sofAmount: cap });
      return hash || "";
    },
  });

  const sellMutation = useMutation({
    mutationFn: async ({
      tokenAmount,
      minSofAmount,
      slippagePct,
      validation,
    }) => {
      if (validation?.seasonTimeNotActive) {
        throw new Error(
          t("transactions:seasonNotActive", {
            defaultValue: "Season is not active",
          }),
        );
      }
      if (validation?.tradingLocked) {
        throw new Error(
          t("transactions:tradingLocked", {
            defaultValue: "Trading is locked — Season has ended",
          }),
        );
      }

      const floor = applyMinSlippage(minSofAmount, slippagePct);

      // Pre-flight reserves check — throw so the modal shows the reason.
      if (client && bondingCurveAddress) {
        const cfg = await client.readContract({
          address: bondingCurveAddress,
          abi: SOFBondingCurveAbi,
          functionName: "curveConfig",
          args: [],
        });
        if (cfg[1] /* sofReserves */ < minSofAmount) {
          throw new Error(
            t("transactions:insufficientCurveReserves", {
              defaultValue: "Insufficient curve reserves — cannot sell this amount",
            }),
          );
        }
      }

      const hash = await executeBatch(
        [
          {
            to: bondingCurveAddress,
            data: encodeFunctionData({
              abi: SOFBondingCurveAbi,
              functionName: "sellTokens",
              args: [tokenAmount, floor],
            }),
          },
        ],
        { sofAmount: floor },
      );
      return hash || "";
    },
  });

  return { buyMutation, sellMutation };
}
