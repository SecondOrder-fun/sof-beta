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

export const ACCESS_CACHE_TTL_SECONDS = 60;
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
 * Invalidate the cache entry for a {fid, wallet} pair. Call this from
 * route handlers after any mutation that flips access (allowlist add,
 * access-level update, removal). The 60s TTL is the safety net — explicit
 * invalidation makes admin changes reflect immediately instead of after
 * the next minute.
 *
 * Both keys are busted when both identifiers are present, in case the
 * caller only ever queries via one or the other.
 *
 * @param {{fid?: number|string, wallet?: string}} identifier
 * @param {{warn: Function}} [logger=console]
 */
export async function invalidateUserAccessCache(identifier, logger = console) {
  const keys = [];
  if (identifier.fid !== undefined && identifier.fid !== null && identifier.fid !== "") {
    keys.push(`${KEY_PREFIX}fid:${identifier.fid}`);
  }
  if (typeof identifier.wallet === "string" && identifier.wallet.length > 0) {
    keys.push(`${KEY_PREFIX}wallet:${identifier.wallet.toLowerCase()}`);
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
