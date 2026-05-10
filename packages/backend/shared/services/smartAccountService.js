/**
 * smartAccountService
 *
 * Computes a user's deterministic SOFSmartAccount (SMA) address via the
 * factory contract and persists it. On first sight, kicks the airdrop
 * relayer to fund the SMA with starter SOF. Returning users with a
 * funded_at timestamp skip both the factory call and the airdrop.
 *
 * Design notes per spec §5.2-§5.3:
 *  - SMA is *counterfactual*: the factory's getAddress() returns the
 *    CREATE2 address whether or not the contract has been deployed yet.
 *  - The accountCreatedListener (Task 5.5) sets deployed_at separately
 *    when the SMA actually lands on-chain (deployed via initCode the
 *    first time the user submits a UserOp).
 *  - All addresses persisted lowercased — matches existing
 *    allowlist_entries convention and lets us use the smart_accounts
 *    primary key as a case-insensitive lookup.
 */

import { SOFSmartAccountFactoryABI } from "@sof/contracts";
import { getDeployment } from "@sof/contracts/deployments";

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
 * Behaviour:
 *  - existing row with funded_at      -> no-op, returns persisted SMA
 *  - existing row without funded_at   -> retry: re-derive + re-airdrop
 *  - no row                           -> derive + insert + airdrop
 *
 * @param {object} args
 * @param {string} args.eoa            - User's EOA (any casing)
 * @param {object} args.db             - { getSmartAccountByEoa, upsertSmartAccount, markFunded }
 * @param {object} args.chain          - viem PublicClient
 * @param {object} args.airdrop        - { transferToSma(sma): Promise<string> }
 * @param {string} [args.network]      - 'local' | 'testnet' | 'mainnet'; falls back to env
 * @returns {Promise<{ eoa: string, sma: string, isNew: boolean }>}
 */
export async function ensureSmartAccount({
  eoa,
  db,
  chain,
  airdrop,
  network,
}) {
  if (!eoa) throw new Error("ensureSmartAccount: eoa is required");
  if (!db) throw new Error("ensureSmartAccount: db is required");
  if (!chain) throw new Error("ensureSmartAccount: chain is required");

  const eoaLc = String(eoa).toLowerCase();

  // Fast path: row exists and the airdrop has already settled.
  const existing = await db.getSmartAccountByEoa(eoaLc);
  if (existing && existing.funded_at) {
    return {
      eoa: eoaLc,
      sma: String(existing.sma).toLowerCase(),
      isNew: false,
    };
  }

  // Otherwise (row missing OR row exists but airdrop never landed) we
  // re-derive the SMA from the factory and retry the airdrop. Re-deriving
  // is cheap (single eth_call) and protects against an old row that
  // pointed at the wrong factory.
  const factoryAddress = getDeployment(network).SOFSmartAccountFactory;
  if (!factoryAddress) {
    throw new Error(
      `SOFSmartAccountFactory address missing from deployments for network=${network}`,
    );
  }

  const sma = await getSmaFromFactory(chain, factoryAddress, eoa);
  await db.upsertSmartAccount({ eoa: eoaLc, sma });

  if (airdrop && typeof airdrop.transferToSma === "function") {
    await airdrop.transferToSma(sma);
  }

  return { eoa: eoaLc, sma, isNew: true };
}
