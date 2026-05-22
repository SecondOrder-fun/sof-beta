# Access Lookup SMA Awareness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `accessService.getUserAccess` resolve through the `smart_accounts` EOA↔SMA mapping on wallet miss, so an admin who allowlisted one address (EOA or SMA) matches a user signing in with the other. Surface the resolution path in the API and admin UI.

**Architecture:** New pure helper `resolveAddressPair(address)` consults `smart_accounts` in both directions and is reused by two call sites — `getUserAccess` (lookup fallback on wallet miss) and `invalidateUserAccessCache` (symmetric cache busting). Lookup response gains `matchedVia: "direct" | "sma_pair" | null` plus `matchedAddress`. UserAccessPanel renders a "Matched via Smart Account" row when the resolved path hits.

**Tech Stack:** Node.js + Vitest backend, Supabase client, Fastify routes; React + Vitest + @testing-library/react frontend.

**Spec:** `docs/superpowers/specs/2026-05-22-access-lookup-sma-awareness-design.md`

**Branch:** `feat/access-lookup-sma-awareness` (already created from `origin/main`; spec already committed at `9f73945`).

**Depends on:** PR #100 (`feat/admin-user-picker`) — introduces `UserAccessPanel.test.jsx` and the picker integration. If #100 hasn't merged by Task 6, either rebase onto #100's tip or wait for the merge.

---

## File Structure

| File | Status | Responsibility |
|------|--------|----------------|
| `packages/backend/shared/services/addressPairResolver.js` | **create** | `resolveAddressPair(address, log)` — pure helper, two-direction `smart_accounts` lookup, error-tolerant |
| `packages/backend/tests/services/addressPairResolver.test.js` | **create** | Unit tests for the helper |
| `packages/backend/shared/accessService.js` | **modify** | `getUserAccess` wallet-miss branch calls the helper; response gains `matchedVia` + `matchedAddress` |
| `packages/backend/tests/services/accessService.smaResolution.test.js` | **create** | Focused tests for the new SMA-fallback branches in `getUserAccess` |
| `packages/backend/fastify/routes/accessRoutes.js` | **modify** | `/access/check` forwards `matchedVia` + `matchedAddress` in the response body |
| `packages/backend/shared/accessCache.js` | **modify** | `invalidateUserAccessCache` symmetric busting via the helper |
| `packages/backend/tests/backend/accessCache.test.js` | **modify** | Extend with symmetric-invalidation cases |
| `packages/frontend/src/components/admin/access/UserAccessPanel.jsx` | **modify** | Add "Matched via" row when `userData.matchedVia === "sma_pair"` |
| `packages/frontend/src/components/admin/access/__tests__/UserAccessPanel.test.jsx` | **modify** | Add one `it()` covering the new conditional row |
| `packages/backend/package.json` | **modify** | Patch bump `0.27.0 → 0.27.1` |
| `packages/frontend/package.json` | **modify** | Patch bump (currently `0.39.11` on this branch — bump to `0.39.12`; if PR #100 has merged, bump to whatever follows `0.39.12`) |

---

## Task 1: `resolveAddressPair` helper

**Files:**
- Create: `packages/backend/tests/services/addressPairResolver.test.js`
- Create: `packages/backend/shared/services/addressPairResolver.js`

- [ ] **Step 1: Write the failing tests**

`packages/backend/tests/services/addressPairResolver.test.js`:

```js
// tests/services/addressPairResolver.test.js
// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from "vitest";

const dbMocks = vi.hoisted(() => ({
  mockGetByEoa: vi.fn(),
  mockGetBySma: vi.fn(),
}));

vi.mock("../../shared/services/smartAccountsDb.js", () => ({
  smartAccountsDb: {
    getSmartAccountByEoa: (...args) => dbMocks.mockGetByEoa(...args),
    getSmartAccountBySma: (...args) => dbMocks.mockGetBySma(...args),
  },
}));

import { resolveAddressPair } from "../../shared/services/addressPairResolver.js";

const EOA_LC = "0xaaaa000000000000000000000000000000000001";
const SMA_LC = "0xbbbb000000000000000000000000000000000002";
const PAIR_ROW = { eoa: EOA_LC, sma: SMA_LC };

function makeLogger() {
  return { warn: vi.fn(), error: vi.fn() };
}

beforeEach(() => {
  dbMocks.mockGetByEoa.mockReset();
  dbMocks.mockGetBySma.mockReset();
});

describe("resolveAddressPair", () => {
  it("returns the pair when input is the EOA", async () => {
    dbMocks.mockGetByEoa.mockResolvedValueOnce(PAIR_ROW);
    const result = await resolveAddressPair(EOA_LC, makeLogger());
    expect(result).toEqual({ eoa: EOA_LC, sma: SMA_LC });
    expect(dbMocks.mockGetByEoa).toHaveBeenCalledWith(EOA_LC);
    expect(dbMocks.mockGetBySma).not.toHaveBeenCalled();
  });

  it("returns the pair when input is the SMA (reverse direction)", async () => {
    dbMocks.mockGetByEoa.mockResolvedValueOnce(null);
    dbMocks.mockGetBySma.mockResolvedValueOnce(PAIR_ROW);
    const result = await resolveAddressPair(SMA_LC, makeLogger());
    expect(result).toEqual({ eoa: EOA_LC, sma: SMA_LC });
    expect(dbMocks.mockGetByEoa).toHaveBeenCalledWith(SMA_LC);
    expect(dbMocks.mockGetBySma).toHaveBeenCalledWith(SMA_LC);
  });

  it("returns null when the address is not in smart_accounts", async () => {
    dbMocks.mockGetByEoa.mockResolvedValueOnce(null);
    dbMocks.mockGetBySma.mockResolvedValueOnce(null);
    const result = await resolveAddressPair("0xdeadbeef0000000000000000000000000000beef", makeLogger());
    expect(result).toBeNull();
  });

  it("lowercases the input before querying", async () => {
    dbMocks.mockGetByEoa.mockResolvedValueOnce(PAIR_ROW);
    const MIXED = "0xAaAa000000000000000000000000000000000001";
    await resolveAddressPair(MIXED, makeLogger());
    expect(dbMocks.mockGetByEoa).toHaveBeenCalledWith(EOA_LC);
  });

  it("catches a DB error and returns null with a warn log", async () => {
    dbMocks.mockGetByEoa.mockRejectedValueOnce(new Error("supabase boom"));
    const logger = makeLogger();
    const result = await resolveAddressPair(EOA_LC, logger);
    expect(result).toBeNull();
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it("returns null when address is null/undefined/empty without calling the db", async () => {
    expect(await resolveAddressPair(null, makeLogger())).toBeNull();
    expect(await resolveAddressPair(undefined, makeLogger())).toBeNull();
    expect(await resolveAddressPair("", makeLogger())).toBeNull();
    expect(dbMocks.mockGetByEoa).not.toHaveBeenCalled();
    expect(dbMocks.mockGetBySma).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests — expect failures (module not found)**

```bash
cd packages/backend && npx vitest run tests/services/addressPairResolver.test.js
```

Expected: failure resolving `../../shared/services/addressPairResolver.js`.

- [ ] **Step 3: Create the helper**

`packages/backend/shared/services/addressPairResolver.js`:

```js
/**
 * addressPairResolver
 *
 * Given any address, looks up its EOA↔SMA pair in smart_accounts. Used by
 * accessService.getUserAccess for SMA-aware allowlist fallback and by
 * accessCache.invalidateUserAccessCache for symmetric cache busting.
 *
 * Error-tolerant: any DB failure returns null with a warn log so callers
 * never block on smart-account resolution.
 */

import { smartAccountsDb } from "./smartAccountsDb.js";

/**
 * @param {string} address — case-insensitive
 * @param {{warn: Function}} [log=console]
 * @returns {Promise<{ eoa: string, sma: string } | null>} — lowercased
 */
export async function resolveAddressPair(address, log = console) {
  if (!address || typeof address !== "string") return null;
  const lc = address.toLowerCase();
  try {
    let row = await smartAccountsDb.getSmartAccountByEoa(lc);
    if (row) return { eoa: row.eoa, sma: row.sma };
    row = await smartAccountsDb.getSmartAccountBySma(lc);
    if (row) return { eoa: row.eoa, sma: row.sma };
    return null;
  } catch (err) {
    if (typeof log.warn === "function") {
      log.warn(
        { err: err.message, address: lc },
        "[addressPairResolver] lookup failed",
      );
    }
    return null;
  }
}

export default resolveAddressPair;
```

- [ ] **Step 4: Run tests — expect 6 passing**

```bash
cd packages/backend && npx vitest run tests/services/addressPairResolver.test.js
```

Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/shared/services/addressPairResolver.js \
        packages/backend/tests/services/addressPairResolver.test.js
git commit -m "feat(backend): resolveAddressPair helper for SMA-aware access lookup

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Push branch + open draft PR

**Files:** none

After Task 1's first meaningful commit, push and open a draft PR per `github-pr-workflow` Phase 2. This triggers the Railway backend preview so subsequent backend changes can be tested in the cloud env.

- [ ] **Step 1: Push and open the draft PR**

```bash
git push -u origin feat/access-lookup-sma-awareness
gh pr create --draft --title "feat(backend): SMA-aware access lookup" --body "$(cat <<'EOF'
## Summary
- New `resolveAddressPair` helper consults `smart_accounts` in both directions.
- `accessService.getUserAccess` falls back to the paired address on wallet miss; response gains `matchedVia` + `matchedAddress`.
- `accessCache.invalidateUserAccessCache` symmetric busting via the helper.
- `UserAccessPanel` renders a "Matched via Smart Account" row when the resolved path hits.
- Spec: `docs/superpowers/specs/2026-05-22-access-lookup-sma-awareness-design.md`
- Plan: `docs/superpowers/plans/2026-05-22-access-lookup-sma-awareness.md`
- **Depends on PR #100** for the `UserAccessPanel.test.jsx` file we extend.

## Test plan
- [ ] `cd packages/backend && npm test -- addressPairResolver accessService.smaResolution accessCache` — all green
- [ ] `cd packages/frontend && npm test -- UserAccessPanel` — extended test passes
- [ ] Preview: Admin → Access tab → User Access Lookup → search by an SMA whose EOA is allowlisted → detail card shows "Matched via Smart Account 0x…"
- [ ] Preview: opposite direction (allowlist the SMA, log in with EOA) → admin route correctly returns the right access level

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 2: Verify the PR**

```bash
gh pr view --json url,isDraft,state
```

Expected: `isDraft: true`, `state: OPEN`, a URL.

---

## Task 3: `accessService.getUserAccess` SMA fallback

**Files:**
- Create: `packages/backend/tests/services/accessService.smaResolution.test.js`
- Modify: `packages/backend/shared/accessService.js`

- [ ] **Step 1: Write the failing tests**

`packages/backend/tests/services/accessService.smaResolution.test.js`:

```js
// tests/services/accessService.smaResolution.test.js
// @vitest-environment node
//
// Focused tests for the SMA-aware wallet fallback added to getUserAccess.
// Existing accessService tests (general flow, FID priority, groups) live
// elsewhere and stay untouched.

import { describe, it, expect, vi, beforeEach } from "vitest";

const supabaseMocks = vi.hoisted(() => ({
  mockFrom: vi.fn(),
}));

const resolverMocks = vi.hoisted(() => ({
  mockResolvePair: vi.fn(),
}));

vi.mock("../../shared/supabaseClient.js", () => ({
  supabase: { from: (...args) => supabaseMocks.mockFrom(...args) },
}));

vi.mock("../../shared/services/addressPairResolver.js", () => ({
  resolveAddressPair: (...args) => resolverMocks.mockResolvePair(...args),
}));

import { getUserAccess } from "../../shared/accessService.js";

const EOA_LC = "0xaaaa000000000000000000000000000000000001";
const SMA_LC = "0xbbbb000000000000000000000000000000000002";

// Helper: builds a chainable supabase-style query object that resolves to
// either { data, error } or { data: null, error: { code: "PGRST116" } }.
function makeQuery(result) {
  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    or: vi.fn(() => chain),
    single: vi.fn(() => Promise.resolve(result)),
  };
  return chain;
}

const NOT_FOUND = { data: null, error: { code: "PGRST116" } };
const ALLOWLIST_ROW_EOA = {
  data: {
    id: 1,
    fid: null,
    wallet_address: EOA_LC,
    access_level: 3,
    is_active: true,
  },
  error: null,
};
const ALLOWLIST_ROW_SMA = {
  data: {
    id: 2,
    fid: null,
    wallet_address: SMA_LC,
    access_level: 3,
    is_active: true,
  },
  error: null,
};

beforeEach(() => {
  supabaseMocks.mockFrom.mockReset();
  resolverMocks.mockResolvePair.mockReset();
});

describe("getUserAccess SMA resolution", () => {
  it("direct wallet hit returns matchedVia: 'direct', matchedAddress: null", async () => {
    // allowlist_entries query hits directly
    supabaseMocks.mockFrom
      .mockReturnValueOnce(makeQuery(ALLOWLIST_ROW_EOA))   // entries
      .mockReturnValueOnce(makeQuery({ data: [], error: null })); // groups

    const result = await getUserAccess({ wallet: EOA_LC });
    expect(result.matchedVia).toBe("direct");
    expect(result.matchedAddress).toBeNull();
    expect(resolverMocks.mockResolvePair).not.toHaveBeenCalled();
  });

  it("wallet miss + SMA pair whose alternate is allowlisted returns matchedVia: 'sma_pair'", async () => {
    // direct miss, then pair fallback hits via alternate address
    supabaseMocks.mockFrom
      .mockReturnValueOnce(makeQuery(NOT_FOUND))           // direct EOA miss
      .mockReturnValueOnce(makeQuery(ALLOWLIST_ROW_SMA))   // alternate SMA hit
      .mockReturnValueOnce(makeQuery({ data: [], error: null })); // groups
    resolverMocks.mockResolvePair.mockResolvedValueOnce({ eoa: EOA_LC, sma: SMA_LC });

    const result = await getUserAccess({ wallet: EOA_LC });
    expect(result.matchedVia).toBe("sma_pair");
    expect(result.matchedAddress).toBe(SMA_LC);
    expect(resolverMocks.mockResolvePair).toHaveBeenCalledWith(
      EOA_LC,
      expect.anything(),
    );
  });

  it("wallet miss + no pair returns public level + null breadcrumbs", async () => {
    supabaseMocks.mockFrom.mockReturnValueOnce(makeQuery(NOT_FOUND));
    resolverMocks.mockResolvePair.mockResolvedValueOnce(null);

    const result = await getUserAccess({ wallet: EOA_LC });
    expect(result.level).toBe(0); // PUBLIC
    expect(result.matchedVia).toBeNull();
    expect(result.matchedAddress).toBeNull();
  });

  it("wallet miss + pair exists but alternate not allowlisted returns public + null", async () => {
    supabaseMocks.mockFrom
      .mockReturnValueOnce(makeQuery(NOT_FOUND))      // direct miss
      .mockReturnValueOnce(makeQuery(NOT_FOUND));     // alternate miss
    resolverMocks.mockResolvePair.mockResolvedValueOnce({ eoa: EOA_LC, sma: SMA_LC });

    const result = await getUserAccess({ wallet: EOA_LC });
    expect(result.level).toBe(0);
    expect(result.matchedVia).toBeNull();
    expect(result.matchedAddress).toBeNull();
  });

  it("does NOT call resolver when fid hits directly", async () => {
    supabaseMocks.mockFrom
      .mockReturnValueOnce(makeQuery(ALLOWLIST_ROW_EOA))
      .mockReturnValueOnce(makeQuery({ data: [], error: null }));

    const result = await getUserAccess({ fid: 1001 });
    expect(result.matchedVia).toBe("direct");
    expect(resolverMocks.mockResolvePair).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests — expect 5 failures**

```bash
cd packages/backend && npx vitest run tests/services/accessService.smaResolution.test.js
```

Expected: 5 failed (no `matchedVia` field yet).

- [ ] **Step 3: Modify `accessService.getUserAccess`**

Open `packages/backend/shared/accessService.js`. At the top of the file, add the import:

```js
import { resolveAddressPair } from "./services/addressPairResolver.js";
```

Replace the entire `getUserAccess` function body with:

```js
export async function getUserAccess({ fid, wallet }, log = console) {
  try {
    let entry = null;
    let matchedVia = null;
    let matchedAddress = null;

    // Priority 1: FID lookup
    if (fid) {
      const { data, error } = await supabase
        .from("allowlist_entries")
        .select("*")
        .eq("fid", fid)
        .eq("is_active", true)
        .single();
      if (!error && data) {
        entry = data;
        matchedVia = "direct";
      } else if (error && error.code !== "PGRST116") {
        throw error;
      }
    }

    // Priority 2: Direct wallet lookup
    if (!entry && wallet) {
      const { data, error } = await supabase
        .from("allowlist_entries")
        .select("*")
        .eq("wallet_address", wallet.toLowerCase())
        .eq("is_active", true)
        .single();
      if (!error && data) {
        entry = data;
        matchedVia = "direct";
      } else if (error && error.code !== "PGRST116") {
        throw error;
      }
    }

    // Priority 3: SMA-paired wallet lookup
    //
    // When the queried wallet misses but the user has a smart_accounts row,
    // try the paired address. Both directions: EOA↔SMA. If both addresses
    // happen to have their own allowlist rows, the direct hit (above) wins —
    // pair fallback only runs after a direct miss.
    if (!entry && wallet) {
      const pair = await resolveAddressPair(wallet, log);
      if (pair) {
        const lc = wallet.toLowerCase();
        const alt = lc === pair.eoa ? pair.sma : pair.eoa;
        if (alt && alt !== lc) {
          const { data, error } = await supabase
            .from("allowlist_entries")
            .select("*")
            .eq("wallet_address", alt)
            .eq("is_active", true)
            .single();
          if (!error && data) {
            entry = data;
            matchedVia = "sma_pair";
            matchedAddress = alt;
          } else if (error && error.code !== "PGRST116") {
            throw error;
          }
        }
      }
    }

    // Total miss → public default
    if (!entry) {
      return {
        level: ACCESS_LEVELS.PUBLIC,
        levelName: ACCESS_LEVEL_NAMES[ACCESS_LEVELS.PUBLIC],
        groups: [],
        entry: null,
        matchedVia: null,
        matchedAddress: null,
      };
    }

    const groups = await getUserGroups({
      fid: entry.fid,
      wallet: entry.wallet_address,
    });

    return {
      level: entry.access_level ?? ACCESS_LEVELS.ALLOWLIST,
      levelName:
        ACCESS_LEVEL_NAMES[entry.access_level ?? ACCESS_LEVELS.ALLOWLIST],
      groups,
      entry,
      matchedVia,
      matchedAddress,
    };
  } catch (error) {
    if (error.code === "PGRST116") {
      return {
        level: ACCESS_LEVELS.PUBLIC,
        levelName: ACCESS_LEVEL_NAMES[ACCESS_LEVELS.PUBLIC],
        groups: [],
        entry: null,
        matchedVia: null,
        matchedAddress: null,
      };
    }
    console.error("Error getting user access:", error);
    throw error;
  }
}
```

- [ ] **Step 4: Run all backend tests to confirm no regressions**

```bash
cd packages/backend && npx vitest run tests/services/accessService.smaResolution.test.js
```

Expected: 5 passed.

Also run the broader access-related suite to check nothing else broke (the response shape grew two fields; existing assertions should still pass since they don't reference the new fields):

```bash
cd packages/backend && npx vitest run tests/services tests/api/accessRoutes.publicRoutes.test.js tests/api/accessRoutes.adminGuard.test.js tests/api/cacheInvalidationCallSites.test.js tests/backend/accessCache.test.js
```

Expected: all green.

- [ ] **Step 5: Commit + push**

```bash
git add packages/backend/shared/accessService.js \
        packages/backend/tests/services/accessService.smaResolution.test.js
git commit -m "feat(backend): SMA-paired fallback in getUserAccess

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
git push
```

---

## Task 4: Forward `matchedVia` and `matchedAddress` in `/access/check`

**Files:**
- Modify: `packages/backend/fastify/routes/accessRoutes.js`

- [ ] **Step 1: Read the current route response shape**

```bash
sed -n '28,56p' packages/backend/fastify/routes/accessRoutes.js
```

You'll see the `/access/check` handler returning a fixed-shape object picked from `accessInfo`. We're adding two fields.

- [ ] **Step 2: Modify the response object**

In `accessRoutes.js`, locate the `/access/check` handler's `return {...}` block (around lines 43-49). Add two lines:

```js
return {
  isAllowlisted: accessInfo.level >= ACCESS_LEVELS.ALLOWLIST,
  accessLevel: accessInfo.level,
  levelName: accessInfo.levelName,
  groups: accessInfo.groups,
  entry: accessInfo.entry,
  matchedVia: accessInfo.matchedVia ?? null,
  matchedAddress: accessInfo.matchedAddress ?? null,
};
```

The `?? null` coercion handles the (unlikely) case where a cached-but-pre-bump value is returned without the new fields.

- [ ] **Step 3: Verify route schema isn't constraining the response**

```bash
grep -A 5 '"/check"' packages/backend/fastify/routes/accessRoutes.js | head -20
```

If a Fastify response schema is declared with `additionalProperties: false` for the `/check` route, the new fields would be stripped. Spot-check the schema — at the time of writing, no schema is bound on `/check` (only `/set-access-level`). If you find one, add `matchedVia: { type: ["string", "null"] }` and `matchedAddress: { type: ["string", "null"] }` to the response schema. Otherwise nothing to do.

- [ ] **Step 4: Re-run the route's existing tests**

```bash
cd packages/backend && npx vitest run tests/api/accessRoutes.publicRoutes.test.js
```

Expected: all green. The existing tests don't reference the new fields so they should still pass.

- [ ] **Step 5: Commit + push**

```bash
git add packages/backend/fastify/routes/accessRoutes.js
git commit -m "feat(backend): /access/check forwards matchedVia + matchedAddress

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
git push
```

---

## Task 5: Symmetric cache invalidation

**Files:**
- Modify: `packages/backend/tests/backend/accessCache.test.js`
- Modify: `packages/backend/shared/accessCache.js`

- [ ] **Step 1: Write the failing tests**

Append to `packages/backend/tests/backend/accessCache.test.js` (inside the existing `describe("invalidateUserAccessCache", ...)` block if present, else at the end of the file inside a new `describe`):

```jsx
const resolverMocks = vi.hoisted(() => ({
  mockResolvePair: vi.fn(),
}));

vi.mock("../../shared/services/addressPairResolver.js", () => ({
  resolveAddressPair: (...args) => resolverMocks.mockResolvePair(...args),
}));
```

Place these `vi.hoisted` / `vi.mock` calls at the top of the test file, alongside the existing mocks. (Hoisted blocks run before imports.)

Then add these test cases to a new `describe` block at the bottom:

```js
describe("invalidateUserAccessCache symmetric busting", () => {
  beforeEach(() => {
    resolverMocks.mockResolvePair.mockReset();
  });

  it("invalidates both keys when the queried wallet has a paired wallet", async () => {
    const EOA_LC = "0xaaaa000000000000000000000000000000000001";
    const SMA_LC = "0xbbbb000000000000000000000000000000000002";
    resolverMocks.mockResolvePair.mockResolvedValueOnce({ eoa: EOA_LC, sma: SMA_LC });

    await invalidateUserAccessCache({ wallet: EOA_LC }, makeLogger());

    // Single call deletes both keys.
    expect(redisMocks.mockDel).toHaveBeenCalledTimes(1);
    const args = redisMocks.mockDel.mock.calls[0];
    expect(args).toContain(`access:wallet:${EOA_LC}`);
    expect(args).toContain(`access:wallet:${SMA_LC}`);
  });

  it("invalidates only the queried key when there is no pair", async () => {
    const EOA_LC = "0xaaaa000000000000000000000000000000000003";
    resolverMocks.mockResolvePair.mockResolvedValueOnce(null);

    await invalidateUserAccessCache({ wallet: EOA_LC }, makeLogger());

    expect(redisMocks.mockDel).toHaveBeenCalledTimes(1);
    expect(redisMocks.mockDel).toHaveBeenCalledWith(`access:wallet:${EOA_LC}`);
  });

  it("skips pair resolution entirely when only fid is supplied", async () => {
    await invalidateUserAccessCache({ fid: 12345 }, makeLogger());
    expect(resolverMocks.mockResolvePair).not.toHaveBeenCalled();
    expect(redisMocks.mockDel).toHaveBeenCalledWith("access:fid:12345");
  });

  it("does not block invalidation of the queried key when pair resolution throws", async () => {
    const EOA_LC = "0xaaaa000000000000000000000000000000000004";
    resolverMocks.mockResolvePair.mockResolvedValueOnce(null); // simulates the swallow-and-return-null contract
    await invalidateUserAccessCache({ wallet: EOA_LC }, makeLogger());
    expect(redisMocks.mockDel).toHaveBeenCalledWith(`access:wallet:${EOA_LC}`);
  });
});
```

- [ ] **Step 2: Run tests — expect failures**

```bash
cd packages/backend && npx vitest run tests/backend/accessCache.test.js
```

Expected: 4 failures (pair logic not implemented yet).

- [ ] **Step 3: Modify `invalidateUserAccessCache`**

In `packages/backend/shared/accessCache.js`, add the import at the top:

```js
import { resolveAddressPair } from "./services/addressPairResolver.js";
```

Replace the entire `invalidateUserAccessCache` function with:

```js
export async function invalidateUserAccessCache(identifier, logger = console) {
  const keys = [];
  if (
    identifier.fid !== undefined &&
    identifier.fid !== null &&
    identifier.fid !== ""
  ) {
    keys.push(`${KEY_PREFIX}fid:${identifier.fid}`);
  }
  if (typeof identifier.wallet === "string" && identifier.wallet.length > 0) {
    const lc = identifier.wallet.toLowerCase();
    keys.push(`${KEY_PREFIX}wallet:${lc}`);

    // Symmetric busting: if this wallet has a paired counterpart in
    // smart_accounts, invalidate its key too. Resolution is best-effort —
    // a failure here doesn't block invalidating the primary key.
    const pair = await resolveAddressPair(lc, logger);
    if (pair) {
      const alt = lc === pair.eoa ? pair.sma : pair.eoa;
      if (alt && alt !== lc) {
        keys.push(`${KEY_PREFIX}wallet:${alt}`);
      }
    }
  }

  if (keys.length === 0) return;

  let client;
  try {
    client = redisClient.getClient();
  } catch (err) {
    logger.warn({ err }, "[accessCache] redis unavailable; skipping invalidate");
    return;
  }

  try {
    await client.del(...keys);
  } catch (err) {
    logger.warn({ err, keys }, "[accessCache] invalidate failed");
  }
}
```

- [ ] **Step 4: Run tests — expect all passing**

```bash
cd packages/backend && npx vitest run tests/backend/accessCache.test.js
```

Expected: all pass (existing tests + 4 new symmetric-busting tests).

Also run the route-level integration suite to confirm the existing call sites still work:

```bash
cd packages/backend && npx vitest run tests/api/cacheInvalidationCallSites.test.js
```

Expected: all green.

- [ ] **Step 5: Commit + push**

```bash
git add packages/backend/shared/accessCache.js \
        packages/backend/tests/backend/accessCache.test.js
git commit -m "feat(backend): symmetric SMA-pair cache invalidation

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
git push
```

---

## Task 6: Frontend "Matched via" row

**Files:**
- Modify: `packages/frontend/src/components/admin/access/UserAccessPanel.jsx`
- Modify: `packages/frontend/src/components/admin/access/__tests__/UserAccessPanel.test.jsx`

If PR #100 hasn't merged when you reach this task, rebase this branch onto its tip first (`git fetch origin && git rebase origin/feat/admin-user-picker`). Without #100, the test file doesn't exist yet.

- [ ] **Step 1: Locate the detail-card grid**

```bash
sed -n '150,200p' packages/frontend/src/components/admin/access/UserAccessPanel.jsx
```

Find the `<div className="grid grid-cols-2 gap-4">` block. It currently contains four cells (Access Level, Level Name, Allowlisted, Groups).

- [ ] **Step 2: Add the conditional cell**

Inside the grid, after the existing four cells (still inside the same `<div className="grid grid-cols-2 gap-4">`), add:

```jsx
{userData.matchedVia === "sma_pair" && userData.matchedAddress && (
  <div className="col-span-2">
    <Label className="text-muted-foreground text-xs">Matched via</Label>
    <p className="mt-1 text-sm">
      <Badge variant="secondary">Smart Account</Badge>{" "}
      <span className="font-mono text-xs text-muted-foreground">
        {userData.matchedAddress}
      </span>
    </p>
  </div>
)}
```

If `Badge` isn't already imported in this file, add it. (PR #100 likely already imports `Badge` for the access-level pill; check.)

- [ ] **Step 3: Extend the existing UserAccessPanel test**

Open `packages/frontend/src/components/admin/access/__tests__/UserAccessPanel.test.jsx`. The PR #100 file mocks `/access/check` to return a happy-path response. Append a second `it()` inside the existing `describe` block:

```jsx
it("renders 'Matched via Smart Account' row when matchedVia is 'sma_pair'", async () => {
  global.fetch = vi.fn((url) => {
    if (url.includes("/allowlist/entries")) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          entries: [{
            fid: 1001,
            username: "alice",
            wallet_address: "0xaaaa000000000000000000000000000000000001",
            pfpUrl: null,
          }],
          count: 1,
        }),
      });
    }
    if (url.includes("/access/check")) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          isAllowlisted: true,
          accessLevel: 2,
          levelName: "allowlist",
          groups: [],
          entry: { fid: 1001, wallet_address: "0xaaaa000000000000000000000000000000000001" },
          matchedVia: "sma_pair",
          matchedAddress: "0xbbbb000000000000000000000000000000000002",
        }),
      });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  });

  renderWithClient(<UserAccessPanel getAuthHeaders={() => ({})} />);
  const input = screen.getByPlaceholderText(/@username, FID, or 0x/);
  fireEvent.change(input, { target: { value: "alice" } });
  const row = await screen.findByText("@alice");
  fireEvent.mouseDown(row.closest("[role='option']"));
  expect(await screen.findByText(/Matched via/i)).toBeInTheDocument();
  expect(screen.getByText(/0xbbbb000000000000000000000000000000000002/i)).toBeInTheDocument();
});
```

- [ ] **Step 4: Run the test**

```bash
cd packages/frontend && npx vitest run src/components/admin/access/__tests__/UserAccessPanel.test.jsx
```

Expected: both the original PR #100 test AND the new one pass.

- [ ] **Step 5: Commit + push**

```bash
git add packages/frontend/src/components/admin/access/UserAccessPanel.jsx \
        packages/frontend/src/components/admin/access/__tests__/UserAccessPanel.test.jsx
git commit -m "feat(frontend): UserAccessPanel shows 'Matched via Smart Account' row

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
git push
```

---

## Task 7: Version bumps + lint + build

**Files:**
- Modify: `packages/backend/package.json`
- Modify: `packages/frontend/package.json`

- [ ] **Step 1: Bump backend version**

Read `packages/backend/package.json` to confirm the current version, then bump the patch:

```bash
grep '"version"' packages/backend/package.json
```

Expected current: `"version": "0.27.0"`. Edit to `"version": "0.27.1"`.

- [ ] **Step 2: Bump frontend version**

```bash
grep '"version"' packages/frontend/package.json
```

If PR #100 hasn't merged, this branch's `packages/frontend/package.json` reads `0.39.11`. Bump to `0.39.12`.
If PR #100 has merged before you reach this task, you'll see `0.39.12` (from PR #100); bump to `0.39.13`.

- [ ] **Step 3: Run lint + build on both packages**

```bash
cd packages/backend && npm run lint
cd packages/frontend && npm run lint
cd packages/frontend && npm run build
```

Expected: zero warnings, zero errors, build succeeds.

If lint flags an unescaped JSX apostrophe (as happened in PR #100 Task 11), escape it with `&apos;` and re-run.

- [ ] **Step 4: Run the full backend and frontend test suites once more**

```bash
cd packages/backend && npm test
cd packages/frontend && npm test
```

Expected: all green.

- [ ] **Step 5: Commit + push**

```bash
git add packages/backend/package.json packages/frontend/package.json
git commit -m "chore: bump backend to 0.27.1 and frontend patch for SMA-aware access

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
git push
```

---

## Task 8: Mark PR ready for review

**Files:** none

- [ ] **Step 1: Mark draft PR ready**

```bash
gh pr ready
```

- [ ] **Step 2: Comment with the test plan results**

```bash
gh pr comment --body "Implementation complete. addressPairResolver, accessService SMA fallback, /access/check forwarding, accessCache symmetric busting, and UserAccessPanel 'Matched via' row all landed with green tests. Lint and build clean. Backend bumped to 0.27.1, frontend patch bumped."
```

- [ ] **Step 3: Hand off to user for review**

Tell the user the PR is ready and offer `/ultrareview` against the branch.

---

## Validation Checklist

After all tasks complete, confirm:

- [ ] `cd packages/backend && npm test` — all green
- [ ] `cd packages/frontend && npm test` — all green
- [ ] `cd packages/backend && npm run lint` — zero warnings
- [ ] `cd packages/frontend && npm run lint && npm run build` — clean
- [ ] PR is open, not draft, preview env reachable
- [ ] Manual smoke in preview (if you can access admin):
  - Allowlist an SMA address only, log in with the matching EOA → admin route accepts.
  - Allowlist an EOA only, query the panel by the SMA → detail card shows "Matched via Smart Account 0x…".
- [ ] No regression in PR #100's behavior (direct EOA hits still show no "Matched via" row).
