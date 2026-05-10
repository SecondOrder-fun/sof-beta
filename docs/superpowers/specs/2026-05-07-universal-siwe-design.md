# Universal SIWE-on-Connect — Design

**Status:** approved (sections 1-5 reviewed in chat 2026-05-07)
**Author:** Claude Opus 4.7 with Patrick (interactive brainstorm)
**Branch:** `feat/gasless-rewrite`
**Companion plan:** `docs/superpowers/plans/2026-05-07-universal-siwe.md`

---

## 1. Problem

The gasless-rewrite spec §6 Flow A says *"Connect wallet → SIWE auth"* triggers `ensureSmartAccount` + `airdropService.transferToSma` for every fresh user. In practice, only `AdminAuthContext` ever calls `/api/auth/verify`, and only after a manual button press inside admin route trees. Non-admin players never SIWE, so:

- `smart_accounts.funded_at` never populates for them
- The airdrop relayer never fires
- Anvil #6 (truly fresh non-admin EOA) cannot buy a ticket without manual SOF top-ups, which means M5 Path C is structurally untestable

This is a missed frontend wiring task in the original M5 plan, not a backend gap. `/api/auth/verify` already does the right thing for any wallet that calls it.

## 2. Goal

Wire SIWE auto-fire on wallet connect for desktop-EOA wallets (MetaMask/Rabby/RainbowKit/Coinbase Smart Wallet), so first-time connection produces a backend JWT containing `sma` + `is_admin` and triggers `ensureSmartAccount` server-side. After this lands, an Anvil #6 fresh-user flow walks itself: connect → sig popup → JWT → airdrop → buy ticket.

## 3. Non-goals

- No Farcaster MiniApp auto-SIWF (kept manual — Q4).
- No Coinbase Smart Wallet bespoke handling (treat identically to desktop EOA — Q5; defer if UX pain surfaces in alpha).
- No JWT refresh-before-expiry (7-day expiry stays; users re-sign at the boundary).
- No mainnet hardening (signed cookies, key rotation) — separate effort.

## 4. Decisions captured

| # | Decision | Rationale |
|---|---|---|
| Q1 | Auto-fire SIWE on connect **only if no valid cached JWT exists** | Fresh users get the spec's Flow A; returning users don't get harassed |
| Q2 | `localStorage` for desktop + Coinbase Smart Wallet; **in-memory only** for Farcaster MiniApp | MiniApp contexts are short-lived; persistence has no value there |
| Q3 | **Delete `AdminAuthContext` and `useAdminAuth`** entirely; migrate ~15-20 callsites to `useAppAuth` | "Ruthless alpha cleanup" preference; one source of truth for JWT |
| Q4 | **Keep SIWF manual** for Farcaster (web QR + MiniApp button) | Auto-prompting QR-flow users is jarring; in-app MiniApp auto-fire deferred |
| Q5 | Coinbase Smart Wallet uses the same code path as desktop EOA | Backend `verifyMessage` handles EIP-1271 transparently; YAGNI |
| Q6 | Sig rejection → non-blocking `SignInRetryBanner` with "Try again" CTA | Lets browsers browse; respects opt-out without trapping the user |

## 5. Architecture

### 5.1 Provider tree (`packages/frontend/src/main.jsx`)

```
WagmiConfigProvider
└─ RainbowKitProvider
   └─ AuthKitProvider
      └─ FarcasterProvider          (profile state only after this change)
         └─ RaffleAccountProvider   (eoa, sma, walletType — unchanged)
            └─ AppAuthProvider      ← NEW: global JWT lifecycle
               └─ LoginModalProvider
                  └─ SSEProvider
                     └─ UsernameProvider
                        └─ ThemeProvider
                           └─ <App />
```

`AppAuthProvider` sits below `RaffleAccountProvider` so it can read `walletType` to decide whether to auto-fire (only `desktop-eoa` per Q4; Coinbase Smart Wallet rolls under `desktop-eoa` for now per Q5).

### 5.2 Public API

```ts
// useAppAuth() returns:
{
  jwt: string | null,
  user: {
    address: string,           // lowercase EOA
    sma: string | null,        // lowercase, from JWT claim
    isAdmin: boolean,
    accessLevel: number,
    role: string,
    fid?: number,              // populated only for Farcaster path
    username?: string | null,
  } | null,
  status: 'idle' | 'signing' | 'verifying' | 'authenticated' | 'rejected' | 'error',
  error: string | null,
  signIn: (opts?: SignInOpts) => Promise<void>,
  signOut: () => void,
  getAuthHeaders: () => { Authorization?: string },
}

type SignInOpts =
  | { method: 'wallet' }                                // default — desktop-eoa flow
  | { method: 'farcaster', message: string,
      signature: string, nonce: string };               // delegated from useFarcasterSignIn
```

`useAppAuth()` throws if used outside the provider — matches existing `useUsernameContext`/`useRaffleAccount` ergonomics.

### 5.3 Storage truth table

| Event | localStorage write | localStorage clear | In-memory state |
|---|---|---|---|
| Verify success — `desktop-eoa`/`coinbase-smart` | yes | — | jwt + user |
| Verify success — `farcaster-miniapp` | no | — | jwt + user |
| Disconnect | — | yes | cleared |
| Wallet change (address differs from JWT claim) | — | yes (then re-auth writes new) | cleared then repopulated |
| Sig rejected | — | — | jwt=null, status='rejected' |
| Tab close | — | (browser keeps localStorage) | cleared |
| Tab reopen with valid cached JWT | — | — | rehydrated |
| Tab reopen with expired cached JWT | — | yes | cleared, re-auth fires |

Storage key: `sof:auth_jwt`. On `AppAuthProvider` mount: also delete `sof:admin_jwt` and `sof:farcaster_jwt` (legacy keys) to avoid orphan tokens confusing edge cases.

## 6. Component inventory

### 6.1 Created

| File | Purpose |
|---|---|
| `packages/frontend/src/context/AppAuthProvider.jsx` | Global JWT lifecycle, auto-fire effect, retry banner state |
| `packages/frontend/src/hooks/useAppAuth.js` | `useAppAuth()` reads `AppAuthContext`; throws outside provider |
| `packages/frontend/src/components/auth/SignInRetryBanner.jsx` | Rendered in `<App />`. Shows when `status='rejected'\|'error'`, click → `signIn()` |
| `packages/frontend/src/context/AppAuthProvider.test.jsx` | Provider state machine tests |
| `packages/frontend/src/hooks/useAppAuth.test.jsx` | Hook contract test |
| `packages/frontend/src/components/auth/SignInRetryBanner.test.jsx` | Banner visibility + click behavior |

### 6.2 Modified

| File | Change |
|---|---|
| `packages/frontend/src/main.jsx` | Insert `<AppAuthProvider>` per §5.1 |
| `packages/frontend/src/App.jsx` | Add `<SignInRetryBanner />` next to `<FirstConnectBanner />` (desktop + mobile branches) |
| `packages/frontend/src/context/FarcasterProvider.jsx` | Drop `verifyWithBackend` + JWT state. Keep auth-kit profile only |
| `packages/frontend/src/hooks/useFarcasterSignIn.js` | Replace `verifyWithBackend(...)` call with `appAuth.signIn({ method:'farcaster', ... })` |
| `packages/frontend/src/components/sponsor/CreateSeasonWorkflow.jsx` | Drop `<AdminAuthProvider>` wrapper |
| `packages/frontend/src/components/mobile/MobileCreateSeason.jsx` | Drop `<AdminAuthProvider>` wrapper |
| `packages/frontend/src/routes/AdminPanel.jsx` | Drop `<AdminAuthProvider>` wrapper |
| All ~15-20 `useAdminAuth()` callers in admin/feature components | Mechanical rename to `useAppAuth()` |
| `packages/frontend/public/locales/en/auth.json` | Add `signInRetry.{rejectedTitle,rejectedBody,errorTitle,errorBody,button}` |
| `packages/frontend/package.json` | Bump `0.27.x → 0.28.0` (feature; minor) |
| `packages/backend/package.json` | Bump `0.21.3 → 0.21.4` (env-only change) |
| `scripts/local-dev.sh` | Add `SOF_AIRDROP_AMOUNT_PER_USER=100` to backend startup block |
| `packages/backend/env/.env.testnet` + `.env.testnet.example` | Add `SOF_AIRDROP_AMOUNT_PER_USER=100` |

### 6.3 Deleted

| File | Reason |
|---|---|
| `packages/frontend/src/context/AdminAuthContext.jsx` | Replaced by `AppAuthProvider` |
| `packages/frontend/src/hooks/useAdminAuth.js` | Replaced by `useAppAuth` |

## 7. Data flow

### 7.1 First-time desktop user (M5 Path C — Anvil #6)

1. User connects wallet → wagmi `useAccount()` → `address=0x976E…0aa9`, `isConnected=true`.
2. `RaffleAccountProvider` derives `sma=0x736D…B321` via `factory.getAddress`.
3. `AppAuthProvider` effect fires:
   - `walletType='desktop-eoa'` ✓
   - `localStorage['sof:auth_jwt']` empty → no cached JWT
   - `status='signing'` → `signIn()`
4. `signIn({method:'wallet'})`:
   - `GET /api/auth/nonce` → `{ nonce }`
   - `signMessage({ message: "Sign in to SecondOrder.fun\nNonce: <nonce>" })` → MetaMask popup → signed
   - `status='verifying'`
   - `POST /api/auth/verify { method:'wallet', address, signature, nonce }`
5. Backend `/verify`:
   - validates nonce + signature
   - `ensureSmartAccount` → factory call → `db.upsertSmartAccount` → `airdrop.transferToSma(sma)` → SOF.transfer submitted from `BACKEND_WALLET_PRIVATE_KEY`'s wallet → `db.markFunded(sma)` on receipt
   - `ensureAdminFlag` → `is_admin=false` for Anvil #6
   - returns `{ token, user: { address, sma, isAdmin:false, ... } }`
6. `AppAuthProvider`:
   - `localStorage.setItem('sof:auth_jwt', token)`
   - `status='authenticated'`, `user` populated
7. `FirstConnectBanner` shown (existing logic).
8. SOF balance polling on the SMA picks up the airdrop in 1-2 blocks.
9. User clicks Buy → existing `useSmartTransactions.executeBatch` flow. First UserOp deploys SMA via `initCode` + buys ticket. EOA pays no gas.

### 7.2 Returning desktop user (valid cached JWT)

Provider initializes from `localStorage`. JWT exists, expiry > now+30s, payload `wallet_address` matches connected EOA → `status='authenticated'`. Effect's auto-fire guard fails. No popup, no round-trip.

### 7.3 Wallet change mid-session

`useAccount()` emits new address. Effect compares to JWT claim's `wallet_address` → mismatch → clear localStorage + state → re-auth via 7.1 from step 5.

### 7.4 Chain switch

JWT is chain-agnostic (claims are `wallet_address` + `sma` + `is_admin`, no chainId). No re-fire. `RaffleAccountProvider` re-derives the SMA against the new chain's factory.

### 7.5 Sig rejection

`signMessage` throws → `status='rejected'` → `SignInRetryBanner` shows. User can navigate freely. Banner's "Try again" → `signIn()`.

### 7.6 Farcaster MiniApp launch

Wallet auto-connects with `walletType='farcaster-miniapp'`. Auto-fire effect skips (per Q4). User taps "Sign in with Farcaster" → `useFarcasterSignIn` polls relay → on success calls `appAuth.signIn({method:'farcaster', message, signature, nonce})`. JWT held in-memory only.

## 8. Error handling

| Failure | Detection | State | Frontend UX | Recovery |
|---|---|---|---|---|
| User rejects sig | `signMessage` throws `UserRejectedRequestError` (code 4001) or message includes `"User rejected"` | `status='rejected'` | Red SignInRetryBanner: *"You declined to sign in. You can browse, but buying needs a signature."* | Banner button → `signIn()` |
| Nonce expired | `/verify` 401 `"Nonce expired or not found"` | `status='error'` | Amber banner | Banner button (fetches fresh nonce) |
| Network failure on `/nonce` or `/verify` | `fetch` throws / non-2xx no-body | `status='error'` | Amber banner | Banner button retries |
| Backend `verifyMessage` returns false | `/verify` 401 `"Invalid signature"` | `status='error'` | Amber banner | Manual retry |
| `ensureSmartAccount` throws (factory call/DB) | `/verify` 500 | `status='error'` | Amber banner | Banner |
| Airdrop transfer reverts | `/verify` 200 (auth still succeeds) — `funded_at` stays null | `status='authenticated'` | None — `FirstConnectBanner` already says "starter SOF will arrive shortly" | Admin manual top-up via `POST /api/airdrop/transfer-to-sma` |
| Stale JWT (expired during idle) | `isTokenExpired(jwt)` true | `status='idle'` then auto-fire | None — auto-reauth | Auto |
| JWT for different EOA than connected | Effect compares claim → mismatch | Clear + auto-reauth | Brief signing popup | Auto |
| `SOF_AIRDROP_AMOUNT_PER_USER` unset | `airdropService` warn + skip; `/verify` 200 | `status='authenticated'` | Banner shown but balance stays 0 — alpha smell | Set env var |
| `BACKEND_WALLET_PRIVATE_KEY` low SOF | airdrop tx reverts | Same as above | None | Top up backend wallet |
| Wallet provider disabled mid-flow | `signMessage` throws `ProviderNotFoundError` | `status='error'` | Amber banner | Reconnect first |

Backend `/api/auth/verify` already wraps `ensureSmartAccount` and `ensureAdminFlag` in try/catch (`authRoutes.js:185-199`). Partial failure of SMA/airdrop side does not block auth — user signs in successfully even if airdrop fails. Keep that behavior.

No retry loops, no exponential backoff, no auto-reauth on rejection. Rejection is opt-out; respect it.

## 9. Testing

| Layer | Test file | Asserts |
|---|---|---|
| Provider state machine | `AppAuthProvider.test.jsx` | (1) Auto-fires `signIn` on connect when no cached JWT and `walletType=desktop-eoa`. (2) Skips auto-fire with valid cached JWT for connected address. (3) Skips auto-fire when `walletType=farcaster-miniapp`. (4) Clears state + storage on disconnect. (5) Clears + re-auths when address changes mid-session. (6) `status='rejected'` when `signMessage` throws `UserRejectedRequestError`. (7) `status='error'` for non-2xx responses. (8) Persists to localStorage for desktop, in-memory only for miniapp. (9) Cleans up legacy `sof:admin_jwt` and `sof:farcaster_jwt` keys on mount. |
| Hook contract | `useAppAuth.test.jsx` | Throws when used outside provider; returns the §5.2 shape inside |
| Farcaster delegation | `useFarcasterSignIn.test.js` (modify) | Calls `appAuth.signIn({method:'farcaster', ...})` with the right payload; no longer calls `verifyWithBackend` directly |
| Banner | `SignInRetryBanner.test.jsx` | (1) Hidden for `authenticated\|idle\|signing\|verifying`. (2) Visible with rejected copy when `status='rejected'`. (3) Visible with error copy when `status='error'`. (4) Click invokes `signIn()` |
| Migration regression | All existing admin component tests | Pass unchanged after the `useAdminAuth` → `useAppAuth` rename |
| Backend | (none new) | `/api/auth/verify` and `ensureSmartAccount` already covered |
| End-to-end | Manual M5 Path C evidence | Anvil #6 fresh connect → SIWE popup → JWT → `smart_accounts` row + `funded_at` → SMA receives airdrop → Buy ticket via UserOp → Portfolio row appears. Tx hashes captured |

Mocks reuse existing patterns: `vi.mock('@wagmi/core')` for `signMessage`, `vi.mock('@/hooks/useRaffleAccount')`, `MockFetch` for `/api/auth/*`, jsdom localStorage.

## 10. Side concerns

1. **`SOF_AIRDROP_AMOUNT_PER_USER` env var** — `100` SOF on local + testnet. Pushed via `./scripts/deploy-env.sh --network testnet --dry-run` then real run (per CLAUDE.md). Local: bake into `local-dev.sh` Step 9/10 backend startup block.

2. **Backend wallet SOF balance** — local-dev.sh Step 8 should ensure `BACKEND_WALLET_ADDRESS` (currently the deployer) holds enough SOF. Verify; add a `cast send SOFToken transfer $BACKEND_WALLET 1000000` if not. Document on testnet ops in `instructions/backend-guidelines.md`.

3. **In-flight admin sessions** — Existing `sof:admin_jwt` / `sof:farcaster_jwt` JWTs become orphans after deploy. `AppAuthProvider` mount effect clears those keys. Single signature popup on first post-deploy connect is acceptable; document in PR description.

4. **i18n** — Add `signInRetry.*` keys to `auth.json`. No hardcoded strings (frontend CLAUDE.md).

5. **Out of scope** — Coinbase Smart Wallet bespoke (Q5 deferred), Farcaster MiniApp auto-SIWF (Q4 deferred), JWT refresh (separate), mainnet hardening (separate).

## 11. M5 Path C completion criteria

After this design ships, the M5 Path C evidence checklist becomes:

- [ ] Anvil #6 connects MetaMask to dapp → MetaMask shows SIWE signature popup with "Sign in to SecondOrder.fun" prefix
- [ ] User signs → backend log shows `/api/auth/nonce` then `/api/auth/verify` for Anvil #6
- [ ] Backend log shows `🪪 ensureSmartAccount` + `airdropService: submitting SOF.transfer` + `airdropService: success`
- [ ] `smart_accounts` table row for Anvil #6 has `deployed_at=null` (not yet deployed) and `funded_at` populated
- [ ] On-chain SOF.transfer from `BACKEND_WALLET_ADDRESS` to Anvil #6 SMA confirmed (`cast call SOFToken balanceOf(sma)` returns `SOF_AIRDROP_AMOUNT_PER_USER` * 1e18)
- [ ] Frontend SettingsMenu Account section shows the SMA + EOA, copy buttons work
- [ ] `FirstConnectBanner` shows once for Anvil #6, dismissible
- [ ] User clicks Buy → MetaMask shows EIP-712 typed-data popup for `PackedUserOperation`
- [ ] Buy tx lands; `AccountDeployed` event for Anvil #6 SMA fires; `UserOperationEvent.success=true`
- [ ] EOA Anvil #6 ETH balance unchanged (paymaster sponsored gas)
- [ ] Portfolio Raffle Holdings tab shows the new BUY row with `SMA` Origin badge
- [ ] `smart_accounts.deployed_at` now populated (AccountCreatedListener fired)
