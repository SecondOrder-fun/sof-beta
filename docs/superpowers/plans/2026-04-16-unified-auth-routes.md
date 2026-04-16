# Unified Auth Routes Implementation Plan

> **Status:** Complete (merged PR #20)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify the wallet SIWE and Farcaster SIWF auth routes into a single nonce + verify endpoint pair with method-based dispatch, eliminating the address-in-URL security issue.

**Architecture:** Replace 4 routes (2 nonce, 2 verify) with 2 routes (1 nonce, 1 verify). The verify endpoint uses a `method` field in the POST body to dispatch to wallet or Farcaster verification logic. Nonces are always stored by nonce value in Redis, never by address.

**Tech Stack:** Fastify, Redis, viem, @farcaster/auth-client, jsonwebtoken

**Spec:** `docs/superpowers/specs/2026-04-16-unified-auth-routes.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `packages/backend/fastify/routes/authRoutes.js` | Rewrite | Unified nonce + verify with method dispatch |
| `packages/frontend/src/context/AdminAuthContext.jsx` | Modify | Update nonce URL, add method to verify body |
| `packages/frontend/src/context/FarcasterProvider.jsx` | Modify | Update nonce/verify URLs, add method to verify body |

---

### Task 1: Rewrite backend authRoutes.js

**Files:**
- Modify: `packages/backend/fastify/routes/authRoutes.js`

- [ ] **Step 1: Rewrite the nonce endpoint**

Replace both `GET /nonce` and `GET /farcaster/nonce` with a single unified endpoint. Remove the `nonceKey(address)` helper and the TODO comment.

```js
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
```

- [ ] **Step 2: Write the unified verify endpoint**

Replace both `POST /verify` and `POST /farcaster/verify` with a single endpoint that dispatches on `method`.

```js
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
```

- [ ] **Step 3: Verify syntax**

Run: `node --check packages/backend/fastify/routes/authRoutes.js`
Expected: no output (clean)

- [ ] **Step 4: Commit backend changes**

```bash
git add packages/backend/fastify/routes/authRoutes.js
git commit -m "refactor: unify auth nonce + verify routes with method dispatch"
```

---

### Task 2: Update AdminAuthContext.jsx (wallet flow)

**Files:**
- Modify: `packages/frontend/src/context/AdminAuthContext.jsx`

- [ ] **Step 1: Update the nonce fetch**

Change line ~93 from:
```js
const nonceRes = await fetch(`${API_BASE}/auth/nonce?address=${address}`);
```
to:
```js
const nonceRes = await fetch(`${API_BASE}/auth/nonce`);
```

- [ ] **Step 2: Add method to verify body**

Change the verify fetch body (line ~108) from:
```js
body: JSON.stringify({ address, signature, nonce }),
```
to:
```js
body: JSON.stringify({ method: "wallet", address, signature, nonce }),
```

- [ ] **Step 3: Commit frontend wallet auth change**

```bash
git add packages/frontend/src/context/AdminAuthContext.jsx
git commit -m "refactor: update wallet auth to use unified nonce + verify endpoints"
```

---

### Task 3: Update FarcasterProvider.jsx (Farcaster flow)

**Files:**
- Modify: `packages/frontend/src/context/FarcasterProvider.jsx`

- [ ] **Step 1: Update the nonce fetch URL**

Find the Farcaster nonce fetch (line ~94) and change from:
```js
fetch(`${API_BASE}/auth/farcaster/nonce`)
```
to:
```js
fetch(`${API_BASE}/auth/nonce`)
```

- [ ] **Step 2: Update the verify fetch URL and body**

Find the Farcaster verify fetch (line ~111) and change from:
```js
const verifyRes = await fetch(`${API_BASE}/auth/farcaster/verify`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ message, signature, nonce }),
});
```
to:
```js
const verifyRes = await fetch(`${API_BASE}/auth/verify`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ method: "farcaster", message, signature, nonce }),
});
```

- [ ] **Step 3: Update user response handling if needed**

Check if the FarcasterProvider reads the verify response differently from the new unified shape. The response now always includes `{ token, user: { address, fid, username, displayName, pfpUrl, accessLevel, role } }`. Verify the existing destructuring matches.

- [ ] **Step 4: Commit frontend Farcaster auth change**

```bash
git add packages/frontend/src/context/FarcasterProvider.jsx
git commit -m "refactor: update Farcaster auth to use unified nonce + verify endpoints"
```

---

### Task 4: Verify end-to-end

- [ ] **Step 1: Run backend syntax check**

```bash
node --check packages/backend/fastify/routes/authRoutes.js
```

- [ ] **Step 2: Run contract tests (regression)**

```bash
cd packages/contracts && forge test
```
Expected: all pass (auth changes don't affect contracts)

- [ ] **Step 3: Squash into final commit, push, and PR**

```bash
git push -u origin fix/unified-auth-routes
gh pr create --title "refactor: unify auth routes with method dispatch" --body "..."
```
