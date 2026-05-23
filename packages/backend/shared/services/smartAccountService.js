/**
 * smartAccountService
 *
 * Resolves the SMA address a user actually trades from and persists it.
 * For EOAs that need a deployed smart account, the factory's
 * deterministic getAddress(eoa) provides a counterfactual SMA. For wallet
 * types where the connected address is *already* a smart account
 * (Coinbase Smart Wallet, Farcaster MiniApp custody flow), we skip the
 * factory and treat the EOA itself as the SMA — matches the frontend's
 * useRaffleAccount classification so airdrops land in the wallet the
 * user actually sees.
 *
 * Design notes per spec §5.2-§5.3:
 *  - Smart-wallet types: sma === eoa (no factory call).
 *  - Plain EOA: sma is *counterfactual* via factory.getAddress(eoa).
 *  - The accountCreatedListener (Task 5.5) sets deployed_at separately
 *    when the SMA actually lands on-chain (deployed via initCode the
 *    first time the user submits a UserOp).
 *  - All addresses persisted lowercased — matches existing
 *    allowlist_entries convention and lets us use the smart_accounts
 *    primary key as a case-insensitive lookup.
 *  - Self-healing migration: a stored row whose sma disagrees with the
 *    walletType-derived expected SMA gets re-pointed and its funded_at
 *    cleared so the airdrop fires once more to the correct address.
 *    This catches users created before this fix shipped without an
 *    explicit DB migration (we can't infer historical walletType from
 *    the row alone).
 */

import { SOFSmartAccountFactoryABI } from "@sof/contracts";
import { getDeployment } from "@sof/contracts/deployments";

/**
 * Wallet types whose connected address IS the smart account — no
 * factory derivation needed. Matches frontend `classifyWalletType` in
 * `useRaffleAccount`. Anything not in this set is treated as a plain
 * EOA and routed through the factory.
 */
const SMART_WALLET_TYPES = new Set(["coinbase-smart", "farcaster-miniapp"]);

export function isSmartWalletType(walletType) {
  return SMART_WALLET_TYPES.has(walletType);
}

/**
 * Read the deterministic SMA address from the factory.
 * Pure async function — no DB or airdrop side effects.
 *
 * @param {object} chain - viem PublicClient
 * @param {string} factoryAddress - SOFSmartAccountFactory address
 * @param {string} eoa - User's EOA address (any casing)
 * @returns {Promise<string>} SMA address, lowercased
 */
export async function getSmaFromFactory(chain, factoryAddress, eoa) {
  const sma = await chain.readContract({
    address: factoryAddress,
    abi: SOFSmartAccountFactoryABI,
    functionName: "getAddress",
    args: [eoa],
  });
  return String(sma).toLowerCase();
}

/**
 * Resolve and persist a user's SMA, optionally kicking the airdrop relayer.
 *
 * SMA resolution depends on walletType:
 *  - "farcaster-miniapp" / "coinbase-smart": connected address is the
 *    smart account → sma === eoa, no factory call.
 *  - anything else (e.g. "desktop-eoa", undefined): sma is the
 *    counterfactual factory.getAddress(eoa).
 *
 * Behaviour:
 *  - existing row, sma matches expected, funded_at set  -> no-op
 *  - existing row, sma matches expected, no funded_at   -> retry airdrop
 *  - existing row, sma DIFFERS from expected           -> repoint sma,
 *      clear funded_at, re-airdrop. Self-heals rows written before
 *      walletType-aware routing existed (Farcaster/Coinbase users whose
 *      airdrop went to a factory-derived address the frontend never
 *      reads from).
 *  - no row                                           -> derive + insert + airdrop
 *
 * @param {object} args
 * @param {string} args.eoa            - User's EOA (any casing)
 * @param {object} args.db             - { getSmartAccountByEoa, upsertSmartAccount, markFunded, clearFunded }
 * @param {object} args.chain          - viem PublicClient
 * @param {object} args.airdrop        - { transferToSma(sma): Promise<string> }
 * @param {string} [args.network]      - 'local' | 'testnet' | 'mainnet'; falls back to env
 * @param {string} [args.walletType]   - "farcaster-miniapp" | "coinbase-smart" | "desktop-eoa" | undefined
 * @returns {Promise<{ eoa: string, sma: string, isNew: boolean }>}
 */
export async function ensureSmartAccount({
  eoa,
  db,
  chain,
  airdrop,
  network,
  walletType,
}) {
  if (!eoa) throw new Error("ensureSmartAccount: eoa is required");
  if (!db) throw new Error("ensureSmartAccount: db is required");
  if (!chain) throw new Error("ensureSmartAccount: chain is required");

  const eoaLc = String(eoa).toLowerCase();
  const useEoaAsSma = isSmartWalletType(walletType);

  const existing = await db.getSmartAccountByEoa(eoaLc);
  const existingSma = existing ? String(existing.sma).toLowerCase() : null;

  // Stale-row detection: a smart-wallet user with a stored sma that
  // isn't the eoa was created before this fix shipped — its prior
  // airdrop landed at the wrong address. We don't try to detect
  // staleness for plain EOAs (the factory is deterministic; we'd need
  // an extra RPC call to compare against). For pre-fix plain-EOA rows
  // that's correct: their factory-derived sma matches what the frontend
  // reads.
  const isStale = useEoaAsSma && existing && existingSma !== eoaLc;

  // Fast path: row is correct + airdrop already landed.
  if (existing && !isStale && existing.funded_at) {
    return { eoa: eoaLc, sma: existingSma, isNew: false };
  }

  // Compute the expected SMA for this wallet type. Smart-wallet types
  // bypass the factory entirely — the connected address IS the smart
  // account, matching the frontend `useRaffleAccount` classification.
  let expectedSma;
  if (useEoaAsSma) {
    expectedSma = eoaLc;
  } else {
    const factoryAddress = getDeployment(network).SOFSmartAccountFactory;
    if (!factoryAddress) {
      throw new Error(
        `SOFSmartAccountFactory address missing from deployments for network=${network}`,
      );
    }
    expectedSma = await getSmaFromFactory(chain, factoryAddress, eoa);
  }

  await db.upsertSmartAccount({ eoa: eoaLc, sma: expectedSma });
  if (isStale && typeof db.clearFunded === "function") {
    // The prior airdrop landed at the wrong sma. Clear funded_at so the
    // airdrop relayer re-sends to the correct address.
    await db.clearFunded(eoaLc);
  }

  if (airdrop && typeof airdrop.transferToSma === "function") {
    await airdrop.transferToSma(expectedSma);
  }

  return { eoa: eoaLc, sma: expectedSma, isNew: true };
}
