import {
  getSponsorPrizes,
  createSponsorPrize,
  getTierConfigs,
} from "../../shared/sponsorPrizeService.js";
import { createRequireAdmin } from "../../shared/adminGuard.js";

export default async function sponsorPrizeRoutes(fastify) {
  const requireAdmin = createRequireAdmin();
  // Get all sponsored prizes for a season
  fastify.get("/:seasonId", async (request, reply) => {
    const { seasonId } = request.params;

    try {
      const prizes = await getSponsorPrizes(Number(seasonId));
      return { prizes };
    } catch (error) {
      fastify.log.error(error, "Failed to get sponsor prizes");
      return reply.status(500).send({ error: error.message });
    }
  });

  // Get tier configuration for a season
  fastify.get("/:seasonId/tiers", async (request, reply) => {
    const { seasonId } = request.params;

    try {
      const tiers = await getTierConfigs(Number(seasonId));
      return { tiers };
    } catch (error) {
      fastify.log.error(error, "Failed to get tier configs");
      return reply.status(500).send({ error: error.message });
    }
  });

  // Create an off-chain (cross-chain) sponsored prize (admin only)
  fastify.post("/:seasonId/offchain", { preHandler: [requireAdmin] }, async (request, reply) => {
    const { seasonId } = request.params;
    const {
      chainId,
      tokenAddress,
      tokenName,
      tokenSymbol,
      tokenId,
      imageUrl,
      description,
      sponsorAddress,
      targetTier,
      prizeType,
    } = request.body || {};

    if (!tokenAddress || !sponsorAddress) {
      return reply.status(400).send({ error: "tokenAddress and sponsorAddress are required" });
    }

    try {
      const prize = await createSponsorPrize({
        seasonId: Number(seasonId),
        prizeType: prizeType || "erc721",
        chainId: chainId || 1,
        tokenAddress,
        tokenName: tokenName || null,
        tokenSymbol: tokenSymbol || null,
        tokenId: tokenId || null,
        imageUrl: imageUrl || null,
        description: description || null,
        sponsorAddress,
        targetTier: targetTier || 0,
        isOnchain: false,
      });

      if (!prize) {
        return reply.status(500).send({ error: "Failed to create prize" });
      }

      return { prize };
    } catch (error) {
      fastify.log.error(error, "Failed to create off-chain prize");
      return reply.status(500).send({ error: error.message });
    }
  });
}
