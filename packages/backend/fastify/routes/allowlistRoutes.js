/**
 * Allowlist API Routes
 * Admin and public endpoints for wallet-based allowlist management
 */

import {
  isAllowlistWindowOpen,
  addToAllowlist,
  removeFromAllowlist,
  isWalletAllowlisted,
  getAllowlistEntries,
  getAllowlistStats,
  updateAllowlistConfig,
} from "../../shared/allowlistService.js";
import { createRequireAdmin } from "../../shared/adminGuard.js";
import { invalidateUserAccessCache } from "../../shared/accessCache.js";
import { walletBodySchema } from "../../shared/schemas/index.js";

/**
 * Register allowlist routes
 * @param {import('fastify').FastifyInstance} fastify
 */
export default async function allowlistRoutes(fastify) {
  const requireAdmin = createRequireAdmin();

  /**
   * GET /api/allowlist/check
   * Check if a wallet address is allowlisted
   * Query: ?wallet=0x...
   */
  fastify.get("/check", async (request, reply) => {
    const { wallet } = request.query;

    if (!wallet || typeof wallet !== "string") {
      return reply.code(400).send({ error: "wallet query parameter required" });
    }

    if (!wallet.match(/^0x[a-fA-F0-9]{40}$/)) {
      return reply.code(400).send({ error: "Invalid wallet address format" });
    }

    try {
      const result = await isWalletAllowlisted(wallet);
      return reply.send({
        isAllowlisted: result.isAllowlisted,
        entry: result.entry || null,
      });
    } catch (error) {
      fastify.log.error({ error }, "Failed to check allowlist");
      return reply.code(500).send({ error: "Failed to check allowlist" });
    }
  });

  /**
   * GET /api/allowlist/window-status
   * Check if the allowlist window is currently open
   */
  fastify.get("/window-status", async (_request, reply) => {
    try {
      const result = await isAllowlistWindowOpen();
      return reply.send(result);
    } catch (error) {
      fastify.log.error({ error }, "Failed to check allowlist window");
      return reply.code(500).send({ error: "Failed to check window status" });
    }
  });

  // ============ ADMIN ROUTES ============

  /**
   * GET /api/allowlist/stats
   * Get allowlist statistics (admin)
   */
  fastify.get(
    "/stats",
    { preHandler: requireAdmin },
    async (_request, reply) => {
      try {
        const stats = await getAllowlistStats();
        return reply.send(stats);
      } catch (error) {
        fastify.log.error({ error }, "Failed to fetch allowlist stats");
        return reply.code(500).send({ error: "Failed to fetch stats" });
      }
    },
  );

  /**
   * GET /api/allowlist/entries
   * Get all allowlist entries (admin)
   * Query: ?activeOnly=true&limit=100
   */
  fastify.get(
    "/entries",
    { preHandler: requireAdmin },
    async (request, reply) => {
      const { activeOnly = "true", limit = "100" } = request.query;

      try {
        const result = await getAllowlistEntries({
          activeOnly: activeOnly !== "false",
          limit: Math.min(Number(limit) || 100, 500),
        });

        return reply.send(result);
      } catch (error) {
        fastify.log.error({ error }, "Failed to fetch allowlist entries");
        return reply.code(500).send({ error: "Failed to fetch entries" });
      }
    },
  );

  /**
   * POST /api/allowlist/add
   * Manually add a wallet to the allowlist (admin)
   * Body: { wallet: string }
   */
  fastify.post(
    "/add",
    {
      preHandler: requireAdmin,
      // Schema enforces wallet (0x + 40 hex) and rejects extras.
      schema: { body: walletBodySchema },
    },
    async (request, reply) => {
    const { wallet } = request.body;

    try {
      const result = await addToAllowlist({ wallet }, "manual", true); // bypass time gate

      if (!result.success) {
        return reply.code(400).send({ error: result.error });
      }

      // Bust the access cache so the new allowlist row is visible to the
      // next admin/check request without waiting for the cache TTL.
      await invalidateUserAccessCache({ wallet }, fastify.log);

      return reply.send({
        success: true,
        entry: result.entry,
        alreadyExists: result.alreadyExists || false,
        reactivated: result.reactivated || false,
      });
    } catch (error) {
      fastify.log.error({ error }, "Failed to add to allowlist");
      return reply.code(500).send({ error: "Failed to add to allowlist" });
    }
    },
  );

  /**
   * POST /api/allowlist/remove
   * Remove a wallet from the allowlist (admin, soft delete)
   * Body: { wallet: string }
   */
  fastify.post(
    "/remove",
    {
      preHandler: requireAdmin,
      schema: { body: walletBodySchema },
    },
    async (request, reply) => {
      const { wallet } = request.body;

      try {
        const result = await removeFromAllowlist({ wallet });

        if (!result.success) {
          return reply.code(400).send({ error: result.error });
        }

        // Bust the access cache so the admin's revocation reflects on the
        // next admin-guarded request instead of after the cache TTL.
        await invalidateUserAccessCache({ wallet }, fastify.log);

        return reply.send({ success: true });
      } catch (error) {
        fastify.log.error({ error }, "Failed to remove from allowlist");
        return reply
          .code(500)
          .send({ error: "Failed to remove from allowlist" });
      }
    },
  );

  /**
   * POST /api/allowlist/config
   * Update allowlist window configuration (admin)
   * Body: { windowStart: ISO date, windowEnd: ISO date | null, maxEntries: number | null }
   */
  fastify.post(
    "/config",
    { preHandler: requireAdmin },
    async (request, reply) => {
      const { windowStart, windowEnd, maxEntries } = request.body || {};

      try {
        const result = await updateAllowlistConfig({
          windowStart: windowStart ? new Date(windowStart) : new Date(),
          windowEnd: windowEnd ? new Date(windowEnd) : null,
          maxEntries: maxEntries ? Number(maxEntries) : null,
        });

        if (!result.success) {
          return reply.code(400).send({ error: result.error });
        }

        return reply.send({ success: true, config: result.config });
      } catch (error) {
        fastify.log.error({ error }, "Failed to update allowlist config");
        return reply.code(500).send({ error: "Failed to update config" });
      }
    },
  );
}
