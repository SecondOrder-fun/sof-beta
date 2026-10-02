# Authentication

Sign-in is wallet-only: the user signs a one-time nonce message with their
connected wallet, the backend verifies the signature and issues a JWT.

## Flow

1. The wallet connects (RainbowKit / wagmi).
2. `GET /api/auth/nonce` returns `{ nonce }` — alphanumeric
   (`crypto.randomUUID().replaceAll('-', '')`), stored in Redis at
   `auth:nonce:{nonce}` with a 5-minute TTL. No parameters, so no address ends
   up in logs or URLs.
3. The wallet signs `"Sign in to SecondOrder.fun\nNonce: {nonce}"`.
4. `POST /api/auth/verify` with
   `{ "method": "wallet", "address": "0x…", "signature": "0x…", "nonce": "…", "walletType": "desktop-eoa" }`.
   `"wallet"` is the only accepted `method`.
5. The backend consumes the nonce (deleted before verification; a missing or
   expired nonce is a 401), then verifies the signature with
   `publicClient.verifyMessage`. Unlike viem's standalone `verifyMessage`
   (ECDSA recovery only), the public-client form also accepts smart-wallet
   signatures: ERC-1271 for deployed accounts and ERC-6492 for counterfactual
   ones (e.g. a Coinbase Smart Wallet that has not deployed yet).
6. It looks up the wallet's access level (`getUserAccess({ wallet })`) and its
   SoF username, sets the admin flag for `ADMIN_EOAS` wallets
   (`ensureAdminFlag`), and returns the JWT. There is no smart account: the
   user's identity is the wallet address they signed with.

The frontend side is `AppAuthProvider` (`packages/frontend/src/context/`): it
fires the flow automatically on connect for desktop EOAs and Coinbase Smart
Wallet and persists the JWT in `localStorage` for those wallet types.

## Response

```json
{
  "token": "jwt…",
  "user": {
    "address": "0x…",
    "username": "alice",
    "accessLevel": 2,
    "role": "allowlist",
    "isAdmin": false
  }
}
```

`username` is the SoF username set via `/api/usernames` (`null` if none).

## JWT

Issued by `AuthService.generateToken()` (`JWT_SECRET`, `JWT_EXPIRES_IN`) with:

- `id` — allowlist entry id, else the wallet address
- `wallet_address` — lowercase address
- `role` — access-level name (`public`, `connected`, `allowlist`, `beta`, `admin`)
- `username`, `is_admin` — when set

The global Fastify `preHandler` decodes `Authorization: Bearer {token}` into
`request.user`; public endpoints ignore a missing token.

## Access control

Allowlist entries, access levels and access groups are keyed by wallet
address (`allowlist_entries.wallet_address`,
`user_access_groups.wallet_address`, both NOT NULL).

| Level | Name |
|-------|------|
| 0 | public (no entry) |
| 1 | connected |
| 2 | allowlist |
| 3 | beta |
| 4 | admin |

`createRequireAdmin()` (`shared/adminGuard.js`) rejects requests whose
wallet's level is below 4. Lookups go through a 5-minute Redis cache
(`shared/accessCache.js`, keys `access:wallet:{address}`) that every access
mutation invalidates.

## Key files

| File | Purpose |
|------|---------|
| `packages/backend/fastify/routes/authRoutes.js` | Nonce + verify endpoints |
| `packages/backend/shared/auth.js` | JWT generation and verification, request auth hook |
| `packages/backend/shared/accessService.js` | Access level + group lookup |
| `packages/backend/shared/accessCache.js` | Redis read-through cache for access lookups |
| `packages/backend/shared/adminGuard.js` | `createRequireAdmin` preHandler |
| `packages/backend/shared/services/adminEoaService.js` | `ADMIN_EOAS` → `is_admin` |
| `packages/frontend/src/context/AppAuthProvider.jsx` | Frontend sign-in lifecycle |
