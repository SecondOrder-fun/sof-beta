import { describe, it, expect, vi, beforeEach } from "vitest";

// Each test resets modules so the redisAvailable module-level state in
// redisCache.js starts fresh. The redisClient mock is rebound per-test
// via vi.doMock so individual tests can control whether getClient throws
// or returns a fake ioredis client.

describe("redisCache", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  /**
   * Mount the helper with a fake ioredis client. The fake records every
   * call and exposes vi.fn handles so tests can drive return values.
   */
  async function mount({ getClientThrows = false, fakeClient } = {}) {
    const defaultGet = vi.fn().mockResolvedValue(null);
    const defaultSet = vi.fn().mockResolvedValue("OK");
    const defaultDel = vi.fn().mockResolvedValue(0);
    const defaultUnlink = vi.fn().mockResolvedValue(0);
    const defaultScanStream = vi.fn(() => {
      // Empty async iterable.
      return (async function* () {})();
    });

    const client = fakeClient ?? {
      get: defaultGet,
      set: defaultSet,
      del: defaultDel,
      unlink: defaultUnlink,
      scanStream: defaultScanStream,
    };

    const getClient = vi.fn(() => {
      if (getClientThrows) {
        throw new Error("Redis URL not configured");
      }
      return client;
    });

    vi.doMock("../../shared/redisClient.js", () => ({
      redisClient: { getClient },
    }));

    const mod = await import("../../shared/redisCache.js");
    return { mod, client, getClient };
  }

  function makeLogger() {
    return { warn: vi.fn(), error: vi.fn() };
  }

  describe("cacheRead", () => {
    it("returns the cached value when present and parseable", async () => {
      const { mod, client } = await mount();
      client.get.mockResolvedValueOnce(JSON.stringify({ a: 1 }));
      const loader = vi.fn();

      const result = await mod.cacheRead("k", loader, { ttlSeconds: 60 });

      expect(result).toEqual({ a: 1 });
      expect(loader).not.toHaveBeenCalled();
      expect(client.set).not.toHaveBeenCalled();
    });

    it("calls the loader on cache miss and writes through with the TTL", async () => {
      const { mod, client } = await mount();
      client.get.mockResolvedValueOnce(null);
      const loader = vi.fn().mockResolvedValue({ from: "db" });

      const result = await mod.cacheRead("miss-key", loader, {
        ttlSeconds: 30,
      });

      expect(result).toEqual({ from: "db" });
      expect(loader).toHaveBeenCalledOnce();
      expect(client.set).toHaveBeenCalledWith(
        "miss-key",
        JSON.stringify({ from: "db" }),
        "EX",
        30,
      );
    });

    it("falls through to loader without writing when Redis is unavailable", async () => {
      const { mod } = await mount({ getClientThrows: true });
      const logger = makeLogger();
      const loader = vi.fn().mockResolvedValue("origin");

      const result = await mod.cacheRead("k", loader, {
        ttlSeconds: 60,
        logger,
      });

      expect(result).toBe("origin");
      expect(loader).toHaveBeenCalledOnce();
      // First call warns once...
      expect(logger.warn).toHaveBeenCalledTimes(1);

      // ... subsequent calls in the same process do NOT re-warn (state
      // is cached at module scope, so the noise budget is one-shot).
      const result2 = await mod.cacheRead("k2", loader, {
        ttlSeconds: 60,
        logger,
      });
      expect(result2).toBe("origin");
      expect(logger.warn).toHaveBeenCalledTimes(1);
    });

    it("falls through to loader on malformed JSON and writes a fresh value", async () => {
      const { mod, client } = await mount();
      client.get.mockResolvedValueOnce("{not valid json");
      const logger = makeLogger();
      const loader = vi.fn().mockResolvedValue({ ok: true });

      const result = await mod.cacheRead("k", loader, {
        ttlSeconds: 60,
        logger,
      });

      expect(result).toEqual({ ok: true });
      expect(loader).toHaveBeenCalledOnce();
      expect(client.set).toHaveBeenCalledOnce();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ key: "k" }),
        expect.stringContaining("malformed JSON"),
      );
    });

    it("skips the SET when ttlSeconds is 0 or negative", async () => {
      const { mod, client } = await mount();
      client.get.mockResolvedValueOnce(null);
      const loader = vi.fn().mockResolvedValue({ x: 1 });

      const result = await mod.cacheRead("k", loader, { ttlSeconds: 0 });
      expect(result).toEqual({ x: 1 });
      expect(loader).toHaveBeenCalledOnce();
      expect(client.set).not.toHaveBeenCalled();

      client.get.mockResolvedValueOnce(null);
      await mod.cacheRead("k2", loader, { ttlSeconds: -5 });
      expect(client.set).not.toHaveBeenCalled();
    });

    it("skips the SET when the loader returns undefined", async () => {
      const { mod, client } = await mount();
      client.get.mockResolvedValueOnce(null);
      const loader = vi.fn().mockResolvedValue(undefined);

      const result = await mod.cacheRead("k", loader, { ttlSeconds: 60 });
      expect(result).toBeUndefined();
      expect(client.set).not.toHaveBeenCalled();
    });

    it("returns the loader value even when the SET write fails", async () => {
      const { mod, client } = await mount();
      client.get.mockResolvedValueOnce(null);
      client.set.mockRejectedValueOnce(new Error("Redis OOM"));
      const logger = makeLogger();
      const loader = vi.fn().mockResolvedValue("origin");

      const result = await mod.cacheRead("k", loader, {
        ttlSeconds: 60,
        logger,
      });

      expect(result).toBe("origin");
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ key: "k" }),
        expect.stringContaining("write failed"),
      );
    });

    it("falls through to loader when a cache READ fails", async () => {
      const { mod, client } = await mount();
      client.get.mockRejectedValueOnce(new Error("Redis disconnected"));
      const logger = makeLogger();
      const loader = vi.fn().mockResolvedValue("origin");

      const result = await mod.cacheRead("k", loader, {
        ttlSeconds: 60,
        logger,
      });

      expect(result).toBe("origin");
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ key: "k" }),
        expect.stringContaining("read failed"),
      );
    });
  });

  describe("cacheInvalidate", () => {
    it("deletes a single key", async () => {
      const { mod, client } = await mount();
      await mod.cacheInvalidate("k1");
      expect(client.del).toHaveBeenCalledWith("k1");
    });

    it("deletes multiple keys", async () => {
      const { mod, client } = await mount();
      await mod.cacheInvalidate(["k1", "k2", "k3"]);
      expect(client.del).toHaveBeenCalledWith("k1", "k2", "k3");
    });

    it("is a no-op on an empty array", async () => {
      const { mod, client } = await mount();
      await mod.cacheInvalidate([]);
      expect(client.del).not.toHaveBeenCalled();
    });

    it("swallows DEL errors", async () => {
      const { mod, client } = await mount();
      client.del.mockRejectedValueOnce(new Error("Redis disconnected"));
      const logger = makeLogger();
      await expect(mod.cacheInvalidate("k1", logger)).resolves.toBeUndefined();
      expect(logger.warn).toHaveBeenCalled();
    });
  });

  describe("cacheInvalidatePattern", () => {
    it("refuses empty patterns", async () => {
      const { mod, client } = await mount();
      const logger = makeLogger();

      await mod.cacheInvalidatePattern("", logger);
      await mod.cacheInvalidatePattern(null, logger);
      await mod.cacheInvalidatePattern(undefined, logger);

      expect(client.scanStream).not.toHaveBeenCalled();
      expect(client.unlink).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledTimes(3);
    });

    it("scans and unlinks matching keys in batches", async () => {
      const { mod, client } = await mount();
      // Two batches arrive then the stream ends.
      client.scanStream.mockImplementationOnce(() =>
        (async function* () {
          yield ["markets:1", "markets:2"];
          yield ["markets:3"];
        })(),
      );

      await mod.cacheInvalidatePattern("markets:*");

      expect(client.scanStream).toHaveBeenCalledWith({
        match: "markets:*",
        count: 100,
      });
      expect(client.unlink).toHaveBeenNthCalledWith(1, "markets:1", "markets:2");
      expect(client.unlink).toHaveBeenNthCalledWith(2, "markets:3");
    });

    it("skips empty batches without calling unlink", async () => {
      const { mod, client } = await mount();
      client.scanStream.mockImplementationOnce(() =>
        (async function* () {
          yield [];
        })(),
      );

      await mod.cacheInvalidatePattern("markets:*");
      expect(client.unlink).not.toHaveBeenCalled();
    });

    it("logs a warning when a batch unlink fails but continues processing", async () => {
      const { mod, client } = await mount();
      client.scanStream.mockImplementationOnce(() =>
        (async function* () {
          yield ["k1"];
          yield ["k2"];
        })(),
      );
      client.unlink.mockRejectedValueOnce(new Error("Redis stalled"));
      client.unlink.mockResolvedValueOnce(0);
      const logger = makeLogger();

      await mod.cacheInvalidatePattern("k*", logger);

      expect(client.unlink).toHaveBeenCalledTimes(2);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ batchSize: 1 }),
        expect.stringContaining("batch unlink failed"),
      );
    });
  });
});
