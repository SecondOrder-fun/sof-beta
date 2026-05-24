// tests/backend/healthRoutes.test.js
// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";

// Supabase + RPC checks are exercised in other tests; here we only care
// about the mountFailures surface (Issue #102). Stub Supabase out so
// the health check doesn't attempt a real query.
vi.mock("../../shared/supabaseClient.js", () => ({
  hasSupabase: false,
  db: { client: null },
}));

// Real registry — we want the route to read from the actual module.
import {
  recordMount,
  _resetMountStatus,
} from "../../shared/mountStatus.js";
import healthRoutes from "../../fastify/routes/healthRoutes.js";

describe("healthRoutes /api/health", () => {
  let app;

  beforeEach(async () => {
    _resetMountStatus();
    // Avoid a real RPC call — the env-driven branch returns
    // ok=false with a stable error string when RPC_URL is unset.
    delete process.env.RPC_URL;

    app = Fastify({ logger: false });
    await app.register(healthRoutes, { prefix: "/api" });
  });

  it("returns mountFailures=[] and checks.mounts.ok=true when no failures recorded", async () => {
    recordMount("/api/auth", { ok: true, critical: true });
    recordMount("/api/admin", { ok: true });

    const res = await app.inject({ method: "GET", url: "/api/health" });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);

    expect(body.mountFailures).toEqual([]);
    expect(body.checks.mounts).toEqual({ ok: true });
  });

  it("includes mount failures in the response and flips status to DEGRADED", async () => {
    recordMount("/api/admin", {
      ok: false,
      critical: false,
      error: "diagnostic module crash",
    });

    const res = await app.inject({ method: "GET", url: "/api/health" });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);

    expect(body.status).toBe("DEGRADED");
    expect(body.checks.mounts.ok).toBe(false);
    expect(body.mountFailures).toHaveLength(1);
    expect(body.mountFailures[0]).toMatchObject({
      prefix: "/api/admin",
      critical: false,
      error: "diagnostic module crash",
    });
  });

  it("preserves the critical flag in failure entries so monitoring can prioritise", async () => {
    recordMount("/api/paymaster/sof", {
      ok: false,
      critical: true,
      error: "RPC_URL unset",
    });
    recordMount("/api/admin", { ok: false, error: "minor" });

    const res = await app.inject({ method: "GET", url: "/api/health" });
    const body = JSON.parse(res.body);

    const criticals = body.mountFailures.filter((f) => f.critical);
    expect(criticals).toHaveLength(1);
    expect(criticals[0].prefix).toBe("/api/paymaster/sof");
  });
});
