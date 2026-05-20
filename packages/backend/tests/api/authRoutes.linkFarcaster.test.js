// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import fastify from "fastify";
import jwt from "jsonwebtoken";

process.env.JWT_SECRET = "test-secret";
process.env.JWT_EXPIRES_IN = "1h";
process.env.SIWF_ALLOWED_DOMAINS = "example.com";

// Mocks (must be hoisted via vi.mock before route import)
const mockRedisGet = vi.fn();
const mockRedisDel = vi.fn();
const mockRedisSet = vi.fn();

vi.mock("../../shared/redisClient.js", () => ({
  redisClient: {
    getClient: () => ({
      get: mockRedisGet,
      del: mockRedisDel,
      set: mockRedisSet,
    }),
  },
}));

const mockGetLinkedFidForWallet = vi.fn();
const mockLinkFarcasterToWallet = vi.fn();
const mockUnlinkFarcasterFromWallet = vi.fn();

vi.mock("../../shared/farcasterLinkService.js", () => ({
  getLinkedFidForWallet: (...a) => mockGetLinkedFidForWallet(...a),
  linkFarcasterToWallet: (...a) => mockLinkFarcasterToWallet(...a),
  unlinkFarcasterFromWallet: (...a) => mockUnlinkFarcasterFromWallet(...a),
}));

const mockVerifyMessage = vi.fn();
vi.mock("viem", async () => {
  const actual = await vi.importActual("viem");
  return {
    ...actual,
    verifyMessage: (...a) => mockVerifyMessage(...a),
  };
});

const mockAuthenticateFarcaster = vi.fn();
vi.mock("../../shared/auth.js", async () => {
  const actual = await vi.importActual("../../shared/auth.js");
  return {
    ...actual,
    AuthService: {
      verifyToken: actual.AuthService.verifyToken.bind(actual.AuthService),
      generateToken: actual.AuthService.generateToken.bind(actual.AuthService),
      authenticateRequest: actual.AuthService.authenticateRequest.bind(actual.AuthService),
      authenticateFarcaster: (...a) => mockAuthenticateFarcaster(...a),
    },
  };
});

const mockResolveFidToWallet = vi.fn();
vi.mock("../../shared/fidResolverService.js", () => ({
  resolveFidToWallet: (...a) => mockResolveFidToWallet(...a),
}));

vi.mock("../../shared/accessService.js", () => ({
  getUserAccess: vi.fn().mockResolvedValue({ entry: { id: 1 }, level: 1 }),
  ACCESS_LEVEL_NAMES: { 1: "user" },
}));

vi.mock("../../shared/allowlistService.js", () => ({
  addToAllowlist: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock("../../shared/accessCache.js", () => ({
  invalidateUserAccessCache: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../shared/usernameService.js", () => ({
  usernameService: {
    syncFarcasterUsername: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("../../shared/services/smartAccountService.js", () => ({
  ensureSmartAccount: vi.fn().mockResolvedValue({ sma: "0xsma" }),
}));

vi.mock("../../shared/services/smartAccountsDb.js", () => ({
  smartAccountsDb: {},
}));

vi.mock("../../shared/services/adminEoaService.js", () => ({
  ensureAdminFlag: vi.fn().mockResolvedValue(false),
}));

vi.mock("../../shared/services/airdropService.js", () => ({
  getAirdropService: vi.fn().mockReturnValue(null),
}));

vi.mock("../../src/lib/viemClient.js", () => ({
  publicClient: {},
}));

let app;

beforeAll(async () => {
  const authRoutes = (await import("../../fastify/routes/authRoutes.js")).default;
  app = fastify({ logger: false });
  await app.register(authRoutes, { prefix: "/api/auth" });
  await app.ready();
});

afterAll(async () => {
  if (app) await app.close();
});

beforeEach(() => {
  mockRedisGet.mockReset();
  mockRedisDel.mockReset();
  mockRedisSet.mockReset();
  mockGetLinkedFidForWallet.mockReset();
  mockLinkFarcasterToWallet.mockReset();
  mockUnlinkFarcasterFromWallet.mockReset();
  mockAuthenticateFarcaster.mockReset();
  mockResolveFidToWallet.mockReset();
  mockVerifyMessage.mockReset();
});

const makeJwt = (claims) =>
  jwt.sign(claims, "test-secret", { expiresIn: "1h" });

describe("POST /api/auth/link-farcaster", () => {
  it("returns 401 when no bearer is provided", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/link-farcaster",
      payload: { message: "m", signature: "s", nonce: "n" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 401 when bearer is expired", async () => {
    const expired = jwt.sign({ wallet_address: "0xabc" }, "test-secret", {
      expiresIn: -10,
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/link-farcaster",
      headers: { authorization: `Bearer ${expired}` },
      payload: { message: "m", signature: "s", nonce: "n" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 401 when nonce is missing from Redis", async () => {
    mockRedisGet.mockResolvedValue(null);
    const token = makeJwt({ wallet_address: "0xabc" });
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/link-farcaster",
      headers: { authorization: `Bearer ${token}` },
      payload: { message: "m", signature: "s", nonce: "n" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 400 when SIWF verification fails", async () => {
    mockRedisGet.mockResolvedValue("1");
    mockAuthenticateFarcaster.mockRejectedValue(new Error("bad sig"));
    const token = makeJwt({ wallet_address: "0xabc" });
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/link-farcaster",
      headers: { authorization: `Bearer ${token}` },
      payload: { message: "m", signature: "s", nonce: "n" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 200 with refreshed JWT on success", async () => {
    mockRedisGet.mockResolvedValue("1");
    mockAuthenticateFarcaster.mockResolvedValue({ fid: 42 });
    mockResolveFidToWallet.mockResolvedValue({
      address: "0xirrelevant",
      username: "alice",
      displayName: "Alice",
      pfpUrl: null,
    });
    mockLinkFarcasterToWallet.mockResolvedValue({
      success: true,
      entry: { id: 1, fid: 42, wallet_address: "0xabc" },
    });
    const token = makeJwt({ wallet_address: "0xabc" });

    const res = await app.inject({
      method: "POST",
      url: "/api/auth/link-farcaster",
      headers: { authorization: `Bearer ${token}` },
      payload: { message: "m", signature: "s", nonce: "n" },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.user.fid).toBe(42);
    expect(body.user.username).toBe("alice");
    expect(body.user.address).toBe("0xabc"); // unchanged from JWT
    const decoded = jwt.decode(body.token);
    expect(decoded.wallet_address).toBe("0xabc");
    expect(decoded.fid).toBe(42);
    expect(decoded.username).toBe("alice");
    expect(body.user.accessLevel).toBe(1);
    expect(body.user.role).toBe("user");
    expect(mockLinkFarcasterToWallet).toHaveBeenCalledWith(
      expect.objectContaining({
        walletAddress: "0xabc",
        fid: 42,
        username: "alice",
        displayName: "Alice",
      }),
    );
  });

  it("returns 500 when DB link write fails", async () => {
    mockRedisGet.mockResolvedValue("1");
    mockAuthenticateFarcaster.mockResolvedValue({ fid: 42 });
    mockResolveFidToWallet.mockResolvedValue({
      address: "0xirrelevant",
      username: "alice",
      displayName: "Alice",
      pfpUrl: null,
    });
    mockLinkFarcasterToWallet.mockResolvedValue({
      success: false,
      error: "constraint violation",
    });
    const token = makeJwt({ wallet_address: "0xabc" });

    const res = await app.inject({
      method: "POST",
      url: "/api/auth/link-farcaster",
      headers: { authorization: `Bearer ${token}` },
      payload: { message: "m", signature: "s", nonce: "n" },
    });

    expect(res.statusCode).toBe(500);
    const body = JSON.parse(res.body);
    expect(body.error).toBe("constraint violation");
  });

  it("succeeds with fid only when Neynar resolution fails", async () => {
    mockRedisGet.mockResolvedValue("1");
    mockAuthenticateFarcaster.mockResolvedValue({ fid: 42 });
    mockResolveFidToWallet.mockRejectedValue(new Error("neynar down"));
    mockLinkFarcasterToWallet.mockResolvedValue({
      success: true,
      entry: { id: 1, fid: 42, wallet_address: "0xabc" },
    });
    const token = makeJwt({ wallet_address: "0xabc" });

    const res = await app.inject({
      method: "POST",
      url: "/api/auth/link-farcaster",
      headers: { authorization: `Bearer ${token}` },
      payload: { message: "m", signature: "s", nonce: "n" },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.user.fid).toBe(42);
    expect(body.user.username).toBeNull();
  });
});

describe("POST /api/auth/unlink-farcaster", () => {
  it("returns 401 without bearer", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/unlink-farcaster",
      payload: {},
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 200 with FID-stripped JWT when linked", async () => {
    mockUnlinkFarcasterFromWallet.mockResolvedValue({ success: true });
    const token = makeJwt({ wallet_address: "0xabc", fid: 42, username: "alice" });

    const res = await app.inject({
      method: "POST",
      url: "/api/auth/unlink-farcaster",
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.user.fid).toBeNull();
    expect(body.user.username).toBeNull();
    expect(body.user.accessLevel).toBe(1);
    expect(body.user.role).toBe("user");
    const decoded = jwt.decode(body.token);
    expect(decoded.wallet_address).toBe("0xabc");
    expect(decoded.fid).toBeUndefined();
    expect(decoded.username).toBeUndefined();
  });

  it("returns 200 idempotently when nothing was linked", async () => {
    mockUnlinkFarcasterFromWallet.mockResolvedValue({ success: true, noop: true });
    const token = makeJwt({ wallet_address: "0xabc" });

    const res = await app.inject({
      method: "POST",
      url: "/api/auth/unlink-farcaster",
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    });

    expect(res.statusCode).toBe(200);
  });
});

describe("POST /api/auth/verify wallet path embeds pre-linked FID", () => {
  it("embeds fid/username from getLinkedFidForWallet into JWT and user", async () => {
    mockRedisGet.mockResolvedValue("1");
    mockVerifyMessage.mockResolvedValue(true);
    mockGetLinkedFidForWallet.mockResolvedValue({
      fid: 42,
      username: "alice",
      displayName: "Alice",
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/auth/verify",
      payload: {
        method: "wallet",
        address: "0xabc0000000000000000000000000000000000abc",
        signature: "0xdeadbeef",
        nonce: "abc123",
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.user.fid).toBe(42);
    expect(body.user.username).toBe("alice");
    const decoded = jwt.decode(body.token);
    expect(decoded.fid).toBe(42);
    expect(decoded.username).toBe("alice");
  });
});
