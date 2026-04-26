# Test A — Rabby End-to-End

**Date:** 2026-04-26
**Goal:** Confirm the ERC-4337 sponsored-UserOp stack is wallet-agnostic by running the same Test A flow with Rabby that we ran with MetaMask (PR #27, Task #37).

## Why this should "just work"

Everything that was wallet-specific in the MetaMask bring-up is in the wallet itself — EIP-7702 authorization signing, EIP-712 userOp hash signing, `wallet_sendCalls` (ERC-5792). The backend bundler, paymaster, EntryPoint, and `useSmartTransactions` hook are all wallet-agnostic. Rabby is a fork of MetaMask that supports the same APIs, so:

- Connect via the same RainbowKit UI
- DelegationModal sees Rabby as a non-Coinbase EOA → prompts for 7702 delegation
- `executeBatch` Path A (delegated EOA → ERC-4337 sponsored UserOp via permissionless) fires the same way
- Backend `/api/paymaster/local` signs the same SOFPaymaster digest
- EntryPoint.handleOps lands the wrapping tx on Anvil

If anything is wallet-specific that we missed, the failure modes are:

1. **`wallet_signAuthorization` (EIP-7702) signing path** — Rabby may need its own way to drive the type-0x04 transaction. We work around this on local with the `/api/wallet/delegate-shortcut` endpoint, so even if Rabby doesn't support EIP-7702 signing yet, the delegation step still works.
2. **`personal_sign` for the userOp hash** — `permissionless`'s `to7702SimpleSmartAccount` adapter uses this. Should work; if not, error will be AA24 (signature error) at submit.
3. **RainbowKit / wagmi connector glue** — Rabby identifies as `injected` (or its own connector); the `useDelegationStatus` hook gates Coinbase Wallet specifically by `connector?.id === 'coinbaseWalletSDK'`, so Rabby falls through to the EOA-needs-delegation branch correctly.

## Prerequisites

Same as MetaMask Test A (see `docs/superpowers/specs/2026-04-16-local-e2e-testing-plan.md`):

```bash
# Clean stack
npm run docker:down
npm run docker:up

# Seed admin (if not already in init.sql)
docker exec -i sof-beta-postgres-1 psql -U postgres -d sof_local -c \
  "INSERT INTO allowlist_entries (wallet_address, source, access_level, is_active) \
   VALUES ('0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266', 'manual', 4, true) \
   ON CONFLICT DO NOTHING;"

# Frontend + backend
cd packages/backend && npm run dev   # tab 1
cd packages/frontend && npm run dev   # tab 2
```

Verify the headless E2E still passes (proves the local stack is healthy and the bug isn't environmental):

```bash
node scripts/test-aa-e2e.js
# Expect: ✓ ALL PHASES PASSED
```

## Wallet setup

1. Install **Rabby** from [rabby.io](https://rabby.io) (Chrome extension).
2. Create or import a fresh test wallet (NOT a wallet you've used with MetaMask Test A — we want a clean delegation slot).
3. Add a custom network:
   - Name: **Anvil Local**
   - RPC: `http://127.0.0.1:8545`
   - Chain ID: `31337`
   - Currency: ETH
4. Import an Anvil-funded test key (deployer #6 is unused by previous MM tests):
   ```
   0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e
   ```
   Address: `0x976EA74026E726554dB657fA54763abd0C3a0aa9`

Funded by Anvil's default genesis allocation (10000 ETH).

## Test plan

### Phase 1 — Connect

1. Open `http://localhost:5174`
2. Click **Connect Wallet** in the header
3. RainbowKit modal: pick **Browser Wallet** (or **Injected**)
4. Rabby popup → Connect

**Pass criteria:**
- Wallet shows connected, address visible in Settings menu
- Browser console: no errors
- Network selector shows "Anvil Local"

### Phase 2 — DelegationModal

Action: trigger any path that calls `useSmartTransactions.executeBatch` — easiest is **buy a ticket** (need a season, see Phase 3).

If the connected EOA isn't yet delegated, the DelegationModal should appear on first sponsored-tx attempt.

**Pass criteria:**
- Modal shows "Set up gasless transactions" or equivalent
- "Approve" → uses `/api/wallet/delegate-shortcut` on local (no Rabby popup expected; the shortcut applies via backend)
- Modal closes after ~5s with success state
- `cast code <address> --rpc-url http://127.0.0.1:8545` returns `0xef0100<smart-account-address>`

### Phase 3 — Create Season (admin path)

Requires the admin allowlist seed from prerequisites.

1. Connect with the **admin wallet** (Anvil #0, key `0xac09...`) — NOT the test wallet from Phase 2.
2. Navigate to `/admin`
3. Open **Create Season**
4. Fill in: name, dates, default bonding-curve config
5. Submit

**Pass criteria:**
- Rabby popup shows the wallet_sendCalls (ERC-5792) request OR the EIP-7702 delegation request (depending on whether admin is already delegated)
- Sign in Rabby
- Frontend modal shows "Submitting" → "Confirmed"
- Console log: `[executeBatch]` shows `pathA: true` (sponsored) OR Path B fallback
- New season appears in `/raffles`

### Phase 4 — Buy Tickets (sponsored)

Switch back to the **test wallet** (Phase 2 wallet). Navigate to the season detail page.

1. Enter ticket amount (e.g., 10)
2. Click **Buy**
3. Rabby popup: review the userOp signing request

**Pass criteria:**
- Rabby shows a `personal_sign` request with a 32-byte hash (the EIP-712 userOp hash)
- Sign in Rabby
- Frontend shows transaction submitted then confirmed
- `Bonding Curve Progress` advances
- **Crucial:** check Rabby's transaction history — the wallet's ETH balance is **unchanged** (paymaster covered gas)
- Transaction toast shows "Tickets purchased successfully" with a working "View Transaction" link

### Phase 5 — Sell Tickets (sponsored)

1. From the same wallet, enter sell amount
2. Click **Sell**
3. Sign in Rabby

**Pass criteria:**
- Same as Phase 4: ETH balance unchanged, paymaster sponsored
- Wallet's SOF balance increases
- Position card updates

### Phase 6 — Diagnostic checks

Confirm under-the-hood the right thing happened:

```bash
# Paymaster deposit decreased by gas-cost amounts
cast call $(jq -r '.contracts.Paymaster' packages/contracts/deployments/local.json) \
  "getDeposit()(uint256)" \
  --rpc-url http://127.0.0.1:8545

# Backend logs: should show ~6 sponsored ops (one per Phase 4/5 action)
# Look for "userOp landed" log lines

# Browser console: useSmartTransactions logs [executeBatch] with
# pathA: true on every sponsored action
```

## Failure modes to watch for

- **AA24 signature error**: Rabby's `personal_sign` produced something incompatible with `permissionless`'s `to7702SimpleSmartAccount` digest. If this happens, capture the userOp + signature from console; we may need a custom account adapter for Rabby.
- **Delegation lands but `useDelegationStatus.isSOFDelegate` stays false**: known issue from the MM bring-up (memory `today-2026-04-26.md`). Hard refresh + check `cast code` first.
- **Path B fallback unexpectedly**: console log will show "sponsored path failed, falling back". Inspect the Error in the warning — usually session-token fetch or paymaster RPC issue, not Rabby-specific.
- **`wallet_sendCalls` not supported by Rabby**: Rabby may report ERC-5792 as unsupported in `useCapabilities`. The frontend should fall through to the legacy permit-or-approve path. If Rabby itself errors, the issue is wagmi's `useSendCalls` not Rabby-compat.

## Reporting back

Capture for each phase: ✓ / ✗, console snippet on failure, Rabby's exact prompt text. If Phase 4/5 pass with the wallet's ETH balance unchanged, **Test A on Rabby is confirmed wallet-agnostic** and we can mark Task #26 done.

If a failure mode surfaces, file a follow-up task with the diagnostic capture and we'll triage — but the heavy lifting is done; any Rabby-specific issue would be a wallet-quirk patch rather than a stack rebuild.
