# Access Lookup SMA Awareness — Design

**Status:** approved, ready for implementation plan
**Date:** 2026-05-22
**Scope:** backend (`packages/backend`) + minimal frontend (`packages/frontend/src/components/admin/access/UserAccessPanel.jsx`)
**Depends on:** PR #100 (`feat/admin-user-picker`) — introduces `UserAccessPanel.test.jsx` and the picker integration we extend here. If #100 hasn't merged when this PR is ready, rebase or wait.

## Problem

`accessService.getUserAccess` looks up `allowlist_entries` by FID (priority) and then by literal `wallet_address`. A user logs in with their EOA (JWT `wallet_address` claim), but an admin may have set the access level against the user's smart-account address (SMA) — or vice versa. The two addresses are different; the lookup misses. The admin's intent is silently ignored.

We already have a populated `smart_accounts` table (`016_smart_accounts.sql`) mapping `eoa` (PK) ↔ `sma` (UNIQUE), maintained by SIWE auth and the airdrop pipeline. Helpers exist in `smartAccountsDb.js`. The lookup just needs to consult it.

## Goals / Non-goals

**In scope:**
- New helper `resolveAddressPair(address)` at `packages/backend/shared/services/addressPairResolver.js`.
- `accessService.getUserAccess` consults the helper on wallet miss, falls back to a second lookup against the alternate address, and surfaces a `matchedVia: "direct" | "sma_pair"` breadcrumb plus `matchedAddress` when SMA resolution succeeds.
- `accessCache.invalidateUserAccessCache` symmetric busting — when mutating by wallet, also invalidate the paired address's cache key.
- `UserAccessPanel.jsx` shows a "Matched via" row in the detail card when `matchedVia === "sma_pair"`.
- Vitest coverage for the helper, the new access-lookup branches, and the cache invalidation symmetry. One frontend test extension.

**Out of scope:**
- `getUserGroups` / `user_access_groups` SMA awareness — groups are typically assigned by FID; expanding scope adds complexity for marginal benefit.
- `UserPicker` SMA decoration — picker keeps its `/allowlist/entries` data source unchanged.
- Schema changes — no `sma_address` column added to `allowlist_entries`. Resolution is runtime via `smart_accounts`.
- JWT changes — adminGuard continues to read only `request.user.wallet_address`. The optional `sma` claim stays informational.

## `resolveAddressPair` helper

`packages/backend/shared/services/addressPairResolver.js` — sibling to `smartAccountsDb.js`.

```js
import { smartAccountsDb } from "./smartAccountsDb.js";

/**
 * Given any address, returns its EOA↔SMA pair from smart_accounts,
 * or null if the address isn't tracked there.
 *
 * Resolution is symmetric: queries the table once by EOA, once by SMA.
 * Returns the first row that matches. Any Supabase error is caught and
 * logged as a warning — pair resolution must never block access decisions.
 *
 * @param {string} address — case-insensitive
 * @param {object} [log] — Fastify logger, falls back to console
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
    log.warn?.({ err: err.message, address: lc }, "[addressPairResolver] lookup failed");
    return null;
  }
}
```

## `accessService.getUserAccess` changes

Modify `packages/backend/shared/accessService.js`. The function signature stays `({ fid, wallet })`. The wallet-lookup branch grows the pair fallback. The return shape adds `matchedVia` and `matchedAddress`.

**Direct wallet hit:** return `{ level, levelName, groups, entry, matchedVia: "direct", matchedAddress: null }`.

**Wallet miss → pair fallback:** call `resolveAddressPair(wallet, log)`. If it returns `{ eoa, sma }`, derive `alt = wallet.toLowerCase() === eoa ? sma : eoa` and re-run the `allowlist_entries.wallet_address = alt` lookup. If THAT hits, return `{ ..., matchedVia: "sma_pair", matchedAddress: alt }`.

**Total miss:** return public-level default with `matchedVia: null, matchedAddress: null`.

**FID hit (early return):** same shape — `matchedVia: "direct", matchedAddress: null`.

**Docstring note:** when both `wallet_address = X` and `wallet_address = X's pair` exist as separate allowlist rows, the direct hit wins — pair fallback never runs. This is intentional: the address the user actually presented takes precedence.

## `/access/check` route changes

`packages/backend/fastify/routes/accessRoutes.js:38-49` currently picks specific fields out of `accessInfo` and doesn't forward unknown ones. Extend the return body with the two new fields so they reach the frontend:

```js
return {
  isAllowlisted: accessInfo.level >= ACCESS_LEVELS.ALLOWLIST,
  accessLevel: accessInfo.level,
  levelName: accessInfo.levelName,
  groups: accessInfo.groups,
  entry: accessInfo.entry,
  matchedVia: accessInfo.matchedVia,
  matchedAddress: accessInfo.matchedAddress,
};
```

`/access/check-access` and any other route that returns `accessInfo` subsets stay untouched — they don't drive the admin UI.

## `accessCache.invalidateUserAccessCache` changes

Modify `packages/backend/shared/accessCache.js`. Signature stays `({ fid, wallet }, log)`. After deleting the primary cache key:

1. If `wallet` is not provided, return.
2. Call `resolveAddressPair(wallet, log)`. If it returns `{ eoa, sma }`, derive `alt = wallet.toLowerCase() === eoa ? sma : eoa`.
3. Delete the cache key for `{ fid, wallet: alt }`.

Pair-resolution failure is non-fatal — log warn, return; the primary key was already busted.

No change needed in `/access/set-access-level` — it already calls `invalidateUserAccessCache({ fid, wallet })`. The symmetric busting happens inside the cache helper.

## Frontend display

`packages/frontend/src/components/admin/access/UserAccessPanel.jsx`. Inside the existing detail-card `<div className="grid grid-cols-2 gap-4">…</div>` (currently four cells), append one conditional cell:

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

`col-span-2` keeps it as a full-width row at the bottom. Nothing renders when `matchedVia === "direct"` or `null`.

No new test file. Extend `UserAccessPanel.test.jsx` (introduced in PR #100) with one `it()` that mocks `/access/check` to return `matchedVia: "sma_pair", matchedAddress: "0xabc…"`, selects a picker row, asserts the "Matched via" row renders with the address.

## Error handling & edge cases

- **`smart_accounts` DB down.** `resolveAddressPair` returns null with a warn log. `getUserAccess` falls through to total-miss (public level). Cache invalidation still busts the primary key.
- **Mixed-case input.** Lowercased at entry to `resolveAddressPair`. Returned values already lowercased per schema invariant.
- **Both `wallet_address = X` and `wallet_address = X's pair` rows exist.** Direct hit wins (pair fallback never runs). Docstring notes this is intentional.
- **`smart_accounts` row exists but neither side is allowlisted.** Total miss → public level.
- **Cache invalidation race.** Worst case, paired cache key holds stale data up to 60s (existing TTL contract). Direct key always invalidated.
- **adminGuard before `smart_accounts` is populated.** SIWE auth writes the row during login. If race leaves it absent, fallback gracefully misses → 403. User re-signs in, row populated. No special case needed.
- **JWT `sma` claim still ignored.** adminGuard reads only `wallet_address` (EOA). Pair fallback resolves via the DB, not the JWT — trust boundary unchanged.

## Testing

Vitest in `packages/backend/tests/` and `packages/frontend/src/components/admin/access/__tests__/`.

**`packages/backend/tests/services/addressPairResolver.test.js`** (new)
- Returns pair when input is the EOA
- Returns pair when input is the SMA (reverse direction)
- Returns null when address isn't in `smart_accounts`
- Lowercases input before query (case-insensitive)
- Catches DB errors and returns null with a warn log

**`packages/backend/tests/services/accessService.smaResolution.test.js`** (new, focused)
- Direct wallet hit → `matchedVia: "direct"`, `matchedAddress: null`
- Wallet miss + SMA pair whose alternate address is allowlisted → `matchedVia: "sma_pair"` + alternate address (lowercased)
- Wallet miss + no pair → public level + null breadcrumbs
- Wallet miss + pair but no alternate row → public level + null breadcrumbs
- Direct hit shadows alternate (alt has higher level, direct lower; direct wins; pair fallback never queries)

**`packages/backend/tests/api/accessCache.invalidation.test.js`** (extend if exists, else new)
- `invalidateUserAccessCache({ wallet })` with paired wallet invalidates both cache keys
- `invalidateUserAccessCache({ wallet })` with no pair invalidates only the queried key
- `invalidateUserAccessCache({ fid })` (no wallet) skips pair resolution entirely
- Pair lookup failure doesn't block invalidation of the queried key

**`packages/frontend/src/components/admin/access/__tests__/UserAccessPanel.test.jsx`** (extend, added by PR #100)
- One `it()` verifying the "Matched via" row renders when `/access/check` returns `matchedVia: "sma_pair"` and `matchedAddress`.

## Version bumps

- `packages/backend/package.json` — patch bump per repo CLAUDE.md (e.g., current → current+0.0.1).
- `packages/frontend/package.json` — patch bump for the UserAccessPanel UI change.

## Open questions

None.

## Migration / rollout

No schema changes. No env-var changes. No data backfill needed. The feature is purely additive — existing direct-hit flows are unchanged. Roll out via normal PR merge → Vercel + Railway preview validation → main merge.
