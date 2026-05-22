/**
 * @file accessCache.test.js
 * @description Read-through Redis cache for access lookups. Validates the
 * cache hit/miss paths, write-through behavior, key derivation (fid > wallet),
 * Redis-failure fallthrough, and explicit invalidation.
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

vi.mock("../../shared/accessService.js", () => ({
  getUserAccess: (...args) => accessMocks.mockGetUserAccess(...args),
}));

vi.mock("../../shared/redisClient.js", () => ({
  redisClient: {
    getClient: (...args) => redisMocks.mockGetClient(...args),
  },
}));

vi.mock("../../shared/services/addressPairResolver.js", () => ({
  resolveAddressPair: (...args) => resolverMocks.mockResolvePair(...args),
}));

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

  it("on miss, calls through to DB and writes through with 60s TTL", async () => {
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
    expect(ACCESS_CACHE_TTL_SECONDS).toBe(60);
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

  it("skips pair resolution entirely when only fid is supplied", async () => {
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
