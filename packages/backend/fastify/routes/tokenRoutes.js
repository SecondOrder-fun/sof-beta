import { sofMetadataCache } from "../../src/lib/sofMetadataCache.js";

export default async function tokenRoutes(fastify) {
  // SOF token metadata (address, decimals, symbol). Populated at backend
  // startup from a single chain read; served from memory forever after.
  // Replaces frontend useSofDecimals's per-mount eth_call on every page.
  fastify.get("/sof", async (_request, reply) => {
    if (sofMetadataCache.decimals == null) {
      return reply.status(503).send({ error: "sof metadata not yet cached" });
    }
    return {
      address: sofMetadataCache.address,
      decimals: sofMetadataCache.decimals,
      symbol: sofMetadataCache.symbol,
      cachedAt: sofMetadataCache.updatedAt,
    };
  });
}
