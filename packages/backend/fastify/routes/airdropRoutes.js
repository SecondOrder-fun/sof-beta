/**
 * Airdrop Routes — direct ERC-20 transfer to a user's SMA.
 *
 * Per gasless-rewrite spec §5.3, the legacy `SOFAirdrop` merkle drop and
 * its EIP-712 attestation flow are gone. The new model: backend wallet
 * does a plain SOF.transfer(sma, amount), gated by SOF_AIRDROP_AMOUNT_PER_USER.
 *
 * The primary trigger is the SIWE auth flow (smartAccountService kicks the
 * relayer for new users). This route exists for:
 *   - admin/manual top-ups during local dev
 *   - replays after a previous failed transfer (smart_accounts row without
 *     funded_at)
 *
 * Auth: requires admin (is_admin in JWT, set by ADMIN_EOAS env). Anyone
 * else hits a 403 — we don't want random callers draining the relayer.
 */

import { isAddress } from "viem";
import { getAirdropService } from "../../shared/services/airdropService.js";
import { smartAccountsDb } from "../../shared/services/smartAccountsDb.js";

/**
 * @param {import('fastify').FastifyInstance} fastify
 */
export default async function airdropRoutes(fastify) {
  /**
   * POST /api/airdrop/transfer-to-sma
   * Body: { sma: "0x..." }
   *
   * Submits SOF.transfer(sma, SOF_AIRDROP_AMOUNT_PER_USER) from
   * BACKEND_WALLET_PRIVATE_KEY's wallet, waits for inclusion, and stamps
   * smart_accounts.funded_at on success.
   */
  fastify.post(
    "/transfer-to-sma",
    {
      config: {
        rateLimit: {
          max: 10,
          timeWindow: "1 minute",
        },
      },
    },
    async (request, reply) => {
      const isAdmin = Boolean(request.user?.is_admin);
      if (!isAdmin) {
        return reply.code(403).send({ error: "Admin only" });
      }

      const { sma } = request.body || {};
      if (!sma || !isAddress(sma)) {
        return reply
          .code(400)
          .send({ error: "Body must include a valid 0x SMA address" });
      }

      const smaLc = sma.toLowerCase();

      try {
        const txHash = await getAirdropService(fastify.log).transferToSma(smaLc);
        if (!txHash) {
          return reply.send({
            status: "skipped",
            reason:
              "SOF_AIRDROP_AMOUNT_PER_USER unset, or SMA already funded",
          });
        }
        return reply.send({ status: "submitted", txHash });
      } catch (err) {
        fastify.log.error({ err, sma: smaLc }, "transfer-to-sma failed");
        return reply.code(500).send({ error: err.message });
      }
    },
  );

  /**
   * GET /api/airdrop/status?eoa=0x...
   * Read-only diagnostic — returns the smart_accounts row for an EOA.
   * Useful for the frontend's first-connect banner state.
   */
  fastify.get("/status", async (request, reply) => {
    const eoa = request.query?.eoa;
    if (!eoa || !isAddress(eoa)) {
      return reply
        .code(400)
        .send({ error: "Query param `eoa` (0x address) is required" });
    }
    const row = await smartAccountsDb.getSmartAccountByEoa(eoa.toLowerCase());
    if (!row) {
      return reply.send({ found: false });
    }
    return reply.send({
      found: true,
      eoa: row.eoa,
      sma: row.sma,
      deployedAt: row.deployed_at,
      fundedAt: row.funded_at,
      lastActiveAt: row.last_active_at,
    });
  });
}
