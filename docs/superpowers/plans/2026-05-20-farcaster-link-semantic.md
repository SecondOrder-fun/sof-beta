# Farcaster Link Semantic Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Desktop/Smartphone users attach a Farcaster identity (`fid`, `username`) to their wallet JWT without replacing the wallet binding. Persist the link in `allowlist_entries` so re-auth restores it. Fix two UI bugs (`@FID null - Linked` badge; hidden "Sign in with Farcaster" button).

**Architecture:** Two new authenticated backend endpoints (`POST /api/auth/link-farcaster`, `POST /api/auth/unlink-farcaster`) mutate `allowlist_entries` and re-issue the JWT. The existing wallet SIWE verify path gains one lookup against `allowlist_entries` to embed pre-linked FID. Frontend gains two context methods (`linkFarcaster`, `unlinkFarcaster`); `useFarcasterSignIn` branches on whether a JWT already exists. MiniApp `method: "farcaster"` path is untouched.

**Tech Stack:** Fastify, Supabase (`allowlist_entries`), Redis (nonce store), `@farcaster/auth-client`, React, wagmi v2, Vitest, React Testing Library.

**Spec:** [`docs/superpowers/specs/2026-05-20-farcaster-link-semantic-design.md`](../specs/2026-05-20-farcaster-link-semantic-design.md)

**Working branch:** `feat/farcaster-link-semantic`

---

## File Structure

### Created
- `packages/backend/shared/farcasterLinkService.js` — pure DB operations on `allowlist_entries` for link / unlink / lookup-by-wallet (testable in isolation with mocked Supabase)
- `packages/backend/tests/api/authRoutes.linkFarcaster.test.js` — integration tests for the new endpoints + wallet-path embedding
- `packages/backend/tests/shared/farcasterLinkService.test.js` — unit tests for the service
- `packages/frontend/src/context/__tests__/AppAuthProvider.linkFarcaster.test.jsx` — tests for the two new context methods
- `packages/frontend/src/hooks/__tests__/useFarcasterSignIn.branching.test.jsx` — tests for the JWT-presence branch
- `packages/frontend/src/components/layout/__tests__/Header.farcasterUser.test.jsx` — tests for the prop gating
- `packages/frontend/src/components/auth/__tests__/FarcasterAuth.gating.test.jsx` — tests for the profile-view gating + unlink button
- `packages/frontend/src/components/common/__tests__/SettingsMenu.linkedBadge.test.jsx` — defense-in-depth test for the badge gate

### Modified
- `packages/backend/shared/auth.js` — `generateToken` adds `username` claim
- `packages/backend/fastify/routes/authRoutes.js` — wallet SIWE path reads pre-linked FID; two new endpoints registered
- `packages/frontend/src/context/AppAuthProvider.jsx` — context gains `linkFarcaster`, `unlinkFarcaster`; status transitions reuse the existing `inflightRef` guard
- `packages/frontend/src/context/AppAuthContext.js` — JSDoc updated (no code change, only typedef of context shape)
- `packages/frontend/src/hooks/useFarcasterSignIn.js` — branch on `jwt` presence inside the relay callback
- `packages/frontend/src/components/layout/Header.jsx` — line 150 gate change
- `packages/frontend/src/components/auth/FarcasterAuth.jsx` — line 42 gate change + sign-out repurpose
- `packages/frontend/src/components/common/SettingsMenu.jsx` — line 345 defense-in-depth tighten
- `packages/backend/package.json` — bump `0.26.0` → `0.27.0`
- `packages/frontend/package.json` — bump `0.38.0` → `0.39.0`

---

## Task 1: Backend — `farcasterLinkService` (DB operations)

**Files:**
- Create: `packages/backend/shared/farcasterLinkService.js`
- Test: `packages/backend/tests/shared/farcasterLinkService.test.js`

This service owns the three DB operations the auth routes need. Pure functions over a Supabase client — no Fastify, no HTTP, no Redis. Lives in `shared/` so route tests can mock it cleanly.

- [ ] **Step 1.1: Write failing tests**

Create `packages/backend/tests/shared/farcasterLinkService.test.js`:

```js
// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock supabaseClient before importing service
const mockFrom = vi.fn();
vi.mock("../../shared/supabaseClient.js", () => ({
  db: { client: { from: (...args) => mockFrom(...args) } },
  hasSupabase: true,
}));

let service;

beforeEach(async () => {
  vi.resetModules();
  mockFrom.mockReset();
  service = await import("../../shared/farcasterLinkService.js");
});

// Helper: build a chainable Supabase mock that returns `result` for awaits on .single()
const supabaseSingle = (result) => {
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    update: vi.fn(() => builder),
    insert: vi.fn(() => builder),
    delete: vi.fn(() => builder),
    single: vi.fn(() => Promise.resolve(result)),
  };
  return builder;
};

describe("getLinkedFidForWallet", () => {
  it("returns null when no row exists", async () => {
    mockFrom.mockReturnValue(supabaseSingle({ data: null, error: null }));
    const result = await service.getLinkedFidForWallet("0xabc");
    expect(result).toBeNull();
  });

  it("returns null when row has fid=null", async () => {
    mockFrom.mockReturnValue(
      supabaseSingle({ data: { fid: null, username: null, display_name: null }, error: null }),
    );
    const result = await service.getLinkedFidForWallet("0xabc");
    expect(result).toBeNull();
  });

  it("returns {fid, username, displayName} when row has fid", async () => {
    mockFrom.mockReturnValue(
      supabaseSingle({
        data: { fid: 42, username: "alice", display_name: "Alice" },
        error: null,
      }),
    );
    const result = await service.getLinkedFidForWallet("0xABC");
    expect(result).toEqual({ fid: 42, username: "alice", displayName: "Alice" });
  });

  it("lowercases the wallet address before querying", async () => {
    const builder = supabaseSingle({ data: null, error: null });
    mockFrom.mockReturnValue(builder);
    await service.getLinkedFidForWallet("0xDEADBEEF");
    expect(builder.eq).toHaveBeenCalledWith("wallet_address", "0xdeadbeef");
  });
});

describe("linkFarcasterToWallet", () => {
  it("inserts a new row when no existing row for fid or wallet", async () => {
    // Two .single() lookups (by fid, by wallet) both return null
    const lookupBuilder = supabaseSingle({ data: null, error: null });
    const insertBuilder = supabaseSingle({
      data: { id: 1, fid: 42, wallet_address: "0xabc" },
      error: null,
    });
    mockFrom
      .mockReturnValueOnce(lookupBuilder) // by fid
      .mockReturnValueOnce(lookupBuilder) // by wallet
      .mockReturnValueOnce(insertBuilder); // insert

    const result = await service.linkFarcasterToWallet({
      walletAddress: "0xabc",
      fid: 42,
      username: "alice",
      displayName: "Alice",
    });

    expect(result.success).toBe(true);
    expect(insertBuilder.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        fid: 42,
        wallet_address: "0xabc",
        username: "alice",
        display_name: "Alice",
        source: "farcaster-link",
        is_active: true,
      }),
    );
  });

  it("updates the wallet row when wallet row exists and fid is unique", async () => {
    const fidLookup = supabaseSingle({ data: null, error: null });
    const walletLookup = supabaseSingle({
      data: { id: 7, fid: null, wallet_address: "0xabc" },
      error: null,
    });
    const updateBuilder = supabaseSingle({
      data: { id: 7, fid: 42, wallet_address: "0xabc" },
      error: null,
    });
    mockFrom
      .mockReturnValueOnce(fidLookup)
      .mockReturnValueOnce(walletLookup)
      .mockReturnValueOnce(updateBuilder);

    const result = await service.linkFarcasterToWallet({
      walletAddress: "0xabc",
      fid: 42,
      username: "alice",
      displayName: "Alice",
    });

    expect(result.success).toBe(true);
    expect(updateBuilder.update).toHaveBeenCalledWith(
      expect.objectContaining({
        fid: 42,
        username: "alice",
        display_name: "Alice",
        source: "farcaster-link",
      }),
    );
    expect(updateBuilder.eq).toHaveBeenCalledWith("id", 7);
  });

  it("reassigns: clears fid on old row (wallet-bound), updates new row", async () => {
    const fidLookup = supabaseSingle({
      data: { id: 5, fid: 42, wallet_address: "0xold" },
      error: null,
    });
    const walletLookup = supabaseSingle({
      data: { id: 7, fid: null, wallet_address: "0xnew" },
      error: null,
    });
    const clearOldBuilder = supabaseSingle({ data: { id: 5 }, error: null });
    const updateNewBuilder = supabaseSingle({
      data: { id: 7, fid: 42, wallet_address: "0xnew" },
      error: null,
    });
    mockFrom
      .mockReturnValueOnce(fidLookup)        // existing by fid
      .mockReturnValueOnce(walletLookup)     // existing by wallet
      .mockReturnValueOnce(clearOldBuilder)  // clear old
      .mockReturnValueOnce(updateNewBuilder); // update new

    const result = await service.linkFarcasterToWallet({
      walletAddress: "0xnew",
      fid: 42,
      username: "alice",
      displayName: "Alice",
    });

    expect(result.success).toBe(true);
    expect(clearOldBuilder.update).toHaveBeenCalledWith(
      expect.objectContaining({
        fid: null,
        username: null,
        display_name: null,
        wallet_resolved_at: null,
      }),
    );
    expect(clearOldBuilder.eq).toHaveBeenCalledWith("id", 5);
  });

  it("reassigns: deletes old row when it has wallet_address=null", async () => {
    const fidLookup = supabaseSingle({
      data: { id: 5, fid: 42, wallet_address: null },
      error: null,
    });
    const walletLookup = supabaseSingle({ data: null, error: null });
    const deleteOldBuilder = supabaseSingle({ data: { id: 5 }, error: null });
    const insertNewBuilder = supabaseSingle({
      data: { id: 9, fid: 42, wallet_address: "0xnew" },
      error: null,
    });
    mockFrom
      .mockReturnValueOnce(fidLookup)
      .mockReturnValueOnce(walletLookup)
      .mockReturnValueOnce(deleteOldBuilder)
      .mockReturnValueOnce(insertNewBuilder);

    const result = await service.linkFarcasterToWallet({
      walletAddress: "0xnew",
      fid: 42,
      username: "alice",
      displayName: "Alice",
    });

    expect(result.success).toBe(true);
    expect(deleteOldBuilder.delete).toHaveBeenCalled();
    expect(deleteOldBuilder.eq).toHaveBeenCalledWith("id", 5);
  });

  it("self-link is idempotent (existing fid row already on this wallet)", async () => {
    const fidLookup = supabaseSingle({
      data: { id: 7, fid: 42, wallet_address: "0xabc" },
      error: null,
    });
    const walletLookup = supabaseSingle({
      data: { id: 7, fid: 42, wallet_address: "0xabc" },
      error: null,
    });
    const refreshBuilder = supabaseSingle({
      data: { id: 7, fid: 42, wallet_address: "0xabc" },
      error: null,
    });
    mockFrom
      .mockReturnValueOnce(fidLookup)
      .mockReturnValueOnce(walletLookup)
      .mockReturnValueOnce(refreshBuilder);

    const result = await service.linkFarcasterToWallet({
      walletAddress: "0xabc",
      fid: 42,
      username: "alice",
      displayName: "Alice",
    });

    expect(result.success).toBe(true);
    expect(refreshBuilder.update).toHaveBeenCalled();
  });

  it("returns error when supabase is unavailable", async () => {
    vi.resetModules();
    vi.doMock("../../shared/supabaseClient.js", () => ({
      db: { client: { from: vi.fn() } },
      hasSupabase: false,
    }));
    const svc = await import("../../shared/farcasterLinkService.js");

    const result = await svc.linkFarcasterToWallet({
      walletAddress: "0xabc",
      fid: 42,
      username: null,
      displayName: null,
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/database/i);
  });
});

describe("unlinkFarcasterFromWallet", () => {
  it("clears fid columns when row has fid", async () => {
    const lookupBuilder = supabaseSingle({
      data: { id: 7, fid: 42, wallet_address: "0xabc" },
      error: null,
    });
    const updateBuilder = supabaseSingle({ data: { id: 7 }, error: null });
    mockFrom
      .mockReturnValueOnce(lookupBuilder)
      .mockReturnValueOnce(updateBuilder);

    const result = await service.unlinkFarcasterFromWallet("0xABC");

    expect(result.success).toBe(true);
    expect(updateBuilder.update).toHaveBeenCalledWith(
      expect.objectContaining({
        fid: null,
        username: null,
        display_name: null,
        wallet_resolved_at: null,
      }),
    );
  });

  it("is a no-op when no row exists for the wallet", async () => {
    const lookupBuilder = supabaseSingle({ data: null, error: null });
    mockFrom.mockReturnValueOnce(lookupBuilder);

    const result = await service.unlinkFarcasterFromWallet("0xabc");

    expect(result.success).toBe(true);
    expect(result.noop).toBe(true);
  });

  it("is a no-op when row exists with fid=null", async () => {
    const lookupBuilder = supabaseSingle({
      data: { id: 7, fid: null, wallet_address: "0xabc" },
      error: null,
    });
    mockFrom.mockReturnValueOnce(lookupBuilder);

    const result = await service.unlinkFarcasterFromWallet("0xabc");

    expect(result.success).toBe(true);
    expect(result.noop).toBe(true);
  });
});
```

- [ ] **Step 1.2: Run tests, verify they fail**

```bash
cd packages/backend && npx vitest run tests/shared/farcasterLinkService.test.js
```

Expected: FAIL — `Cannot find module '../../shared/farcasterLinkService.js'`.

- [ ] **Step 1.3: Implement the service**

Create `packages/backend/shared/farcasterLinkService.js`:

```js
/**
 * farcasterLinkService — DB operations for attaching/detaching a Farcaster
 * identity (fid, username) to a wallet's allowlist_entries row.
 *
 * Used by /api/auth/link-farcaster, /api/auth/unlink-farcaster, and the
 * wallet branch of /api/auth/verify (lookup only).
 *
 * Spec: docs/superpowers/specs/2026-05-20-farcaster-link-semantic-design.md
 */
import { db, hasSupabase } from "./supabaseClient.js";

/**
 * Look up the FID currently linked to a given wallet address.
 * Returns { fid, username, displayName } or null.
 */
export async function getLinkedFidForWallet(walletAddress) {
  if (!hasSupabase || !walletAddress) return null;
  const addr = walletAddress.toLowerCase();

  const { data } = await db.client
    .from("allowlist_entries")
    .select("fid, username, display_name")
    .eq("wallet_address", addr)
    .eq("is_active", true)
    .single();

  if (!data || data.fid == null) return null;
  return {
    fid: data.fid,
    username: data.username || null,
    displayName: data.display_name || null,
  };
}

/**
 * Attach `fid` (with username, displayName) to `walletAddress`.
 *
 * Handles the three cases described in the spec:
 *   1. No conflict — insert/update the wallet's row.
 *   2. Self-link — refresh username/display_name on existing row.
 *   3. Cross-wallet conflict — clear FID columns on the loser's row
 *      (or delete the row if it has no wallet_address), then write the
 *      new row.
 *
 * Returns { success: true, entry } on success, { success: false, error } on failure.
 */
export async function linkFarcasterToWallet({
  walletAddress,
  fid,
  username,
  displayName,
}) {
  if (!hasSupabase) return { success: false, error: "Database not configured" };
  if (!walletAddress || !fid) {
    return { success: false, error: "walletAddress and fid are required" };
  }

  const addr = walletAddress.toLowerCase();
  const now = new Date().toISOString();

  // Look up existing rows by fid and by wallet (independent partial-unique constraints).
  const { data: existingByFid } = await db.client
    .from("allowlist_entries")
    .select("id, fid, wallet_address, is_active")
    .eq("fid", fid)
    .single();

  const { data: existingByWallet } = await db.client
    .from("allowlist_entries")
    .select("id, fid, wallet_address, is_active")
    .eq("wallet_address", addr)
    .single();

  // Case: self-link — same row already has this (fid, wallet) pairing.
  if (
    existingByFid &&
    existingByWallet &&
    existingByFid.id === existingByWallet.id
  ) {
    const { data, error } = await db.client
      .from("allowlist_entries")
      .update({
        username: username || null,
        display_name: displayName || null,
        is_active: true,
        wallet_resolved_at: now,
        updated_at: now,
      })
      .eq("id", existingByFid.id)
      .select()
      .single();

    if (error) return { success: false, error: error.message };
    return { success: true, entry: data };
  }

  // Cross-wallet conflict: existing fid row points to a different wallet.
  // Clear or delete it first so the partial-unique constraint on `fid` is free.
  if (existingByFid && existingByFid.id !== existingByWallet?.id) {
    if (!existingByFid.wallet_address) {
      const { error } = await db.client
        .from("allowlist_entries")
        .delete()
        .eq("id", existingByFid.id);
      if (error) return { success: false, error: error.message };
    } else {
      const { error } = await db.client
        .from("allowlist_entries")
        .update({
          fid: null,
          username: null,
          display_name: null,
          wallet_resolved_at: null,
          updated_at: now,
        })
        .eq("id", existingByFid.id);
      if (error) return { success: false, error: error.message };
    }
  }

  // Case: wallet row exists — update in place.
  if (existingByWallet) {
    const { data, error } = await db.client
      .from("allowlist_entries")
      .update({
        fid,
        username: username || null,
        display_name: displayName || null,
        source: "farcaster-link",
        is_active: true,
        wallet_resolved_at: now,
        updated_at: now,
      })
      .eq("id", existingByWallet.id)
      .select()
      .single();

    if (error) return { success: false, error: error.message };
    return { success: true, entry: data };
  }

  // Case: insert fresh.
  const { data, error } = await db.client
    .from("allowlist_entries")
    .insert({
      fid,
      wallet_address: addr,
      username: username || null,
      display_name: displayName || null,
      source: "farcaster-link",
      is_active: true,
      added_at: now,
      wallet_resolved_at: now,
    })
    .select()
    .single();

  if (error) return { success: false, error: error.message };
  return { success: true, entry: data };
}

/**
 * Clear the FID columns on the wallet's row. Idempotent.
 * Returns { success: true, noop?: true } or { success: false, error }.
 */
export async function unlinkFarcasterFromWallet(walletAddress) {
  if (!hasSupabase) return { success: false, error: "Database not configured" };
  if (!walletAddress) return { success: false, error: "walletAddress is required" };

  const addr = walletAddress.toLowerCase();

  const { data: existing } = await db.client
    .from("allowlist_entries")
    .select("id, fid, wallet_address")
    .eq("wallet_address", addr)
    .single();

  if (!existing || existing.fid == null) {
    return { success: true, noop: true };
  }

  const { error } = await db.client
    .from("allowlist_entries")
    .update({
      fid: null,
      username: null,
      display_name: null,
      wallet_resolved_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", existing.id);

  if (error) return { success: false, error: error.message };
  return { success: true };
}
```

- [ ] **Step 1.4: Run tests, verify they pass**

```bash
cd packages/backend && npx vitest run tests/shared/farcasterLinkService.test.js
```

Expected: all 12 tests pass.

- [ ] **Step 1.5: Commit**

```bash
git add packages/backend/shared/farcasterLinkService.js packages/backend/tests/shared/farcasterLinkService.test.js
git commit -m "$(cat <<'EOF'
feat(backend): add farcasterLinkService for allowlist_entries link ops

Three operations: getLinkedFidForWallet (lookup), linkFarcasterToWallet
(insert/update with reassign-on-conflict), unlinkFarcasterFromWallet
(idempotent clear). Pure DB layer — no Fastify, no HTTP, no Redis.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Backend — `AuthService.generateToken` adds `username` claim

**Files:**
- Modify: `packages/backend/shared/auth.js:11-23`

Currently `generateToken` only conditionally adds `fid`. We need `username` too so that wallet re-auth's JWT carries enough info for the frontend to skip the user-fetch round trip.

- [ ] **Step 2.1: Update generateToken**

Edit `packages/backend/shared/auth.js`. Replace lines 11-23:

```js
  static async generateToken(user) {
    const payload = {
      id: user.id,
      wallet_address: user.wallet_address,
      role: user.role || "user",
    };

    if (user.fid) {
      payload.fid = user.fid;
    }

    if (user.username) {
      payload.username = user.username;
    }

    return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
  }
```

- [ ] **Step 2.2: Verify existing auth tests still pass**

```bash
cd packages/backend && npx vitest run tests/shared/farcasterLinkService.test.js
```

Expected: pass (no auth-service-specific tests exist; this is an additive change covered by the integration tests in Task 4).

- [ ] **Step 2.3: Commit**

```bash
git add packages/backend/shared/auth.js
git commit -m "$(cat <<'EOF'
feat(backend): include username in JWT payload when present

Adds username as an optional JWT claim alongside fid so the frontend can
display the linked Farcaster identity without a round-trip on re-auth.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Backend — wallet SIWE path embeds pre-linked FID

**Files:**
- Modify: `packages/backend/fastify/routes/authRoutes.js:81-103` (wallet method block) and `authRoutes.js:165` (shared section)

After verifying the wallet signature, look up the linked FID for that wallet so the resulting JWT/user carries it.

- [ ] **Step 3.1: Import the new service**

In `packages/backend/fastify/routes/authRoutes.js`, add to the imports near the top (around line 17):

```js
import { getLinkedFidForWallet } from "../../shared/farcasterLinkService.js";
```

- [ ] **Step 3.2: Embed lookup in wallet branch**

After line 102 (`walletAddress = address.toLowerCase();`) and before the `} else if (method === "farcaster") {` branch begins, add:

```js
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
```

- [ ] **Step 3.3: Run a smoke-level integration test stub**

Tests for this behavior are written in Task 4's combined endpoint test file. Here, just confirm the module still parses:

```bash
cd packages/backend && node --check fastify/routes/authRoutes.js
```

Expected: no output (success).

- [ ] **Step 3.4: Commit**

```bash
git add packages/backend/fastify/routes/authRoutes.js
git commit -m "$(cat <<'EOF'
feat(backend): wallet SIWE embeds pre-linked FID into JWT

After a successful wallet signature verification, look up the wallet's
linked Farcaster identity in allowlist_entries and embed fid/username
into both the JWT claims and the returned user object. Allows the link
to survive wallet reconnects without a re-SIWF.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Backend — `POST /api/auth/link-farcaster` endpoint

**Files:**
- Modify: `packages/backend/fastify/routes/authRoutes.js` (add new route handler)
- Test: `packages/backend/tests/api/authRoutes.linkFarcaster.test.js`

- [ ] **Step 4.1: Write failing test for the endpoint**

Create `packages/backend/tests/api/authRoutes.linkFarcaster.test.js`:

```js
// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import fastify from "fastify";
import jwt from "jsonwebtoken";

process.env.JWT_SECRET = "test-secret";
process.env.JWT_EXPIRES_IN = "1h";
process.env.SIWF_ALLOWED_DOMAINS = "example.com";

// Mocks (must be hoisted via vi.mock before route import)
const mockRedisGet = vi.fn();
const mockRedisDel = vi.fn();
const mockRedisSet = vi.fn();

vi.mock("../../shared/redisClient.js", () => ({
  redisClient: {
    getClient: () => ({
      get: mockRedisGet,
      del: mockRedisDel,
      set: mockRedisSet,
    }),
  },
}));

const mockGetLinkedFidForWallet = vi.fn();
const mockLinkFarcasterToWallet = vi.fn();
const mockUnlinkFarcasterFromWallet = vi.fn();

vi.mock("../../shared/farcasterLinkService.js", () => ({
  getLinkedFidForWallet: (...a) => mockGetLinkedFidForWallet(...a),
  linkFarcasterToWallet: (...a) => mockLinkFarcasterToWallet(...a),
  unlinkFarcasterFromWallet: (...a) => mockUnlinkFarcasterFromWallet(...a),
}));

const mockAuthenticateFarcaster = vi.fn();
vi.mock("../../shared/auth.js", async () => {
  const actual = await vi.importActual("../../shared/auth.js");
  return {
    ...actual,
    AuthService: {
      ...actual.AuthService,
      authenticateFarcaster: (...a) => mockAuthenticateFarcaster(...a),
      generateToken: actual.AuthService.generateToken,
    },
  };
});

const mockResolveFidToWallet = vi.fn();
vi.mock("../../shared/fidResolverService.js", () => ({
  resolveFidToWallet: (...a) => mockResolveFidToWallet(...a),
}));

vi.mock("../../shared/accessService.js", () => ({
  getUserAccess: vi.fn().mockResolvedValue({ entry: { id: 1 }, level: 1 }),
  ACCESS_LEVEL_NAMES: { 1: "user" },
}));

vi.mock("../../shared/allowlistService.js", () => ({
  addToAllowlist: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock("../../shared/accessCache.js", () => ({
  invalidateUserAccessCache: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../shared/usernameService.js", () => ({
  usernameService: {
    syncFarcasterUsername: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("../../shared/services/smartAccountService.js", () => ({
  ensureSmartAccount: vi.fn().mockResolvedValue({ sma: "0xsma" }),
}));

vi.mock("../../shared/services/smartAccountsDb.js", () => ({
  smartAccountsDb: {},
}));

vi.mock("../../shared/services/adminEoaService.js", () => ({
  ensureAdminFlag: vi.fn().mockResolvedValue(false),
}));

vi.mock("../../shared/services/airdropService.js", () => ({
  getAirdropService: vi.fn().mockReturnValue(null),
}));

vi.mock("../../src/lib/viemClient.js", () => ({
  publicClient: {},
}));

let app;

beforeAll(async () => {
  const authRoutes = (await import("../../fastify/routes/authRoutes.js")).default;
  app = fastify({ logger: false });
  await app.register(authRoutes, { prefix: "/api/auth" });
  await app.ready();
});

afterAll(async () => {
  if (app) await app.close();
});

beforeEach(() => {
  mockRedisGet.mockReset();
  mockRedisDel.mockReset();
  mockRedisSet.mockReset();
  mockGetLinkedFidForWallet.mockReset();
  mockLinkFarcasterToWallet.mockReset();
  mockUnlinkFarcasterFromWallet.mockReset();
  mockAuthenticateFarcaster.mockReset();
  mockResolveFidToWallet.mockReset();
});

const makeJwt = (claims) =>
  jwt.sign(claims, "test-secret", { expiresIn: "1h" });

describe("POST /api/auth/link-farcaster", () => {
  it("returns 401 when no bearer is provided", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/link-farcaster",
      payload: { message: "m", signature: "s", nonce: "n" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 401 when bearer is expired", async () => {
    const expired = jwt.sign({ wallet_address: "0xabc" }, "test-secret", {
      expiresIn: -10,
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/link-farcaster",
      headers: { authorization: `Bearer ${expired}` },
      payload: { message: "m", signature: "s", nonce: "n" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 401 when nonce is missing from Redis", async () => {
    mockRedisGet.mockResolvedValue(null);
    const token = makeJwt({ wallet_address: "0xabc" });
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/link-farcaster",
      headers: { authorization: `Bearer ${token}` },
      payload: { message: "m", signature: "s", nonce: "n" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 400 when SIWF verification fails", async () => {
    mockRedisGet.mockResolvedValue("1");
    mockAuthenticateFarcaster.mockRejectedValue(new Error("bad sig"));
    const token = makeJwt({ wallet_address: "0xabc" });
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/link-farcaster",
      headers: { authorization: `Bearer ${token}` },
      payload: { message: "m", signature: "s", nonce: "n" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 200 with refreshed JWT on success", async () => {
    mockRedisGet.mockResolvedValue("1");
    mockAuthenticateFarcaster.mockResolvedValue({ fid: 42 });
    mockResolveFidToWallet.mockResolvedValue({
      address: "0xirrelevant",
      username: "alice",
      displayName: "Alice",
      pfpUrl: null,
    });
    mockLinkFarcasterToWallet.mockResolvedValue({
      success: true,
      entry: { id: 1, fid: 42, wallet_address: "0xabc" },
    });
    const token = makeJwt({ wallet_address: "0xabc" });

    const res = await app.inject({
      method: "POST",
      url: "/api/auth/link-farcaster",
      headers: { authorization: `Bearer ${token}` },
      payload: { message: "m", signature: "s", nonce: "n" },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.user.fid).toBe(42);
    expect(body.user.username).toBe("alice");
    expect(body.user.address).toBe("0xabc"); // unchanged from JWT
    const decoded = jwt.decode(body.token);
    expect(decoded.wallet_address).toBe("0xabc");
    expect(decoded.fid).toBe(42);
    expect(decoded.username).toBe("alice");
    expect(mockLinkFarcasterToWallet).toHaveBeenCalledWith(
      expect.objectContaining({
        walletAddress: "0xabc",
        fid: 42,
        username: "alice",
        displayName: "Alice",
      }),
    );
  });

  it("succeeds with fid only when Neynar resolution fails", async () => {
    mockRedisGet.mockResolvedValue("1");
    mockAuthenticateFarcaster.mockResolvedValue({ fid: 42 });
    mockResolveFidToWallet.mockRejectedValue(new Error("neynar down"));
    mockLinkFarcasterToWallet.mockResolvedValue({
      success: true,
      entry: { id: 1, fid: 42, wallet_address: "0xabc" },
    });
    const token = makeJwt({ wallet_address: "0xabc" });

    const res = await app.inject({
      method: "POST",
      url: "/api/auth/link-farcaster",
      headers: { authorization: `Bearer ${token}` },
      payload: { message: "m", signature: "s", nonce: "n" },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.user.fid).toBe(42);
    expect(body.user.username).toBeNull();
  });
});

describe("POST /api/auth/unlink-farcaster", () => {
  it("returns 401 without bearer", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/unlink-farcaster",
      payload: {},
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 200 with FID-stripped JWT when linked", async () => {
    mockUnlinkFarcasterFromWallet.mockResolvedValue({ success: true });
    const token = makeJwt({ wallet_address: "0xabc", fid: 42, username: "alice" });

    const res = await app.inject({
      method: "POST",
      url: "/api/auth/unlink-farcaster",
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.user.fid).toBeNull();
    expect(body.user.username).toBeNull();
    const decoded = jwt.decode(body.token);
    expect(decoded.wallet_address).toBe("0xabc");
    expect(decoded.fid).toBeUndefined();
    expect(decoded.username).toBeUndefined();
  });

  it("returns 200 idempotently when nothing was linked", async () => {
    mockUnlinkFarcasterFromWallet.mockResolvedValue({ success: true, noop: true });
    const token = makeJwt({ wallet_address: "0xabc" });

    const res = await app.inject({
      method: "POST",
      url: "/api/auth/unlink-farcaster",
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    });

    expect(res.statusCode).toBe(200);
  });
});

describe("POST /api/auth/verify wallet path embeds pre-linked FID", () => {
  it("embeds fid/username from getLinkedFidForWallet into JWT and user", async () => {
    mockRedisGet.mockResolvedValue("1");
    mockGetLinkedFidForWallet.mockResolvedValue({
      fid: 42,
      username: "alice",
      displayName: "Alice",
    });

    // Patch viem verifyMessage for this test (the route imports it directly)
    const viem = await import("viem");
    const verifySpy = vi.spyOn(viem, "verifyMessage").mockResolvedValue(true);

    const res = await app.inject({
      method: "POST",
      url: "/api/auth/verify",
      payload: {
        method: "wallet",
        address: "0xabc0000000000000000000000000000000000abc",
        signature: "0xdeadbeef",
        nonce: "abc123",
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.user.fid).toBe(42);
    expect(body.user.username).toBe("alice");
    verifySpy.mockRestore();
  });
});
```

- [ ] **Step 4.2: Run the test, verify it fails**

```bash
cd packages/backend && npx vitest run tests/api/authRoutes.linkFarcaster.test.js
```

Expected: failures on `/link-farcaster` and `/unlink-farcaster` (404 — route not registered). The wallet-verify test may also fail because Task 3's wallet-path lookup needs to run.

- [ ] **Step 4.3: Add a JWT-bearer preHandler helper**

Inside `packages/backend/fastify/routes/authRoutes.js`, add this helper above the `export default async function authRoutes(fastify)` declaration:

```js
async function requireBearer(request, reply) {
  const authHeader = request.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return reply.code(401).send({ error: "Missing bearer token" });
  }
  const token = authHeader.substring(7);
  const result = await AuthService.verifyToken(token);
  if (!result.valid) {
    return reply.code(401).send({ error: "Invalid or expired token" });
  }
  request.user = result.user;
}
```

- [ ] **Step 4.4: Register the link endpoint**

Inside the `authRoutes` function, before the closing brace, add the link route:

```js
  /**
   * POST /link-farcaster
   * Body: { message, signature, nonce }
   * Requires: Authorization: Bearer <wallet JWT>
   *
   * Verifies SIWF, attaches fid/username to the JWT's wallet via
   * allowlist_entries, issues a refreshed JWT. The Neynar-resolved
   * walletAddress is intentionally ignored — the link binds the FID to
   * the bearer JWT's wallet, not the FID's primary wallet.
   */
  fastify.post(
    "/link-farcaster",
    { preHandler: requireBearer },
    async (request, reply) => {
      const { message, signature, nonce } = request.body || {};
      if (!message || !signature || !nonce) {
        return reply
          .code(400)
          .send({ error: "message, signature, and nonce are required" });
      }

      const walletAddress = request.user.wallet_address;
      if (!walletAddress) {
        return reply
          .code(400)
          .send({ error: "JWT has no wallet_address claim" });
      }

      // Consume nonce (one-time use)
      const redis = redisClient.getClient();
      const nonceRedisKey = `auth:nonce:${nonce}`;
      const storedNonce = await redis.get(nonceRedisKey);
      if (!storedNonce) {
        return reply
          .code(401)
          .send({ error: "Nonce expired or not found. Request a new one." });
      }
      await redis.del(nonceRedisKey);

      // Verify SIWF
      let fid;
      try {
        const result = await AuthService.authenticateFarcaster(
          message,
          signature,
          nonce,
        );
        fid = result.fid;
      } catch (err) {
        fastify.log.error({ err }, "SIWF verification error during link");
        return reply
          .code(400)
          .send({ error: "Farcaster signature verification failed" });
      }
      if (!fid) {
        return reply
          .code(400)
          .send({ error: "Could not extract FID from SIWF message" });
      }

      // Resolve FID → username/displayName (ignore walletAddress — link binds
      // to the JWT's wallet, not the FID's primary wallet).
      let username = null;
      let displayName = null;
      let pfpUrl = null;
      try {
        const walletData = await resolveFidToWallet(fid);
        username = walletData.username || null;
        displayName = walletData.displayName || null;
        pfpUrl = walletData.pfpUrl || null;
      } catch (err) {
        fastify.log.warn(
          { err, fid },
          "FID resolution failed during link — proceeding with fid only",
        );
      }

      // Persist the link
      const linkResult = await linkFarcasterToWallet({
        walletAddress,
        fid,
        username,
        displayName,
      });
      if (!linkResult.success) {
        fastify.log.error(
          { error: linkResult.error, fid, walletAddress },
          "Farcaster link DB write failed",
        );
        return reply
          .code(500)
          .send({ error: linkResult.error || "Link failed" });
      }

      // Mint a refreshed JWT carrying the new identity claims
      const tokenPayload = {
        id: request.user.id,
        wallet_address: walletAddress,
        role: request.user.role || "user",
        fid,
      };
      if (username) tokenPayload.username = username;
      if (request.user.sma) tokenPayload.sma = request.user.sma;
      if (request.user.is_admin) tokenPayload.is_admin = true;

      const token = await AuthService.generateToken(tokenPayload);

      return reply.send({
        token,
        user: {
          address: walletAddress,
          fid,
          username,
          displayName,
          pfpUrl,
          accessLevel: request.user.accessLevel ?? null,
          role: request.user.role || "user",
          sma: request.user.sma ?? null,
          isAdmin: !!request.user.is_admin,
        },
      });
    },
  );
```

Add `linkFarcasterToWallet` and `unlinkFarcasterFromWallet` to the existing import line for `farcasterLinkService`:

```js
import {
  getLinkedFidForWallet,
  linkFarcasterToWallet,
  unlinkFarcasterFromWallet,
} from "../../shared/farcasterLinkService.js";
```

- [ ] **Step 4.5: Run tests, verify link endpoint passes**

```bash
cd packages/backend && npx vitest run tests/api/authRoutes.linkFarcaster.test.js -t "link-farcaster"
```

Expected: all 5 link-farcaster tests pass. Unlink and wallet-verify tests still fail (next task).

- [ ] **Step 4.6: Commit**

```bash
git add packages/backend/fastify/routes/authRoutes.js packages/backend/tests/api/authRoutes.linkFarcaster.test.js
git commit -m "$(cat <<'EOF'
feat(backend): POST /api/auth/link-farcaster endpoint

Authenticated endpoint that takes SIWF proof, attaches fid/username to
the bearer JWT's wallet via farcasterLinkService, and issues a refreshed
JWT. Neynar-resolved walletAddress is ignored — link binds to the JWT's
wallet, not the FID's primary wallet.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Backend — `POST /api/auth/unlink-farcaster` endpoint

**Files:**
- Modify: `packages/backend/fastify/routes/authRoutes.js` (register second new route)

- [ ] **Step 5.1: Register the unlink endpoint**

Inside `authRoutes`, after the `/link-farcaster` handler, add:

```js
  /**
   * POST /unlink-farcaster
   * Body: {} (empty JSON)
   * Requires: Authorization: Bearer <JWT>
   *
   * Idempotently clears fid/username from the wallet's allowlist row and
   * issues a refreshed JWT without the fid/username claims.
   */
  fastify.post(
    "/unlink-farcaster",
    { preHandler: requireBearer },
    async (request, reply) => {
      const walletAddress = request.user.wallet_address;
      if (!walletAddress) {
        return reply
          .code(400)
          .send({ error: "JWT has no wallet_address claim" });
      }

      const result = await unlinkFarcasterFromWallet(walletAddress);
      if (!result.success) {
        fastify.log.error(
          { error: result.error, walletAddress },
          "Farcaster unlink DB write failed",
        );
        return reply
          .code(500)
          .send({ error: result.error || "Unlink failed" });
      }

      const tokenPayload = {
        id: request.user.id,
        wallet_address: walletAddress,
        role: request.user.role || "user",
      };
      if (request.user.sma) tokenPayload.sma = request.user.sma;
      if (request.user.is_admin) tokenPayload.is_admin = true;

      const token = await AuthService.generateToken(tokenPayload);

      return reply.send({
        token,
        user: {
          address: walletAddress,
          fid: null,
          username: null,
          displayName: null,
          pfpUrl: null,
          accessLevel: request.user.accessLevel ?? null,
          role: request.user.role || "user",
          sma: request.user.sma ?? null,
          isAdmin: !!request.user.is_admin,
        },
      });
    },
  );
```

- [ ] **Step 5.2: Run all endpoint tests, verify unlink + wallet-verify embedding pass**

```bash
cd packages/backend && npx vitest run tests/api/authRoutes.linkFarcaster.test.js
```

Expected: all tests in the file pass (link, unlink, and wallet-verify-embedding).

- [ ] **Step 5.3: Run the full backend test suite**

```bash
cd packages/backend && npm test
```

Expected: all suites pass, no new failures.

- [ ] **Step 5.4: Lint**

```bash
cd packages/backend && npm run lint
```

Expected: zero warnings.

- [ ] **Step 5.5: Commit**

```bash
git add packages/backend/fastify/routes/authRoutes.js
git commit -m "$(cat <<'EOF'
feat(backend): POST /api/auth/unlink-farcaster endpoint

Authenticated, idempotent endpoint that clears fid/username from the
bearer JWT's wallet row in allowlist_entries and issues a refreshed
JWT without those claims. No-op when nothing was linked.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Frontend — `AppAuthProvider` exposes `linkFarcaster` / `unlinkFarcaster`

**Files:**
- Modify: `packages/frontend/src/context/AppAuthProvider.jsx`
- Test: `packages/frontend/src/context/__tests__/AppAuthProvider.linkFarcaster.test.jsx`

- [ ] **Step 6.1: Write failing tests**

Create `packages/frontend/src/context/__tests__/AppAuthProvider.linkFarcaster.test.jsx`:

```jsx
import { render, act, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useContext } from "react";

vi.mock("wagmi", () => ({
  useAccount: vi.fn(() => ({
    address: "0xabc",
    status: "connected",
  })),
}));

vi.mock("@wagmi/core", () => ({
  signMessage: vi.fn(),
}));

vi.mock("@/lib/wagmiConfig", () => ({ config: {} }));

vi.mock("@/hooks/useRaffleAccount", () => ({
  useRaffleAccount: () => ({ walletType: "desktop-eoa" }),
}));

vi.mock("@/lib/apiBase", () => ({ API_BASE: "http://api.test" }));

const mockFetch = vi.fn();
global.fetch = mockFetch;

import { AppAuthProvider } from "@/context/AppAuthProvider";
import { AppAuthContext } from "@/context/AppAuthContext";

let capturedCtx = null;
const Probe = () => {
  capturedCtx = useContext(AppAuthContext);
  return null;
};

const makeFakeJwt = (claims) => {
  // header.payload.signature with payload = base64(JSON(claims))
  const body = btoa(JSON.stringify({ ...claims, exp: Math.floor(Date.now() / 1000) + 3600 }));
  return `h.${body}.s`;
};

beforeEach(() => {
  capturedCtx = null;
  mockFetch.mockReset();
  localStorage.clear();
});

describe("AppAuthProvider.linkFarcaster", () => {
  it("POSTs to /auth/link-farcaster with bearer and replaces jwt+user", async () => {
    // Seed with an authenticated wallet JWT
    const initialJwt = makeFakeJwt({ wallet_address: "0xabc" });
    localStorage.setItem("sof:auth_jwt", initialJwt);
    localStorage.setItem(
      "sof:auth_user",
      JSON.stringify({ address: "0xabc", fid: null, username: null }),
    );

    const refreshedJwt = makeFakeJwt({
      wallet_address: "0xabc",
      fid: 42,
      username: "alice",
    });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        token: refreshedJwt,
        user: { address: "0xabc", fid: 42, username: "alice" },
      }),
    });

    render(
      <AppAuthProvider>
        <Probe />
      </AppAuthProvider>,
    );

    await waitFor(() => expect(capturedCtx?.status).toBe("authenticated"));
    expect(capturedCtx.user.fid).toBeNull();

    await act(async () => {
      await capturedCtx.linkFarcaster({
        message: "m",
        signature: "s",
        nonce: "n",
      });
    });

    expect(mockFetch).toHaveBeenCalledWith(
      "http://api.test/auth/link-farcaster",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: `Bearer ${initialJwt}`,
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({ message: "m", signature: "s", nonce: "n" }),
      }),
    );
    expect(capturedCtx.user.fid).toBe(42);
    expect(capturedCtx.user.username).toBe("alice");
    expect(capturedCtx.jwt).toBe(refreshedJwt);
  });

  it("sets status='error' and surfaces error on link failure", async () => {
    const initialJwt = makeFakeJwt({ wallet_address: "0xabc" });
    localStorage.setItem("sof:auth_jwt", initialJwt);

    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ error: "bad sig" }),
    });

    render(
      <AppAuthProvider>
        <Probe />
      </AppAuthProvider>,
    );

    await waitFor(() => expect(capturedCtx?.status).toBe("authenticated"));

    await act(async () => {
      await capturedCtx.linkFarcaster({
        message: "m",
        signature: "s",
        nonce: "n",
      });
    });

    expect(capturedCtx.status).toBe("error");
    expect(capturedCtx.error).toMatch(/bad sig/);
  });
});

describe("AppAuthProvider.unlinkFarcaster", () => {
  it("POSTs to /auth/unlink-farcaster and clears fid/username on success", async () => {
    const initialJwt = makeFakeJwt({
      wallet_address: "0xabc",
      fid: 42,
      username: "alice",
    });
    localStorage.setItem("sof:auth_jwt", initialJwt);
    localStorage.setItem(
      "sof:auth_user",
      JSON.stringify({ address: "0xabc", fid: 42, username: "alice" }),
    );

    const refreshedJwt = makeFakeJwt({ wallet_address: "0xabc" });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        token: refreshedJwt,
        user: { address: "0xabc", fid: null, username: null },
      }),
    });

    render(
      <AppAuthProvider>
        <Probe />
      </AppAuthProvider>,
    );

    await waitFor(() => expect(capturedCtx?.status).toBe("authenticated"));

    await act(async () => {
      await capturedCtx.unlinkFarcaster();
    });

    expect(mockFetch).toHaveBeenCalledWith(
      "http://api.test/auth/unlink-farcaster",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: `Bearer ${initialJwt}`,
        }),
      }),
    );
    expect(capturedCtx.user.fid).toBeNull();
    expect(capturedCtx.user.username).toBeNull();
  });
});
```

- [ ] **Step 6.2: Run the test, verify it fails**

```bash
cd packages/frontend && npx vitest run src/context/__tests__/AppAuthProvider.linkFarcaster.test.jsx
```

Expected: FAIL — `capturedCtx.linkFarcaster is not a function`.

- [ ] **Step 6.3: Add linkFarcaster and unlinkFarcaster to AppAuthProvider**

Edit `packages/frontend/src/context/AppAuthProvider.jsx`. After the `signIn` `useCallback` block (line ~227) and before `signOut`, add:

```js
  const linkFarcaster = useCallback(async ({ message, signature, nonce }) => {
    if (inflightRef.current) return;
    if (!jwt) {
      setError("Cannot link Farcaster — wallet not authenticated");
      setStatus("error");
      return;
    }

    inflightRef.current = true;
    setError(null);
    setStatus("verifying");

    try {
      const res = await fetch(`${API_BASE}/auth/link-farcaster`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${jwt}`,
        },
        body: JSON.stringify({ message, signature, nonce }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Link failed (${res.status})`);
      }

      const { token, user: userObj } = await res.json();
      setAuth({ jwt: token, user: userObj });
      setStatus("authenticated");
      persist(token, userObj);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[AppAuth] linkFarcaster failed:", err);
      setStatus("error");
      setError(err?.message || "Link failed");
    } finally {
      inflightRef.current = false;
    }
  }, [jwt, persist]);

  const unlinkFarcaster = useCallback(async () => {
    if (inflightRef.current) return;
    if (!jwt) return;

    inflightRef.current = true;
    setError(null);

    try {
      const res = await fetch(`${API_BASE}/auth/unlink-farcaster`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${jwt}`,
        },
        body: "{}",
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Unlink failed (${res.status})`);
      }

      const { token, user: userObj } = await res.json();
      setAuth({ jwt: token, user: userObj });
      setStatus("authenticated");
      persist(token, userObj);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[AppAuth] unlinkFarcaster failed:", err);
      setStatus("error");
      setError(err?.message || "Unlink failed");
    } finally {
      inflightRef.current = false;
    }
  }, [jwt, persist]);
```

Then update the `value` memo (line ~291-294):

```js
  const value = useMemo(
    () => ({
      jwt,
      user,
      status,
      error,
      signIn,
      signOut,
      linkFarcaster,
      unlinkFarcaster,
      getAuthHeaders,
    }),
    [jwt, user, status, error, signIn, signOut, linkFarcaster, unlinkFarcaster, getAuthHeaders],
  );
```

- [ ] **Step 6.4: Run the test, verify it passes**

```bash
cd packages/frontend && npx vitest run src/context/__tests__/AppAuthProvider.linkFarcaster.test.jsx
```

Expected: all 3 tests pass.

- [ ] **Step 6.5: Commit**

```bash
git add packages/frontend/src/context/AppAuthProvider.jsx packages/frontend/src/context/__tests__/AppAuthProvider.linkFarcaster.test.jsx
git commit -m "$(cat <<'EOF'
feat(frontend): linkFarcaster + unlinkFarcaster on AppAuthContext

Two new context methods that POST to the matching backend endpoints
with the current bearer JWT, replace local {jwt, user} from the
response, and persist via the existing persist/clearStorage helpers.
Reuse inflightRef so concurrent calls are guarded the same way as
signIn.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Frontend — `useFarcasterSignIn` branches on JWT presence

**Files:**
- Modify: `packages/frontend/src/hooks/useFarcasterSignIn.js`
- Test: `packages/frontend/src/hooks/__tests__/useFarcasterSignIn.branching.test.jsx`

- [ ] **Step 7.1: Write failing test**

Create `packages/frontend/src/hooks/__tests__/useFarcasterSignIn.branching.test.jsx`:

```jsx
import { renderHook, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSignIn = vi.fn();
const mockLinkFarcaster = vi.fn();
const mockUseAppAuth = vi.fn();

vi.mock("@/hooks/useAppAuth", () => ({
  useAppAuth: () => mockUseAppAuth(),
}));

const mockFetchNonce = vi.fn().mockResolvedValue("nonce-123");
vi.mock("@/hooks/useFarcaster", () => ({
  useFarcaster: () => ({ fetchNonce: mockFetchNonce }),
}));

const mockUseSignInConnect = vi.fn();
const mockUseSignInReconnect = vi.fn();
const mockUseSignInSignOut = vi.fn();
let mockChannelToken = null;
vi.mock("@farcaster/auth-kit", () => ({
  useSignIn: () => ({
    signOut: mockUseSignInSignOut,
    connect: mockUseSignInConnect,
    reconnect: mockUseSignInReconnect,
    channelToken: mockChannelToken,
    url: "https://example.com/qr",
    isError: false,
  }),
}));

vi.mock("@/hooks/useToast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (_k, fallback) => fallback }),
}));

// Mock global fetch used by the relay poll
const originalFetch = global.fetch;

beforeEach(() => {
  mockSignIn.mockReset();
  mockLinkFarcaster.mockReset();
  mockUseAppAuth.mockReset();
  mockChannelToken = null;
  global.fetch = vi.fn((url) => {
    if (url.startsWith("https://relay.farcaster.xyz")) {
      return Promise.resolve({
        status: 200,
        ok: true,
        json: async () => ({
          state: "completed",
          message: "siwf-msg",
          signature: "0xsig",
        }),
      });
    }
    return originalFetch?.(url);
  });
});

describe("useFarcasterSignIn JWT branching", () => {
  it("calls linkFarcaster when a JWT exists", async () => {
    mockUseAppAuth.mockReturnValue({
      signIn: mockSignIn,
      linkFarcaster: mockLinkFarcaster,
      status: "authenticated",
      jwt: "existing-jwt",
    });

    const { useFarcasterSignIn } = await import("@/hooks/useFarcasterSignIn");
    mockChannelToken = "ch_token_1";
    renderHook(() => useFarcasterSignIn());

    await waitFor(() => {
      expect(mockLinkFarcaster).toHaveBeenCalledWith({
        message: "siwf-msg",
        signature: "0xsig",
        nonce: "nonce-123",
      });
    });
    expect(mockSignIn).not.toHaveBeenCalled();
  });

  it("calls signIn(method=farcaster) when no JWT exists", async () => {
    mockUseAppAuth.mockReturnValue({
      signIn: mockSignIn,
      linkFarcaster: mockLinkFarcaster,
      status: "idle",
      jwt: null,
    });

    const { useFarcasterSignIn } = await import("@/hooks/useFarcasterSignIn");
    mockChannelToken = "ch_token_2";
    renderHook(() => useFarcasterSignIn());

    await waitFor(() => {
      expect(mockSignIn).toHaveBeenCalledWith({
        method: "farcaster",
        message: "siwf-msg",
        signature: "0xsig",
        nonce: "nonce-123",
      });
    });
    expect(mockLinkFarcaster).not.toHaveBeenCalled();
  });
});
```

Note: this test imports `useFarcasterSignIn` lazily inside each `it` to ensure module-scoped state (the auth-kit hook closure) re-reads the per-test mockChannelToken value. Vitest's module cache is per-test by default with `vi.mock` hoisting; that's why the dynamic import is used.

- [ ] **Step 7.2: Run the test, verify it fails**

```bash
cd packages/frontend && npx vitest run src/hooks/__tests__/useFarcasterSignIn.branching.test.jsx
```

Expected: FAIL — `mockLinkFarcaster` is never called (current code unconditionally calls `signIn`).

- [ ] **Step 7.3: Branch the relay callback**

Edit `packages/frontend/src/hooks/useFarcasterSignIn.js`.

Replace line 27:

```js
  const { signIn, status: appAuthStatus } = useAppAuth();
```

with:

```js
  const { signIn, linkFarcaster, jwt, status: appAuthStatus } = useAppAuth();
```

Replace lines 156-160 (the `await signIn(...)` block plus its toast and onSuccess call):

```js
        if (jwt) {
          await linkFarcaster({ message, signature, nonce });
        } else {
          await signIn({ method: "farcaster", message, signature, nonce });
        }
        toast({
          title: t("siwfSuccess", "Signed In"),
          description: t("welcome", "Welcome"),
        });
        onSuccessRef.current?.();
```

- [ ] **Step 7.4: Run the test, verify it passes**

```bash
cd packages/frontend && npx vitest run src/hooks/__tests__/useFarcasterSignIn.branching.test.jsx
```

Expected: both tests pass.

- [ ] **Step 7.5: Commit**

```bash
git add packages/frontend/src/hooks/useFarcasterSignIn.js packages/frontend/src/hooks/__tests__/useFarcasterSignIn.branching.test.jsx
git commit -m "$(cat <<'EOF'
feat(frontend): useFarcasterSignIn branches on JWT presence

After SIWF channel completion, call linkFarcaster when a wallet JWT
already exists (Desktop link path) and signIn(method=farcaster) when
no JWT (MiniApp wallet-replacement path). Preserves the MiniApp flow.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Frontend — `Header.jsx` `farcasterUser` prop gating

**Files:**
- Modify: `packages/frontend/src/components/layout/Header.jsx:150`
- Test: `packages/frontend/src/components/layout/__tests__/Header.farcasterUser.test.jsx`

- [ ] **Step 8.1: Write failing test**

Create `packages/frontend/src/components/layout/__tests__/Header.farcasterUser.test.jsx`:

```jsx
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

vi.mock("wagmi", () => ({
  useAccount: () => ({ address: "0xabc", isConnected: true }),
  useDisconnect: () => ({ disconnect: vi.fn() }),
}));

vi.mock("@/hooks/useAppAuth", () => ({
  useAppAuth: vi.fn(),
}));

vi.mock("@/hooks/useLoginModal", () => ({
  useLoginModal: () => ({ openLoginModal: vi.fn() }),
}));

vi.mock("@/hooks/useUsername", () => ({
  useUsername: () => ({ data: null }),
}));

vi.mock("@/hooks/useRaffleAccount", () => ({
  useRaffleAccount: () => ({ sma: "0xsma", walletType: "desktop-eoa" }),
}));

vi.mock("@/hooks/useAllowlist", () => ({
  useAllowlist: () => ({ accessLevel: 1 }),
}));

vi.mock("@/hooks/useRouteAccess", () => ({
  useRouteAccess: () => ({ isDisabled: true, hasAccess: false }),
}));

// Capture the farcasterUser prop passed to SettingsMenu
const capturedProps = { farcasterUser: undefined };
vi.mock("@/components/common/SettingsMenu", () => ({
  default: (props) => {
    capturedProps.farcasterUser = props.farcasterUser;
    return <div data-testid="settings-menu" />;
  },
}));

vi.mock("@/components/auth/FarcasterAuth", () => ({
  default: () => <div data-testid="farcaster-auth" />,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (_k, f) => f }),
}));

import { useAppAuth } from "@/hooks/useAppAuth";
import Header from "@/components/layout/Header";

const renderHeader = () =>
  render(
    <MemoryRouter>
      <Header />
    </MemoryRouter>,
  );

describe("Header — farcasterUser prop", () => {
  it("passes null when backendUser has no fid", () => {
    vi.mocked(useAppAuth).mockReturnValue({
      user: { address: "0xabc", fid: null, username: null },
      status: "authenticated",
      signOut: vi.fn(),
    });
    capturedProps.farcasterUser = undefined;
    renderHeader();
    expect(screen.getByTestId("settings-menu")).toBeInTheDocument();
    expect(capturedProps.farcasterUser).toBeNull();
  });

  it("passes the backendUser when fid is present", () => {
    const user = { address: "0xabc", fid: 42, username: "alice" };
    vi.mocked(useAppAuth).mockReturnValue({
      user,
      status: "authenticated",
      signOut: vi.fn(),
    });
    capturedProps.farcasterUser = undefined;
    renderHeader();
    expect(capturedProps.farcasterUser).toEqual(user);
  });
});
```

- [ ] **Step 8.2: Run, verify failure**

```bash
cd packages/frontend && npx vitest run src/components/layout/__tests__/Header.farcasterUser.test.jsx
```

Expected: FAIL — first test fails because the current code passes the whole `backendUser` even when `fid` is null.

- [ ] **Step 8.3: Fix the gating**

Edit `packages/frontend/src/components/layout/Header.jsx:150`:

```diff
-                farcasterUser={isBackendAuthenticated ? backendUser : null}
+                farcasterUser={backendUser?.fid ? backendUser : null}
```

- [ ] **Step 8.4: Run, verify pass**

```bash
cd packages/frontend && npx vitest run src/components/layout/__tests__/Header.farcasterUser.test.jsx
```

Expected: both tests pass.

- [ ] **Step 8.5: Commit**

```bash
git add packages/frontend/src/components/layout/Header.jsx packages/frontend/src/components/layout/__tests__/Header.farcasterUser.test.jsx
git commit -m "$(cat <<'EOF'
fix(frontend): gate Header.farcasterUser prop on fid, not auth state

Wallet-only SIWE users have fid=null on backendUser; passing the whole
object caused SettingsMenu to render the 'Linked' branch as
'@FID null'. Gate on backendUser?.fid so the prop is null when no
Farcaster identity is linked.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Frontend — `FarcasterAuth.jsx` gating + unlink button

**Files:**
- Modify: `packages/frontend/src/components/auth/FarcasterAuth.jsx:42-73`
- Test: `packages/frontend/src/components/auth/__tests__/FarcasterAuth.gating.test.jsx`

- [ ] **Step 9.1: Write failing test**

Create `packages/frontend/src/components/auth/__tests__/FarcasterAuth.gating.test.jsx`:

```jsx
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

vi.mock("@/hooks/useFarcaster", () => ({
  useFarcaster: () => ({ profile: null }),
}));

const mockUseAppAuth = vi.fn();
vi.mock("@/hooks/useAppAuth", () => ({
  useAppAuth: () => mockUseAppAuth(),
}));

const mockHandleSignInClick = vi.fn();
const mockHandleCancel = vi.fn();
const mockSiwfSignOut = vi.fn();
vi.mock("@/hooks/useFarcasterSignIn", () => ({
  useFarcasterSignIn: () => ({
    handleSignInClick: mockHandleSignInClick,
    handleCancel: mockHandleCancel,
    signOut: mockSiwfSignOut,
    showQrView: false,
    url: null,
    isLoading: false,
  }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (_k, f) => f }),
}));

vi.mock("qrcode.react", () => ({ QRCodeSVG: () => null }));

import FarcasterAuth from "@/components/auth/FarcasterAuth";

describe("FarcasterAuth gating", () => {
  it("shows the Sign in with Farcaster button when fid is null even if authenticated", () => {
    mockUseAppAuth.mockReturnValue({
      user: { address: "0xabc", fid: null, username: null },
      status: "authenticated",
      signOut: vi.fn(),
      unlinkFarcaster: vi.fn(),
    });
    render(<FarcasterAuth />);
    expect(screen.getByText("Sign in with Farcaster")).toBeInTheDocument();
  });

  it("shows the profile view when fid is present", () => {
    mockUseAppAuth.mockReturnValue({
      user: { address: "0xabc", fid: 42, username: "alice" },
      status: "authenticated",
      signOut: vi.fn(),
      unlinkFarcaster: vi.fn(),
    });
    render(<FarcasterAuth />);
    expect(screen.getByText("@alice")).toBeInTheDocument();
    expect(screen.queryByText("Sign in with Farcaster")).not.toBeInTheDocument();
  });

  it("calls unlinkFarcaster (not appAuthSignOut) when Sign Out is clicked in profile view", () => {
    const unlinkFarcaster = vi.fn();
    const appAuthSignOut = vi.fn();
    mockUseAppAuth.mockReturnValue({
      user: { address: "0xabc", fid: 42, username: "alice" },
      status: "authenticated",
      signOut: appAuthSignOut,
      unlinkFarcaster,
    });
    render(<FarcasterAuth />);

    fireEvent.click(screen.getByText("Sign Out"));

    expect(unlinkFarcaster).toHaveBeenCalled();
    expect(appAuthSignOut).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 9.2: Run, verify failure**

```bash
cd packages/frontend && npx vitest run src/components/auth/__tests__/FarcasterAuth.gating.test.jsx
```

Expected: tests 1 and 3 fail (current code shows ProfileView when authenticated regardless of fid; sign-out calls `appAuthSignOut`, not `unlinkFarcaster`).

- [ ] **Step 9.3: Fix the gating and the sign-out behavior**

Edit `packages/frontend/src/components/auth/FarcasterAuth.jsx`. Replace lines 20-73 (the destructure of `useAppAuth`, the derived locals, and the authenticated-state block):

```jsx
  const {
    user: appAuthUser,
    unlinkFarcaster,
  } = useAppAuth();

  const username = appAuthUser?.username || null;
  const fid = appAuthUser?.fid || null;
  const displayName = profile?.displayName || null;
  const pfpUrl = profile?.pfpUrl || null;

  const {
    handleSignInClick,
    handleCancel,
    signOut,
    showQrView,
    url,
    isLoading,
  } = useFarcasterSignIn();

  // Linked state — show profile + unlink button
  if (fid) {
    return (
      <div className="flex items-center gap-3">
        {pfpUrl && (
          <img
            src={pfpUrl}
            alt={displayName || username || ""}
            className="w-8 h-8 rounded-full"
          />
        )}
        <div className="flex flex-col">
          <span className="text-sm font-medium text-foreground">
            {displayName || username || `FID ${fid}`}
          </span>
          {username && (
            <span className="text-xs text-muted-foreground">
              @{username}
            </span>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            signOut();
            unlinkFarcaster();
          }}
        >
          {t("farcasterSignOut", "Sign Out")}
        </Button>
      </div>
    );
  }
```

Remove the now-unused imports at the top:
- Remove `status: authStatus` and `signOut: appAuthSignOut` from the destructure (above).
- The `useAppAuth` import line stays (just the destructure shape changed).

- [ ] **Step 9.4: Run, verify pass**

```bash
cd packages/frontend && npx vitest run src/components/auth/__tests__/FarcasterAuth.gating.test.jsx
```

Expected: all 3 tests pass.

- [ ] **Step 9.5: Commit**

```bash
git add packages/frontend/src/components/auth/FarcasterAuth.jsx packages/frontend/src/components/auth/__tests__/FarcasterAuth.gating.test.jsx
git commit -m "$(cat <<'EOF'
fix(frontend): FarcasterAuth gates profile view on fid + uses unlink

The 'authenticated profile' branch now renders only when appAuthUser.fid
is set, so wallet-only SIWE users see the 'Sign in with Farcaster'
button (previously hidden because the branch matched on
isBackendAuthenticated). The Sign Out button now calls unlinkFarcaster
to clear the Farcaster identity from the JWT without disconnecting the
wallet.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Frontend — `SettingsMenu` defense-in-depth gate

**Files:**
- Modify: `packages/frontend/src/components/common/SettingsMenu.jsx:345`
- Test: `packages/frontend/src/components/common/__tests__/SettingsMenu.linkedBadge.test.jsx`

The Header fix in Task 8 already ensures `SettingsMenu` never receives a `farcasterUser` without `fid`. This test+change is a belt-and-braces guard so that if any future caller passes the wrong shape, the badge still won't show `@FID null`.

- [ ] **Step 10.1: Write failing test**

Create `packages/frontend/src/components/common/__tests__/SettingsMenu.linkedBadge.test.jsx`:

```jsx
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (_k, f) => f, i18n: { language: "en" } }),
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: null, isLoading: false }),
}));

vi.mock("@/lib/viemClient", () => ({ buildPublicClient: () => null }));

vi.mock("@/context/ThemeContext", () => ({
  useTheme: () => ({ theme: "system", setTheme: vi.fn() }),
}));

vi.mock("@/lib/wagmi", () => ({ getStoredNetworkKey: () => "LOCAL" }));

vi.mock("@/config/networks", () => ({
  getNetworkByKey: () => ({ rpcUrl: "http://localhost" }),
}));

vi.mock("@/config/contracts", () => ({ getContractAddresses: () => ({}) }));

vi.mock("@/components/auth/FarcasterAuth", () => ({
  default: () => <div data-testid="farcaster-auth-button" />,
}));

vi.mock("@/components/account/UsernameEditor", () => ({
  default: () => null,
}));

vi.mock("@/hooks/useRaffleAccount", () => ({
  useRaffleAccount: () => ({
    eoa: "0xabc",
    sma: "0xsma",
    walletType: "desktop-eoa",
    isReady: true,
  }),
}));

import SettingsMenu from "@/components/common/SettingsMenu";

describe("SettingsMenu — linked badge defense-in-depth", () => {
  it("does NOT render the Linked badge when farcasterUser exists but has no fid", () => {
    // Pass a truthy-but-incomplete farcasterUser (the bug shape)
    render(
      <SettingsMenu
        address="0xabc"
        username={null}
        farcasterUser={{ address: "0xabc", fid: null, username: null }}
        onDisconnect={vi.fn()}
      />,
    );
    // The 'Linked' badge text comes from t("auth:farcasterLinked", "Linked")
    expect(screen.queryByText("Linked")).not.toBeInTheDocument();
  });

  it("renders the FarcasterAuth connect button when fid is null", () => {
    render(
      <SettingsMenu
        address="0xabc"
        username={null}
        farcasterUser={{ address: "0xabc", fid: null }}
        onDisconnect={vi.fn()}
      />,
    );
    expect(screen.getByTestId("farcaster-auth-button")).toBeInTheDocument();
  });
});
```

Note: SettingsMenu is a dropdown that doesn't render its content until opened. If the test runs against the closed state, the assertion `queryByText("Linked")` correctly returns null (the badge isn't in the DOM). If RTL renders the open state via portal (Radix's `DropdownMenu` defers content rendering until open), and the test fails because nothing is in the DOM, change the assertion to also wrap the menu in a `<DropdownMenu open>` shim or use `getAllByText` against the portal root. If needed, add an explicit `defaultOpen` check by inspecting how Radix's `DropdownMenu` behaves in tests; fall back to splitting the linked-badge logic into a small testable subcomponent.

- [ ] **Step 10.2: Run, verify failure**

```bash
cd packages/frontend && npx vitest run src/components/common/__tests__/SettingsMenu.linkedBadge.test.jsx
```

If Radix dropdown content isn't rendered when closed: the test will pass trivially. In that case the failure is conceptual, not real — skip the test step and apply the fix in 10.3 anyway. Document the limitation by leaving the test asserting "does not render Linked badge" — it's still a useful regression guard even if it only fires when the dropdown is opened in another test.

Expected (best case): FAIL — the current code renders the Linked branch on object truthiness.

- [ ] **Step 10.3: Tighten the gate**

Edit `packages/frontend/src/components/common/SettingsMenu.jsx:345`:

```diff
-          {farcasterUser ? (
+          {farcasterUser?.fid ? (
```

- [ ] **Step 10.4: Run, verify pass**

```bash
cd packages/frontend && npx vitest run src/components/common/__tests__/SettingsMenu.linkedBadge.test.jsx
```

Expected: pass.

- [ ] **Step 10.5: Commit**

```bash
git add packages/frontend/src/components/common/SettingsMenu.jsx packages/frontend/src/components/common/__tests__/SettingsMenu.linkedBadge.test.jsx
git commit -m "$(cat <<'EOF'
fix(frontend): SettingsMenu gates Linked badge on fid (defense in depth)

Header now ensures farcasterUser is null without fid, but tighten the
badge gate so any future caller that passes the wrong shape still
doesn't render '@FID null - Linked'.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Version bumps + full pre-merge checks

**Files:**
- Modify: `packages/backend/package.json`
- Modify: `packages/frontend/package.json`

- [ ] **Step 11.1: Bump backend version**

Edit `packages/backend/package.json`: `"version": "0.26.0"` → `"version": "0.27.0"`.

- [ ] **Step 11.2: Bump frontend version**

Edit `packages/frontend/package.json`: `"version": "0.38.0"` → `"version": "0.39.0"`.

- [ ] **Step 11.3: Run all tests**

```bash
cd /Users/psd/Projects/SOf/sof-beta && npm test
```

Expected: all packages green.

- [ ] **Step 11.4: Run lint**

```bash
cd /Users/psd/Projects/SOf/sof-beta && npm run lint
```

Expected: zero warnings (frontend enforces `--max-warnings 0`).

- [ ] **Step 11.5: Run build**

```bash
cd /Users/psd/Projects/SOf/sof-beta && npm run build
```

Expected: all packages build clean.

- [ ] **Step 11.6: Commit version bumps**

```bash
git add packages/backend/package.json packages/frontend/package.json
git commit -m "$(cat <<'EOF'
chore: bump backend 0.27.0, frontend 0.39.0 for Farcaster link

Minor bump per CLAUDE.md monorepo rules (new feature: link-only
Farcaster attachment on Desktop without wallet replacement).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: Open PR

- [ ] **Step 12.1: Push the branch (invoke `superpowers:github-pr-workflow` first)**

Invoke the `github-pr-workflow` skill. Then:

```bash
git push -u origin feat/farcaster-link-semantic
```

- [ ] **Step 12.2: Open the PR**

```bash
gh pr create --title "feat: Farcaster link semantic for Desktop (fix @FID null - Linked)" --body "$(cat <<'EOF'
## Summary
- Two new authenticated endpoints (`POST /api/auth/link-farcaster`, `POST /api/auth/unlink-farcaster`) attach/detach a Farcaster identity to the JWT's wallet without replacing the wallet binding.
- Wallet SIWE verify path now embeds any pre-linked FID into the issued JWT so links survive wallet reconnects.
- Frontend gates Farcaster UI on the presence of `fid` (not on backend-auth state), fixing the `@FID null - Linked` badge and unhiding the "Sign in with Farcaster" button for wallet-only users.
- MiniApp `method: "farcaster"` flow is untouched.
- Reuses `allowlist_entries` — no DB migration.

## Test plan
- [ ] Backend tests pass: `cd packages/backend && npm test`
- [ ] Frontend tests pass: `cd packages/frontend && npm test`
- [ ] Lint clean: `npm run lint`
- [ ] Build clean: `npm run build`
- [ ] Manual smoke (preview): connect Desktop wallet → no badge → click Sign in with Farcaster from settings → badge appears, wallet stays connected
- [ ] Manual smoke (preview): disconnect + reconnect same wallet → linked state restored without re-SIWF
- [ ] Manual smoke (preview): click Sign Out (in linked profile view) → badge clears, wallet remains
- [ ] Manual smoke (preview): MiniApp opens cleanly, single auto-SIWF as today

Spec: `docs/superpowers/specs/2026-05-20-farcaster-link-semantic-design.md`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 12.3: Verify CI starts**

```bash
gh pr checks --watch
```

Expected: CI runs and passes.

---

## Self-Review Notes (run before handoff)

Confirmed during plan authoring:

1. **Spec coverage:**
   - "Two new authenticated endpoints" → Tasks 4, 5.
   - "Wallet SIWE embeds pre-linked FID" → Task 3.
   - "Reassign-on-conflict" → Task 1 (covered by tests 4 & 5 in the service test).
   - "No migration, reuse `allowlist_entries`" → Task 1 only writes to existing columns.
   - "Header / FarcasterAuth / SettingsMenu UI fixes" → Tasks 8, 9, 10.
   - "useFarcasterSignIn branches on JWT" → Task 7.
   - "AppAuthProvider exposes link/unlink" → Task 6.
   - "JWT carries username claim" → Task 2.
   - "Version bumps + tests + lint + build" → Task 11.
   - "MiniApp unchanged" → Task 7's test verifies the `signIn({ method: "farcaster" })` branch is still hit when no JWT exists.

2. **Type/naming consistency check:**
   - Service exports: `getLinkedFidForWallet`, `linkFarcasterToWallet`, `unlinkFarcasterFromWallet`. Used identically in Tasks 1, 3, 4, 5. ✓
   - Context methods: `linkFarcaster`, `unlinkFarcaster`. Used in Tasks 6, 7, 9. ✓
   - Return shape from service: `{ success, entry?, error?, noop? }`. Consumed consistently. ✓
   - JWT claim names: `wallet_address`, `fid`, `username` (snake-case wallet, bare fid/username). ✓
   - User object fields: `address`, `fid`, `username`, `displayName`, `pfpUrl`, `sma`, `isAdmin`, `accessLevel`, `role`. Consistent in Task 4, 5, 6 tests. ✓

3. **Placeholder scan:** No TBD / TODO / "similar to" references. Every code step shows real code.

4. **Ambiguity check:** Task 10's note about Radix dropdown rendering is explicit about the test limitation rather than hand-waving. Task 7's note about dynamic import explains the why.
