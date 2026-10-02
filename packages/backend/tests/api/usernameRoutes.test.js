// tests/api/usernameRoutes.test.js
// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import fastify from "fastify";

// Mock Redis client before importing routes
const mockGet = vi.fn();
const mockSet = vi.fn();
const mockDel = vi.fn();
const mockMget = vi.fn();
const mockKeys = vi.fn();
const mockExec = vi.fn();

vi.mock("../../shared/redisClient.js", () => ({
  redisClient: {
    getClient: () => ({
      get: mockGet,
      set: mockSet,
      del: mockDel,
      mget: mockMget,
      keys: mockKeys,
      pipeline: () => ({
        set: mockSet,
        del: mockDel,
        exec: mockExec,
      }),
    }),
    connect: vi.fn(),
    disconnect: vi.fn(),
    ping: vi.fn().mockResolvedValue(true),
  },
}));

// Admin check behind createRequireAdmin: level 4 for the admin test wallet.
const ADMIN_WALLET = "0x" + "a".repeat(40);
vi.mock("../../shared/accessCache.js", () => ({
  getCachedUserAccess: vi.fn(async ({ wallet }) => ({
    level: wallet?.toLowerCase() === "0x" + "a".repeat(40) ? 4 : 1,
  })),
}));

// Stands in for the app-wide JWT hook (shared/auth.js): the x-test-wallet
// header plays the role of a verified Bearer token's wallet_address.
const asWallet = (wallet) => ({ "x-test-wallet": wallet });

describe("Username Routes", () => {
  let app;
  let usernameRoutes;

  beforeAll(async () => {
    // Set up default mock behaviors
    mockGet.mockResolvedValue(null);
    mockSet.mockResolvedValue("OK");
    mockExec.mockResolvedValue([["OK"], ["OK"]]);
    mockMget.mockResolvedValue([null, null]);
    mockKeys.mockResolvedValue([]);

    // Import routes after mocks are set up
    usernameRoutes = (await import("../../fastify/routes/usernameRoutes.js"))
      .default;

    app = fastify({ logger: false });
    app.decorateRequest("user", null);
    app.addHook("preHandler", async (request) => {
      const wallet = request.headers["x-test-wallet"];
      if (wallet) request.user = { wallet_address: wallet };
    });
    await app.register(usernameRoutes, { prefix: "/api/usernames" });
    await app.ready();
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  describe("GET /api/usernames/:address", () => {
    it("should return null for non-existent username", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/api/usernames/0x1234567890123456789012345678901234567890",
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.username).toBeNull();
    });

    it("should reject invalid address format", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/api/usernames/invalid-address",
      });

      expect(response.statusCode).toBe(400);
    });

    it("returns the username stored against the address", async () => {
      const address = "0x" + "a".repeat(40);
      mockGet.mockResolvedValueOnce("alice");

      const response = await app.inject({
        method: "GET",
        url: `/api/usernames/${address}`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.username).toBe("alice");
      expect(mockGet).toHaveBeenCalledWith(`wallet:${address}`);
    });
  });

  describe("POST /api/usernames", () => {
    const WALLET = "0x" + "1".repeat(40);
    const post = (payload, headers = asWallet(WALLET)) =>
      app.inject({ method: "POST", url: "/api/usernames", payload, headers });

    it("rejects a request without a signed-in wallet", async () => {
      mockSet.mockClear();
      const response = await post({ address: WALLET, username: "nobody1" }, {});

      expect(response.statusCode).toBe(401);
      expect(JSON.parse(response.body).error).toBe("SIGN_IN_REQUIRED");
      expect(mockSet).not.toHaveBeenCalled();
    });

    it("sets the signed-in wallet's username without a body address", async () => {
      mockGet.mockResolvedValueOnce(null); // username free
      mockGet.mockResolvedValueOnce(null); // wallet has no previous name
      mockExec.mockResolvedValueOnce([["OK"], ["OK"]]);
      mockSet.mockClear();

      const response = await post({ username: "alice1" });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body).toMatchObject({ success: true, address: WALLET, username: "alice1" });
      expect(mockSet).toHaveBeenCalledWith(`wallet:${WALLET}`, "alice1");
      expect(mockSet).toHaveBeenCalledWith("username:alice1", WALLET);
    });

    it("accepts a body address that matches the signed-in wallet in any case", async () => {
      const mixed = "0x" + "AbC1".repeat(10);
      mockGet.mockResolvedValueOnce(null);
      mockGet.mockResolvedValueOnce(null);
      mockExec.mockResolvedValueOnce([["OK"], ["OK"]]);

      const response = await post({ address: mixed.toLowerCase(), username: "bob1" }, asWallet(mixed));

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body).address).toBe(mixed.toLowerCase());
    });

    it("refuses to set another wallet's username", async () => {
      mockSet.mockClear();
      const response = await post({ address: "0x" + "9".repeat(40), username: "squatter" });

      expect(response.statusCode).toBe(403);
      expect(JSON.parse(response.body).error).toBe("NOT_YOUR_WALLET");
      expect(mockSet).not.toHaveBeenCalled();
    });

    it("returns 409 when the name belongs to another wallet", async () => {
      mockGet.mockResolvedValueOnce("0x" + "8".repeat(40)); // username:taken → someone else

      const response = await post({ username: "taken1" });

      expect(response.statusCode).toBe(409);
      expect(JSON.parse(response.body).error).toBe("USERNAME_TAKEN");
    });

    it("should reject username that is too short", async () => {
      const response = await post({ username: "ab" });
      expect(response.statusCode).toBe(400);
    });

    it("should reject username that is too long", async () => {
      const response = await post({ username: "a".repeat(21) });
      expect(response.statusCode).toBe(400);
    });

    it("should reject username with invalid characters", async () => {
      const response = await post({ username: "test@user" });
      expect(response.statusCode).toBe(400);
    });
  });

  describe("GET /api/usernames/all", () => {
    it("requires a signed-in wallet", async () => {
      const response = await app.inject({ method: "GET", url: "/api/usernames/all" });
      expect(response.statusCode).toBe(401);
    });

    it("refuses non-admin wallets", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/api/usernames/all",
        headers: asWallet("0x" + "1".repeat(40)),
      });
      expect(response.statusCode).toBe(403);
    });

    it("lists usernames for an admin", async () => {
      mockKeys.mockResolvedValueOnce([]);
      const response = await app.inject({
        method: "GET",
        url: "/api/usernames/all",
        headers: asWallet(ADMIN_WALLET),
      });
      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body)).toEqual({ count: 0, usernames: [] });
    });
  });

  describe("GET /api/usernames/check/:username", () => {
    it("should return available for new username", async () => {
      // Mock Redis to return null (username not taken)
      mockGet.mockResolvedValueOnce(null);

      const testUsername = "unique" + (Date.now() % 10000); // Keep under 20 chars

      const response = await app.inject({
        method: "GET",
        url: "/api/usernames/check/" + testUsername,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.available).toBe(true);
    });

    it("should return not available for invalid username", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/api/usernames/check/ab",
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.available).toBe(false);
    });
  });

  describe("GET /api/usernames/batch", () => {
    it("should return usernames for multiple addresses", async () => {
      const addr1 = "0x" + "5".repeat(40);
      const addr2 = "0x" + "6".repeat(40);

      const response = await app.inject({
        method: "GET",
        url: `/api/usernames/batch?addresses=${addr1},${addr2}`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body).toHaveProperty(addr1.toLowerCase());
      expect(body).toHaveProperty(addr2.toLowerCase());
    });

    it("should reject invalid addresses in batch", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/api/usernames/batch?addresses=invalid,0x" + "7".repeat(40),
      });

      expect(response.statusCode).toBe(400);
    });
  });
});
