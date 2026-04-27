// tests/api/cacheInvalidationCallSites.test.js
// @vitest-environment node
//
// Route-level integration tests asserting the 7 mutation routes that flip a
// user's access state actually call invalidateUserAccessCache afterward.
//
// accessCache.test.js covers the cache module in isolation. That suite
// would not have caught the two missing removeFromAllowlist invalidations
// reviewer flagged in PR #55, because the mutation routes themselves
// weren't exercised. This file closes that gap: each route is hit with a
// minimal mocked payload, the underlying mutation is forced to succeed or
// fail, and the spy on `invalidateUserAccessCache` is asserted to fire
// (success path) or not fire (failure path).

import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  vi,
} from "vitest";
import fastify from "fastify";

process.env.NETWORK = process.env.NETWORK || "LOCAL";
process.env.JWT_SECRET =
  process.env.JWT_SECRET || "y".repeat(40); // auth.js reads this at module load
process.env.JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "7d";
// farcasterWebhookRoutes guards `POST /webhook/farcaster` registration on
// NEYNAR_API_KEY presence; set a stub so the route is mounted in tests.
process.env.NEYNAR_API_KEY = process.env.NEYNAR_API_KEY || "test-stub-key";

// ── Spies + service mocks ────────────────────────────────────────────────
const invalidateUserAccessCache = vi.fn(async () => {});
const setUserAccessLevel = vi.fn(async () => ({ success: true, entry: {} }));
const addToAllowlist = vi.fn(async () => ({ success: true, entry: {} }));
const removeFromAllowlist = vi.fn(async () => ({ success: true }));

vi.mock("../../shared/accessCache.js", () => ({
  getCachedUserAccess: vi.fn(async () => ({
    level: 4,
    levelName: "admin",
    groups: [],
    entry: {},
  })),
  invalidateUserAccessCache: (...args) => invalidateUserAccessCache(...args),
}));

vi.mock("../../shared/accessService.js", () => ({
  getUserAccess: vi.fn(async () => ({
    level: 4,
    levelName: "admin",
    groups: [],
    entry: {},
  })),
  checkRouteAccess: vi.fn(async () => ({ hasAccess: true })),
  getRouteConfig: vi.fn(async () => null),
  setUserAccessLevel: (...args) => setUserAccessLevel(...args),
  getDefaultAccessLevel: vi.fn(async () => 0),
  setDefaultAccessLevel: vi.fn(async () => ({ success: true })),
  ACCESS_LEVELS: { PUBLIC: 0, CONNECTED: 1, ALLOWLIST: 2, BETA: 3, ADMIN: 4 },
  ACCESS_LEVEL_NAMES: { 0: "public", 4: "admin" },
}));

vi.mock("../../shared/allowlistService.js", () => ({
  addToAllowlist: (...args) => addToAllowlist(...args),
  removeFromAllowlist: (...args) => removeFromAllowlist(...args),
  // Used by farcasterWebhookRoutes to fetch tokens; trivial mock.
  getNotificationTokenByFidAndKey: vi.fn(async () => null),
  getAllEnabledTokens: vi.fn(async () => []),
}));

vi.mock("../../shared/adminGuard.js", () => ({
  createRequireAdmin: () => async () => {},
}));

// Webhook route uses these for event verification + token persistence.
vi.mock("@farcaster/miniapp-node", () => ({
  parseWebhookEvent: vi.fn(async (body) => body),
  verifyAppKeyWithNeynar: vi.fn(async () => ({ valid: true })),
}));

// Self-referencing chainable mock so callers can do
//   .from(...).delete().eq(...).eq(...) → resolves to {error: null}
// without us pre-shaping each path.
function makeChain(resolved = { data: null, error: null }) {
  const chain = {};
  for (const m of [
    "from",
    "select",
    "insert",
    "upsert",
    "update",
    "delete",
    "eq",
    "limit",
    "order",
  ]) {
    chain[m] = vi.fn(() => chain);
  }
  chain.single = vi.fn(async () => resolved);
  chain.maybeSingle = vi.fn(async () => resolved);
  // Make the chain itself awaitable so trailing chains without .single
  // (e.g. delete().eq().eq()) resolve too.
  chain.then = (resolve) => resolve(resolved);
  return chain;
}

vi.mock("../../shared/supabaseClient.js", () => ({
  hasSupabase: true,
  db: { client: makeChain() },
}));

vi.mock("../../shared/redisClient.js", () => {
  const store = new Map();
  return {
    redisClient: {
      getClient: () => ({
        get: async (k) => store.get(k) ?? null,
        set: async (k, v) => store.set(k, v),
        del: async (k) => store.delete(k),
      }),
    },
  };
});

// authRoutes pulls these in for the SIWF verification path.
vi.mock("../../shared/auth.js", () => ({
  authenticateFastify: vi.fn(async () => {}),
  AuthService: {
    generateToken: vi.fn(async () => "stub-jwt"),
    authenticateRequest: vi.fn(async () => null),
    authenticateFarcaster: vi.fn(async () => ({ fid: 12345 })),
  },
  default: {},
}));

vi.mock("../../shared/fidResolverService.js", () => ({
  resolveFidToWallet: vi.fn(async () => ({
    address: "0x1111111111111111111111111111111111111111",
    username: "alice",
    displayName: "Alice",
    pfpUrl: null,
  })),
}));

vi.mock("../../shared/usernameService.js", () => ({
  usernameService: {
    syncFarcasterUsername: vi.fn(async () => {}),
  },
}));

const VALID_ADDR = "0x1111111111111111111111111111111111111111";

// ── Helpers ─────────────────────────────────────────────────────────────
async function buildApp(routesPath, prefix) {
  const mod = await import(routesPath);
  const app = fastify({ logger: false });
  await app.register(mod.default, { prefix });
  await app.ready();
  return app;
}

beforeEach(() => {
  invalidateUserAccessCache.mockClear();
  setUserAccessLevel.mockReset().mockResolvedValue({ success: true, entry: {} });
  addToAllowlist.mockReset().mockResolvedValue({ success: true, entry: {} });
  removeFromAllowlist.mockReset().mockResolvedValue({ success: true });
});

// ── 1. accessRoutes /set-access-level ────────────────────────────────────
describe("invalidates cache: POST /api/access/set-access-level", () => {
  let app;
  beforeAll(async () => {
    app = await buildApp("../../fastify/routes/accessRoutes.js", "/api/access");
  });
  afterAll(async () => app.close());

  it("invalidates after successful setUserAccessLevel", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/access/set-access-level",
      payload: { wallet: VALID_ADDR, accessLevel: 2 },
    });
    expect(res.statusCode).toBe(200);
    expect(invalidateUserAccessCache).toHaveBeenCalledOnce();
    expect(invalidateUserAccessCache.mock.calls[0][0]).toMatchObject({
      wallet: VALID_ADDR,
    });
  });

  it("does NOT invalidate when setUserAccessLevel fails", async () => {
    setUserAccessLevel.mockResolvedValueOnce({
      success: false,
      error: "permission denied",
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/access/set-access-level",
      payload: { wallet: VALID_ADDR, accessLevel: 2 },
    });
    expect(res.statusCode).toBe(400);
    expect(invalidateUserAccessCache).not.toHaveBeenCalled();
  });
});

// ── 2 + 3. allowlistRoutes /add /remove ──────────────────────────────────
describe("invalidates cache: POST /api/allowlist/add", () => {
  let app;
  beforeAll(async () => {
    app = await buildApp(
      "../../fastify/routes/allowlistRoutes.js",
      "/api/allowlist",
    );
  });
  afterAll(async () => app.close());

  it("invalidates after successful add (wallet)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/allowlist/add",
      payload: { wallet: VALID_ADDR },
    });
    expect(res.statusCode).toBe(200);
    expect(invalidateUserAccessCache).toHaveBeenCalledOnce();
    expect(invalidateUserAccessCache.mock.calls[0][0]).toMatchObject({
      wallet: VALID_ADDR,
    });
  });

  it("invalidates after successful add (fid)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/allowlist/add",
      payload: { fid: 999 },
    });
    expect(res.statusCode).toBe(200);
    expect(invalidateUserAccessCache).toHaveBeenCalledOnce();
    expect(invalidateUserAccessCache.mock.calls[0][0]).toMatchObject({
      fid: 999,
    });
  });

  it("does NOT invalidate when addToAllowlist fails", async () => {
    addToAllowlist.mockResolvedValueOnce({ success: false, error: "duplicate" });
    const res = await app.inject({
      method: "POST",
      url: "/api/allowlist/add",
      payload: { wallet: VALID_ADDR },
    });
    expect(res.statusCode).toBe(400);
    expect(invalidateUserAccessCache).not.toHaveBeenCalled();
  });
});

describe("invalidates cache: POST /api/allowlist/remove", () => {
  let app;
  beforeAll(async () => {
    app = await buildApp(
      "../../fastify/routes/allowlistRoutes.js",
      "/api/allowlist",
    );
  });
  afterAll(async () => app.close());

  it("invalidates after successful remove", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/allowlist/remove",
      payload: { fid: 42 },
    });
    expect(res.statusCode).toBe(200);
    expect(invalidateUserAccessCache).toHaveBeenCalledOnce();
    expect(invalidateUserAccessCache.mock.calls[0][0]).toMatchObject({
      fid: 42,
    });
  });

  it("does NOT invalidate when removeFromAllowlist fails", async () => {
    removeFromAllowlist.mockResolvedValueOnce({
      success: false,
      error: "not found",
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/allowlist/remove",
      payload: { fid: 42 },
    });
    expect(res.statusCode).toBe(400);
    expect(invalidateUserAccessCache).not.toHaveBeenCalled();
  });
});

// ── 4. authRoutes /verify (SIWF path) ────────────────────────────────────
describe("invalidates cache: POST /api/auth/verify (SIWF)", () => {
  let app;
  beforeAll(async () => {
    // Pre-populate the auth nonce in our redis stub so /verify accepts it.
    const { redisClient } = await import("../../shared/redisClient.js");
    await redisClient.getClient().set("auth:nonce:test-nonce-001", "active");
    app = await buildApp("../../fastify/routes/authRoutes.js", "/api/auth");
  });
  afterAll(async () => app.close());

  it("invalidates after successful SIWF addToAllowlist", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/verify",
      payload: {
        method: "farcaster",
        nonce: "test-nonce-001",
        signature: "0x" + "a".repeat(130),
        message: "secondorder.fun wants you to sign in...",
      },
    });
    expect(res.statusCode).toBe(200);
    expect(addToAllowlist).toHaveBeenCalledOnce();
    expect(invalidateUserAccessCache).toHaveBeenCalledOnce();
    expect(invalidateUserAccessCache.mock.calls[0][0]).toMatchObject({
      fid: 12345,
      wallet: VALID_ADDR,
    });
  });
});

// ── 5 + 6. farcasterWebhookRoutes (added + removed) ──────────────────────
describe("invalidates cache: POST /webhook/farcaster", () => {
  let app;
  beforeAll(async () => {
    // server.js mounts this module under /api so the route lands at
    // /api/webhook/farcaster.
    app = await buildApp(
      "../../fastify/routes/farcasterWebhookRoutes.js",
      "/api",
    );
  });
  afterAll(async () => app.close());

  it("invalidates on miniapp_added when allowlist add succeeds", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/webhook/farcaster",
      payload: {
        header: { fid: 7777, key: "0xkey" },
        payload: { event: "miniapp_added", notificationDetails: null },
        signature: "stub",
      },
    });
    expect(res.statusCode).toBe(200);
    expect(invalidateUserAccessCache).toHaveBeenCalledOnce();
    expect(invalidateUserAccessCache.mock.calls[0][0]).toMatchObject({
      fid: 7777,
    });
  });

  it("does NOT invalidate on miniapp_added when allowlist add fails", async () => {
    addToAllowlist.mockResolvedValueOnce({
      success: false,
      error: "time-gate",
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/webhook/farcaster",
      payload: {
        header: { fid: 7778, key: "0xkey" },
        payload: { event: "miniapp_added", notificationDetails: null },
        signature: "stub",
      },
    });
    expect(res.statusCode).toBe(200);
    expect(invalidateUserAccessCache).not.toHaveBeenCalled();
  });

  it("invalidates on miniapp_removed when remove succeeds", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/webhook/farcaster",
      payload: {
        header: { fid: 8888, key: "0xkey" },
        payload: { event: "miniapp_removed" },
        signature: "stub",
      },
    });
    expect(res.statusCode).toBe(200);
    expect(invalidateUserAccessCache).toHaveBeenCalledOnce();
    expect(invalidateUserAccessCache.mock.calls[0][0]).toMatchObject({
      fid: 8888,
    });
  });

  it("does NOT invalidate on miniapp_removed when remove fails", async () => {
    removeFromAllowlist.mockResolvedValueOnce({
      success: false,
      error: "not found",
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/webhook/farcaster",
      payload: {
        header: { fid: 8889, key: "0xkey" },
        payload: { event: "miniapp_removed" },
        signature: "stub",
      },
    });
    expect(res.statusCode).toBe(200);
    expect(invalidateUserAccessCache).not.toHaveBeenCalled();
  });
});
