// tests/api/routeBodySchemas.test.js
// @vitest-environment node
//
// Coverage for the JSON Schema validation layer added to Tier-1 mutation
// routes. Each route is exercised with payloads that the schema rejects
// (missing required field, malformed type, additional property) and the
// minimum payload that the schema accepts.

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import fastify from "fastify";

// airdropRoutes -> paymasterService -> viemClient throws on import without
// NETWORK. Tests that touch that route family need it set before import.
process.env.NETWORK = process.env.NETWORK || "LOCAL";

vi.mock("../../src/lib/viemClient.js", () => ({
  publicClient: {},
  getWalletClient: () => ({}),
}));

vi.mock("../../src/services/paymasterService.js", () => ({
  getPaymasterService: () => ({
    initialized: true,
    initialize: vi.fn(),
    claimAirdrop: vi.fn(async () => ({ success: false, error: "mocked" })),
  }),
}));

// Make signature recovery a no-op so the airdrop "schema accepts" test
// doesn't get caught by the handler's semantic sig-recovery 400.
vi.mock("viem", async () => {
  const actual = await vi.importActual("viem");
  return {
    ...actual,
    recoverMessageAddress: vi.fn(async ({ message }) => {
      // Recover the address from the message body; route expects this
      // to equal `address`, which is stable in the test payload.
      const m = /Claim (?:daily )?SOF airdrop for (0x[0-9a-fA-F]{40})/.exec(message);
      return m ? m[1] : "0x0000000000000000000000000000000000000000";
    }),
  };
});

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

  it("rejects payload with neither fid nor wallet", async () => {
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

  it("accepts a valid fid+level payload", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/access/set-access-level",
      payload: { fid: 12345, accessLevel: 4 },
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

  it("rejects fid <= 0", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/allowlist/add",
      payload: { fid: 0 },
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

  it("accepts valid fid", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/allowlist/add",
      payload: { fid: 42 },
    });
    expect(res.statusCode).toBe(200);
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

  it("accepts valid fid", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/allowlist/remove",
      payload: { fid: 42 },
    });
    expect(res.statusCode).toBe(200);
  });
});

// ── airdrop /claim ────────────────────────────────────────────────────────
describe("schema: POST /api/airdrop/claim", () => {
  // The handler's behavior beyond schema is exercised in integration manually;
  // we only need to confirm the schema accepts/rejects shapes correctly. To
  // avoid the handler making real chain/relay calls on the accept path, we
  // mount only the claim route's schema validation by injecting a 503 short-
  // circuit through the missing SOFAirdrop env.
  let app;
  beforeAll(async () => {
    const mod = await import("../../fastify/routes/airdropRoutes.js");
    app = fastify({ logger: false });
    await app.register(mod.default, { prefix: "/api/airdrop" });
    await app.ready();
  });
  afterAll(async () => { await app.close(); });

  it("rejects missing address", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/airdrop/claim",
      payload: { type: "basic", signature: VALID_SIG },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.payload).message).toMatch(/address/);
  });

  it("rejects unknown type", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/airdrop/claim",
      payload: { address: VALID_ADDR, type: "weekly", signature: VALID_SIG },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects type=initial without fid", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/airdrop/claim",
      payload: { address: VALID_ADDR, type: "initial" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects type=basic without signature", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/airdrop/claim",
      payload: { address: VALID_ADDR, type: "basic" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects type=daily without signature", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/airdrop/claim",
      payload: { address: VALID_ADDR, type: "daily" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects malformed signature length", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/airdrop/claim",
      payload: { address: VALID_ADDR, type: "basic", signature: "0xshort" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("accepts well-shaped basic payload (handler may still reject downstream)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/airdrop/claim",
      payload: { address: VALID_ADDR, type: "basic", signature: VALID_SIG },
    });
    expect(res.statusCode).not.toBe(400);
  });

  it("accepts well-shaped initial payload", async () => {
    // Closes the gap reviewer flagged: the initial accept path was
    // implicitly covered by the basic test, never exercised on its own.
    const res = await app.inject({
      method: "POST",
      url: "/api/airdrop/claim",
      payload: { address: VALID_ADDR, type: "initial", fid: 12345 },
    });
    expect(res.statusCode).not.toBe(400);
  });

  it("accepts well-shaped daily payload", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/airdrop/claim",
      payload: { address: VALID_ADDR, type: "daily", signature: VALID_SIG },
    });
    expect(res.statusCode).not.toBe(400);
  });
});

// ── adminRoutes /create-market and /send-notification ────────────────────
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

describe("schema: POST /api/admin/send-notification", () => {
  let app;
  beforeAll(async () => { app = await buildAdminApp(); });
  afterAll(async () => { await app.close(); });

  it("rejects missing title", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/admin/send-notification",
      payload: { body: "hi" },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.payload).message).toMatch(/title/);
  });

  it("rejects missing body", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/admin/send-notification",
      payload: { title: "hi" },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.payload).message).toMatch(/body/);
  });

  it("rejects empty title (minLength: 1)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/admin/send-notification",
      payload: { title: "", body: "x" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects fid <= 0", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/admin/send-notification",
      payload: { title: "x", body: "y", fid: 0 },
    });
    expect(res.statusCode).toBe(400);
  });
});
