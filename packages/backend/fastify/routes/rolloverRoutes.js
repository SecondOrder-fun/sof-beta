/**
 * Rollover API routes
 * Prefix: /api/rollover
 *
 * GET /api/rollover/positions?wallet=0x...
 *   Returns all DEPOSIT events for a wallet, representing current rollover positions.
 */

import { db } from "../../shared/supabaseClient.js";

export default async function rolloverRoutes(fastify) {
  /**
   * GET /positions?wallet=0x...
   * Returns rollover deposit history for a wallet address.
   *
   * Query params:
   *   wallet (required) — checksummed or lowercase 0x address
   *
   * Response:
   *   { positions: [{ seasonId, deposited, depositedAt }] }
   */
  fastify.get("/positions", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (request, reply) => {
    const { wallet } = request.query;

    if (!wallet || !/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
      return reply.code(400).send({ error: "Invalid wallet address" });
    }

    const { data, error } = await db.client
      .from("rollover_events")
      .select("season_id, amount, created_at")
      .eq("user_address", wallet.toLowerCase())
      .eq("event_type", "DEPOSIT")
      .order("created_at", { ascending: false });

    if (error) {
      fastify.log.error({ error }, "Error fetching rollover positions");
      return reply.code(500).send({ error: "Internal server error" });
    }

    return reply.send({
      positions: (data || []).map((row) => ({
        seasonId: row.season_id,
        deposited: row.amount,
        depositedAt: row.created_at,
      })),
    });
  });
}
