/**
 * smartAccountsDb
 *
 * Thin Supabase wrapper for the smart_accounts table. Returns plain rows;
 * smartAccountService is responsible for any address normalization on the
 * way in or out.
 */

import { supabase, hasSupabase } from "../supabaseClient.js";

const TABLE = "smart_accounts";

/**
 * Fetch the row for a given EOA, or null if none exists.
 * @param {string} eoa - Lowercased EOA
 * @returns {Promise<{eoa: string, sma: string, deployed_at: string|null, funded_at: string|null} | null>}
 */
export async function getSmartAccountByEoa(eoa) {
  if (!hasSupabase) return null;
  const { data, error } = await supabase
    .from(TABLE)
    .select("eoa, sma, deployed_at, funded_at, last_active_at, created_at")
    .eq("eoa", String(eoa).toLowerCase())
    .maybeSingle();
  if (error && error.code !== "PGRST116") {
    throw new Error(`smartAccountsDb.getSmartAccountByEoa: ${error.message}`);
  }
  return data || null;
}

/**
 * Fetch the row for a given SMA, or null.
 * @param {string} sma - Lowercased SMA
 */
export async function getSmartAccountBySma(sma) {
  if (!hasSupabase) return null;
  const { data, error } = await supabase
    .from(TABLE)
    .select("eoa, sma, deployed_at, funded_at, last_active_at, created_at")
    .eq("sma", String(sma).toLowerCase())
    .maybeSingle();
  if (error && error.code !== "PGRST116") {
    throw new Error(`smartAccountsDb.getSmartAccountBySma: ${error.message}`);
  }
  return data || null;
}

/**
 * Insert or update a row keyed on EOA. Caller passes lowercased addresses.
 * @param {{eoa: string, sma: string}} row
 */
export async function upsertSmartAccount({ eoa, sma }) {
  if (!hasSupabase) return;
  const { error } = await supabase
    .from(TABLE)
    .upsert(
      {
        eoa: String(eoa).toLowerCase(),
        sma: String(sma).toLowerCase(),
        last_active_at: new Date().toISOString(),
      },
      { onConflict: "eoa" },
    );
  if (error) {
    throw new Error(`smartAccountsDb.upsertSmartAccount: ${error.message}`);
  }
}

/**
 * Mark an SMA as funded. Idempotent — funded_at only gets stamped once.
 * @param {string} sma - Lowercased SMA
 * @param {string} [_txHash] - Optional tx hash for logging only (not persisted yet)
 */
export async function markFunded(sma, _txHash) {
  if (!hasSupabase) return;
  const { error } = await supabase
    .from(TABLE)
    .update({ funded_at: new Date().toISOString() })
    .eq("sma", String(sma).toLowerCase())
    .is("funded_at", null);
  if (error) {
    throw new Error(`smartAccountsDb.markFunded: ${error.message}`);
  }
}

/**
 * Mark an SMA as deployed (called by accountCreatedListener).
 * Idempotent — deployed_at only gets stamped once.
 * @param {string} sma - Lowercased SMA
 */
export async function markDeployed(sma) {
  if (!hasSupabase) return;
  const { error } = await supabase
    .from(TABLE)
    .update({ deployed_at: new Date().toISOString() })
    .eq("sma", String(sma).toLowerCase())
    .is("deployed_at", null);
  if (error) {
    throw new Error(`smartAccountsDb.markDeployed: ${error.message}`);
  }
}

/**
 * Bundle of helpers shaped to match the smartAccountService dependency
 * contract. Importers call `smartAccountsDb` directly; this default-export
 * shape makes it cheap to plug into ensureSmartAccount({ db, ... }).
 */
export const smartAccountsDb = {
  getSmartAccountByEoa,
  getSmartAccountBySma,
  upsertSmartAccount,
  markFunded,
  markDeployed,
};

export default smartAccountsDb;
