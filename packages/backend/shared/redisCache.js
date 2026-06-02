// backend/shared/redisCache.js
//
// Read-through Redis cache helper used by accessCache (allowlist),
// routeConfigCache, infoFiMarketsCache, and seasonContractsCache. The
// pattern is: try Redis → fall through to the loader on miss/error,
// best-effort write-through, never throws. Designed so a Redis hiccup
// (network blip, restart, eviction) silently degrades to direct DB
// reads rather than failing the calling request.
//
// Why we cache: every protected route used to do 3–5 Supabase round-
// trips just to resolve the caller's identity / route ACL, on top of
// any business-logic reads. The /api/infofi/markets endpoint returned
// all market rows on every page load. `season_contracts` is queried
// on every health probe + listener init. None of these change often;
// short-TTL Redis caching collapses the egress without changing the
// product surface.

import { redisClient } from "./redisClient.js";

/**
 * Read-through cache wrapper. Returns the cached value if present,
 * otherwise calls `loader()`, stores the result, and returns it.
 *
 * Redis failures (connect refused, parse errors, write failures) are
 * logged at warn and treated as cache misses — they never block the
 * loader. The caller's request still succeeds via the origin path.
 *
 * @template T
 * @param {string} key — fully-qualified Redis key (caller owns namespacing)
 * @param {() => Promise<T>} loader — origin fetch on cache miss
 * @param {{ ttlSeconds: number, logger?: { warn?: Function, error?: Function } }} opts
 * @returns {Promise<T>}
 */
export async function cacheRead(key, loader, { ttlSeconds, logger = console } = {}) {
  let client;
  try {
    client = redisClient.getClient();
  } catch (err) {
    logger.warn?.({ err, key }, "[cache] redis unavailable; loading from origin");
    return loader();
  }

  try {
    const cached = await client.get(key);
    if (cached !== null && cached !== undefined) {
      try {
        return JSON.parse(cached);
      } catch (err) {
        logger.warn?.({ err, key }, "[cache] malformed JSON; refetching");
        // fall through to loader
      }
    }
  } catch (err) {
    logger.warn?.({ err, key }, "[cache] read failed; loading from origin");
    return loader();
  }

  const value = await loader();

  try {
    await client.set(key, JSON.stringify(value), "EX", ttlSeconds);
  } catch (err) {
    logger.warn?.({ err, key }, "[cache] write failed; returning origin value");
  }

  return value;
}

/**
 * Delete one or more Redis keys. Best-effort: Redis failures are
 * logged at warn and never propagated — invalidation is for freshness,
 * not correctness (the TTL is the safety net).
 *
 * @param {string | string[]} keyOrKeys
 * @param {{ warn?: Function }} [logger=console]
 */
export async function cacheInvalidate(keyOrKeys, logger = console) {
  const keys = Array.isArray(keyOrKeys) ? keyOrKeys : [keyOrKeys];
  if (keys.length === 0) return;

  let client;
  try {
    client = redisClient.getClient();
  } catch (err) {
    logger.warn?.({ err, keys }, "[cache] redis unavailable; skipping invalidate");
    return;
  }

  try {
    await client.del(...keys);
  } catch (err) {
    logger.warn?.({ err, keys }, "[cache] invalidate failed");
  }
}

/**
 * Invalidate all keys matching a pattern. Uses SCAN to avoid blocking
 * the Redis main thread on large key spaces.
 *
 * @param {string} pattern — glob-style Redis pattern, e.g. `"markets:*"`
 * @param {{ warn?: Function }} [logger=console]
 */
export async function cacheInvalidatePattern(pattern, logger = console) {
  let client;
  try {
    client = redisClient.getClient();
  } catch (err) {
    logger.warn?.({ err, pattern }, "[cache] redis unavailable; skipping invalidate");
    return;
  }

  try {
    const stream = client.scanStream({ match: pattern, count: 100 });
    const toDelete = [];
    for await (const batch of stream) {
      if (batch.length > 0) toDelete.push(...batch);
    }
    if (toDelete.length > 0) {
      await client.del(...toDelete);
    }
  } catch (err) {
    logger.warn?.({ err, pattern }, "[cache] pattern invalidate failed");
  }
}
