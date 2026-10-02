/**
 * Auth Routes — wallet sign-in (nonce + signed message → JWT)
 *
 * GET  /api/auth/nonce    — generate a one-time nonce
 * POST /api/auth/verify   — verify the wallet's signature over the nonce
 *                           message, return a JWT
 */

import crypto from "node:crypto";
import { redisClient } from "../../shared/redisClient.js";
import { AuthService } from "../../shared/auth.js";
import { getUserAccess, ACCESS_LEVEL_NAMES } from "../../shared/accessService.js";
import { usernameService } from "../../shared/usernameService.js";
import { ensureAdminFlag } from "../../shared/services/adminEoaService.js";
import { publicClient } from "../../src/lib/viemClient.js";

const NONCE_TTL_SECONDS = 300; // 5 minutes
const SIGN_IN_MESSAGE_PREFIX = "Sign in to SecondOrder.fun\nNonce: ";

export default async function authRoutes(fastify) {
  /**
   * GET /nonce
   * Returns { nonce } and stores it in Redis with a 5-minute TTL.
   * No address parameter — nonce is keyed by its own value.
   */
  fastify.get("/nonce", async (_request, reply) => {
    const nonce = crypto.randomUUID().replaceAll("-", "");
    const redis = redisClient.getClient();

    await redis.set(`auth:nonce:${nonce}`, "1", "EX", NONCE_TTL_SECONDS);

    return reply.send({ nonce });
  });

  /**
   * POST /verify
   * Body: { method: "wallet", address, signature, nonce }
   *
   * The signed message is `${SIGN_IN_MESSAGE_PREFIX}${nonce}`; the nonce is
   * single-use (consumed before verification). The user's identity is the
   * signing wallet address.
   */
  fastify.post("/verify", async (request, reply) => {
    const { method, nonce, signature } = request.body || {};

    // ── Validate method ─────────────────────────────────────────────
    if (!method) {
      return reply.code(400).send({ error: "method is required" });
    }

    const VALID_METHODS = ["wallet"];
    if (!VALID_METHODS.includes(method)) {
      return reply.code(400).send({
        error: `method must be one of: ${VALID_METHODS.join(", ")}`,
      });
    }

    if (!nonce || !signature) {
      return reply.code(400).send({
        error: "nonce and signature are required for this method",
      });
    }

    const redis = redisClient.getClient();
    const nonceRedisKey = `auth:nonce:${nonce}`;
    const storedNonce = await redis.get(nonceRedisKey);

    if (!storedNonce) {
      return reply
        .code(401)
        .send({ error: "Nonce expired or not found. Request a new one." });
    }

    await redis.del(nonceRedisKey);

    // ── Signature verification ──────────────────────────────────────
    const { address } = request.body;

    if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
      return reply.code(400).send({ error: "Valid Ethereum address required" });
    }

    const message = `${SIGN_IN_MESSAGE_PREFIX}${nonce}`;

    let isValid;
    try {
      // publicClient.verifyMessage, not viem's standalone verifyMessage: it
      // also checks smart-wallet signatures (ERC-1271 for deployed accounts,
      // ERC-6492 for counterfactual ones, e.g. Coinbase Smart Wallet), which
      // plain ECDSA recovery rejects.
      isValid = await publicClient.verifyMessage({ address, message, signature });
    } catch (err) {
      fastify.log.error({ err }, "Signature verification error");
      return reply.code(401).send({ error: "Signature verification failed" });
    }

    if (!isValid) {
      return reply.code(401).send({ error: "Invalid signature" });
    }

    const walletAddress = address.toLowerCase();

    // ── Access lookup + username ────────────────────────────────────
    const accessInfo = await getUserAccess({ wallet: walletAddress });
    const role = ACCESS_LEVEL_NAMES[accessInfo.level] || "user";

    // The user's SoF username (Redis-backed, set via /api/usernames).
    // getUsernameByAddress never throws — it returns null on any failure.
    const username = await usernameService.getUsernameByAddress(walletAddress);

    // ── Admin flag ──────────────────────────────────────────────────
    // ADMIN_EOAS-listed wallets get is_admin flipped to true here on first
    // auth.
    let isAdmin = false;
    try {
      isAdmin = await ensureAdminFlag(walletAddress, fastify.log);
    } catch (err) {
      fastify.log.warn(
        { err, walletAddress },
        "ensureAdminFlag failed during auth — defaulting isAdmin=false",
      );
    }

    const tokenPayload = {
      id: accessInfo.entry?.id || walletAddress,
      wallet_address: walletAddress,
      role,
    };
    if (username) tokenPayload.username = username;
    if (isAdmin) tokenPayload.is_admin = true;

    const token = await AuthService.generateToken(tokenPayload);

    return reply.send({
      token,
      user: {
        address: walletAddress,
        username: username || null,
        accessLevel: accessInfo.level,
        role,
        isAdmin,
      },
    });
  });
}
