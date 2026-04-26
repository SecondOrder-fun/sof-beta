/**
 * useBuySellTransactions Hook
 * Centralized buy/sell transaction logic with error handling and confirmations
 */

import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useAccount, useWalletClient, useChainId } from "wagmi";
import { parseSignature, encodeFunctionData } from "viem";
import { useCurve } from "@/hooks/useCurve";
import { useSOFToken } from "@/hooks/useSOFToken";
import { useSmartTransactions } from "@/hooks/useSmartTransactions";
import { getReadableContractError } from "@/utils/buysell/contractErrors";
import { applyMaxSlippage, applyMinSlippage } from "@/utils/buysell/slippage";
import { SOFBondingCurveAbi, SOFTokenAbi, ERC20Abi } from "@/utils/abis";
import { getContractAddresses } from "@/config/contracts";
import { getStoredNetworkKey } from "@/lib/wagmi";

/**
 * Hook for executing buy/sell transactions
 * @param {string} bondingCurveAddress - Address of the bonding curve contract
 * @param {Object} client - Viem public client
 * @param {Function} onNotify - Notification callback
 * @param {Function} onSuccess - Success callback
 * @returns {Object} Transaction handlers { executeBuy, executeSell }
 */
export function useBuySellTransactions(
  bondingCurveAddress,
  client,
  onNotify,
  onSuccess
) {
  const { t } = useTranslation(["common", "transactions"]);
  const { buyTokens, buyTokensWithPermit, sellTokens, approve } = useCurve(bondingCurveAddress);
  const { refetchBalance } = useSOFToken();
  const { address } = useAccount();
  const { data: walletClient } = useWalletClient();
  const chainId = useChainId();
  const contracts = getContractAddresses(getStoredNetworkKey());
  const { hasBatch, isDelegated, needsDelegation, executeBatch } = useSmartTransactions();
  // Sponsored path is allowed when either:
  //   - the EOA is 7702-delegated (Path A: sponsored UserOp via our bundler), OR
  //   - the wallet advertises atomic ERC-5792 capability AND the EOA isn't
  //     a non-CB EOA waiting on delegation.
  // The second clause guards against wallets (e.g. Rabby) that *advertise*
  // wallet_sendCalls but return a malformed response shape that crashes
  // viem's parser. Those wallets MUST go through delegation first so we
  // route via Path A and never touch wallet_sendCalls.
  const canBatch = isDelegated || (hasBatch && !needsDelegation);

  /**
   * Execute buy transaction
   * @param {Object} params - Buy parameters
   * @param {bigint} params.tokenAmount - Amount of tokens to buy
   * @param {bigint} params.maxSofAmount - Maximum SOF to spend (with slippage)
   * @param {string} params.slippagePct - Slippage percentage
   * @param {Function} params.onComplete - Optional completion callback
   */
  const executeBuy = useCallback(
    async ({ tokenAmount, maxSofAmount, slippagePct, onComplete, rolloverSeasonId, rolloverAmount }) => {
      try {
        const cap = applyMaxSlippage(maxSofAmount, slippagePct);

        // Tier 1: ERC-5792 batch + paymaster (single gasless confirmation)
        if (canBatch) {
          try {
            let calls;

            if (rolloverSeasonId && rolloverAmount > 0n) {
              // Rollover buy: escrow contract handles approve + buyTokensFor internally
              const { buildSpendFromRolloverCall } = await import("@/services/onchainRolloverEscrow");
              const rolloverCall = buildSpendFromRolloverCall({
                seasonId: rolloverSeasonId,
                sofAmount: rolloverAmount,
                ticketAmount: tokenAmount,
                maxTotalSof: cap,
              });
              calls = [rolloverCall];
            } else {
              // Normal buy: approve SOF + buyTokens
              const approveTx = {
                to: contracts.SOF,
                data: encodeFunctionData({
                  abi: ERC20Abi,
                  functionName: 'approve',
                  args: [bondingCurveAddress, cap],
                }),
              };
              const buyTx = {
                to: bondingCurveAddress,
                data: encodeFunctionData({
                  abi: SOFBondingCurveAbi,
                  functionName: 'buyTokens',
                  args: [tokenAmount, cap],
                }),
              };
              calls = [approveTx, buyTx];
            }

            const batchId = await executeBatch(calls, { sofAmount: cap });

            onNotify?.({
              type: "success",
              message: t("transactions:bought"),
              hash: batchId || "",
            });

            onSuccess?.();
            onComplete?.();
            void refetchBalance?.();

            return { success: true, hash: batchId || "" };
          } catch (batchErr) {
            if (
              batchErr?.code === 4001 ||
              batchErr?.name === "UserRejectedRequestError"
            ) {
              throw batchErr;
            }
            // eslint-disable-next-line no-console
            console.warn("Batch flow failed, falling back to permit:", batchErr.message);
          }
        }

        // Tier 2: Try permit-based atomic flow
        let hash;
        let usedPermit = false;

        if (walletClient && address) {
          try {
            const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);

            const tokenName = await client.readContract({
              address: contracts.SOF,
              abi: SOFTokenAbi,
              functionName: "name",
            });

            const nonce = await client.readContract({
              address: contracts.SOF,
              abi: SOFTokenAbi,
              functionName: "nonces",
              args: [address],
            });

            const domain = {
              name: tokenName,
              version: "1",
              chainId,
              verifyingContract: contracts.SOF,
            };

            const types = {
              Permit: [
                { name: "owner", type: "address" },
                { name: "spender", type: "address" },
                { name: "value", type: "uint256" },
                { name: "nonce", type: "uint256" },
                { name: "deadline", type: "uint256" },
              ],
            };

            const message = {
              owner: address,
              spender: bondingCurveAddress,
              value: cap,
              nonce,
              deadline,
            };

            const signature = await walletClient.signTypedData({
              domain,
              types,
              primaryType: "Permit",
              message,
            });

            const { v, r, s } = parseSignature(signature);

            const tx = await buyTokensWithPermit.mutateAsync({
              tokenAmount,
              maxSofAmount: cap,
              deadline,
              v: Number(v),
              r,
              s,
            });

            hash = tx?.hash ?? tx ?? "";
            usedPermit = true;
          } catch (permitErr) {
            // If user rejected the signature request, rethrow
            if (
              permitErr?.code === 4001 ||
              permitErr?.name === "UserRejectedRequestError"
            ) {
              throw permitErr;
            }
            // Otherwise fall through to traditional approve flow
            // eslint-disable-next-line no-console
            console.warn("Permit flow failed, falling back to approve:", permitErr.message);
          }
        }

        // Fallback: traditional approve + buy
        if (!usedPermit) {
          const maxUint = (1n << 255n) - 1n;
          const approvalTxHash = await approve.mutateAsync({ amount: maxUint });
          if (client && approvalTxHash) {
            await client.waitForTransactionReceipt({
              hash: approvalTxHash,
              confirmations: 1,
            });
          }
          const tx = await buyTokens.mutateAsync({
            tokenAmount,
            maxSofAmount: cap,
          });
          hash = tx?.hash ?? tx ?? "";
        }

        // Wait for transaction confirmation
        if (client && hash) {
          try {
            const receipt = await client.waitForTransactionReceipt({
              hash,
              confirmations: 1,
            });

            if (receipt.status === "reverted") {
              onNotify?.({
                type: "error",
                message: "Transaction reverted",
                hash,
              });
              return { success: false, hash };
            }

            onNotify?.({
              type: "success",
              message: t("transactions:bought"),
              hash,
            });

            onSuccess?.();
            onComplete?.();
            void refetchBalance?.();

            return { success: true, hash };
          } catch (waitErr) {
            const waitMsg =
              waitErr instanceof Error
                ? waitErr.message
                : "Failed waiting for transaction receipt";
            onNotify?.({ type: "error", message: waitMsg, hash });

            // Still trigger refresh after delay if wait fails
            setTimeout(() => {
              onSuccess?.();
              onComplete?.();
            }, 2000);

            return { success: false, hash, error: waitMsg };
          }
        }

        // Fallback: no client available
        onNotify?.({
          type: "success",
          message: t("transactions:bought"),
          hash,
        });

        setTimeout(() => {
          onSuccess?.();
          onComplete?.();
        }, 2000);

        return { success: true, hash };
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("Buy transaction error:", err);
        const message = getReadableContractError(err, t);
        onNotify?.({ type: "error", message, hash: "" });
        return { success: false, error: message };
      }
    },
    [approve, buyTokens, buyTokensWithPermit, client, walletClient, address, chainId, contracts, bondingCurveAddress, onNotify, onSuccess, refetchBalance, t, canBatch, executeBatch]
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
      try {
        const floor = applyMinSlippage(minSofAmount, slippagePct);

        // Check curve reserves before selling
        if (client && bondingCurveAddress) {
          try {
            const cfg = await client.readContract({
              address: bondingCurveAddress,
              abi: SOFBondingCurveAbi,
              functionName: "curveConfig",
              args: [],
            });
            const reserves = cfg[1];
            const estimatedSell = minSofAmount; // Base amount before slippage

            if (reserves < estimatedSell) {
              const errorMsg = "Insufficient curve reserves - cannot sell this amount";
              onNotify?.({
                type: "error",
                message: errorMsg,
                hash: "",
              });
              return { success: false, error: errorMsg };
            }
          } catch (checkErr) {
            const message =
              checkErr instanceof Error
                ? checkErr.message
                : "Unable to verify curve reserves";
            onNotify?.({ type: "error", message, hash: "" });
            return { success: false, error: message };
          }
        }

        // Tier 1: ERC-5792 batch + paymaster (single gasless confirmation)
        if (canBatch) {
          try {
            const sellTx = {
              to: bondingCurveAddress,
              data: encodeFunctionData({
                abi: SOFBondingCurveAbi,
                functionName: 'sellTokens',
                args: [tokenAmount, floor],
              }),
            };

            const batchId = await executeBatch([sellTx], { sofAmount: floor });

            onNotify?.({
              type: "success",
              message: t("transactions:sold"),
              hash: batchId || "",
            });

            onSuccess?.();
            onComplete?.();
            void refetchBalance?.();

            return { success: true, hash: batchId || "" };
          } catch (batchErr) {
            if (
              batchErr?.code === 4001 ||
              batchErr?.name === "UserRejectedRequestError"
            ) {
              throw batchErr;
            }
            // eslint-disable-next-line no-console
            console.warn("Batch sell flow failed, falling back to direct sell:", batchErr.message);
          }
        }

        // Fallback: direct sell transaction
        const tx = await sellTokens.mutateAsync({
          tokenAmount,
          minSofAmount: floor,
        });
        const hash = tx?.hash ?? tx ?? "";

        // Wait for confirmation before notifying success
        if (client && hash) {
          try {
            const receipt = await client.waitForTransactionReceipt({
              hash,
              confirmations: 1,
            });

            if (receipt.status === "reverted") {
              onNotify?.({
                type: "error",
                message: "Transaction reverted",
                hash,
              });
              return { success: false, hash };
            }

            onNotify?.({
              type: "success",
              message: t("transactions:sold"),
              hash,
            });

            onSuccess?.();
            onComplete?.();
            void refetchBalance?.();

            return { success: true, hash };
          } catch (waitErr) {
            const waitMsg =
              waitErr instanceof Error
                ? waitErr.message
                : "Failed waiting for transaction receipt";
            onNotify?.({ type: "error", message: waitMsg, hash });

            // Still trigger refresh after delay
            setTimeout(() => {
              onSuccess?.();
              onComplete?.();
            }, 2000);

            return { success: false, hash, error: waitMsg };
          }
        }

        // Fallback: no client available
        onNotify?.({
          type: "success",
          message: t("transactions:sold"),
          hash,
        });

        setTimeout(() => {
          onSuccess?.();
          onComplete?.();
        }, 2000);

        return { success: true, hash };
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("Sell transaction error:", err);
        const message = getReadableContractError(err, t);
        onNotify?.({ type: "error", message, hash: "" });
        return { success: false, error: message };
      }
    },
    [sellTokens, client, bondingCurveAddress, onNotify, onSuccess, refetchBalance, t, canBatch, executeBatch]
  );

  return {
    executeBuy,
    executeSell,
    isPending: buyTokens.isPending || sellTokens.isPending,
  };
}
