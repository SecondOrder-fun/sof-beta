import { db } from "../../shared/supabaseClient.js";
import { createRequireAdmin } from "../../shared/adminGuard.js";

const MAX_SIGNATURES = 200;

export default async function gatingRoutes(fastify) {
  const requireAdmin = createRequireAdmin();

  // Bulk upload signed allowlist entries (admin only)
  fastify.post("/signatures/:seasonId", { preHandler: [requireAdmin] }, async (request, reply) => {
    const { seasonId } = request.params;
    const { signatures } = request.body;

    if (!Array.isArray(signatures) || signatures.length === 0) {
      return reply.status(400).send({ error: "signatures array required" });
    }
    if (signatures.length > MAX_SIGNATURES) {
      return reply.status(400).send({
        error: `Maximum ${MAX_SIGNATURES} signatures per batch`,
      });
    }

    try {
      for (const sig of signatures) {
        const row = {
          season_id: Number(seasonId),
          participant_address: sig.address.toLowerCase(),
          deadline: sig.deadline,
          signature: sig.signature,
          gate_index: sig.gateIndex || 0,
        };

        const { error } = await db.client
          .from("gating_signatures")
          .upsert(row, {
            onConflict: "season_id,participant_address,gate_index",
          });

        if (error) throw error;
      }

      return { success: true, count: signatures.length };
    } catch (error) {
      fastify.log.error(error, "Failed to store gating signatures");
      return reply.status(500).send({ error: error.message });
    }
  });

  // Fetch individual signature for a user
  fastify.get("/signature/:seasonId/:address", async (request, reply) => {
    const { seasonId, address } = request.params;

    try {
      const { data, error } = await db.client
        .from("gating_signatures")
        .select("signature, deadline, gate_index")
        .eq("season_id", Number(seasonId))
        .eq("participant_address", address.toLowerCase())
        .limit(1)
        .maybeSingle();

      if (error && error.code !== "PGRST116") {
        throw error;
      }

      if (!data) {
        return reply.status(404).send({ error: "Not on allowlist" });
      }

      return {
        signature: data.signature,
        deadline: data.deadline,
        gateIndex: data.gate_index,
      };
    } catch (error) {
      fastify.log.error(error, "Failed to fetch gating signature");
      return reply.status(500).send({ error: error.message });
    }
  });
}
