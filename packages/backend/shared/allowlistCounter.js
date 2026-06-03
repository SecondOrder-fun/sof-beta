// backend/shared/allowlistCounter.js
//
// Redis-backed counter for allowlist_entries row counts. The allowlist
// window check (isAllowlistWindowOpen) and stats endpoint used to run a
// `select("*", { count: "exact", head: true })` COUNT(*) against Postgres
// on every protected-route access — that's a full index scan per request
// just to compare against max_entries. Counts change only on the rare
// mutation paths (add / remove / deactivate / kick), so we cache them in
// Redis with a long TTL and bust the whole namespace on any mutation.
//
// Keys are namespaced `allowlist:count:{filter}` where {filter} encodes
// the WHERE clause (e.g. "active", "total", "active:withWallet"). Each
// distinct count the service needs gets its own key; invalidation wipes
// them all via SCAN over `allowlist:count:*`.
//
// Cold start / cache miss falls through to a single COUNT(*) and primes
// the key. A Redis hiccup degrades silently to a direct COUNT(*) — same
// degradation contract as redisCache.js (never throws, never blocks).

import { cacheRead, cacheInvalidatePattern } from "./redisCache.js";
import { db, hasSupabase } from "./supabaseClient.js";

// Single source of truth for the key prefix so the reader and the
// invalidator can't drift.
export const ALLOWLIST_COUNT_KEY_PREFIX = "allowlist:count:";

// Counts are stable except on admin-rare mutations, which invalidate
// explicitly; the TTL is just the safety net.
const ALLOWLIST_COUNT_TTL_SECONDS = 3600;

// Filter -> builder mapping. Each builder applies the WHERE clause for a
// head-only COUNT(*) query. Keeping these here (rather than inlined at the
// call site) means the filter string and the query that produces it live
// together, so a typo can't silently count the wrong thing.
const FILTERS = {
  total: (q) => q,
  active: (q) => q.eq("is_active", true),
  "active:withWallet": (q) =>
    q.eq("is_active", true).not("wallet_address", "is", null),
  "active:pendingWallet": (q) =>
    q.eq("is_active", true).is("wallet_address", null),
};

/**
 * Read-through allowlist row count for a named filter.
 *
 * @param {keyof typeof FILTERS} filter — which WHERE clause to count
 * @returns {Promise<number>} the row count (0 when Supabase is unconfigured)
 */
export async function getAllowlistCount(filter = "active") {
  if (!hasSupabase) return 0;

  const applyFilter = FILTERS[filter];
  if (!applyFilter) {
    throw new Error(`[allowlistCounter] unknown filter: ${filter}`);
  }

  const value = await cacheRead(
    `${ALLOWLIST_COUNT_KEY_PREFIX}${filter}`,
    async () => {
      const base = db.client
        .from("allowlist_entries")
        .select("*", { count: "exact", head: true });
      const { count, error } = await applyFilter(base);
      if (error) throw new Error(error.message);
      return count || 0;
    },
    { ttlSeconds: ALLOWLIST_COUNT_TTL_SECONDS },
  );

  return value || 0;
}

/**
 * Invalidate every cached allowlist count. Call after any mutation that
 * could change a row count (add / reactivate / remove / deactivate).
 * Best-effort — Redis failures are swallowed by cacheInvalidatePattern.
 */
export async function invalidateAllowlistCount() {
  await cacheInvalidatePattern(`${ALLOWLIST_COUNT_KEY_PREFIX}*`);
}

export default { getAllowlistCount, invalidateAllowlistCount };
