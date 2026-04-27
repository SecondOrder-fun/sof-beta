// tests/api/gatingRoutes.test.js
// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import fastify from "fastify";

// Build a chainable mock that mimics supabase-js query builder
function createChainMock(resolvedValue = { data: null, error: null }) {
  const chain = {
    from: vi.fn(() => chain),
    select: vi.fn(() => chain),
    insert: vi.fn(() => chain),
    upsert: vi.fn(() => chain),
    update: vi.fn(() => chain),
    delete: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    limit: vi.fn(() => chain),
    single: vi.fn(() => resolvedValue),
    maybeSingle: vi.fn(() => resolvedValue),
    order: vi.fn(() => chain),
  };
  return chain;
}

let mockClient = createChainMock();

vi.mock("../../shared/supabaseClient.js", () => ({
  hasSupabase: true,
  db: {
    get client() {
      return mockClient;
    },
  },
}));

// Admin guard is exercised in adminGuard tests; mock as pass-through here.
vi.mock("../../shared/adminGuard.js", () => ({
  createRequireAdmin: () => async () => {},
}));

import gatingRoutes from "../../fastify/routes/gatingRoutes.js";

describe("Gating Routes", () => {
  let app;

  beforeAll(async () => {
    app = fastify({ logger: false });
    await app.register(gatingRoutes, { prefix: "/api/gating" });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset to a successful mock by default
    mockClient = createChainMock({ data: null, error: null });
  });

  describe("POST /api/gating/signatures/:seasonId", () => {
    // Real-shape fixtures so the JSON Schema validator (40-hex address,
    // 130-hex signature) accepts them. The actual values are dummy.
    const ADDR_A = "0x1111111111111111111111111111111111111111";
    const ADDR_A_LOWER = ADDR_A.toLowerCase();
    const ADDR_B = "0x2222222222222222222222222222222222222222";
    const SIG_A = `0x${"a".repeat(130)}`;
    const SIG_B = `0x${"b".repeat(130)}`;

    it("should store batch of signatures", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/gating/signatures/1",
        payload: {
          signatures: [
            { address: ADDR_A, deadline: 1712345600, signature: SIG_A },
            { address: ADDR_B, deadline: 1712345600, signature: SIG_B },
          ],
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.success).toBe(true);
      expect(body.count).toBe(2);
      // upsert should have been called twice (once per signature)
      expect(mockClient.upsert).toHaveBeenCalledTimes(2);
    });

    it("should lowercase addresses before storing", async () => {
      // Mixed-case address — schema accepts hex either way, handler lowercases.
      const mixed = "0xAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAa";
      await app.inject({
        method: "POST",
        url: "/api/gating/signatures/1",
        payload: {
          signatures: [
            { address: mixed, deadline: 1712345600, signature: SIG_A },
          ],
        },
      });

      expect(mockClient.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ participant_address: mixed.toLowerCase() }),
        expect.any(Object),
      );
    });

    it("should reject empty signatures array", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/gating/signatures/1",
        payload: { signatures: [] },
      });

      expect(res.statusCode).toBe(400);
    });

    it("should reject missing signatures key", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/gating/signatures/1",
        payload: {},
      });

      // Fastify JSON Schema 400 — `body must have required property 'signatures'`
      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.payload);
      expect(body.message).toMatch(/signatures/);
    });

    it("should reject more than 200 signatures", async () => {
      const sigs = Array.from({ length: 201 }, (_, i) => ({
        address: `0x${i.toString(16).padStart(40, "0")}`,
        deadline: 1712345600,
        signature: SIG_A,
      }));

      const res = await app.inject({
        method: "POST",
        url: "/api/gating/signatures/1",
        payload: { signatures: sigs },
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.payload);
      // Schema says `maxItems: 200` — Fastify error mentions the constraint.
      expect(body.message).toMatch(/200|fewer|maxItems/i);
    });

    it("should return 500 when upsert fails", async () => {
      mockClient = createChainMock({ data: null, error: { message: "DB error" } });
      // Make upsert return an error
      mockClient.upsert = vi.fn(() => ({
        data: null,
        error: { message: "DB error" },
      }));

      const res = await app.inject({
        method: "POST",
        url: "/api/gating/signatures/1",
        payload: {
          signatures: [
            { address: ADDR_A_LOWER, deadline: 1712345600, signature: SIG_A },
          ],
        },
      });

      expect(res.statusCode).toBe(500);
    });
  });

  describe("GET /api/gating/signature/:seasonId/:address", () => {
    it("should return signature for allowlisted address", async () => {
      mockClient = createChainMock({
        data: { signature: "0xabc", deadline: 1712345600, gate_index: 0 },
        error: null,
      });

      const res = await app.inject({
        method: "GET",
        url: "/api/gating/signature/1/0xABC123",
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.signature).toBe("0xabc");
      expect(body.deadline).toBe(1712345600);
      expect(body.gateIndex).toBe(0);
    });

    it("should lowercase the address for lookup", async () => {
      mockClient = createChainMock({ data: null, error: null });

      await app.inject({
        method: "GET",
        url: "/api/gating/signature/1/0xABC123",
      });

      // The second .eq() call should use the lowercased address
      const eqCalls = mockClient.eq.mock.calls;
      const addressCall = eqCalls.find(
        (call) => call[0] === "participant_address",
      );
      expect(addressCall[1]).toBe("0xabc123");
    });

    it("should return 404 for non-allowlisted address", async () => {
      mockClient = createChainMock({ data: null, error: null });

      const res = await app.inject({
        method: "GET",
        url: "/api/gating/signature/1/0xNOTFOUND",
      });

      expect(res.statusCode).toBe(404);
    });

    it("should return 500 on database error", async () => {
      mockClient = createChainMock({
        data: null,
        error: { message: "Connection failed", code: "FATAL" },
      });

      const res = await app.inject({
        method: "GET",
        url: "/api/gating/signature/1/0xABC",
      });

      expect(res.statusCode).toBe(500);
    });
  });
});
