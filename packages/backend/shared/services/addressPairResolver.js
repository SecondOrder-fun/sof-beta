/**
 * addressPairResolver
 *
 * Given any address, looks up its EOA↔SMA pair in smart_accounts. Used by
 * accessService.getUserAccess for SMA-aware allowlist fallback and by
 * accessCache.invalidateUserAccessCache for symmetric cache busting.
 *
 * Error-tolerant: any DB failure returns null with a warn log so callers
 * never block on smart-account resolution.
 */

import { smartAccountsDb } from "./smartAccountsDb.js";

/**
 * @param {string} address — case-insensitive
 * @param {{warn: Function}} [log=console]
 * @returns {Promise<{ eoa: string, sma: string } | null>} — lowercased
 */
export async function resolveAddressPair(address, log = console) {
  if (!address || typeof address !== "string") return null;
  const lc = address.toLowerCase();
  try {
    let row = await smartAccountsDb.getSmartAccountByEoa(lc);
    if (row) return { eoa: row.eoa, sma: row.sma };
    row = await smartAccountsDb.getSmartAccountBySma(lc);
    if (row) return { eoa: row.eoa, sma: row.sma };
    return null;
  } catch (err) {
    if (typeof log.warn === "function") {
      log.warn(
        { err: err.message, address: lc },
        "[addressPairResolver] lookup failed",
      );
    }
    return null;
  }
}

export default resolveAddressPair;
