// Read-through Redis cache for accessService.getUserAccess.
//
// Hot-path optimization: every protected admin route used to do one
// `allowlist_entries` lookup per request via getUserAccess (often two
// queries — fid lookup, then wallet fallback). Caching the result for
// 60s eliminates the bulk of those roundtrips at near-zero risk: TTL
// is short, mutations explicitly invalidate, and any Redis hiccup
// silently falls through to the DB.

import { getUserAccess } from "./accessService.js";
import { redisClient } from "./redisClient.js";
import { resolveAddressPair } from "./services/addressPairResolver.js";
import { supabase, hasSupabase } from "./supabaseClient.js";

// 5-minute TTL. Mutations explicitly invalidate via invalidateUserAccessCache
// from every admin endpoint that touches allowlist_entries or
// user_access_groups, so the TTL only matters as a safety net for stale
// entries — 5 min is fine and cuts cache-miss frequency 5x vs the prior 60s.
export const ACCESS_CACHE_TTL_SECONDS = 300;
const KEY_PREFIX = "access:";

/**
 * Derive the Redis key for a {fid, wallet} pair. Mirrors the priority
 * order in getUserAccess: fid wins because it's stable across wallet
 * rotations (a Farcaster user can change their primary verified address).
 *
 * @returns {string|null} The cache key, or null if neither identifier present.
 */
export function buildAccessCacheKey({ fid, wallet }) {
  if (fid !== undefined && fid !== null && fid !== "") {
    return `${KEY_PREFIX}fid:${fid}`;
  }
  if (typeof wallet === "string" && wallet.length > 0) {
    return `${KEY_PREFIX}wallet:${wallet.toLowerCase()}`;
  }
  return null;
}

/**
 * Read-through cache wrapper for getUserAccess.
 *
 * Returns the same shape as getUserAccess: {level, levelName, groups, entry}.
 * Cache failures (Redis down, parse error) are logged at warn and never
 * block the request — we always fall through to the DB.
 *
 * @param {{fid?: number|string, wallet?: string}} identifier
 * @param {{warn: Function, error: Function}} [logger=console]
 */
export async function getCachedUserAccess(identifier, logger = console) {
  const key = buildAccessCacheKey(identifier);

  // No identifier → can't cache, just call through.
  if (!key) {
    return getUserAccess(identifier);
  }

  // Try cache first. ANY failure (connect refused, malformed JSON, etc.)
  // falls through to the DB — caching is best-effort.
  let client;
  try {
    client = redisClient.getClient();
  } catch (err) {
    logger.warn({ err }, "[accessCache] redis unavailable; falling through");
    return getUserAccess(identifier);
  }

  try {
    const cached = await client.get(key);
    if (cached !== null && cached !== undefined) {
      try {
        return JSON.parse(cached);
      } catch (err) {
        logger.warn(
          { err, key },
          "[accessCache] cached value not valid JSON; refetching",
        );
        // fall through to DB
      }
    }
  } catch (err) {
    logger.warn({ err, key }, "[accessCache] read failed; falling through");
    return getUserAccess(identifier);
  }

  // Miss — load from DB and write through.
  const value = await getUserAccess(identifier);

  try {
    await client.set(key, JSON.stringify(value), "EX", ACCESS_CACHE_TTL_SECONDS);
  } catch (err) {
    logger.warn({ err, key }, "[accessCache] write failed; returning DB result");
  }

  return value;
}

/**
 * Look up the wallet associated with an FID via the allowlist_entries
 * table. Used by invalidateUserAccessCache to derive the wallet keys
 * that need busting for FID-only invalidations (Farcaster webhooks,
 * FID-only allowlist mutations). No `is_active` filter — we want the
 * row even after a soft-delete mutation, because that's exactly the
 * mutation that triggered the invalidation.
 *
 * Best-effort: returns null on any error (Supabase unconfigured, query
 * failure, no matching row). Callers fall back to the existing
 * FID-only behaviour — at worst the wallet-keyed entry stays stale for
 * the 60s TTL.
 *
 * @param {number|string} fid
 * @param {{warn: Function}} [logger=console]
 * @returns {Promise<string|null>} lowercased wallet address, or null
 */
async function resolveWalletByFid(fid, logger = console) {
  if (!hasSupabase) return null;
  try {
    const { data, error } = await supabase
      .from("allowlist_entries")
      .select("wallet_address")
      .eq("fid", fid)
      .limit(1)
      .maybeSingle();
    if (error) {
      logger.warn?.(
        { err: error, fid },
        "[accessCache] wallet-by-fid lookup failed",
      );
      return null;
    }
    const w = data?.wallet_address;
    return typeof w === "string" && w.length > 0 ? w.toLowerCase() : null;
  } catch (err) {
    logger.warn?.({ err, fid }, "[accessCache] wallet-by-fid threw");
    return null;
  }
}

/**
 * Invalidate the cache entry for a {fid, wallet} pair. Call this from
 * route handlers after any mutation that flips access (allowlist add,
 * access-level update, removal). The 60s TTL is the safety net — explicit
 * invalidation makes admin changes reflect immediately instead of after
 * the next minute.
 *
 * Wallet keys (including SMA-paired counterparts) are busted whenever
 * a wallet can be derived, even when the caller only supplied a FID:
 * Farcaster webhooks and FID-only allowlist mutations would otherwise
 * leave `access:wallet:0xEOA` / `access:wallet:0xSMA` entries holding
 * the pre-mutation verdict for up to 60s. See Issue #109.
 *
 * @param {{fid?: number|string, wallet?: string}} identifier
 * @param {{warn: Function}} [logger=console]
 */
export async function invalidateUserAccessCache(identifier, logger = console) {
  const keys = [];

  const hasFid =
    identifier.fid !== undefined &&
    identifier.fid !== null &&
    identifier.fid !== "";
  const suppliedWallet =
    typeof identifier.wallet === "string" && identifier.wallet.length > 0
      ? identifier.wallet.toLowerCase()
      : null;

  if (hasFid) {
    keys.push(`${KEY_PREFIX}fid:${identifier.fid}`);
  }

  // Derive a wallet to bust against. The caller-supplied wallet wins;
  // when only a FID is present, look up the wallet from allowlist_entries
  // so we can run the existing pair-busting against the same address an
  // admin route would have used to populate the wallet-keyed entry.
  let walletForBust = suppliedWallet;
  if (!walletForBust && hasFid) {
    walletForBust = await resolveWalletByFid(identifier.fid, logger);
  }

  if (walletForBust) {
    keys.push(`${KEY_PREFIX}wallet:${walletForBust}`);

    // Symmetric busting: if this wallet has a paired counterpart in
    // smart_accounts, invalidate its key too. Resolution is best-effort —
    // a failure here doesn't block invalidating the primary key.
    const pair = await resolveAddressPair(walletForBust, logger);
    if (pair) {
      const alt = walletForBust === pair.eoa ? pair.sma : pair.eoa;
      if (alt && alt !== walletForBust) {
        keys.push(`${KEY_PREFIX}wallet:${alt}`);
      }
    }
  }

  if (keys.length === 0) return;

  let client;
  try {
    client = redisClient.getClient();
  } catch (err) {
    logger.warn({ err }, "[accessCache] redis unavailable; skipping invalidate");
    return;
  }

  try {
    await client.del(...keys);
  } catch (err) {
    logger.warn({ err, keys }, "[accessCache] invalidate failed");
  }
}
