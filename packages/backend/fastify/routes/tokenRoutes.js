import process from "node:process";
import { sofMetadataCache } from "../../src/lib/sofMetadataCache.js";
import { fetchSofTransactions } from "../../src/services/sofTransactionsService.js";
import { db } from "../../shared/supabaseClient.js";

export default async function tokenRoutes(fastify, options = {}) {
  const { blockscoutClient } = options;

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

  // Per-user SOF transaction feed. Replaces the in-browser ERC-20 indexer
  // in useSOFTransactions — Blockscout is the data source, the backend
  // classifies transfers by counterparty against the contracts bundle and
  // the season_contracts table so the UI gets typed rows
  // (BONDING_CURVE_BUY/SELL, PRIZE_CLAIM, TRANSFER_IN/OUT, AIRDROP) with
  // seasonId where applicable. Disabled when Blockscout isn't configured.
  fastify.get("/sof/transactions/:user", async (request, reply) => {
    if (!blockscoutClient) {
      return reply.status(503).send({
        error: "blockscout not configured — set BLOCKSCOUT_BASE_URL + BLOCKSCOUT_API_KEY",
      });
    }
    const { user } = request.params;
    if (!user || !/^0x[a-fA-F0-9]{40}$/.test(user)) {
      return reply.status(400).send({ error: "invalid user address" });
    }
    try {
      const network = process.env.NETWORK || "TESTNET";
      const data = await fetchSofTransactions(
        { blockscoutClient, db, network },
        user,
      );
      return { transactions: data };
    } catch (err) {
      request.log.error({ err, user }, "sof transactions lookup failed");
      return reply.status(502).send({ error: err.message });
    }
  });
}
