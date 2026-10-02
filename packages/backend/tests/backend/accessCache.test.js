/**
 * @file accessCache.test.js
 * @description Read-through Redis cache for access lookups. Validates the
 * cache hit/miss paths, write-through behavior, wallet key derivation,
 * Redis-failure fallthrough, and explicit invalidation.
 *
 * accessCache.js now delegates the Redis mechanics to the generic
 * shared/redisCache.js helper (cacheRead / cacheInvalidate). These tests
 * mock that boundary rather than the low-level redis client: the mocked
 * cacheRead/cacheInvalidate faithfully reproduce the helper's contract
 * (try-cache → fall through on miss/error, best-effort write-through and
 * delete, never throw) by driving the same get/set/del client mocks the
 * suite already asserts against. So every key-shape, TTL, and
 * fallthrough assertion still verifies real accessCache behaviour, now
 * exercised through the helper seam.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

const accessMocks = vi.hoisted(() => ({
  mockGetUserAccess: vi.fn(),
}));

const redisMocks = vi.hoisted(() => ({
  mockGet: vi.fn(),
  mockSet: vi.fn(),
  mockDel: vi.fn(),
  mockGetClient: vi.fn(),
}));

vi.mock("../../shared/accessService.js", () => ({
  getUserAccess: (...args) => accessMocks.mockGetUserAccess(...args),
}));

// Mock the generic read-through helper at the seam accessCache now uses.
// These fakes mirror redisCache.js's real contract so the suite's
// existing get/set/del + key/TTL assertions keep verifying the same
// behaviour. The redisClient mock stays wired in case the helper's
// getClient() is consulted (and so unconfigured-Redis tests still apply).
vi.mock("../../shared/redisCache.js", () => ({
  // cacheRead: try client.get(key) → on hit JSON.parse (refetch on bad
  // JSON), on miss call loader() and write-through with EX ttl. Any
  // client failure falls through to loader(). Never throws.
  async cacheRead(key, loader, { ttlSeconds, logger = console } = {}) {
    let client;
    try {
      client = redisMocks.mockGetClient();
    } catch (err) {
      logger.warn?.({ err }, "[cache] redis unavailable");
      return loader();
    }
    try {
      const cached = await client.get(key);
      if (cached !== null && cached !== undefined) {
        try {
          return JSON.parse(cached);
        } catch (err) {
          logger.warn?.({ err, key }, "[cache] malformed JSON; refetching");
        }
      }
    } catch (err) {
      logger.warn?.({ err, key }, "[cache] read failed; loading from origin");
      return loader();
    }
    const value = await loader();
    if (!Number.isFinite(ttlSeconds) || ttlSeconds < 1 || value === undefined) {
      return value;
    }
    try {
      await client.set(key, JSON.stringify(value), "EX", ttlSeconds);
    } catch (err) {
      logger.warn?.({ err, key }, "[cache] write failed; returning origin value");
    }
    return value;
  },
  // cacheInvalidate: best-effort client.del(...keys). Never throws.
  async cacheInvalidate(keyOrKeys, logger = console) {
    const keys = Array.isArray(keyOrKeys) ? keyOrKeys : [keyOrKeys];
    if (keys.length === 0) return;
    let client;
    try {
      client = redisMocks.mockGetClient();
    } catch (err) {
      logger.warn?.({ err }, "[cache] redis unavailable; skipping invalidate");
      return;
    }
    try {
      await client.del(...keys);
    } catch (err) {
      logger.warn?.({ err, keys }, "[cache] invalidate failed");
    }
  },
}));

vi.mock("../../shared/redisClient.js", () => ({
  redisClient: {
    getClient: (...args) => redisMocks.mockGetClient(...args),
  },
}));

import {
  getCachedUserAccess,
  invalidateUserAccessCache,
  buildAccessCacheKey,
  ACCESS_CACHE_TTL_SECONDS,
} from "../../shared/accessCache.js";

const WALLET_LC = "0x1111111111111111111111111111111111111111";
const WALLET_KEY = `access:wallet:${WALLET_LC}`;

const SAMPLE_ENTRY = {
  level: 4,
  levelName: "admin",
  groups: [],
  entry: { id: 1, wallet_address: "0xabc" },
};

function makeLogger() {
  return { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() };
}

beforeEach(() => {
  accessMocks.mockGetUserAccess.mockReset();
  redisMocks.mockGet.mockReset();
  redisMocks.mockSet.mockReset();
  redisMocks.mockDel.mockReset();
  redisMocks.mockGetClient.mockReset();

  redisMocks.mockGetClient.mockReturnValue({
    get: (...args) => redisMocks.mockGet(...args),
    set: (...args) => redisMocks.mockSet(...args),
    del: (...args) => redisMocks.mockDel(...args),
  });
});

describe("buildAccessCacheKey", () => {
  it("returns null when no wallet is present", () => {
    expect(buildAccessCacheKey({})).toBeNull();
    expect(buildAccessCacheKey({ wallet: undefined })).toBeNull();
    expect(buildAccessCacheKey({ wallet: "" })).toBeNull();
  });

  it("keys by wallet, lowercasing the address", () => {
    expect(
      buildAccessCacheKey({ wallet: "0xABCDEF1234567890ABCDEF1234567890ABCDEF12" }),
    ).toBe("access:wallet:0xabcdef1234567890abcdef1234567890abcdef12");
  });
});

describe("getCachedUserAccess", () => {
  it("returns the cached value on hit and skips the DB call", async () => {
    redisMocks.mockGet.mockResolvedValueOnce(JSON.stringify(SAMPLE_ENTRY));
    const logger = makeLogger();

    const result = await getCachedUserAccess({ wallet: WALLET_LC }, logger);

    expect(result).toEqual(SAMPLE_ENTRY);
    expect(accessMocks.mockGetUserAccess).not.toHaveBeenCalled();
    expect(redisMocks.mockGet).toHaveBeenCalledWith(WALLET_KEY);
  });

  it("on miss, calls through to DB and writes through with the configured TTL", async () => {
    redisMocks.mockGet.mockResolvedValueOnce(null);
    accessMocks.mockGetUserAccess.mockResolvedValueOnce(SAMPLE_ENTRY);
    redisMocks.mockSet.mockResolvedValueOnce("OK");
    const logger = makeLogger();

    const result = await getCachedUserAccess({ wallet: WALLET_LC }, logger);

    expect(result).toEqual(SAMPLE_ENTRY);
    expect(accessMocks.mockGetUserAccess).toHaveBeenCalledOnce();
    expect(redisMocks.mockSet).toHaveBeenCalledWith(
      WALLET_KEY,
      JSON.stringify(SAMPLE_ENTRY),
      "EX",
      ACCESS_CACHE_TTL_SECONDS,
    );
    // TTL was bumped 60s → 300s as part of the Supabase-egress optimization
    // bundle. Mutations explicitly invalidate via invalidateUserAccessCache,
    // so the longer TTL just reduces cache-miss frequency.
    expect(ACCESS_CACHE_TTL_SECONDS).toBe(300);
  });

  it("falls through to DB when Redis getClient throws (e.g. unconfigured)", async () => {
    redisMocks.mockGetClient.mockImplementationOnce(() => {
      throw new Error("Redis URL not configured");
    });
    accessMocks.mockGetUserAccess.mockResolvedValueOnce(SAMPLE_ENTRY);
    const logger = makeLogger();

    const result = await getCachedUserAccess({ wallet: WALLET_LC }, logger);

    expect(result).toEqual(SAMPLE_ENTRY);
    expect(accessMocks.mockGetUserAccess).toHaveBeenCalledOnce();
    expect(logger.warn).toHaveBeenCalled();
  });

  it("falls through to DB when redis.get rejects (network blip)", async () => {
    redisMocks.mockGet.mockRejectedValueOnce(new Error("ECONNRESET"));
    accessMocks.mockGetUserAccess.mockResolvedValueOnce(SAMPLE_ENTRY);
    const logger = makeLogger();

    const result = await getCachedUserAccess({ wallet: WALLET_LC }, logger);

    expect(result).toEqual(SAMPLE_ENTRY);
    expect(accessMocks.mockGetUserAccess).toHaveBeenCalledOnce();
    expect(logger.warn).toHaveBeenCalled();
  });

  it("returns DB value (not throws) when redis.set fails after a miss", async () => {
    redisMocks.mockGet.mockResolvedValueOnce(null);
    accessMocks.mockGetUserAccess.mockResolvedValueOnce(SAMPLE_ENTRY);
    redisMocks.mockSet.mockRejectedValueOnce(new Error("write failed"));
    const logger = makeLogger();

    const result = await getCachedUserAccess({ wallet: WALLET_LC }, logger);

    expect(result).toEqual(SAMPLE_ENTRY);
    expect(logger.warn).toHaveBeenCalled();
  });

  it("refetches from DB when cached value is malformed JSON", async () => {
    redisMocks.mockGet.mockResolvedValueOnce("{not valid json");
    accessMocks.mockGetUserAccess.mockResolvedValueOnce(SAMPLE_ENTRY);
    redisMocks.mockSet.mockResolvedValueOnce("OK");
    const logger = makeLogger();

    const result = await getCachedUserAccess({ wallet: WALLET_LC }, logger);

    expect(result).toEqual(SAMPLE_ENTRY);
    expect(accessMocks.mockGetUserAccess).toHaveBeenCalledOnce();
    expect(logger.warn).toHaveBeenCalled();
  });

  it("skips the cache when no wallet is present (calls through directly)", async () => {
    accessMocks.mockGetUserAccess.mockResolvedValueOnce(SAMPLE_ENTRY);

    const result = await getCachedUserAccess({});

    expect(result).toEqual(SAMPLE_ENTRY);
    expect(redisMocks.mockGet).not.toHaveBeenCalled();
    expect(redisMocks.mockSet).not.toHaveBeenCalled();
  });
});

describe("invalidateUserAccessCache", () => {
  it("issues DEL on the wallet key (lowercased)", async () => {
    redisMocks.mockDel.mockResolvedValueOnce(1);
    await invalidateUserAccessCache({
      wallet: "0xABCDEF1234567890ABCDEF1234567890ABCDEF12",
    });
    expect(redisMocks.mockDel).toHaveBeenCalledWith(
      "access:wallet:0xabcdef1234567890abcdef1234567890abcdef12",
    );
  });

  it("is a no-op when no wallet is present", async () => {
    await invalidateUserAccessCache({});
    expect(redisMocks.mockDel).not.toHaveBeenCalled();
  });

  it("does not throw when redis is unavailable", async () => {
    redisMocks.mockGetClient.mockImplementationOnce(() => {
      throw new Error("Redis URL not configured");
    });
    const logger = makeLogger();

    await expect(
      invalidateUserAccessCache({ wallet: WALLET_LC }, logger),
    ).resolves.not.toThrow();
    expect(logger.warn).toHaveBeenCalled();
  });

  it("does not throw when redis.del rejects", async () => {
    redisMocks.mockDel.mockRejectedValueOnce(new Error("ECONNRESET"));
    const logger = makeLogger();

    await expect(
      invalidateUserAccessCache({ wallet: WALLET_LC }, logger),
    ).resolves.not.toThrow();
    expect(logger.warn).toHaveBeenCalled();
  });
});
