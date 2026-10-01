# Gasless Transaction Pipeline

All user-facing on-chain transactions are gasless, sponsored by the platform via ERC-4337 paymasters.

## Problem

All user-facing transactions showed gas fees because:
1. The JWT that gates paymaster access was only read from one sign-in path's context, so a JWT from the other sign-in path was ignored by `useSmartTransactions`.
2. On local Anvil, there was no paymaster. The Pimlico proxy returned 503 when `PAYMASTER_RPC_URL` was unset.

## Architecture

### Frontend: Three-Tier Fallback

The frontend hook `useSmartTransactions` provides `executeBatch()` which attempts a three-tier fallback:

1. **ERC-5792 batch + ERC-7677 paymaster** — gasless, single confirmation
2. **ERC-2612 permit** — signature + single transaction
3. **Traditional approve + tx** — two confirmations (last resort)

`executeBatch([{ to, data, value }])` sends calls via `wallet_sendCalls` (ERC-5792). The wallet (Coinbase Wallet, MetaMask with ERC-7702) detects paymaster capabilities and sponsors gas automatically.

Batch capability is detected dynamically from the connected wallet's advertised capabilities (`useCapabilities` from wagmi). Non-batch wallets (plain MetaMask EOA) fall back to tiers 2/3 automatically.

The JWT for paymaster session gating is the wallet sign-in JWT from
`useAppAuth()` (`AppAuthProvider`).

### Backend: Paymaster Proxy

The backend proxies paymaster requests at `/api/paymaster/pimlico`:

- **Production (testnet/mainnet):** Forwards to Pimlico's hosted API via `PAYMASTER_RPC_URL`
- **Local (Anvil):** Signs paymaster approvals directly using the relay wallet against a locally deployed `SOFPaymaster` contract

Both paths implement the same ERC-7677 interface (`pm_getPaymasterStubData`, `pm_getPaymasterData`). MetaMask and the frontend see no difference between local and production.

**Local signing flow:**
1. Extract UserOp hash from the request
2. Sign `keccak256(abi.encode(userOpHash, validUntil, validAfter))` with `BACKEND_WALLET_PRIVATE_KEY`
3. Return `{ paymaster: paymasterAddress, paymasterData: validUntil + validAfter + signature }`

### Contract: SOFPaymaster

A verifying paymaster (ERC-4337) deployed on local Anvil only. On testnet/mainnet, Pimlico's hosted API is used instead.

**`paymasterAndData` layout (129 bytes):**
- `[0:20]` — paymaster address (20 bytes)
- `[20:52]` — reserved by EntryPoint (32 bytes)
- `[52:58]` — `validUntil` (uint48, 6 bytes) — 0 means no expiry
- `[58:64]` — `validAfter` (uint48, 6 bytes) — 0 means immediately valid
- `[64:129]` — ECDSA signature (65 bytes)

The backend signs `keccak256(abi.encode(userOpHash, validUntil, validAfter))`. The contract verifies the signer matches the designated signer (relay wallet) and returns packed `validationData` per ERC-4337 spec: `sigFailed | (validUntil << 160) | (validAfter << 208)`.

**Deployment:** `15_DeployPaymaster.s.sol` deploys with 100 ETH deposit, registers the relay wallet as signer. Skipped on testnet/mainnet via `HelperConfig.isLocal` check.

### Chain Support

Uses EntryPoint v0.8 (`0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108`) deployed on:
- Local Anvil (Prague hardfork)
- Base Sepolia
- Base Mainnet

Same contract works everywhere. On testnet/mainnet, the hosted Pimlico API handles signing.

## What Stays The Same

- `executeBatch` → `sendCallsAsync` → `wallet_sendCalls` flow
- Pimlico hosted API for testnet/mainnet (`PAYMASTER_RPC_URL` set)
- Session-gated proxy (JWT required for paymaster session)
- MetaMask handles 7702 internally via `wallet_sendCalls`
- Coinbase Wallet CDP paymaster path (separate proxy)

## Key Files

| File | Purpose |
|------|---------|
| `packages/frontend/src/hooks/useSmartTransactions.js` | `executeBatch` + capability detection |
| `packages/backend/fastify/routes/paymasterProxyRoutes.js` | Paymaster proxy (Pimlico + local) |
| `packages/backend/src/services/paymasterService.js` | Backend relay transactions |
| `packages/contracts/src/paymaster/SOFPaymaster.sol` | Verifying paymaster contract |
| `packages/contracts/script/deploy/15_DeployPaymaster.s.sol` | Local deployment script |

## Testing

- Local: `docker compose up -d` → all transactions gasless via local SOFPaymaster
- Testnet: deploy to Base Sepolia → gasless via Pimlico hosted API
- Verify: MetaMask shows "Sponsored by SecondOrder.fun" instead of gas fee
- Verify: faucet claim, ticket buy/sell, market bets all gasless
- Verify: unauthenticated users (no JWT) still see gas fees (paymaster not available)
