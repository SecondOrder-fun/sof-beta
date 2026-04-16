# Unified Auth Routes

**Date:** 2026-04-16
**Status:** Complete (merged PR #20)

## Problem

The auth system has two parallel route sets for wallet SIWE and Farcaster SIWF authentication:

- `GET /auth/nonce?address=0x...` + `POST /auth/verify` (wallet)
- `GET /auth/farcaster/nonce` + `POST /auth/farcaster/verify` (Farcaster)

Issues:
1. Wallet address exposed in GET query parameter (server logs, browser history, Referer headers)
2. Inconsistent nonce storage: by-address for wallet, by-nonce for Farcaster
3. Duplicated nonce generation, Redis storage, and JWT issuance logic
4. Adding a new auth method requires new route pairs

## Design

### Unified Nonce Endpoint

**`GET /auth/nonce`** — no parameters.

- Generate alphanumeric nonce (`crypto.randomUUID().replaceAll('-', '')`)
- Store in Redis keyed by nonce value: `auth:nonce:{nonce}` with 5-minute TTL
- Return `{ nonce }`

Replaces both `GET /nonce?address=` and `GET /farcaster/nonce`.

### Unified Verify Endpoint

**`POST /auth/verify`** with `method` discriminator in the body.

#### Wallet SIWE request:
```json
{ "method": "wallet", "address": "0x...", "signature": "0x...", "nonce": "abc123" }
```

#### Farcaster SIWF request:
```json
{ "method": "farcaster", "message": "...", "signature": "0x...", "nonce": "abc123" }
```

#### Shared verify flow:
1. Validate `method` is `"wallet"` or `"farcaster"`
2. Validate nonce exists in Redis at `auth:nonce:{nonce}`, consume it (delete)
3. Dispatch to method-specific verification:
   - **wallet**: validate address format, verify signature via `viem.verifyMessage()` against `"Sign in to SecondOrder.fun\nNonce: {nonce}"`
   - **farcaster**: verify signature via `AuthService.authenticateFarcaster()`, resolve FID→wallet, upsert allowlist, sync username
4. Look up access level via `getUserAccess()`
5. Generate JWT via `AuthService.generateToken()`
6. Return unified response

#### Unified response shape:
```json
{
  "token": "jwt...",
  "user": {
    "address": "0x...",
    "fid": null,
    "username": null,
    "displayName": null,
    "pfpUrl": null,
    "accessLevel": 2,
    "role": "user"
  }
}
```

All fields always present. Farcaster-specific fields are `null` for wallet-only users. `address` may be `null` if Farcaster FID resolution fails.

### Redis Key Change

| Before | After |
|--------|-------|
| `auth:nonce:{address}` (wallet) | `auth:nonce:{nonce}` (both) |
| `auth:farcaster_nonce:{nonce}` (farcaster) | `auth:nonce:{nonce}` (both) |

### Removed Routes

- `GET /auth/nonce?address=` — replaced by `GET /auth/nonce`
- `GET /auth/farcaster/nonce` — replaced by `GET /auth/nonce`
- `POST /auth/farcaster/verify` — replaced by `POST /auth/verify` with `method: "farcaster"`

No backward compatibility layer. Clean break since we control both frontend and backend.

## Files Changed

### Backend
- `packages/backend/fastify/routes/authRoutes.js` — rewrite: unified nonce + verify with method dispatch

### Frontend
- `packages/frontend/src/context/AdminAuthContext.jsx` — update nonce URL (drop address param), add `method: "wallet"` to verify body
- `packages/frontend/src/context/FarcasterProvider.jsx` — update nonce URL (`/auth/nonce`), update verify URL (`/auth/verify`), add `method: "farcaster"` to verify body

## Testing

- Existing auth flow should work identically from user perspective
- Wallet sign-in: nonce → sign → verify → JWT
- Farcaster sign-in: nonce → SIWF relay → verify → JWT
- Nonce expiry (5 min TTL) unchanged
- Nonce replay protection (one-time use) unchanged
