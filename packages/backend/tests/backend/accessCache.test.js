/**
 * @file accessCache.test.js
 * @description Read-through Redis cache for access lookups. Validates the
 * cache hit/miss paths, write-through behavior, key derivation (fid > wallet),
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

const resolverMocks = vi.hoisted(() => ({
  mockResolvePair: vi.fn(),
}));

const supabaseMocks = vi.hoisted(() => ({
  // Single .maybeSingle() resolver per test — chain builder below.
  mockMaybeSingle: vi.fn(),
  hasSupabase: true,
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

vi.mock("../../shared/services/addressPairResolver.js", () => ({
  resolveAddressPair: (...args) => resolverMocks.mockResolvePair(...args),
}));

// Stub supabase chain — accessCache calls
//   supabase.from("allowlist_entries").select(...).eq(...).limit(1).maybeSingle()
// We only assert behaviour on the final .maybeSingle() return value;
// the intermediate chain just returns itself.
vi.mock("../../shared/supabaseClient.js", () => {
  const chain = {
    select: () => chain,
    eq: () => chain,
    limit: () => chain,
    maybeSingle: (...args) => supabaseMocks.mockMaybeSingle(...args),
  };
  return {
    hasSupabase: true,
    supabase: { from: () => chain },
  };
});

import {
  getCachedUserAccess,
  invalidateUserAccessCache,
  buildAccessCacheKey,
  ACCESS_CACHE_TTL_SECONDS,
} from "../../shared/accessCache.js";

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
  supabaseMocks.mockMaybeSingle.mockReset();
  supabaseMocks.mockMaybeSingle.mockResolvedValue({ data: null, error: null });

  redisMocks.mockGetClient.mockReturnValue({
    get: (...args) => redisMocks.mockGet(...args),
    set: (...args) => redisMocks.mockSet(...args),
    del: (...args) => redisMocks.mockDel(...args),
  });
});

describe("buildAccessCacheKey", () => {
  it("returns null when neither identifier is present", () => {
    expect(buildAccessCacheKey({})).toBeNull();
    expect(buildAccessCacheKey({ fid: undefined, wallet: undefined })).toBeNull();
    expect(buildAccessCacheKey({ fid: "", wallet: "" })).toBeNull();
  });

  it("prefers fid over wallet (stable across wallet rotations)", () => {
    expect(
      buildAccessCacheKey({ fid: 12345, wallet: "0xABCDEF" }),
    ).toBe("access:fid:12345");
  });

  it("falls back to wallet when fid is absent, lowercases the address", () => {
    expect(
      buildAccessCacheKey({ wallet: "0xABCDEF1234567890ABCDEF1234567890ABCDEF12" }),
    ).toBe("access:wallet:0xabcdef1234567890abcdef1234567890abcdef12");
  });

  it("treats numeric 0 fid as present (uncommon but legal)", () => {
    expect(buildAccessCacheKey({ fid: 0 })).toBe("access:fid:0");
  });
});

describe("getCachedUserAccess", () => {
  it("returns the cached value on hit and skips the DB call", async () => {
    redisMocks.mockGet.mockResolvedValueOnce(JSON.stringify(SAMPLE_ENTRY));
    const logger = makeLogger();

    const result = await getCachedUserAccess({ fid: 1 }, logger);

    expect(result).toEqual(SAMPLE_ENTRY);
    expect(accessMocks.mockGetUserAccess).not.toHaveBeenCalled();
    expect(redisMocks.mockGet).toHaveBeenCalledWith("access:fid:1");
  });

  it("on miss, calls through to DB and writes through with the configured TTL", async () => {
    redisMocks.mockGet.mockResolvedValueOnce(null);
    accessMocks.mockGetUserAccess.mockResolvedValueOnce(SAMPLE_ENTRY);
    redisMocks.mockSet.mockResolvedValueOnce("OK");
    const logger = makeLogger();

    const result = await getCachedUserAccess({ fid: 1 }, logger);

    expect(result).toEqual(SAMPLE_ENTRY);
    expect(accessMocks.mockGetUserAccess).toHaveBeenCalledOnce();
    expect(redisMocks.mockSet).toHaveBeenCalledWith(
      "access:fid:1",
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

    const result = await getCachedUserAccess({ fid: 1 }, logger);

    expect(result).toEqual(SAMPLE_ENTRY);
    expect(accessMocks.mockGetUserAccess).toHaveBeenCalledOnce();
    expect(logger.warn).toHaveBeenCalled();
  });

  it("falls through to DB when redis.get rejects (network blip)", async () => {
    redisMocks.mockGet.mockRejectedValueOnce(new Error("ECONNRESET"));
    accessMocks.mockGetUserAccess.mockResolvedValueOnce(SAMPLE_ENTRY);
    const logger = makeLogger();

    const result = await getCachedUserAccess({ fid: 1 }, logger);

    expect(result).toEqual(SAMPLE_ENTRY);
    expect(accessMocks.mockGetUserAccess).toHaveBeenCalledOnce();
    expect(logger.warn).toHaveBeenCalled();
  });

  it("returns DB value (not throws) when redis.set fails after a miss", async () => {
    redisMocks.mockGet.mockResolvedValueOnce(null);
    accessMocks.mockGetUserAccess.mockResolvedValueOnce(SAMPLE_ENTRY);
    redisMocks.mockSet.mockRejectedValueOnce(new Error("write failed"));
    const logger = makeLogger();

    const result = await getCachedUserAccess({ fid: 1 }, logger);

    expect(result).toEqual(SAMPLE_ENTRY);
    expect(logger.warn).toHaveBeenCalled();
  });

  it("refetches from DB when cached value is malformed JSON", async () => {
    redisMocks.mockGet.mockResolvedValueOnce("{not valid json");
    accessMocks.mockGetUserAccess.mockResolvedValueOnce(SAMPLE_ENTRY);
    redisMocks.mockSet.mockResolvedValueOnce("OK");
    const logger = makeLogger();

    const result = await getCachedUserAccess({ fid: 1 }, logger);

    expect(result).toEqual(SAMPLE_ENTRY);
    expect(accessMocks.mockGetUserAccess).toHaveBeenCalledOnce();
    expect(logger.warn).toHaveBeenCalled();
  });

  it("skips the cache when neither identifier present (calls through directly)", async () => {
    accessMocks.mockGetUserAccess.mockResolvedValueOnce(SAMPLE_ENTRY);

    const result = await getCachedUserAccess({});

    expect(result).toEqual(SAMPLE_ENTRY);
    expect(redisMocks.mockGet).not.toHaveBeenCalled();
    expect(redisMocks.mockSet).not.toHaveBeenCalled();
  });

  it("uses the fid key when both fid and wallet are provided", async () => {
    redisMocks.mockGet.mockResolvedValueOnce(JSON.stringify(SAMPLE_ENTRY));

    await getCachedUserAccess({ fid: 99, wallet: "0xCAFE" });

    expect(redisMocks.mockGet).toHaveBeenCalledWith("access:fid:99");
  });
});

describe("invalidateUserAccessCache", () => {
  it("issues DEL on the fid key", async () => {
    redisMocks.mockDel.mockResolvedValueOnce(1);
    await invalidateUserAccessCache({ fid: 42 });
    expect(redisMocks.mockDel).toHaveBeenCalledWith("access:fid:42");
  });

  it("issues DEL on the wallet key (lowercased)", async () => {
    redisMocks.mockDel.mockResolvedValueOnce(1);
    await invalidateUserAccessCache({
      wallet: "0xABCDEF1234567890ABCDEF1234567890ABCDEF12",
    });
    expect(redisMocks.mockDel).toHaveBeenCalledWith(
      "access:wallet:0xabcdef1234567890abcdef1234567890abcdef12",
    );
  });

  it("issues DEL on BOTH keys when both identifiers provided", async () => {
    redisMocks.mockDel.mockResolvedValueOnce(2);
    await invalidateUserAccessCache({ fid: 42, wallet: "0xABCDEF" });
    expect(redisMocks.mockDel).toHaveBeenCalledWith(
      "access:fid:42",
      "access:wallet:0xabcdef",
    );
  });

  it("is a no-op when no identifier present", async () => {
    await invalidateUserAccessCache({});
    expect(redisMocks.mockDel).not.toHaveBeenCalled();
  });

  it("does not throw when redis is unavailable", async () => {
    redisMocks.mockGetClient.mockImplementationOnce(() => {
      throw new Error("Redis URL not configured");
    });
    const logger = makeLogger();

    await expect(
      invalidateUserAccessCache({ fid: 1 }, logger),
    ).resolves.not.toThrow();
    expect(logger.warn).toHaveBeenCalled();
  });

  it("does not throw when redis.del rejects", async () => {
    redisMocks.mockDel.mockRejectedValueOnce(new Error("ECONNRESET"));
    const logger = makeLogger();

    await expect(
      invalidateUserAccessCache({ fid: 1 }, logger),
    ).resolves.not.toThrow();
    expect(logger.warn).toHaveBeenCalled();
  });
});

describe("invalidateUserAccessCache symmetric busting", () => {
  beforeEach(() => {
    resolverMocks.mockResolvePair.mockReset();
  });

  it("invalidates both keys when the queried wallet has a paired wallet", async () => {
    const EOA_LC = "0xaaaa000000000000000000000000000000000001";
    const SMA_LC = "0xbbbb000000000000000000000000000000000002";
    resolverMocks.mockResolvePair.mockResolvedValueOnce({ eoa: EOA_LC, sma: SMA_LC });

    await invalidateUserAccessCache({ wallet: EOA_LC }, makeLogger());

    // Single call deletes both keys.
    expect(redisMocks.mockDel).toHaveBeenCalledTimes(1);
    const args = redisMocks.mockDel.mock.calls[0];
    expect(args).toContain(`access:wallet:${EOA_LC}`);
    expect(args).toContain(`access:wallet:${SMA_LC}`);
  });

  it("invalidates only the queried key when there is no pair", async () => {
    const EOA_LC = "0xaaaa000000000000000000000000000000000003";
    resolverMocks.mockResolvePair.mockResolvedValueOnce(null);

    await invalidateUserAccessCache({ wallet: EOA_LC }, makeLogger());

    expect(redisMocks.mockDel).toHaveBeenCalledTimes(1);
    expect(redisMocks.mockDel).toHaveBeenCalledWith(`access:wallet:${EOA_LC}`);
  });

  it("skips pair resolution entirely when only fid is supplied and the FID has no allowlist row", async () => {
    // Default mock already returns { data: null } — no wallet derivable.
    await invalidateUserAccessCache({ fid: 12345 }, makeLogger());
    expect(resolverMocks.mockResolvePair).not.toHaveBeenCalled();
    expect(redisMocks.mockDel).toHaveBeenCalledWith("access:fid:12345");
  });

  it("does not block invalidation of the queried key when pair resolution returns null", async () => {
    const EOA_LC = "0xaaaa000000000000000000000000000000000004";
    resolverMocks.mockResolvePair.mockResolvedValueOnce(null); // simulates the swallow-and-return-null contract
    await invalidateUserAccessCache({ wallet: EOA_LC }, makeLogger());
    expect(redisMocks.mockDel).toHaveBeenCalledWith(`access:wallet:${EOA_LC}`);
  });
});

describe("invalidateUserAccessCache FID-only wallet busting (Issue #109)", () => {
  beforeEach(() => {
    resolverMocks.mockResolvePair.mockReset();
  });

  it("looks up wallet from allowlist_entries and busts the wallet key when only fid supplied", async () => {
    const FID = 9001;
    const EOA_LC = "0xaaaa000000000000000000000000000000000010";
    supabaseMocks.mockMaybeSingle.mockResolvedValueOnce({
      data: { wallet_address: EOA_LC },
      error: null,
    });
    resolverMocks.mockResolvePair.mockResolvedValueOnce(null);

    await invalidateUserAccessCache({ fid: FID }, makeLogger());

    expect(redisMocks.mockDel).toHaveBeenCalledTimes(1);
    const args = redisMocks.mockDel.mock.calls[0];
    expect(args).toContain(`access:fid:${FID}`);
    expect(args).toContain(`access:wallet:${EOA_LC}`);
  });

  it("also busts the SMA pair key when the derived wallet has one (the Farcaster MiniApp case)", async () => {
    const FID = 9002;
    const EOA_LC = "0xaaaa000000000000000000000000000000000011";
    const SMA_LC = "0xbbbb000000000000000000000000000000000012";
    supabaseMocks.mockMaybeSingle.mockResolvedValueOnce({
      data: { wallet_address: EOA_LC },
      error: null,
    });
    resolverMocks.mockResolvePair.mockResolvedValueOnce({
      eoa: EOA_LC,
      sma: SMA_LC,
    });

    await invalidateUserAccessCache({ fid: FID }, makeLogger());

    expect(redisMocks.mockDel).toHaveBeenCalledTimes(1);
    const args = redisMocks.mockDel.mock.calls[0];
    expect(args).toContain(`access:fid:${FID}`);
    expect(args).toContain(`access:wallet:${EOA_LC}`);
    expect(args).toContain(`access:wallet:${SMA_LC}`);
  });

  it("lowercases the wallet returned by the lookup", async () => {
    const FID = 9003;
    const EOA_MIXED = "0xAaAa000000000000000000000000000000000013";
    const EOA_LC = EOA_MIXED.toLowerCase();
    supabaseMocks.mockMaybeSingle.mockResolvedValueOnce({
      data: { wallet_address: EOA_MIXED },
      error: null,
    });
    resolverMocks.mockResolvePair.mockResolvedValueOnce(null);

    await invalidateUserAccessCache({ fid: FID }, makeLogger());

    const args = redisMocks.mockDel.mock.calls[0];
    expect(args).toContain(`access:wallet:${EOA_LC}`);
    expect(args).not.toContain(`access:wallet:${EOA_MIXED}`);
  });

  it("falls back to fid-only busting when the FID has no allowlist row (best-effort)", async () => {
    supabaseMocks.mockMaybeSingle.mockResolvedValueOnce({
      data: null,
      error: null,
    });
    await invalidateUserAccessCache({ fid: 9004 }, makeLogger());

    expect(resolverMocks.mockResolvePair).not.toHaveBeenCalled();
    expect(redisMocks.mockDel).toHaveBeenCalledWith("access:fid:9004");
  });

  it("falls back to fid-only busting when the Supabase lookup errors (does not throw)", async () => {
    supabaseMocks.mockMaybeSingle.mockResolvedValueOnce({
      data: null,
      error: { code: "PGRST500", message: "boom" },
    });
    const logger = makeLogger();
    await expect(
      invalidateUserAccessCache({ fid: 9005 }, logger),
    ).resolves.not.toThrow();

    expect(redisMocks.mockDel).toHaveBeenCalledWith("access:fid:9005");
    expect(logger.warn).toHaveBeenCalled();
  });

  it("prefers caller-supplied wallet over the FID lookup when both are present", async () => {
    const FID = 9006;
    const SUPPLIED_LC = "0xcccc000000000000000000000000000000000020";
    const DB_WALLET = "0xdddd000000000000000000000000000000000021";
    // The lookup would return DB_WALLET — but the caller-supplied
    // wallet must win because that's the address they just mutated.
    supabaseMocks.mockMaybeSingle.mockResolvedValueOnce({
      data: { wallet_address: DB_WALLET },
      error: null,
    });
    resolverMocks.mockResolvePair.mockResolvedValueOnce(null);

    await invalidateUserAccessCache(
      { fid: FID, wallet: SUPPLIED_LC },
      makeLogger(),
    );

    const args = redisMocks.mockDel.mock.calls[0];
    expect(args).toContain(`access:wallet:${SUPPLIED_LC}`);
    expect(args).not.toContain(`access:wallet:${DB_WALLET}`);
    // And we shouldn't have hit the DB at all when wallet was supplied.
    expect(supabaseMocks.mockMaybeSingle).not.toHaveBeenCalled();
  });
});
