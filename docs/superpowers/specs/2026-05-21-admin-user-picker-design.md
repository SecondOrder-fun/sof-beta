# Admin User Picker — Design

**Status:** approved, ready for implementation plan
**Date:** 2026-05-21
**Scope:** frontend only (`packages/frontend`)
**Follow-up (separate PR):** access-lookup SMA-awareness — out of scope here

## Problem

The Access panel's "User Access Lookup" (`UserAccessPanel`) and "Add Member" inputs in `AccessGroupsPanel` require admins to type a full FID or `0x…` address from memory. There is no way to scan the existing user base. Today the dropdown of known users only lives behind the AllowlistPanel's entries table — useless for the Access workflows.

A reusable typeahead that pulls from `allowlist_entries` removes the manual-recall step. Brand-new users (FID/wallet not yet in `allowlist_entries`) still need to be addressable, so the picker must accept free-text fallback in the same input.

## Goals / Non-goals

**In scope (this PR):**
- New `UserPicker` component in `packages/frontend/src/components/admin/access/UserPicker.jsx`
- Wire into `UserAccessPanel` (replaces the lookup input) and `AccessGroupsPanel` (replaces the per-group Add Member input)
- Vitest coverage for the picker plus one integration assertion per panel
- Patch version bump in `packages/frontend/package.json`

**Out of scope:**
- `AllowlistPanel` Add input (almost never matches the picker since users aren't allowlisted yet there; revisit if free-text autocomplete becomes useful)
- Backend search endpoint (`/access/users/search`) — reuse `/allowlist/entries` for now
- SMA-awareness for access lookup — separate PR
- Any change to `allowlist_entries` schema

## Component API

`packages/frontend/src/components/admin/access/UserPicker.jsx`

```jsx
<UserPicker
  placeholder="@username, FID, or 0x…"
  onSelect={(result) => { /* … */ }}
  disabled={false}
  autoFocus={false}
  filterEntry={(entry) => entry.is_active}   // optional
/>
```

Callback `result` shape:

```js
// Existing match selected from the dropdown
{ source: "match", fid: 12345, wallet: "0x…", username: "alice", pfpUrl: "…" }

// Free-text fallback: input parses as valid FID or wallet but no row matched
{ source: "freeText", fid: 12345, wallet: null }
{ source: "freeText", fid: null,  wallet: "0x…" }
```

State owned internally: `inputValue`, `isOpen`, `highlightedIndex`. The caller never parses the raw input.

## Data flow

**Fetch.** One react-query, shared cache key:

```js
useQuery({
  queryKey: ["allowlist-entries-picker"],
  queryFn: () =>
    fetch(`${API_BASE}/allowlist/entries?activeOnly=true&limit=200`, {
      headers: getAuthHeaders(),
    }).then((r) => r.json()),
  staleTime: 30_000,
})
```

Concurrent mounts (UserAccessPanel + AccessGroupsPanel both open) dedup to one request via the shared key.

**Filter.** Pure client-side. The trimmed lowercased query matches against each entry on:

- `username.toLowerCase().includes(q)`
- `wallet_address.toLowerCase().includes(q)`
- `String(fid).startsWith(q)`

**Ranking (top to bottom):**
1. Exact `@username` match
2. Exact FID match
3. Wallet prefix match (`0x…`)
4. Substring matches in any field

Cap the visible list at 20 rows. When the unfiltered match count exceeds 20, render a non-selectable `+N more — keep typing` footer.

**Free-text fallback.** When `matches.length === 0`, test the trimmed input against:

- `/^0x[a-fA-F0-9]{40}$/` → render single row `"Use 0x1234…abcd"`, selecting fires `{ source: "freeText", fid: null, wallet }`
- `/^\d+$/` → render `"Use FID 12345"`, selecting fires `{ source: "freeText", fid: Number, wallet: null }`
- otherwise → non-selectable `"No users found"`

**Row visual.** Avatar (16px from `pfpUrl` if present — the `/allowlist/entries` endpoint enriches entries with `username`, `displayName`, `pfpUrl` via `bulkResolveFidsToWallets`) · `@username` · truncated wallet · right-aligned muted `FID:n`. Rows missing username still render with wallet + FID.

**Keyboard.** `↑`/`↓` moves highlight, `Enter` selects the highlighted row, `Esc` closes the dropdown, blur closes with a 150ms delay (so row clicks register).

## Panel integration

### `UserAccessPanel.jsx`

Replace the input + Lookup button block (today at lines ~137–148) with:

```jsx
<UserPicker
  placeholder="@username, FID, or 0x…"
  onSelect={(r) =>
    setLookupParams(r.fid ? { fid: String(r.fid) } : { wallet: r.wallet })
  }
  disabled={lookupQuery.isFetching}
/>
```

The downstream `lookupQuery` against `/access/check?fid=…|wallet=…` is unchanged. Delete the local `lookupInput`, `handleLookup`, and the inline `0x…` regex parsing — that responsibility moves to the picker. Selecting a row triggers the lookup automatically; the separate "Lookup" button is removed.

### `AccessGroupsPanel.jsx`

Replace the per-group Add Member input (today at lines ~353–387) with:

```jsx
<UserPicker
  placeholder="@username, FID, or 0x…"
  onSelect={(r) =>
    addMemberMutation.mutate({
      ...(r.fid ? { fid: r.fid } : { wallet: r.wallet }),
      groupSlug: group.slug,
    })
  }
  disabled={addMemberMutation.isPending}
/>
```

Selecting fires the mutation directly. Delete `addMemberInput`, `parseIdentifier`, and the standalone Add button. Existing success/error message rendering below the picker stays.

### `AllowlistPanel.jsx`

No changes this PR.

## Cache invalidation

`AllowlistPanel`'s `addMutation`, `removeMutation`, and `importMutation` already invalidate `["allowlist-entries"]`. Add `queryClient.invalidateQueries({ queryKey: ["allowlist-entries-picker"] })` to each so the picker's dropdown refreshes within the same session when an admin adds a user from AllowlistPanel and then jumps to AccessGroups.

## Error handling & edge cases

- **`/allowlist/entries` fetch fails.** Dropdown renders `"Couldn't load users — type a full FID or 0x address"`; free-text fallback still works. Error is `console.error`-logged; panel does not block.
- **Empty allowlist.** Dropdown shows `"No users yet — paste a FID or 0x address"`; free-text fallback still works.
- **Blur during selection.** 150ms blur delay before close, covering single-click row selection.
- **Duplicate add in AccessGroupsPanel.** Backend `/access/groups/assign` already returns an error for duplicates; existing `addMemberMutation.error.message` rendering surfaces it.
- **Same wallet across multiple FIDs.** Existing schema treats `wallet_address` as the natural key; picker treats rows independently. No dedup logic.

## Testing

Vitest, matching the existing style under `packages/frontend/src/components/admin/access/`.

**`UserPicker.test.jsx`**
- Renders input; dropdown closed by default
- Filters by username, FID, wallet substring (one assertion each)
- Ranks exact `@username` above substring matches
- No matches + valid `0x…` → shows `"Use 0x…"` row; `onSelect` fires with `source: "freeText"`
- No matches + invalid input → shows `"No users found"`; no row selectable
- `↑`/`↓`/`Enter`/`Esc` keyboard nav happy path
- Fetch error renders fallback text

**`UserAccessPanel.test.jsx`** (extend existing if present, else add)
- Selecting a picker row sets lookup params and triggers `/access/check`

**`AccessGroupsPanel.test.jsx`** (extend existing if present, else add)
- Selecting a picker row fires `addMemberMutation` with the correct `{ fid|wallet, groupSlug }` payload

Mock `fetch` via the same approach used in nearby tests (raw stub or MSW — check `packages/frontend/src/test/setup`).

## Version bump

`packages/frontend/package.json` → patch bump (e.g., `0.39.11 → 0.39.12`) per repo CLAUDE.md.

## Open questions

None. Free-text fallback shape, picker UX (inline dropdown), data source (`/allowlist/entries`), and integration surfaces (UserAccessPanel + AccessGroupsPanel) all confirmed.

## Out-of-scope follow-up: SMA awareness for access lookup

Tracked as the second of the two PRs requested. Anticipated approach (not blocking this design):

- `accessService.getUserAccess` consults `smart_accounts` (migration `016_smart_accounts.sql`) when wallet lookup misses, mapping a queried EOA to its SMA (or vice versa) and re-running the `allowlist_entries.wallet_address` lookup with the alternate address.
- `adminGuard` continues to read `request.user.wallet_address`; no JWT changes needed because the EOA→SMA resolution lives behind `getUserAccess`.

Owner decides whether matches should fan out (EOA *and* SMA) or only fall back when EOA misses.
