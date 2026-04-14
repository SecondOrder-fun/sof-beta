# Gasless Transaction Pipeline

**Date:** 2026-04-14
**Status:** Approved design
**Scope:** Frontend (`useSmartTransactions`), Backend (paymaster proxy), Contracts (VerifyingPaymaster deploy)

## Problem

All user-facing transactions show gas fees because:
1. The JWT that gates paymaster access is only read from `FarcasterContext`. Wallet-based SIWE auth produces a JWT (`sof:jwt` in localStorage) that `useSmartTransactions` ignores.
2. On local Anvil, there's no paymaster. The Pimlico proxy returns 503 when `PAYMASTER_RPC_URL` is unset.

## Solution

### 1. Widen JWT read in useSmartTransactions

**File:** `packages/frontend/src/hooks/useSmartTransactions.js`

Currently (line 41-42):
```js
const farcasterAuth = useContext(FarcasterContext);
const backendJwt = farcasterAuth?.backendJwt ?? null;
```

Change to:
```js
const farcasterAuth = useContext(FarcasterContext);
const backendJwt = farcasterAuth?.backendJwt
  ?? localStorage.getItem('sof:jwt')
  ?? null;
```

This reads from Farcaster context first (MiniApp users), then falls back to the SIWE wallet JWT (desktop browser users). Both JWTs are issued by the same backend `AuthService.generateToken` and accepted by the same session endpoint.

### 2. Deploy Pimlico VerifyingPaymaster to local Anvil

**New file:** `packages/contracts/script/deploy/15_DeployPaymaster.s.sol`

Deploys Pimlico's `VerifyingPaymaster` contract on local Anvil only (skipped on testnet/mainnet where Pimlico's hosted API is used). Steps:
1. Deploy the VerifyingPaymaster contract (references EntryPoint v0.8 at `0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108`)
2. Fund the paymaster's EntryPoint deposit with 100 ETH from the relay wallet
3. Set the relay wallet as the paymaster signer (signs off-chain paymaster approvals)
4. Store the address in `DeployedAddresses.paymasterAddress`
5. Write to `local.json` as `"Paymaster"`

**Source contract:** Use Pimlico's open-source `VerifyingPaymaster` from their permissionless.js repo, or a minimal implementation that:
- Inherits from the ERC-4337 `BasePaymaster`
- Accepts any UserOp signed by the designated signer (relay wallet)
- Pays gas from its EntryPoint deposit

**DeployAll changes:**
- Add `15_DeployPaymaster` to the orchestrator (after `14_ConfigureRoles`)
- Only runs when `block.chainid == 31337` (local) — on testnet/mainnet, `addrs.paymasterAddress` stays `address(0)`
- Add `"Paymaster"` key to the JSON output

**DeployedAddresses struct:** Add `address paymasterAddress` field.

### 3. Backend paymaster proxy handles local

**File:** `packages/backend/fastify/routes/paymasterProxyRoutes.js`

When `PAYMASTER_RPC_URL` is not set (local dev), instead of returning 503, the `/pimlico` endpoint handles `pm_getPaymasterStubData` and `pm_getPaymasterData` locally:

1. Read the VerifyingPaymaster address from `@sof/contracts` deployments (`getDeployment('local').Paymaster`)
2. For `pm_getPaymasterStubData`: return the paymaster address and estimated gas limits (stub values for gas estimation)
3. For `pm_getPaymasterData`: sign the UserOp hash with the relay wallet private key (`BACKEND_WALLET_PRIVATE_KEY`), return the paymaster address + signature as `paymasterData`

This implements the same ERC-7677 interface that Pimlico's hosted API uses. MetaMask and the frontend see no difference between local and production.

**Signing flow:**
- Extract UserOp hash from the request
- Sign with `BACKEND_WALLET_PRIVATE_KEY` (same key that's the paymaster's designated signer)
- Return `{ paymaster: paymasterAddress, paymasterData: signature }`

### Chain support

The VerifyingPaymaster uses EntryPoint v0.8 (`0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108`) which is deployed on:
- Local Anvil (Prague hardfork)
- Base Sepolia
- Base Mainnet
- Arbitrum Sepolia / Mainnet
- Ethereum Mainnet

Same contract works everywhere. On testnet/mainnet, the hosted Pimlico API handles the signing — no local paymaster needed.

## What stays the same

- `executeBatch` → `sendCallsAsync` → `wallet_sendCalls` flow (already refactored in PR #16)
- Pimlico hosted API for testnet/mainnet (`PAYMASTER_RPC_URL` set)
- Session-gated proxy (JWT required for paymaster session)
- MetaMask handles 7702 internally via `wallet_sendCalls`
- Coinbase Wallet CDP paymaster path (separate proxy)

## Testing

- Local: `docker compose up -d` → all transactions gasless via local VerifyingPaymaster
- Testnet: deploy to Base Sepolia → gasless via Pimlico hosted API
- Verify: MetaMask shows "Sponsored by SecondOrder.fun" instead of gas fee
- Verify: faucet claim, ticket buy/sell, market bets all gasless
- Verify: unauthenticated users (no JWT) still see gas fees (paymaster not available)
