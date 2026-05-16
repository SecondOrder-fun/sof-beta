/**
 * useBuySellTransactions Hook
 *
 * Single-path buy/sell flow. All writes go through useSmartTransactions.executeBatch
 * which routes by wallet type:
 *   - desktop-EOA  → Path A: counterfactual SMA + EntryPoint v0.8 UserOp + paymaster
 *   - Coinbase     → wallet_sendCalls + CDP paymaster
 *   - Farcaster    → wallet_sendCalls + paymaster capability
 *
 * Calls are authored as if msg.sender = the smart account, because that's what
 * Path A makes them be. Approvals + buys batch into a single ERC-7821 execute
 * inside one UserOp. No EOA-permit fallback (incoherent with the SMA model —
 * it would sign a permit that pulls SOF from the EOA while reads/writes
 * resolve at the SMA), no separate writeContract approve+buy fallback.
 */

import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { encodeFunctionData } from "viem";
import { useSOFToken } from "@/hooks/useSOFToken";
import { useSmartTransactions } from "@/hooks/useSmartTransactions";
import { getReadableContractError } from "@/utils/buysell/contractErrors";
import { applyMaxSlippage, applyMinSlippage } from "@/utils/buysell/slippage";
import { SOFBondingCurveAbi, ERC20Abi } from "@/utils/abis";
import { getContractAddresses } from "@/config/contracts";
import { getStoredNetworkKey } from "@/lib/wagmi";

/**
 * Hook for executing buy/sell transactions
 * @param {string} bondingCurveAddress - Address of the bonding curve contract
 * @param {Object} client - Viem public client
 * @param {Function} onNotify - Notification callback
 * @param {Function} onSuccess - Success callback
 * @returns {Object} Transaction handlers { executeBuy, executeSell, isPending }
 */
export function useBuySellTransactions(
  bondingCurveAddress,
  client,
  onNotify,
  onSuccess
) {
  const { t } = useTranslation(["common", "transactions"]);
  const { refetchBalance } = useSOFToken();
  const contracts = getContractAddresses(getStoredNetworkKey());
  const { executeBatch } = useSmartTransactions();
  const [isPending, setIsPending] = useState(false);

  const finishWithReceipt = useCallback(
    async (hash, successKey, onComplete) => {
      if (!hash) {
        onNotify?.({ type: "success", message: t(successKey), hash: "" });
        setTimeout(() => { onSuccess?.(); onComplete?.(); }, 2000);
        return { success: true, hash: "" };
      }
      if (!client) {
        onNotify?.({ type: "success", message: t(successKey), hash });
        setTimeout(() => { onSuccess?.(); onComplete?.(); }, 2000);
        return { success: true, hash };
      }
      try {
        const receipt = await client.waitForTransactionReceipt({ hash, confirmations: 1 });
        if (receipt.status === "reverted") {
          onNotify?.({ type: "error", message: "Transaction reverted", hash });
          return { success: false, hash };
        }
        onNotify?.({ type: "success", message: t(successKey), hash });
        onSuccess?.();
        onComplete?.();
        void refetchBalance?.();
        return { success: true, hash };
      } catch (waitErr) {
        const waitMsg = waitErr instanceof Error ? waitErr.message : "Failed waiting for transaction receipt";
        onNotify?.({ type: "error", message: waitMsg, hash });
        setTimeout(() => { onSuccess?.(); onComplete?.(); }, 2000);
        return { success: false, hash, error: waitMsg };
      }
    },
    [client, onNotify, onSuccess, refetchBalance, t]
  );

  /**
   * Execute buy transaction
   * @param {Object} params - Buy parameters
   * @param {bigint} params.tokenAmount - Amount of tokens to buy
   * @param {bigint} params.maxSofAmount - Maximum SOF to spend (with slippage)
   * @param {string} params.slippagePct - Slippage percentage
   * @param {Function} params.onComplete - Optional completion callback
   */
  const executeBuy = useCallback(
    async ({
      tokenAmount,
      maxSofAmount,
      slippagePct,
      onComplete,
      rolloverSeasonId,
      rolloverAmount,
      walletTopupTickets = 0n,
      walletTopupMaxSof = 0n,
    }) => {
      setIsPending(true);
      try {
        const cap = applyMaxSlippage(maxSofAmount, slippagePct);
        const hasRollover = rolloverSeasonId && rolloverAmount > 0n;
        const hasWalletTopup = hasRollover && walletTopupTickets > 0n;

        let calls;
        if (hasRollover && hasWalletTopup) {
          // Mixed batch: rollover funds part of the buy, wallet funds the rest.
          // ticketAmount on spendFromRollover is the rollover-funded portion only.
          const { buildSpendFromRolloverCall } = await import("@/services/onchainRolloverEscrow");
          const rolloverTickets = tokenAmount - walletTopupTickets;
          calls = [
            buildSpendFromRolloverCall({
              seasonId: rolloverSeasonId,
              sofAmount: rolloverAmount,
              ticketAmount: rolloverTickets,
              maxTotalSof: rolloverAmount + (rolloverAmount * 1000n) / 10000n, // base + 10% headroom for bonus
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
        } else if (hasRollover) {
          // Rollover-only: escrow contract handles approve + buyTokensFor internally.
          const { buildSpendFromRolloverCall } = await import("@/services/onchainRolloverEscrow");
          calls = [
            buildSpendFromRolloverCall({
              seasonId: rolloverSeasonId,
              sofAmount: rolloverAmount,
              ticketAmount: tokenAmount,
              maxTotalSof: cap,
            }),
          ];
        } else {
          // Normal buy: SMA approves curve, SMA calls buyTokens. Both run as
          // msg.sender = SMA inside the same ERC-7821 batch, so the curve
          // pulls SOF from the SMA's balance.
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
        return await finishWithReceipt(hash, "transactions:bought", onComplete);
      } catch (err) {
        if (err?.code === 4001 || err?.name === "UserRejectedRequestError") {
          onNotify?.({ type: "error", message: t("transactions:userRejected", { defaultValue: "Transaction rejected" }), hash: "" });
          return { success: false, error: "user_rejected" };
        }
        // eslint-disable-next-line no-console
        console.error("Buy transaction error:", err);
        const message = getReadableContractError(err, t);
        onNotify?.({ type: "error", message, hash: "" });
        return { success: false, error: message };
      } finally {
        setIsPending(false);
      }
    },
    [bondingCurveAddress, contracts.SOF, executeBatch, finishWithReceipt, onNotify, t]
  );

  /**
   * Execute sell transaction
   * @param {Object} params - Sell parameters
   * @param {bigint} params.tokenAmount - Amount of tokens to sell
   * @param {bigint} params.minSofAmount - Minimum SOF to receive (with slippage)
   * @param {string} params.slippagePct - Slippage percentage
   * @param {Function} params.onComplete - Optional completion callback
   */
  const executeSell = useCallback(
    async ({ tokenAmount, minSofAmount, slippagePct, onComplete }) => {
      setIsPending(true);
      try {
        const floor = applyMinSlippage(minSofAmount, slippagePct);

        // Sanity-check curve has reserves before submitting (avoids burning
        // a wallet popup on a doomed sell).
        if (client && bondingCurveAddress) {
          try {
            const cfg = await client.readContract({
              address: bondingCurveAddress,
              abi: SOFBondingCurveAbi,
              functionName: "curveConfig",
              args: [],
            });
            if (cfg[1] /* sofReserves */ < minSofAmount) {
              const errorMsg = "Insufficient curve reserves - cannot sell this amount";
              onNotify?.({ type: "error", message: errorMsg, hash: "" });
              return { success: false, error: errorMsg };
            }
          } catch (checkErr) {
            const message = checkErr instanceof Error ? checkErr.message : "Unable to verify curve reserves";
            onNotify?.({ type: "error", message, hash: "" });
            return { success: false, error: message };
          }
        }

        // Sell from SMA: single ERC-7821 batch with one Execution.
        const hash = await executeBatch(
          [{
            to: bondingCurveAddress,
            data: encodeFunctionData({
              abi: SOFBondingCurveAbi,
              functionName: "sellTokens",
              args: [tokenAmount, floor],
            }),
          }],
          { sofAmount: floor }
        );
        return await finishWithReceipt(hash, "transactions:sold", onComplete);
      } catch (err) {
        if (err?.code === 4001 || err?.name === "UserRejectedRequestError") {
          onNotify?.({ type: "error", message: t("transactions:userRejected", { defaultValue: "Transaction rejected" }), hash: "" });
          return { success: false, error: "user_rejected" };
        }
        // eslint-disable-next-line no-console
        console.error("Sell transaction error:", err);
        const message = getReadableContractError(err, t);
        onNotify?.({ type: "error", message, hash: "" });
        return { success: false, error: message };
      } finally {
        setIsPending(false);
      }
    },
    [bondingCurveAddress, client, executeBatch, finishWithReceipt, onNotify, t]
  );

  return { executeBuy, executeSell, isPending };
}
