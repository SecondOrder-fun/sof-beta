// backend/shared/redisCache.js
//
// Read-through Redis cache helper. Used by accessService.getRouteConfig,
// the /api/infofi/markets endpoint handler, DatabaseService's
// season_contracts reads, infoFiPositionService (getNetPosition +
// getMarketInfo), raffleTransactionService.getSeasonTransactions, and
// accessCache.js (which layers its own FID-vs-wallet-vs-SMA-pair key
// logic on top of this generic core).
//
// The pattern is: try Redis → fall through to the loader on miss/error,
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
//
// All cache key prefixes are defined here so readers and invalidators
// import from one place — prevents the drift bug where one file
// renames the prefix and the matching invalidator silently misses
// the new namespace.

import { redisClient } from "./redisClient.js";

// Cache key prefixes — single source of truth shared between readers
// (which construct keys) and invalidators (which match by pattern).
export const ROUTE_CONFIG_KEY_PREFIX = "route_config:";
export const MARKETS_KEY_PREFIX = "markets:";
export const SEASON_CONTRACTS_KEY_PREFIX = "season_contracts:";
// Per-user net position in a single market. Key:
//   positions:net:{marketId}:{userAddress}
export const POSITIONS_KEY_PREFIX = "positions:";
// Market pool info (on-chain reserves + DB-derived volume). Key:
//   market_info:{marketId}
export const MARKET_INFO_KEY_PREFIX = "market_info:";
// Paginated season transaction list. Key:
//   raffle_tx:{seasonId}:{order}:{limit}:{offset}
export const RAFFLE_TX_KEY_PREFIX = "raffle_tx:";

// Track whether Redis is configured at all. `redisClient.getClient()`
// throws when no URL is set; in dev environments without Redis we'd
// otherwise log a warn on every cache call — once per page load × 4
// caches = noisy. After the first failure we remember the state and
// short-circuit subsequent calls to a single one-time warn.
let redisAvailable = /** @type {boolean|null} */ (null);

function tryGetClient(logger) {
  if (redisAvailable === false) {
    return null;
  }
  try {
    const client = redisClient.getClient();
    redisAvailable = true;
    return client;
  } catch (err) {
    if (redisAvailable !== false) {
      logger.warn?.(
        { err },
        "[cache] redis unavailable; subsequent cache calls will skip silently",
      );
    }
    redisAvailable = false;
    return null;
  }
}

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
  const client = tryGetClient(logger);
  if (!client) return loader();

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

  // Reject ttlSeconds <= 0 — Redis EX rejects non-positive values, which
  // would surface as a silent write failure that disables caching for
  // this key permanently. Skip the write entirely and let the next call
  // re-evaluate. A loader returning undefined would also fail to
  // serialize cleanly (JSON.stringify(undefined) === undefined), so
  // skip that case too.
  if (!Number.isFinite(ttlSeconds) || ttlSeconds < 1 || value === undefined) {
    return value;
  }

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

  const client = tryGetClient(logger);
  if (!client) return;

  try {
    await client.del(...keys);
  } catch (err) {
    logger.warn?.({ err, keys }, "[cache] invalidate failed");
  }
}

/**
 * Invalidate all keys matching a pattern. Uses SCAN + UNLINK in
 * batches so a mid-stream Redis error still deletes the keys
 * collected so far (rather than the previous accumulate-then-delete
 * pattern which dropped everything on partial failure). UNLINK is the
 * non-blocking variant of DEL.
 *
 * @param {string} pattern — glob-style Redis pattern, e.g. `"markets:*"`
 * @param {{ warn?: Function }} [logger=console]
 */
export async function cacheInvalidatePattern(pattern, logger = console) {
  // Defensive: an empty / nullish pattern would resolve to `match: undefined`
  // and SCAN every key in the namespace; the subsequent UNLINK would wipe
  // the whole DB. No current caller passes anything but a hardcoded prefix,
  // but the cost of guarding is one line.
  if (typeof pattern !== "string" || pattern.length === 0) {
    logger.warn?.({ pattern }, "[cache] refused empty pattern");
    return;
  }

  const client = tryGetClient(logger);
  if (!client) return;

  try {
    const stream = client.scanStream({ match: pattern, count: 100 });
    for await (const batch of stream) {
      if (batch.length === 0) continue;
      // Delete each batch as it arrives — if scan errors mid-stream
      // the keys already scanned are still busted.
      try {
        await client.unlink(...batch);
      } catch (err) {
        logger.warn?.({ err, pattern, batchSize: batch.length },
          "[cache] batch unlink failed");
      }
    }
  } catch (err) {
    logger.warn?.({ err, pattern }, "[cache] pattern invalidate failed");
  }
}
