/**
 * Auth Routes — unified nonce + verify with method-based dispatch
 *
 * GET  /api/auth/nonce    — generate a one-time nonce (all auth methods)
 * POST /api/auth/verify   — verify signature, return JWT
 */

import crypto from "node:crypto";
import process from "node:process";
import { verifyMessage } from "viem";
import { createClient as createQuickAuthClient } from "@farcaster/quick-auth";
import { redisClient } from "../../shared/redisClient.js";
import { AuthService } from "../../shared/auth.js";
import { getUserAccess, ACCESS_LEVEL_NAMES } from "../../shared/accessService.js";
import { resolveFidToWallet } from "../../shared/fidResolverService.js";
import { addToAllowlist } from "../../shared/allowlistService.js";
import { getLinkedFidForWallet } from "../../shared/farcasterLinkService.js";
import { invalidateUserAccessCache } from "../../shared/accessCache.js";
import { usernameService } from "../../shared/usernameService.js";
import { ensureSmartAccount } from "../../shared/services/smartAccountService.js";
import { smartAccountsDb } from "../../shared/services/smartAccountsDb.js";
import { ensureAdminFlag } from "../../shared/services/adminEoaService.js";
import { getAirdropService } from "../../shared/services/airdropService.js";
import { publicClient } from "../../src/lib/viemClient.js";

const NONCE_TTL_SECONDS = 300; // 5 minutes
const SIGN_IN_MESSAGE_PREFIX = "Sign in to SecondOrder.fun\nNonce: ";

// Lazily-constructed Quick Auth client (verifies JWTs issued by
// https://auth.farcaster.xyz). Lazy so backend boot doesn't fail when
// @farcaster/quick-auth isn't reachable during a cold start.
let _quickAuthClient = null;
function getQuickAuthClient() {
  if (!_quickAuthClient) _quickAuthClient = createQuickAuthClient();
  return _quickAuthClient;
}

/**
 * Quick Auth JWTs carry an `aud` claim equal to the MiniApp's hosting domain
 * (the same domain Warpcast loaded the app from). Allow a comma-separated
 * list via env so the same backend serves prod + preview deploys.
 */
function getQuickAuthAllowedDomains() {
  const raw = (process.env.QUICK_AUTH_DOMAINS || "secondorder.fun").trim();
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

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
   * Body (wallet):    { method: "wallet", address, signature, nonce, walletType? }
   * Body (farcaster): { method: "farcaster", message, signature, nonce }
   *
   * `walletType` (wallet method only) routes the SMA resolution: smart-
   * wallet types ("coinbase-smart", "farcaster-miniapp") keep sma=eoa so
   * airdrops land where the user trades. Omitted/unknown values fall
   * back to factory derivation. The farcaster method implies
   * walletType="farcaster-miniapp".
   */
  fastify.post("/verify", async (request, reply) => {
    const { method, nonce, signature } = request.body || {};

    // ── Validate method ─────────────────────────────────────────────
    if (!method) {
      return reply.code(400).send({ error: "method is required" });
    }

    const VALID_METHODS = ["wallet", "farcaster", "farcaster-quick-auth"];
    if (!VALID_METHODS.includes(method)) {
      return reply.code(400).send({
        error: `method must be one of: ${VALID_METHODS.join(", ")}`,
      });
    }

    // wallet + farcaster (legacy QR SIWF) both require a one-time nonce that
    // we issued from /auth/nonce. farcaster-quick-auth carries its own replay
    // protection (Farcaster-issued JWT with exp/iat), so we skip the nonce
    // consume on that branch.
    if (method === "wallet" || method === "farcaster") {
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
    }

    // ── Method-specific verification ────────────────────────────────
    let walletAddress = null;
    let fid = null;
    let username = null;
    let displayName = null;
    let pfpUrl = null;
    let walletType;

    if (method === "wallet") {
      const { address, walletType: bodyWalletType } = request.body;
      walletType = bodyWalletType;

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

      // Embed any pre-linked Farcaster identity into the resulting JWT so the
      // user's `fid`/`username` survive wallet reconnects without a re-SIWF.
      try {
        const link = await getLinkedFidForWallet(walletAddress);
        if (link) {
          fid = link.fid;
          username = link.username;
          displayName = link.displayName;
        }
      } catch (err) {
        fastify.log.warn(
          { err, walletAddress },
          "Failed to read linked FID for wallet — continuing without",
        );
      }

    } else if (method === "farcaster") {
      const { message } = request.body;
      // SIWF auth implies the user is in a Farcaster MiniApp context
      // (or auth-kit'd from a Farcaster surface). Their connected
      // address is itself a smart account — skip factory derivation.
      walletType = "farcaster-miniapp";

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
    } else if (method === "farcaster-quick-auth") {
      // Zero-prompt MiniApp sign-in. The Farcaster client (Warpcast) issues
      // a short-lived JWT via auth.farcaster.xyz that proves FID ownership
      // without the user signing anything. The frontend passes:
      //   - quickAuthToken : the Quick Auth JWT
      //   - address        : the wagmi-connected MiniApp address (whatever the
      //                      Farcaster connector exposes — this matches what
      //                      the frontend's useRaffleAccount reads, so SMA
      //                      lookups stay consistent)
      // Verifies the JWT against the configured allowed domains, extracts the
      // FID (`sub` claim), and accepts the supplied address as the user's
      // EOA/SMA.
      const { quickAuthToken, address } = request.body || {};
      walletType = "farcaster-miniapp";

      if (!quickAuthToken) {
        return reply.code(400).send({
          error: "quickAuthToken is required for farcaster-quick-auth method",
        });
      }
      if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
        return reply
          .code(400)
          .send({ error: "Valid Ethereum address required" });
      }

      const allowedDomains = getQuickAuthAllowedDomains();
      let payload = null;
      let lastErr = null;
      for (const domain of allowedDomains) {
        try {
          payload = await getQuickAuthClient().verifyJwt({
            token: quickAuthToken,
            domain,
          });
          break;
        } catch (err) {
          // Catch ALL errors (not only InvalidTokenError): a transient JWKS
          // fetch failure on one domain shouldn't bypass the remaining
          // allowlist. If every iteration fails, the !payload check below
          // surfaces a clean 401 (with the last error logged) rather than
          // letting the raw error escape as a 500.
          lastErr = err;
        }
      }
      if (!payload) {
        fastify.log.error(
          { err: lastErr, domains: allowedDomains },
          "Quick Auth JWT verification failed against all allowed domains",
        );
        return reply
          .code(401)
          .send({ error: "Quick Auth verification failed" });
      }

      fid = Number(payload.sub);
      if (!fid) {
        return reply
          .code(401)
          .send({ error: "Quick Auth JWT missing FID" });
      }

      walletAddress = address.toLowerCase();

      // Address-trust note (tracked in follow-up issue): we trust the supplied
      // address as the FID's wallet. The Quick Auth JWT proves FID ownership
      // but does NOT bind the FID to the supplied address. A user could
      // technically claim multiple SOF airdrops by rotating addresses. This
      // is acceptable for testnet alpha (SOF is mintable) but should be
      // hardened with a verified-address cross-check (Neynar) before mainnet.

      // Enrich the JWT with display claims via the existing FID resolver
      // (best-effort — failures don't block auth).
      try {
        const data = await resolveFidToWallet(fid);
        username = data.username || null;
        displayName = data.displayName || null;
        pfpUrl = data.pfpUrl || null;
      } catch (err) {
        fastify.log.warn(
          { err, fid },
          "FID profile enrichment failed for Quick Auth — proceeding without",
        );
      }

      // Allowlist upsert (mirrors the legacy farcaster method).
      const allowlistResult = await addToAllowlist(
        { fid, wallet: walletAddress },
        "siwf",
        true,
      );
      if (!allowlistResult.success) {
        fastify.log.warn(
          { fid, error: allowlistResult.error },
          "Allowlist upsert failed",
        );
      } else {
        await invalidateUserAccessCache(
          { fid, wallet: walletAddress },
          fastify.log,
        );
      }

      if (username) {
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

    // ── Smart account + admin flag (gasless rewrite §5.3) ──────────
    // Resolve the user's SMA (factory-derived for plain EOAs, eoa-as-sma
    // for smart-wallet types) and persist the row. For new users (or
    // users whose stored sma disagrees with the walletType-derived
    // expected value) the airdrop relayer fires next. ADMIN_EOAS-listed
    // wallets get is_admin flipped to true here on first auth.
    let sma = null;
    let isAdmin = false;
    if (walletAddress) {
      try {
        const sa = await ensureSmartAccount({
          eoa: walletAddress,
          db: smartAccountsDb,
          chain: publicClient,
          airdrop: getAirdropService(fastify.log),
          network: (process.env.NETWORK || "LOCAL").toLowerCase(),
          walletType,
        });
        sma = sa.sma;
      } catch (err) {
        fastify.log.warn(
          { err, walletAddress, walletType },
          "ensureSmartAccount failed during auth — continuing without SMA",
        );
      }

      try {
        isAdmin = await ensureAdminFlag(walletAddress, fastify.log);
      } catch (err) {
        fastify.log.warn(
          { err, walletAddress },
          "ensureAdminFlag failed during auth — defaulting isAdmin=false",
        );
      }
    }

    const tokenPayload = {
      id: accessInfo.entry?.id || walletAddress || `fid:${fid}`,
      wallet_address: walletAddress,
      role,
    };
    if (fid) tokenPayload.fid = fid;
    if (username) tokenPayload.username = username;
    if (sma) tokenPayload.sma = sma;
    if (isAdmin) tokenPayload.is_admin = true;

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
        sma,
        isAdmin,
      },
    });
  });

}
