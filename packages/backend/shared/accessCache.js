// Read-through Redis cache for accessService.getUserAccess.
//
// Hot-path optimization: every protected admin route used to do one
// `allowlist_entries` lookup per request via getUserAccess. Caching the
// result for 5 minutes (see ACCESS_CACHE_TTL_SECONDS) eliminates the bulk
// of those roundtrips at near-zero risk: mutations explicitly invalidate,
// and any Redis hiccup silently falls through to the DB.
//
// This module is a thin, access-specific wrapper around the generic
// read-through helper in redisCache.js. It owns the wallet key derivation
// and the SMA-pair invalidation surface; the Redis mechanics (try-cache,
// write-through, best-effort invalidation, never-throw) live in
// redisCache.js.

import { getUserAccess } from "./accessService.js";
import { cacheRead, cacheInvalidate } from "./redisCache.js";
import { resolveAddressPair } from "./services/addressPairResolver.js";

// 5-minute TTL. Mutations explicitly invalidate via invalidateUserAccessCache
// from every admin endpoint that touches allowlist_entries or
// user_access_groups, so the TTL only matters as a safety net for stale
// entries — 5 min is fine and cuts cache-miss frequency 5x vs the prior 60s.
export const ACCESS_CACHE_TTL_SECONDS = 300;
const KEY_PREFIX = "access:";

/**
 * Derive the Redis key for a {wallet} identifier.
 *
 * @returns {string|null} The cache key, or null if no wallet is present.
 */
export function buildAccessCacheKey({ wallet } = {}) {
  if (typeof wallet === "string" && wallet.length > 0) {
    return `${KEY_PREFIX}wallet:${wallet.toLowerCase()}`;
  }
  return null;
}

/**
 * Read-through cache wrapper for getUserAccess.
 *
 * Returns the same shape as getUserAccess: {level, levelName, groups, entry}.
 * Cache failures (Redis down, parse error) are logged at warn by the
 * underlying helper and never block the request — we always fall through
 * to the DB.
 *
 * @param {{wallet?: string}} identifier
 * @param {{warn: Function, error: Function}} [logger=console]
 */
export async function getCachedUserAccess(identifier, logger = console) {
  const key = buildAccessCacheKey(identifier);

  // No identifier → can't cache, just call through.
  if (!key) {
    return getUserAccess(identifier);
  }

  return cacheRead(key, () => getUserAccess(identifier), {
    ttlSeconds: ACCESS_CACHE_TTL_SECONDS,
    logger,
  });
}

/**
 * Invalidate the cache entry for a {wallet} identifier. Call this from
 * route handlers after any mutation that flips access (allowlist add,
 * access-level update, removal). The ACCESS_CACHE_TTL_SECONDS window is
 * the safety net — explicit invalidation makes admin changes reflect
 * immediately instead of after the TTL elapses.
 *
 * The wallet's SMA-paired counterpart (EOA <-> SMA, via smart_accounts) is
 * busted too, so an admin change to either address takes effect for both.
 *
 * @param {{wallet?: string}} identifier
 * @param {{warn: Function}} [logger=console]
 */
export async function invalidateUserAccessCache(identifier, logger = console) {
  const wallet =
    typeof identifier?.wallet === "string" && identifier.wallet.length > 0
      ? identifier.wallet.toLowerCase()
      : null;

  if (!wallet) return;

  const keys = [`${KEY_PREFIX}wallet:${wallet}`];

  // Symmetric busting: if this wallet has a paired counterpart in
  // smart_accounts, invalidate its key too. Resolution is best-effort —
  // a failure here doesn't block invalidating the primary key.
  const pair = await resolveAddressPair(wallet, logger);
  if (pair) {
    const alt = wallet === pair.eoa ? pair.sma : pair.eoa;
    if (alt && alt !== wallet) {
      keys.push(`${KEY_PREFIX}wallet:${alt}`);
    }
  }

  // Single DEL covering the wallet + SMA-pair keys; cacheInvalidate is
  // best-effort and never throws on a Redis hiccup.
  await cacheInvalidate(keys, logger);
}
