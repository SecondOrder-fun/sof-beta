/**
 * adminEoaService
 *
 * Parses the ADMIN_EOAS env var (comma-separated lowercase addresses) at
 * boot, and provides helpers for the auth flow to:
 *   - check whether a given EOA is an admin (in-memory + DB)
 *   - flip allowlist_entries.is_admin = true on first auth
 *
 * Per spec §2 backend-enforced admin gating. is_admin is never downgraded
 * from true → false here; remove an EOA from ADMIN_EOAS and run a manual
 * UPDATE if you actually need to revoke.
 */

import process from "node:process";
import { supabase, hasSupabase } from "../supabaseClient.js";

let cachedAdminSet = null;
let cachedRawValue = null;

/**
 * Parse a comma-separated list of EOAs, trim+lowercase each, drop blanks
 * and anything that doesn't look like a 0x address. Cached in-memory but
 * invalidated when the ADMIN_EOAS env var changes between calls (helps tests).
 *
 * @returns {Set<string>}
 */
export function getAdminEoaSet() {
  const raw = process.env.ADMIN_EOAS || "";
  if (cachedAdminSet && raw === cachedRawValue) {
    return cachedAdminSet;
  }
  const parsed = raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => /^0x[0-9a-f]{40}$/.test(s));
  cachedAdminSet = new Set(parsed);
  cachedRawValue = raw;
  return cachedAdminSet;
}

/**
 * Reset cache — only used in tests.
 */
export function _resetAdminEoaCache() {
  cachedAdminSet = null;
  cachedRawValue = null;
}

/**
 * Is the given EOA in the env-seeded admin list?
 * @param {string} eoa
 */
export function isEnvSeededAdmin(eoa) {
  if (!eoa) return false;
  return getAdminEoaSet().has(String(eoa).toLowerCase());
}

/**
 * Check whether `is_admin = true` is currently set on the user's
 * allowlist_entries row. Returns false if no row exists or column is false.
 * @param {string} walletAddress
 */
export async function getIsAdminFromDb(walletAddress) {
  if (!hasSupabase || !walletAddress) return false;
  const wallet = String(walletAddress).toLowerCase();
  const { data, error } = await supabase
    .from("allowlist_entries")
    .select("is_admin")
    .eq("wallet_address", wallet)
    .maybeSingle();
  if (error && error.code !== "PGRST116") {
    // Soft-fail: don't block auth on DB read errors.
    return false;
  }
  return Boolean(data?.is_admin);
}

/**
 * If the EOA is in ADMIN_EOAS and is_admin is currently false (or no row
 * exists), flip it to true. Never downgrades.
 *
 * Returns the resolved is_admin value after any update.
 * @param {string} walletAddress
 * @param {{warn: Function, info?: Function} | undefined} [logger]
 * @returns {Promise<boolean>}
 */
export async function ensureAdminFlag(walletAddress, logger) {
  if (!walletAddress) return false;
  const wallet = String(walletAddress).toLowerCase();
  const seeded = isEnvSeededAdmin(wallet);

  if (!hasSupabase) {
    return seeded;
  }

  // Read current state
  const currentlyAdmin = await getIsAdminFromDb(wallet);

  if (seeded && !currentlyAdmin) {
    // Flip false → true. Use update on existing row; if no row exists yet
    // the SIWE flow's allowlist upsert will land first for SIWF, and for
    // pure wallet auth we leave it for whichever code path materializes
    // the row (we don't want to insert a dangling allowlist entry here).
    const { error } = await supabase
      .from("allowlist_entries")
      .update({ is_admin: true })
      .eq("wallet_address", wallet);
    if (error) {
      logger?.warn?.(
        { err: error, wallet },
        "ensureAdminFlag: failed to flip is_admin",
      );
      return seeded;
    }
    return true;
  }

  // If env doesn't list them, do not downgrade an existing true value.
  return currentlyAdmin || seeded;
}
