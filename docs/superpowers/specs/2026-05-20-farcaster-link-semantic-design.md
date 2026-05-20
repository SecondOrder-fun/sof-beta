# Farcaster Link Semantic — Design

Status: Draft (2026-05-20)
Branch: `feat/farcaster-link-semantic`
Related: [Universal SIWE design (2026-05-07)](./2026-05-07-universal-siwe-design.md)

## Problem

The current auth model conflates two distinct concepts:

1. **Backend authentication** — possession of a valid JWT, issued via SIWE (wallet) or SIWF (Farcaster Sign-In).
2. **Farcaster identity link** — association of a Farcaster account (`fid`, `username`) with the authenticated wallet.

Several UI surfaces treat "the user is backend-authenticated" as a proxy for "the user has linked Farcaster", which produces two visible bugs on Desktop/Smartphone:

- **`@FID null - Linked`** appears in the settings dropdown for wallet-only SIWE users, because `Header.jsx` passes the full backend user as `farcasterUser` and `SettingsMenu.jsx` renders the "Linked" branch on object truthiness instead of on the presence of `fid`.
- **The "Sign in with Farcaster" button is hidden** once a wallet is connected, because `FarcasterAuth.jsx` short-circuits to the authenticated profile view for any backend-authenticated user. Desktop wallet users cannot initiate SIWF.

Additionally, the existing `method: "farcaster"` path in `/api/auth/verify` **replaces** the JWT entirely — it re-issues a new token bound to the FID's resolved primary wallet (via Neynar). On Desktop, this is problematic because:

- Desktop users now operate against a separate SMA (counterfactual ERC-4337). The FID's primary wallet is unrelated to the user's SMA.
- We have not verified that the Farcaster custody wallet works with the SMA flow on Desktop.
- We have not verified that gasless still works inside the Farcaster MiniApp, so we want to avoid expanding our reliance on Farcaster-as-wallet until both flows are validated.

The fix is to introduce a **link semantic**: on Desktop, signing in with Farcaster attaches `fid`/`username` to the user's existing wallet JWT without replacing the wallet binding. The MiniApp flow (where Farcaster *is* the wallet) is unchanged.

## Goals

- Desktop/Smartphone users can attach a Farcaster identity to their wallet JWT.
- Attaching does not change the wallet bound to the JWT and does not require a new SIWE.
- The link persists across sessions, so reconnecting the same wallet automatically restores the `fid`/`username` in the new JWT.
- Users can unlink their Farcaster identity without disconnecting the wallet.
- All UI surfaces gate Farcaster-specific affordances on the presence of `fid`, not on backend-auth state.
- Existing MiniApp SIWF flow is untouched.

## Non-Goals

- No changes to the MiniApp authentication flow.
- No new database table or migration.
- No changes to gasless / paymaster / SMA wiring.
- No support for linking a Farcaster identity to a wallet other than the one the JWT is bound to.
- No "merge accounts" UI for users who linked separate FIDs on separate wallets historically.

## Architecture

### Endpoints (new)

Both new endpoints require a valid `Authorization: Bearer <jwt>` header. The JWT's `wallet_address` claim identifies the target wallet for the operation.

#### `POST /api/auth/link-farcaster`

Request body (same SIWF proof shape as the existing `method: "farcaster"` verify path):

```json
{
  "message": "<SIWE message text>",
  "signature": "0x...",
  "nonce": "<alphanumeric nonce previously issued by /auth/nonce>"
}
```

Behavior:
1. Verify the bearer JWT; reject 401 if missing/expired.
2. Verify SIWF (`verifySignInMessage`) — reject 400 on invalid signature.
3. Verify the SIWE nonce against the nonce store (one-time use) — reject 400 on reuse.
4. Extract `fid` from the verified SIWF result.
5. Resolve `fid → { username, displayName, pfpUrl }` via `resolveFidToWallet`. **The resolver's `walletAddress` field is intentionally ignored** — the link attaches `fid` to the JWT's wallet, not to the FID's Neynar-resolved primary wallet. Resolution failure is tolerated: link still proceeds with `fid` only, matching existing tolerance at `authRoutes.js:128`.
6. Upsert into `allowlist_entries` per the reassignment rules below. The new row's `source` is `'farcaster-link'` (a new permitted source value alongside the existing `'webhook'`, `'manual'`, `'import'`, `'siwf'`).
7. Issue a new JWT with claims `{ wallet_address, fid, username, ... }`.
8. Return `{ token, user }` with the same shape as `/auth/verify`.

#### `POST /api/auth/unlink-farcaster`

Request body: empty JSON object `{}` (Fastify's JSON body parser rejects POSTs without a body when `Content-Type: application/json` is sent).

Behavior:
1. Verify the bearer JWT; reject 401 if missing/expired.
2. Idempotently clear `fid`, `username`, `display_name`, `wallet_resolved_at` on the row matching the JWT's `wallet_address`. If no row matches or `fid` is already null, the operation is a no-op.
3. Issue a new JWT without `fid`/`username` claims.
4. Return `{ token, user }`.

### Endpoint (modified)

#### `POST /api/auth/verify` — `method: "wallet"` path

After verifying the wallet signature and before issuing the JWT, perform a single read against `allowlist_entries`:

```
SELECT fid, username, display_name
  FROM allowlist_entries
 WHERE LOWER(wallet_address) = LOWER(:walletAddress)
   AND is_active = true
 LIMIT 1
```

If a row with `fid IS NOT NULL` is found, embed `fid` and `username` into the JWT claims and returned `user` object exactly as the SIWF path does today.

If no row is found or `fid` is null, behavior is unchanged — the JWT is wallet-only.

#### `POST /api/auth/verify` — `method: "farcaster"` path

**Unchanged.** MiniApp users continue to receive a JWT bound to the FID's resolved primary wallet. This path remains in place to support contexts where there is no pre-existing wallet JWT.

### Data Model

Reuse `allowlist_entries` (defined in `packages/backend/migrations/004_allowlist_entries.sql`, with constraints relaxed in `007_allowlist_wallet_only.sql`):

```
fid              BIGINT       -- nullable, partial UNIQUE (uq_allowlist_entries_fid_not_null)
wallet_address   VARCHAR(42)  -- nullable, partial UNIQUE (uq_allowlist_entries_wallet_not_null)
username         TEXT
display_name     TEXT
source           TEXT         -- gains a new value: 'farcaster-link'
is_active        BOOLEAN
metadata         JSONB
wallet_resolved_at TIMESTAMPTZ
```

Three valid row shapes:

- `(fid=F, wallet_address=null)` — pre-allowlisted FID with no wallet bound (existing webhook-source rows).
- `(fid=null, wallet_address=W)` — wallet-authenticated user, no Farcaster link.
- `(fid=F, wallet_address=W)` — linked.

No schema migration is required. The partial unique constraints already permit the row transitions described below.

### Reassign-on-conflict semantics

When a user with wallet `W_new` attempts to link FID `F` via SIWF:

1. **No conflict.** No existing row has `fid = F`. Update or insert the row for `W_new` with `fid = F`. Source `'farcaster-link'`.
2. **Self-link.** The row for `W_new` already has `fid = F`. Idempotent no-op (refresh `username`/`display_name`/`updated_at`).
3. **Cross-wallet conflict.** A different row has `fid = F, wallet_address = W_old`. The SIWF signature proves the user currently owns `F`, so the link is reassigned. In the same transaction:
   - On the `W_old` row, clear `fid`, `username`, `display_name`, and `wallet_resolved_at`. If after clearing the row also has `wallet_address IS NULL` (legacy FID-only allowlist entry), delete the row instead.
   - Update or insert `W_new`'s row with `fid = F`, `username`, `display_name`, `source = 'farcaster-link'`.

All branches execute inside a single transaction. The partial unique constraints (`uq_allowlist_entries_fid_not_null`, `uq_allowlist_entries_wallet_not_null`) are satisfied at every commit boundary because each row is written with its final shape.

Rationale for clearing rather than deleting the `W_old` row when it still has a `wallet_address`: that wallet may have other access state (admin flag, manual allowlist entry, group membership) that must not be discarded just because the user moved their FID elsewhere. Only the FID-specific columns are cleared.

### Frontend changes

#### `packages/frontend/src/context/AppAuthProvider.jsx`

Extend the context value with two new methods:

```js
linkFarcaster({ message, signature, nonce }) -> Promise<void>
unlinkFarcaster() -> Promise<void>
```

Both POST to the new endpoints with `Authorization: Bearer ${jwt}`, replace `{jwt, user}` in state from the response, and persist via the existing `persist`/`clearStorage` helpers. They follow the same `inflightRef` guard and `status` transitions as `signIn`.

The existing auto-fire SIWE effect (`AppAuthProvider.jsx:282`) requires no change — the backend now embeds the linked FID server-side, so the resulting JWT automatically carries the user's Farcaster identity across reconnects.

#### `packages/frontend/src/hooks/useFarcasterSignIn.js`

The polled relay callback (`useFarcasterSignIn.js:140`) branches based on whether a JWT already exists:

```js
const { signIn, linkFarcaster, jwt } = useAppAuth();
// ...
if (jwt) {
  await linkFarcaster({ message, signature, nonce });
} else {
  await signIn({ method: "farcaster", message, signature, nonce });
}
```

This preserves the existing MiniApp flow (no prior JWT → wallet-replacement SIWF) and enables the new Desktop flow (prior wallet JWT → attach FID).

#### `packages/frontend/src/components/auth/FarcasterAuth.jsx`

Replace the gating condition at line 42:

```diff
- if (isBackendAuthenticated && appAuthUser) {
+ if (appAuthUser?.fid) {
```

Repurpose the "Sign Out Farcaster" button: when wallet is still connected, call `unlinkFarcaster()` instead of `appAuthSignOut()`. When wallet is disconnected (edge case in MiniApp), keep the existing `signOut` + `appAuthSignOut` chain.

#### `packages/frontend/src/components/layout/Header.jsx`

Fix line 150:

```diff
- farcasterUser={isBackendAuthenticated ? backendUser : null}
+ farcasterUser={backendUser?.fid ? backendUser : null}
```

#### `packages/frontend/src/components/common/SettingsMenu.jsx`

Defense-in-depth: tighten the badge condition at line 345 even though Header now passes `null` for unlinked users.

```diff
- {farcasterUser ? (
+ {farcasterUser?.fid ? (
```

## Data Flow

### Link flow (Desktop, wallet already authenticated)

```
User clicks "Sign in with Farcaster" in SettingsMenu
  -> FarcasterAuth renders connect button (now visible because appAuthUser.fid is null)
  -> useFarcasterSignIn.handleSignInClick() opens auth-kit channel
  -> User scans QR / approves in Farcaster
  -> Relay returns { message, signature }
  -> useFarcasterSignIn sees jwt != null, calls linkFarcaster({ message, signature, nonce })
  -> POST /api/auth/link-farcaster (Bearer wallet JWT)
  -> Backend: verify JWT -> verify SIWF -> upsert allowlist_entries (reassign if needed)
  -> Backend: issue new JWT with { wallet, fid, username }
  -> Frontend: replace { jwt, user } in AppAuthContext
  -> UI: SettingsMenu now shows "@username - Linked", FarcasterAuth shows profile view
```

### Unlink flow

```
User clicks "Sign Out Farcaster" in FarcasterAuth profile view
  -> unlinkFarcaster() in AppAuthContext
  -> POST /api/auth/unlink-farcaster (Bearer current JWT)
  -> Backend: clear fid/username on allowlist_entries row -> issue new JWT (wallet-only)
  -> Frontend: replace { jwt, user }
  -> UI: SettingsMenu reverts to "Sign in with Farcaster" connect button
```

### Wallet reconnect with pre-existing link

```
User opens app, wallet reconnects
  -> AppAuthProvider auto-fires signIn({ method: "wallet" })
  -> POST /api/auth/verify (method: wallet)
  -> Backend: verify SIWE -> SELECT fid, username FROM allowlist_entries WHERE wallet = W
  -> Backend: issue JWT with embedded fid/username
  -> Frontend: user state contains fid/username from first connect
  -> UI: shows linked state immediately, no re-SIWF required
```

### MiniApp flow (unchanged)

```
Farcaster MiniApp loads
  -> Auto-SIWF via Farcaster Auth Kit
  -> useFarcasterSignIn sees jwt == null, calls signIn({ method: "farcaster", ... })
  -> POST /api/auth/verify (method: farcaster)
  -> Backend: verify SIWF -> resolve fid -> issue JWT bound to resolved wallet
  -> No change to today's behavior
```

## Error Handling

| Case | Surface | Response |
|------|---------|----------|
| Link request without bearer JWT | Backend | 401 |
| Bearer JWT expired | Backend | 401 — client triggers fresh SIWE first |
| Invalid SIWF signature | Backend | 400 (reuses existing path) |
| Invalid/reused SIWF nonce | Backend | 400 (reuses existing path) |
| Neynar resolution fails | Backend | Link still succeeds with `fid` only; `username`/`display_name` written as null (matches existing tolerance) |
| FID already linked to different wallet | Backend | Transparent reassign per policy; returns 200 with new JWT |
| Unlink when no FID linked | Backend | 200 no-op (idempotent) |
| Concurrent link race (same FID, two wallets) | Backend | Postgres row-level locking serializes; last writer wins. Loser's next SIWE re-auth observes `fid=null` and presents "Sign in with Farcaster" |
| Frontend network error during link | Frontend | Toast error via existing `useFarcasterSignIn` error path; JWT/user state unchanged |
| Wallet disconnects mid-link | Frontend | `AppAuthProvider` disconnect effect clears JWT/user; in-flight link request resolves but its response is ignored because `walletStatus !== "connected"` |

## Testing Strategy

### Backend (Vitest + supertest, `packages/backend/__tests__`)

- `auth/linkFarcaster`:
  - Link with valid SIWF + valid wallet JWT → 200, new JWT contains `fid`/`username`, `allowlist_entries` row updated.
  - Link without bearer → 401.
  - Link with expired bearer → 401.
  - Link with invalid SIWF signature → 400.
  - Link with reused nonce → 400.
  - Reassign: FID already linked to `W_old` (with wallet) → `W_new`'s row gets the FID, `W_old`'s row's FID-specific columns cleared but row retained.
  - Reassign with FID-only legacy row (`wallet_address=null`) → legacy row deleted, `W_new`'s row updated.
  - Idempotent self-link → 200, no row changes other than `updated_at`.
- `auth/unlinkFarcaster`:
  - Unlink with linked JWT → 200, new JWT has no `fid`, row cleared.
  - Unlink with no-FID JWT → 200, no-op.
  - Unlink without bearer → 401.
- `auth/verify` wallet path:
  - Wallet sign-in with pre-linked FID in `allowlist_entries` → JWT contains embedded `fid`/`username`.
  - Wallet sign-in with no allowlist row → JWT has `fid: null` (existing behavior).

### Frontend (Vitest + RTL, `packages/frontend/src/__tests__`)

- `useFarcasterSignIn`:
  - With non-null JWT → calls `linkFarcaster` on success.
  - With null JWT → calls `signIn({ method: "farcaster" })` on success (MiniApp behavior preserved).
- `AppAuthProvider`:
  - `linkFarcaster` updates `{jwt, user}` and persists on Desktop wallet types.
  - `unlinkFarcaster` updates `{jwt, user}` and persists.
  - Both methods are guarded by `inflightRef` against double-fire.
- `Header`:
  - `farcasterUser` prop is `null` when `backendUser.fid` is null.
  - `farcasterUser` prop carries `backendUser` when `fid` is set.
- `FarcasterAuth`:
  - Renders profile view only when `appAuthUser?.fid` is truthy.
  - Renders "Sign in with Farcaster" button when authenticated but `fid` is null.
  - Sign-out button calls `unlinkFarcaster()` when wallet is still connected.
- `SettingsMenu`:
  - "Linked" badge only renders when `farcasterUser?.fid` is set.

### Manual smoke (post-deploy)

- Connect wallet on Desktop → no "Linked" badge, "Sign in with Farcaster" visible in settings dropdown.
- Sign in with Farcaster from settings dropdown → badge appears, no wallet disconnect, JWT refreshed.
- Disconnect + reconnect same wallet → linked state restored without re-SIWF.
- Click "Sign Out Farcaster" → badge clears, wallet stays connected.
- Open same site in Farcaster MiniApp → unchanged (auto-SIWF, single auth, FID present).

## Rollout

1. Implement and merge behind no flag (alpha pre-deploy).
2. Deploy backend first (additive endpoints; existing surface unchanged).
3. Deploy frontend.
4. Verify smoke test above on both Vercel preview and production.
5. Update `instructions/frontend-guidelines.md` Farcaster section to document the link semantic and the `fid`-gated UI pattern.

## Open Followups (not in scope)

- Verify gasless still functions inside the Farcaster MiniApp (separate investigation).
- Verify whether the Farcaster custody wallet can participate in the Desktop SMA flow (separate investigation).
- Consider exposing the link state via a public profile field once stable.
