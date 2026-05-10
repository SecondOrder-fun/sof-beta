/**
 * airdropService — direct ERC-20 transfer of SOF from BACKEND_WALLET to a
 * user's Smart Account (SMA) on first SIWE auth.
 *
 * Per gasless-rewrite spec §5.3. Replaces the old SOFAirdrop merkle/
 * attestation flow: the user no longer claims on-chain — the backend
 * just sends. SOF is mintable on Sepolia so this is free; mainnet
 * funding is a separate cost-center decision (spec §13).
 *
 * Public surface:
 *   getAirdropService(logger) -> { transferToSma(sma) }
 *
 * `transferToSma(sma)` is what smartAccountService.ensureSmartAccount
 * calls. It:
 *   1. resolves the deployer wallet client (lazy, so .env loads first)
 *   2. checks SOF_AIRDROP_AMOUNT_PER_USER — 0/unset → log + skip
 *   3. checks the SMA hasn't already been funded (idempotent — skips on
 *      smart_accounts.funded_at non-null)
 *   4. submits SOF.transfer(sma, amount) and waits for a receipt
 *   5. marks smart_accounts.funded_at on success
 *
 * Failures bubble up; the caller (auth flow) catches and logs without
 * blocking auth. The smart_accounts row stays without funded_at so the
 * next login retries.
 */

import process from "node:process";
import { erc20Abi, parseUnits } from "viem";
import { getDeployment } from "@sof/contracts/deployments";
import { getWalletClient, publicClient } from "../../src/lib/viemClient.js";
import { smartAccountsDb } from "./smartAccountsDb.js";

let _service = null;
let _decimalsCache = null;

/**
 * Resolve the SOF token address for the active network.
 */
function getSofTokenAddress() {
  const network = (process.env.NETWORK || "LOCAL").toLowerCase();
  const sof = getDeployment(network).SOFToken;
  if (!sof) {
    throw new Error(
      `SOFToken address missing from deployments for network=${network}`,
    );
  }
  return sof;
}

/**
 * Read SOF.decimals() and cache. Lets the env var be a human-readable
 * count of SOF (e.g. "100" for 100 SOF) rather than a raw 21-digit wei
 * value — which is what kept misfiring across LOCAL/testnet/mainnet
 * configs (env had "100", code interpreted as 100 wei = 1e-16 SOF).
 */
async function getSofDecimals(sofAddress) {
  if (_decimalsCache !== null) return _decimalsCache;
  const decimals = await publicClient.readContract({
    address: sofAddress,
    abi: erc20Abi,
    functionName: "decimals",
  });
  _decimalsCache = Number(decimals);
  return _decimalsCache;
}

/**
 * Parse the per-user airdrop amount from env (interpreted as a count of
 * SOF, NOT raw wei) and convert to wei using SOF.decimals(). Returns 0n
 * if unset/invalid; caller should treat 0n as "skip airdrop" and log a
 * warning.
 *
 * Accepts integer or decimal strings ("100", "100.5"). parseUnits handles
 * both. Negative or non-numeric → 0n.
 */
async function getAirdropAmountWei(sofAddress) {
  const raw = process.env.SOF_AIRDROP_AMOUNT_PER_USER;
  if (!raw) return 0n;
  // Reject obviously bad input early (parseUnits would throw on letters).
  if (!/^-?\d+(\.\d+)?$/.test(raw.trim())) return 0n;
  if (raw.trim().startsWith("-")) return 0n;
  try {
    const decimals = await getSofDecimals(sofAddress);
    return parseUnits(raw.trim(), decimals);
  } catch {
    return 0n;
  }
}

/**
 * Build the airdrop service. Returns a singleton — wrapping the wallet
 * client lazily means env validation in fastify/boot.js runs before we
 * try to derive the deployer address.
 *
 * @param {{warn: Function, info?: Function, error?: Function}} [logger]
 */
export function getAirdropService(logger) {
  if (_service) return _service;

  _service = {
    /**
     * Send SOF_AIRDROP_AMOUNT_PER_USER SOF from BACKEND_WALLET to `sma`.
     * Skips if already funded or amount unset.
     *
     * @param {string} sma - Lowercased SMA address
     * @returns {Promise<string|null>} tx hash, or null if skipped
     */
    async transferToSma(sma) {
      if (!sma) {
        logger?.warn?.("transferToSma: missing sma — skipping");
        return null;
      }
      const smaLc = String(sma).toLowerCase();

      const sofAddress = getSofTokenAddress();
      const amount = await getAirdropAmountWei(sofAddress);
      if (amount === 0n) {
        logger?.warn?.(
          { sma: smaLc },
          "SOF_AIRDROP_AMOUNT_PER_USER unset, 0, or invalid — skipping airdrop",
        );
        return null;
      }

      // Idempotency: if the row already has funded_at, don't double-send.
      // smartAccountService.ensureSmartAccount also gates on funded_at,
      // but a double check protects against direct callers (e.g. an
      // admin-triggered top-up).
      const existing = await smartAccountsDb.getSmartAccountBySma(smaLc);
      if (existing?.funded_at) {
        logger?.info?.(
          { sma: smaLc, funded_at: existing.funded_at },
          "transferToSma: SMA already funded — skipping",
        );
        return null;
      }

      const wallet = getWalletClient();

      logger?.info?.(
        { sma: smaLc, amount: amount.toString() },
        "transferToSma: submitting SOF.transfer",
      );

      const txHash = await wallet.writeContract({
        address: sofAddress,
        abi: erc20Abi,
        functionName: "transfer",
        args: [smaLc, amount],
      });

      // Wait for inclusion so we don't mark funded_at on a tx that reverts.
      const receipt = await publicClient.waitForTransactionReceipt({
        hash: txHash,
      });

      if (receipt.status !== "success") {
        logger?.error?.(
          { sma: smaLc, txHash, status: receipt.status },
          "transferToSma: tx reverted",
        );
        throw new Error(`SOF transfer to ${smaLc} reverted (${txHash})`);
      }

      await smartAccountsDb.markFunded(smaLc, txHash);

      logger?.info?.(
        { sma: smaLc, txHash, amount: amount.toString() },
        "transferToSma: success",
      );
      return txHash;
    },
  };

  return _service;
}

/** Test/dev hook: clear the cached singleton + decimals cache. */
export function _resetAirdropService() {
  _service = null;
  _decimalsCache = null;
}
