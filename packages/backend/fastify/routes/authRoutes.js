/**
 * Auth Routes — unified nonce + verify with method-based dispatch
 *
 * GET  /api/auth/nonce    — generate a one-time nonce (all auth methods)
 * POST /api/auth/verify   — verify signature, return JWT
 */

import crypto from "node:crypto";
import { verifyMessage } from "viem";
import { redisClient } from "../../shared/redisClient.js";
import { AuthService } from "../../shared/auth.js";
import { getUserAccess, ACCESS_LEVEL_NAMES } from "../../shared/accessService.js";
import { resolveFidToWallet } from "../../shared/fidResolverService.js";
import { addToAllowlist } from "../../shared/allowlistService.js";
import { invalidateUserAccessCache } from "../../shared/accessCache.js";
import { usernameService } from "../../shared/usernameService.js";

const NONCE_TTL_SECONDS = 300; // 5 minutes
const SIGN_IN_MESSAGE_PREFIX = "Sign in to SecondOrder.fun\nNonce: ";

export default async function authRoutes(fastify) {
  /**
   * GET /nonce
   * Returns { nonce } and stores it in Redis with a 5-minute TTL.
   * No address parameter — nonce is keyed by its own value.
   */
  fastify.get("/nonce", async (_request, reply) => {
    // Alphanumeric nonce (SIWE spec requires alphanumeric for SIWF compat)
    const nonce = crypto.randomUUID().replaceAll("-", "");
    const redis = redisClient.getClient();

    await redis.set(`auth:nonce:${nonce}`, "1", "EX", NONCE_TTL_SECONDS);

    return reply.send({ nonce });
  });

  /**
   * POST /verify
   * Body (wallet):    { method: "wallet", address, signature, nonce }
   * Body (farcaster): { method: "farcaster", message, signature, nonce }
   *
   * Validates nonce, dispatches to method-specific verification,
   * looks up access level, returns JWT + user.
   */
  fastify.post("/verify", async (request, reply) => {
    const { method, nonce, signature } = request.body || {};

    // ── Validate common fields ──────────────────────────────────────
    if (!method || !nonce || !signature) {
      return reply.code(400).send({ error: "method, nonce, and signature are required" });
    }

    if (method !== "wallet" && method !== "farcaster") {
      return reply.code(400).send({ error: 'method must be "wallet" or "farcaster"' });
    }

    // ── Validate and consume nonce (one-time use) ───────────────────
    const redis = redisClient.getClient();
    const nonceRedisKey = `auth:nonce:${nonce}`;
    const storedNonce = await redis.get(nonceRedisKey);

    if (!storedNonce) {
      return reply.code(401).send({ error: "Nonce expired or not found. Request a new one." });
    }

    await redis.del(nonceRedisKey);

    // ── Method-specific verification ────────────────────────────────
    let walletAddress = null;
    let fid = null;
    let username = null;
    let displayName = null;
    let pfpUrl = null;

    if (method === "wallet") {
      const { address } = request.body;

      if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
        return reply.code(400).send({ error: "Valid Ethereum address required" });
      }

      const message = `${SIGN_IN_MESSAGE_PREFIX}${nonce}`;

      let isValid;
      try {
        isValid = await verifyMessage({ address, message, signature });
      } catch (err) {
        fastify.log.error({ err }, "Signature verification error");
        return reply.code(401).send({ error: "Signature verification failed" });
      }

      if (!isValid) {
        return reply.code(401).send({ error: "Invalid signature" });
      }

      walletAddress = address.toLowerCase();

    } else if (method === "farcaster") {
      const { message } = request.body;

      if (!message) {
        return reply.code(400).send({ error: "message is required for farcaster method" });
      }

      try {
        const result = await AuthService.authenticateFarcaster(message, signature, nonce);
        fid = result.fid;
      } catch (err) {
        fastify.log.error({ err }, "SIWF verification error");
        return reply.code(401).send({ error: "Farcaster signature verification failed" });
      }

      if (!fid) {
        return reply.code(401).send({ error: "Could not extract FID from SIWF message" });
      }

      // Resolve FID → wallet address + profile
      let walletData;
      try {
        walletData = await resolveFidToWallet(fid);
      } catch (err) {
        fastify.log.warn({ err, fid }, "Failed to resolve FID to wallet");
        walletData = { address: null };
      }

      walletAddress = walletData.address ? walletData.address.toLowerCase() : null;
      username = walletData.username || null;
      displayName = walletData.displayName || null;
      pfpUrl = walletData.pfpUrl || null;

      // Upsert allowlist entry
      const allowlistResult = await addToAllowlist(
        { fid, wallet: walletAddress },
        "siwf",
        true,
      );

      if (!allowlistResult.success) {
        fastify.log.warn({ fid, error: allowlistResult.error }, "Allowlist upsert failed");
      } else {
        // Bust any stale "no access" entry now that this user is in the allowlist.
        await invalidateUserAccessCache(
          { fid, wallet: walletAddress },
          fastify.log,
        );
      }

      // Sync Farcaster username
      if (walletAddress && username) {
        try {
          await usernameService.syncFarcasterUsername(walletAddress, username);
        } catch (err) {
          fastify.log.warn({ err }, "Failed to sync Farcaster username");
        }
      }
    }

    // ── Shared: access lookup + JWT ─────────────────────────────────
    const accessInfo = await getUserAccess({ fid, wallet: walletAddress });
    const role = ACCESS_LEVEL_NAMES[accessInfo.level] || "user";

    const tokenPayload = {
      id: accessInfo.entry?.id || walletAddress || `fid:${fid}`,
      wallet_address: walletAddress,
      role,
    };
    if (fid) tokenPayload.fid = fid;

    const token = await AuthService.generateToken(tokenPayload);

    return reply.send({
      token,
      user: {
        address: walletAddress,
        fid: fid || null,
        username: username || null,
        displayName: displayName || null,
        pfpUrl: pfpUrl || null,
        accessLevel: accessInfo.level,
        role,
      },
    });
  });
}
