/**
 * @file allowlistCounter.test.js
 * @description Regression test for the Redis-backed allowlist counter
 * (#161). Proves that (a) a cold count falls through to a single COUNT(*)
 * and primes Redis, (b) subsequent reads are served from cache without
 * re-querying Postgres, and (c) invalidateAllowlistCount() busts the
 * namespace so the next read re-runs the COUNT(*).
 *
 * The redisClient is backed by a tiny in-memory store so cacheRead's real
 * read-through/write-through logic runs unmocked — the test exercises the
 * counter through the same code path production uses.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

const supabaseMocks = vi.hoisted(() => ({
  hasSupabase: true,
  // Records every terminal COUNT(*) resolution so we can count DB hits.
  countCalls: vi.fn(),
}));

// In-memory Redis double. Implements just the surface cacheRead /
// cacheInvalidatePattern touch: get/set/scanStream/unlink.
const redisStore = vi.hoisted(() => ({ map: new Map() }));

vi.mock("../../shared/redisClient.js", () => {
  const fakeClient = {
    async get(key) {
      return redisStore.map.has(key) ? redisStore.map.get(key) : null;
    },
    async set(key, value) {
      redisStore.map.set(key, value);
      return "OK";
    },
    async del(...keys) {
      keys.forEach((k) => redisStore.map.delete(k));
      return keys.length;
    },
    async unlink(...keys) {
      keys.forEach((k) => redisStore.map.delete(k));
      return keys.length;
    },
    scanStream({ match }) {
      // Translate the glob suffix `*` to a prefix match.
      const prefix = match.endsWith("*") ? match.slice(0, -1) : match;
      const keys = [...redisStore.map.keys()].filter((k) =>
        k.startsWith(prefix),
      );
      return (async function* () {
        if (keys.length) yield keys;
      })();
    },
  };
  return { redisClient: { getClient: () => fakeClient } };
});

// Supabase chain double. The counter builds:
//   db.client.from("allowlist_entries")
//     .select("*", { count: "exact", head: true })
//     .eq(...)?.not(...)?.is(...)
// then awaits the builder for { count, error }. The builder is a thenable
// so `await` on any point in the chain resolves to the mocked result.
vi.mock("../../shared/supabaseClient.js", () => {
  function makeBuilder() {
    const builder = {
      select: () => builder,
      eq: () => builder,
      not: () => builder,
      is: () => builder,
      then(resolve, reject) {
        return Promise.resolve(supabaseMocks.countCalls()).then(
          resolve,
          reject,
        );
      },
    };
    return builder;
  }
  return {
    hasSupabase: supabaseMocks.hasSupabase,
    db: { client: { from: () => makeBuilder() } },
  };
});

import {
  getAllowlistCount,
  invalidateAllowlistCount,
  ALLOWLIST_COUNT_KEY_PREFIX,
} from "../../shared/allowlistCounter.js";

describe("allowlistCounter", () => {
  beforeEach(() => {
    redisStore.map.clear();
    supabaseMocks.countCalls.mockReset();
  });

  it("cold read runs one COUNT(*) and primes the cache key", async () => {
    supabaseMocks.countCalls.mockResolvedValue({ count: 7, error: null });

    const result = await getAllowlistCount("active");

    expect(result).toBe(7);
    expect(supabaseMocks.countCalls).toHaveBeenCalledTimes(1);
    expect(redisStore.map.has(`${ALLOWLIST_COUNT_KEY_PREFIX}active`)).toBe(true);
  });

  it("serves repeat reads from cache without re-querying Postgres", async () => {
    supabaseMocks.countCalls.mockResolvedValue({ count: 3, error: null });

    const first = await getAllowlistCount("active");
    const second = await getAllowlistCount("active");
    const third = await getAllowlistCount("active");

    expect(first).toBe(3);
    expect(second).toBe(3);
    expect(third).toBe(3);
    // One DB hit total — the warm reads came from Redis.
    expect(supabaseMocks.countCalls).toHaveBeenCalledTimes(1);
  });

  it("invalidation busts the cache so the next read re-runs COUNT(*)", async () => {
    supabaseMocks.countCalls.mockResolvedValueOnce({ count: 1, error: null });
    expect(await getAllowlistCount("active")).toBe(1);
    expect(supabaseMocks.countCalls).toHaveBeenCalledTimes(1);

    // A mutation happened; bust the namespace.
    await invalidateAllowlistCount();
    expect(redisStore.map.size).toBe(0);

    // Next read sees the new value from the DB, not the stale cached 1.
    supabaseMocks.countCalls.mockResolvedValueOnce({ count: 2, error: null });
    expect(await getAllowlistCount("active")).toBe(2);
    expect(supabaseMocks.countCalls).toHaveBeenCalledTimes(2);
  });

  it("keeps distinct filters on independent cache keys", async () => {
    supabaseMocks.countCalls
      .mockResolvedValueOnce({ count: 10, error: null }) // total
      .mockResolvedValueOnce({ count: 6, error: null }); // active

    expect(await getAllowlistCount("total")).toBe(10);
    expect(await getAllowlistCount("active")).toBe(6);
    // Two distinct keys, two DB hits.
    expect(supabaseMocks.countCalls).toHaveBeenCalledTimes(2);

    // Warm both — no further DB hits.
    expect(await getAllowlistCount("total")).toBe(10);
    expect(await getAllowlistCount("active")).toBe(6);
    expect(supabaseMocks.countCalls).toHaveBeenCalledTimes(2);
  });

  it("throws on an unknown filter", async () => {
    await expect(getAllowlistCount("bogus")).rejects.toThrow(/unknown filter/);
  });
});
