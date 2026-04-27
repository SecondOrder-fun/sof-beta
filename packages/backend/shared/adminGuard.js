import { ACCESS_LEVELS } from "./accessService.js";
import { getCachedUserAccess } from "./accessCache.js";

/**
 * Create a Fastify preHandler that enforces ADMIN access level.
 *
 * Reads through a 60s Redis cache (shared/accessCache.js) so a burst of
 * admin requests doesn't translate 1:1 to allowlist_entries lookups.
 *
 * @returns {(request: any, reply: any) => Promise<void>} Fastify preHandler
 */
export function createRequireAdmin() {
  return async (request, reply) => {
    if (!request.user) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    const accessInfo = await getCachedUserAccess(
      {
        fid: request.user.fid,
        wallet: request.user.wallet_address || request.user.wallet,
      },
      request.log,
    );

    if (accessInfo.level < ACCESS_LEVELS.ADMIN) {
      return reply.code(403).send({ error: "Forbidden" });
    }
  };
}
