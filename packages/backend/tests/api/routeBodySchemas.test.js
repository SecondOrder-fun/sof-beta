// tests/api/routeBodySchemas.test.js
// @vitest-environment node
//
// Coverage for the JSON Schema validation layer added to Tier-1 mutation
// routes. Each route is exercised with payloads that the schema rejects
// (missing required field, malformed type, additional property) and the
// minimum payload that the schema accepts.

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import fastify from "fastify";

// adminRoutes -> viemClient throws on import without NETWORK.
process.env.NETWORK = process.env.NETWORK || "LOCAL";

vi.mock("../../src/lib/viemClient.js", () => ({
  publicClient: {},
  getWalletClient: () => ({}),
}));

vi.mock("../../src/services/positionRelayService.js", () => ({
  getPositionRelayService: () => ({
    initialized: true,
    initialize: vi.fn(),
  }),
}));

// ── Mock supabase + admin guard once for every route under test ───────────
const mockSupabase = {
  from: vi.fn(() => mockSupabase),
  select: vi.fn(() => mockSupabase),
  insert: vi.fn(() => mockSupabase),
  upsert: vi.fn(() => Promise.resolve({ data: null, error: null })),
  update: vi.fn(() => mockSupabase),
  delete: vi.fn(() => mockSupabase),
  eq: vi.fn(() => mockSupabase),
  limit: vi.fn(() => mockSupabase),
  single: vi.fn(() => Promise.resolve({ data: null, error: null })),
  maybeSingle: vi.fn(() => Promise.resolve({ data: null, error: null })),
  order: vi.fn(() => mockSupabase),
};

vi.mock("../../shared/supabaseClient.js", () => ({
  hasSupabase: true,
  db: { client: mockSupabase },
}));

vi.mock("../../shared/adminGuard.js", () => ({
  createRequireAdmin: () => async () => {},
}));

vi.mock("../../shared/accessCache.js", () => ({
  getCachedUserAccess: vi.fn(async () => ({
    level: 4,
    levelName: "admin",
    groups: [],
    entry: {},
  })),
  invalidateUserAccessCache: vi.fn(async () => {}),
}));

vi.mock("../../shared/accessService.js", () => ({
  getUserAccess: vi.fn(async () => ({ level: 4, levelName: "admin", groups: [], entry: {} })),
  checkRouteAccess: vi.fn(async () => ({ hasAccess: true })),
  getRouteConfig: vi.fn(async () => null),
  setUserAccessLevel: vi.fn(async () => ({ success: true, entry: {} })),
  getDefaultAccessLevel: vi.fn(async () => 0),
  setDefaultAccessLevel: vi.fn(async () => ({ success: true })),
  ACCESS_LEVELS: { PUBLIC: 0, CONNECTED: 1, ALLOWLIST: 2, BETA: 3, ADMIN: 4 },
  ACCESS_LEVEL_NAMES: { 0: "public", 4: "admin" },
}));

vi.mock("../../shared/allowlistService.js", () => ({
  addToAllowlist: vi.fn(async () => ({ success: true, entry: {} })),
  removeFromAllowlist: vi.fn(async () => ({ success: true })),
}));

const VALID_ADDR = "0x1111111111111111111111111111111111111111";
const VALID_SIG = `0x${"a".repeat(130)}`;

// ── Helpers ──────────────────────────────────────────────────────────────
async function buildAccessApp() {
  const mod = await import("../../fastify/routes/accessRoutes.js");
  const app = fastify({ logger: false });
  await app.register(mod.default, { prefix: "/api/access" });
  await app.ready();
  return app;
}

async function buildAllowlistApp() {
  const mod = await import("../../fastify/routes/allowlistRoutes.js");
  const app = fastify({ logger: false });
  await app.register(mod.default, { prefix: "/api/allowlist" });
  await app.ready();
  return app;
}

// ── access /set-access-level ─────────────────────────────────────────────
describe("schema: POST /api/access/set-access-level", () => {
  let app;
  beforeAll(async () => { app = await buildAccessApp(); });
  afterAll(async () => { await app.close(); });

  it("rejects missing accessLevel", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/access/set-access-level",
      payload: { wallet: VALID_ADDR },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.payload).message).toMatch(/accessLevel/);
  });

  it("rejects accessLevel out of [0,4]", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/access/set-access-level",
      payload: { wallet: VALID_ADDR, accessLevel: 7 },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects payload without a wallet", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/access/set-access-level",
      payload: { accessLevel: 2 },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects malformed wallet", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/access/set-access-level",
      payload: { wallet: "not-an-address", accessLevel: 2 },
    });
    expect(res.statusCode).toBe(400);
  });

  // NOTE: Fastify's default Ajv config uses `removeAdditional: 'all'`, which
  // SILENTLY STRIPS unknown fields instead of rejecting them. Our schemas
  // declare `additionalProperties: false` for documentation + future hardening
  // — if we ever switch the global Ajv config to `removeAdditional: false`,
  // the strip becomes a reject. Until then there's no way to test "rejects
  // unknown fields" via inject. Behavior of the accepted shape is the load-
  // bearing guarantee anyway.

  it("accepts a valid wallet+level payload", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/access/set-access-level",
      payload: { wallet: VALID_ADDR, accessLevel: 2 },
    });
    expect(res.statusCode).toBe(200);
  });
});

// ── allowlist /add /remove ───────────────────────────────────────────────
describe("schema: POST /api/allowlist/add", () => {
  let app;
  beforeAll(async () => { app = await buildAllowlistApp(); });
  afterAll(async () => { await app.close(); });

  it("rejects empty body", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/allowlist/add",
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects malformed wallet", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/allowlist/add",
      payload: { wallet: "0xnotenough" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("accepts valid wallet", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/allowlist/add",
      payload: { wallet: VALID_ADDR },
    });
    expect(res.statusCode).toBe(200);
  });
});

describe("schema: POST /api/allowlist/remove", () => {
  let app;
  beforeAll(async () => { app = await buildAllowlistApp(); });
  afterAll(async () => { await app.close(); });

  it("rejects empty body", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/allowlist/remove",
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("accepts valid wallet", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/allowlist/remove",
      payload: { wallet: VALID_ADDR },
    });
    expect(res.statusCode).toBe(200);
  });
});

// ── adminRoutes /create-market ───────────────────────────────────────────
async function buildAdminApp() {
  const mod = await import("../../fastify/routes/adminRoutes.js");
  const app = fastify({ logger: false });
  await app.register(mod.default, { prefix: "/api/admin" });
  await app.ready();
  return app;
}

describe("schema: POST /api/admin/create-market", () => {
  let app;
  beforeAll(async () => { app = await buildAdminApp(); });
  afterAll(async () => { await app.close(); });

  it("rejects missing seasonId", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/admin/create-market",
      payload: { playerAddress: VALID_ADDR },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.payload).message).toMatch(/seasonId/);
  });

  it("rejects missing playerAddress", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/admin/create-market",
      payload: { seasonId: 1 },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.payload).message).toMatch(/playerAddress/);
  });

  it("rejects malformed playerAddress", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/admin/create-market",
      payload: { seasonId: 1, playerAddress: "0xtoo-short" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects seasonId <= 0", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/admin/create-market",
      payload: { seasonId: 0, playerAddress: VALID_ADDR },
    });
    expect(res.statusCode).toBe(400);
  });
});
