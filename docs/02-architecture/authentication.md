# Authentication

Unified auth system supporting wallet SIWE and Farcaster SIWF via a single endpoint pair with method-based dispatch.

## Problem

The auth system previously had two parallel route sets:
- `GET /auth/nonce?address=0x...` + `POST /auth/verify` (wallet)
- `GET /auth/farcaster/nonce` + `POST /auth/farcaster/verify` (Farcaster)

Issues:
1. Wallet address exposed in GET query parameter (server logs, browser history, Referer headers)
2. Inconsistent nonce storage: by-address for wallet, by-nonce for Farcaster
3. Duplicated nonce generation, Redis storage, and JWT issuance logic
4. Adding a new auth method required new route pairs

## Architecture

### Unified Nonce Endpoint

**`GET /api/auth/nonce`** — no parameters.

- Generates alphanumeric nonce (`crypto.randomUUID().replaceAll('-', '')`)
- Stores in Redis keyed by nonce value: `auth:nonce:{nonce}` with 5-minute TTL
- Returns `{ nonce }`
- One-time use — deleted on consumption during verify

### Unified Verify Endpoint

**`POST /api/auth/verify`** with `method` discriminator in the body.

**Wallet SIWE request:**
```json
{ "method": "wallet", "address": "0x...", "signature": "0x...", "nonce": "abc123" }
```

**Farcaster SIWF request:**
```json
{ "method": "farcaster", "message": "...", "signature": "0x...", "nonce": "abc123" }
```

**Shared verify flow:**
1. Validate `method` is `"wallet"` or `"farcaster"`
2. Validate nonce exists in Redis at `auth:nonce:{nonce}`, consume it (delete)
3. Dispatch to method-specific verification:
   - **wallet**: validate address format, verify signature via `viem.verifyMessage()` against `"Sign in to SecondOrder.fun\nNonce: {nonce}"`
   - **farcaster**: verify signature via `@farcaster/auth-client`, extract FID, resolve FID→wallet via Neynar, upsert allowlist, sync username
4. Look up access level via `getUserAccess()`
5. Generate JWT via `AuthService.generateToken()`
6. Return unified response

### Unified Response Shape

```json
{
  "token": "jwt...",
  "user": {
    "address": "0x...",
    "fid": 12345,
    "username": "alice",
    "displayName": "Alice",
    "pfpUrl": "https://...",
    "accessLevel": 2,
    "role": "user"
  }
}
```

All fields always present. Farcaster-specific fields (`fid`, `username`, `displayName`, `pfpUrl`) are `null` for wallet-only users. `address` may be `null` if Farcaster FID resolution fails.

### Redis Key Scheme

All auth methods use the same key pattern:

| Key | TTL | Purpose |
|-----|-----|---------|
| `auth:nonce:{nonce}` | 5 min | One-time nonce for any auth method |

## Auth Contexts

| Context | Method | Frontend Provider | Notes |
|---------|--------|-------------------|-------|
| Farcaster MiniApp | `farcaster` | `FarcasterProvider` | SIWF via Auth Kit, QR code relay |
| Admin panel | `wallet` | `AdminAuthContext` | SIWE via wagmi `signMessage` |
| Desktop browser | `wallet` | `AdminAuthContext` | RainbowKit connect + SIWE |

### Wallet SIWE Flow (Admin)

1. User connects wallet (wagmi/RainbowKit)
2. Frontend calls `GET /api/auth/nonce`
3. Backend returns nonce, stores in Redis for 5 minutes
4. Frontend signs message: `"Sign in to SecondOrder.fun\nNonce: {nonce}"`
5. Frontend calls `POST /api/auth/verify` with `{ method: "wallet", address, signature, nonce }`
6. Backend verifies signature via `viem.verifyMessage()`
7. Nonce consumed (deleted from Redis)
8. Backend returns JWT + user info
9. Frontend stores JWT in sessionStorage

### Farcaster SIWF Flow (MiniApp)

1. User clicks "Sign in with Farcaster"
2. Frontend calls `GET /api/auth/nonce`
3. Backend returns alphanumeric nonce, stores in Redis for 5 minutes
4. Frontend calls auth-kit's `useSignIn` with nonce callback
5. Auth-kit creates channel → user scans QR code in Farcaster
6. Frontend manually polls Farcaster relay until user confirms
7. Relay returns `{ message, signature }`
8. Frontend calls `POST /api/auth/verify` with `{ method: "farcaster", message, signature, nonce }`
9. Backend validates SIWF via `@farcaster/auth-client`, extracts FID
10. Backend resolves FID → wallet address via Neynar, upserts allowlist
11. Backend returns JWT + user info (FID, address, username, display name, PFP)
12. Frontend stores JWT in sessionStorage

## JWT

Issued by `AuthService.generateToken()` with payload:
- `id` — allowlist entry ID or wallet address
- `wallet_address` — lowercase Ethereum address
- `role` — derived from access level (`user`, `admin`, etc.)
- `fid` — Farcaster ID (only for Farcaster auth)

Configured via `JWT_SECRET` and `JWT_EXPIRES_IN` env vars.

The global Fastify `preHandler` hook decodes the JWT from `Authorization: Bearer {token}` and populates `request.user`. Public endpoints ignore missing auth; admin endpoints use the `requireAdmin` guard which checks access level via `accessService`.

## Access Control

Access levels are managed via the allowlist service:

| Level | Name | Description |
|-------|------|-------------|
| 0 | PUBLIC | No allowlist entry |
| 1 | BASIC | Allowlisted user |
| 2 | PREMIUM | Premium access |
| 3 | MODERATOR | Moderation capabilities |
| 4 | ADMIN | Full admin access |

The `requireAdmin` preHandler (from `shared/adminGuard.js`) rejects any request where `accessInfo.level < ADMIN`.

## Key Files

| File | Purpose |
|------|---------|
| `packages/backend/fastify/routes/authRoutes.js` | Unified nonce + verify endpoints |
| `packages/backend/shared/auth.js` | JWT generation, verification, SIWF client |
| `packages/backend/shared/accessService.js` | Access level lookup |
| `packages/backend/shared/adminGuard.js` | `requireAdmin` preHandler |
| `packages/backend/shared/allowlistService.js` | Allowlist CRUD + upsert |
| `packages/backend/shared/fidResolverService.js` | FID → wallet resolution via Neynar |
| `packages/frontend/src/context/AdminAuthContext.jsx` | Wallet SIWE flow |
| `packages/frontend/src/context/FarcasterProvider.jsx` | Farcaster SIWF flow |
| `packages/frontend/src/hooks/useFarcasterSignIn.js` | SIWF relay polling |
