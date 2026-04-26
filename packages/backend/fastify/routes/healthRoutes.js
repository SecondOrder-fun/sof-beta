import process from "node:process";
import { hasSupabase, db } from "../../shared/supabaseClient.js";

/**
 * Health check routes
 *
 * Exposes GET /health (typically mounted under prefix /api → /api/health).
 * - Always returns HTTP 200 so platform healthchecks don't flap.
 * - Body.status is "OK" or "DEGRADED" based on checks.
 */
async function healthRoutes(fastify) {
  fastify.get("/health", async (_request, reply) => {
    const startedAt = Date.now();

    const checks = {
      supabase: { ok: true },
      rpc: { ok: true },
    };

    // Supabase check: simple lightweight query against a small table
    if (hasSupabase) {
      try {
        const { data, error } = await db.client
          .from("season_contracts")
          .select("id")
          .limit(1);

        if (error) {
          checks.supabase.ok = false;
          checks.supabase.error = error.message || String(error);
        } else {
          checks.supabase.rows = Array.isArray(data) ? data.length : 0;
        }
      } catch (err) {
        checks.supabase.ok = false;
        checks.supabase.error =
          err instanceof Error ? err.message : String(err);
      }
    } else {
      checks.supabase.ok = false;
      checks.supabase.error =
        "Supabase not configured (missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY)";
    }

    // RPC check: call eth_blockNumber on configured RPC, if available
    const rpcUrl = process.env.RPC_URL || null;

    if (rpcUrl) {
      try {
        const res = await fetch(rpcUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "eth_blockNumber",
            params: [],
          }),
        });

        if (!res.ok) {
          checks.rpc.ok = false;
          checks.rpc.error = `RPC HTTP ${res.status}`;
        } else {
          const body = await res.json().catch(() => ({}));
          checks.rpc.raw = body?.result;
        }
      } catch (err) {
        checks.rpc.ok = false;
        checks.rpc.error = err instanceof Error ? err.message : String(err);
      }
    } else {
      checks.rpc.ok = false;
      checks.rpc.error =
        "RPC_URL not configured in this environment";
    }

    const overallStatus =
      checks.supabase.ok && checks.rpc.ok ? "OK" : "DEGRADED";

    const payload = {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      checks,
      _meta: {
        responseTimeMs: Date.now() - startedAt,
      },
    };

    return reply.send(payload);
  });
}

export default healthRoutes;
