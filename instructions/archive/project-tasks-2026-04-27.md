# SecondOrder.fun Active Tasks

## MetaMask Gas Sponsorship (ERC-4337)

MetaMask `wallet_sendCalls` does not support `paymasterService` capability. Batching works on all wallets; sponsorship works on Farcaster (built-in) and Coinbase Wallet (built-in CDP). MetaMask users currently pay their own gas.

### Phase 1: CDP Paymaster Proxy Verification
- [ ] Verify Railway backend `/api/paymaster` correctly proxies ERC-7677 requests to CDP
- [ ] Confirm `PAYMASTER_RPC_URL_TESTNET` is set correctly on Railway
- [ ] Test proxy with real `pm_getPaymasterStubData` / `pm_getPaymasterData` requests
- [ ] Confirm Coinbase Wallet sponsorship uses our CDP proxy (not just built-in)

### Phase 2: MetaMask Smart Account Bundler Integration
- [x] Install `permissionless` (Pimlico) — `@metamask/smart-accounts-kit` not needed
- [x] Create `useDelegatedAccount` hook (serves this role for all non-CB wallets)
- [x] Set up bundler + paymaster clients pointing to CDP RPC endpoint (useDelegatedAccount does this)
- [x] Implement `sendUserOperation` path (Path A in useSmartTransactions)

### Phase 3: Unified Transaction Hook
- [x] Extend `useSmartTransactions` to detect wallet type via capabilities
- [x] Keep single `executeBatch` API with transparent internal routing
- [x] Preserve three-tier fallback: sponsored batch -> unsponsored batch -> sequential

### Phase 4: ERC-20 Gas Payments (Mainnet)
- [ ] Implement CDP ERC-20 paymaster flow (user pays gas in USDC)
- [ ] Auto-prepend USDC approval call to batch if allowance insufficient
- [ ] Pass `erc20` context in `pm_getPaymasterData` requests via proxy

### Phase 5: Testing & Cleanup
- [x] Remove diagnostic `console.log` from `useSmartTransactions`
- [x] Add tests for capability detection and routing logic
- [ ] Test all wallets: MetaMask (with/without Smart Account), Coinbase, Farcaster

## Desktop UI Audit

- [ ] Audit Farcaster vs Desktop component differences (buttons, tabs, links, cards, inputs, modals)
- [ ] Propose shared design system approach (shared primitives, design tokens, responsive variants)
- [ ] Approval gate: review each proposed change with user before implementing
- [ ] Implementation + tests for approved updates

## i18n Remaining Components

- [x] Audit all components for hardcoded strings
- [x] Add missing translation keys to locale files (high + medium priority)
- [x] Verify all namespaces are loaded correctly (added `airdrop` to ns config, synced market translations)

## Smart Contract Deferred Items

### VRF / Multi-Winner Expansion
- [x] **M-1**: Remove auto-finalization from VRF callback, reduce gas to 200K
- [x] **M-2**: Validate `requestSeasonEnd` idempotency (verified — no changes needed)
- [x] **M-3**: Add optional `maxParticipants` to SeasonConfig (default 10K, ceiling 50K)

### Skipped Tests
- [x] `test_MultiAddress_StaggeredRemovals_OrderAndReadd` in SellAllTickets.t.sol (fixed `_swapPop` test helper, removed env gate)
- [x] `FullSeasonFlow.t.sol` (rewrote to current APIs, 3 tests pass)

## Infrastructure

### Mainnet Deployment Preparation
- [ ] Base App auth flow implementation (Coinbase Wallet login)
- [ ] SOFExchange integration for mainnet token swap (Uniswap/Aerodrome)
- [ ] Production environment setup (Railway + Vercel production configs)
- [ ] Contract deployment to Base Mainnet with verification

### SSE Edge Offload Investigation
- [ ] Evaluate moving SSE connections to edge workers for reduced Railway load
- [ ] Benchmark current SSE connection limits

## ERC-7702 Smart Wallet Integration

- [x] Design SOFSmartAccount delegate contract
- [x] Write SOFSmartAccount foundry tests
- [x] Add deploy script and deployment address placeholders
- [x] Add useDelegationStatus hook
- [x] Add POST /api/wallet/delegate backend relay
- [x] Add DelegationModal component
- [x] Add useDelegatedAccount hook (permissionless.js)
- [x] Refactor useSmartTransactions for delegation routing
- [x] Wire DelegationGate into WagmiConfigProvider
- [x] Deploy SOFSmartAccount to Base Sepolia
- [x] End-to-end testing with MetaMask on local Anvil (Test A — sponsored UserOp via local bundler+paymaster, season created and ticket buy gasless, both confirmed on-chain at 0 ETH user cost)
- [ ] End-to-end testing with Rabby on local Anvil
- [ ] End-to-end testing with Big Wallet on Safari (passkey, may need a non-permissionless account adapter)
- [x] Add delegation locale strings for de, es, fr, it, ja, pt, ru, zh

### Local AA bring-up fixes (this milestone)
- [x] Deploy real EntryPoint v0.8 at canonical `0x4337...108` on Anvil — bootstrap deploys via tx so EIP-712 immutables (`name="ERC4337"`, `version="1"`) get inlined into the runtime, then `anvil_setCode` moves it to the canonical address
- [x] Redesign SOFPaymaster to avoid the `userOpHash` chicken-and-egg — added `getHash(userOp, validUntil, validAfter)` mirroring eth-infinitism `VerifyingPaymaster`; off-chain signer mirrors the layout
- [x] Add SimpleAccount-compatible `execute` + `executeBatch` shims to SOFSmartAccount so permissionless's `to7702SimpleSmartAccount` adapter can dispatch (selectors `0xb61d27f6` and `0x34fcd5be`)
- [x] Fix `normalizeUserOp` defaults — `maxFeePerGas`/`maxPriorityFeePerGas` default to 0 (not 1 gwei) so they don't mutate the packed `gasFees` and break the wallet signature
- [x] Bump bundler `eth_estimateUserOperationGas` defaults — `callGasLimit` 300k → 8M to cover ops that deploy contracts (createSeason was OOG'ing inside `new RaffleToken`)
- [x] `executeBatch` Path A returns the real handleOps tx hash (not the userOpHash) so `useWaitForTransactionReceipt` resolves
- [x] `WagmiConfigProvider` re-prompts delegation when the EOA is delegated to a stale SOFSmartAccount on local chain (`isDelegated && !isLocalChain` guard)
- [x] `14_ConfigureRoles.s.sol` auto-broadcasts `sof.approve(InfoFiFactory, max)` and `sof.approve(RolloverEscrow, max)` when `TREASURY_ADDRESS == deployer`
- [x] `15_DeployPaymaster.s.sol` removed Stub fallback; deposit moved to post-deploy `cast send` in `local-dev.sh` (forge's local sim doesn't see `anvil_setCode` injections)
- [x] Bundler returns decoded `FailedOp`/`FailedOpWithRevert` reasons + serializes BigInts in `eth_getUserOperationReceipt`; tolerates the "tx not yet mined" race

### Pre-testnet paymaster operational hardening (Task #41)
- [x] Phase 1 — Bounded `validUntil` per signature. `createBundlerService` reads `NETWORK` + `PAYMASTER_VALIDITY_WINDOW_SEC`: LOCAL → unbounded (`0n`, matches headless E2E), TESTNET/MAINNET → 600s default (10 min headroom for MM popups), 30s `validAfter` backdate for clock skew. Env override is validated (non-negative integer, max 86_400s); `=0` on non-local logs a loud `console.warn` so a stray env can't silently deploy unbounded sigs. Removed dead in-route Pimlico fallback that used the old digest scheme. 19 tests covering bounds, env validation, anti-replay across bounds + callData.
- [x] Phase 2 — Server-side gas caps + per-EOA sponsorship quota. Per-network gas-cap defaults (LOCAL: 8M call / 1M verification / 500k pmVerification / 100k pmPostOp; REMOTE: 2M / 500k / 200k / 60k) with env overrides. `assertGasLimitsWithinCaps` rejects oversized userOps with -32602; `eth_estimateUserOperationGas` clamps suggestions to caps. Per-EOA Redis quota (atomic INCR+EXPIRE pipeline, 40 calls/hr default REMOTE, applied to BOTH stub and real calls so the stub endpoint isn't a free-signature oracle), keyed by `chainId:sender` for multi-tenant isolation. Fail-closed on Redis errors (-32000) so an outage can't silently turn into unbounded sponsorship. Sender format validated before the quota call. Total 34 tests covering gas caps, quota across stub/real, multi-tenant chainId isolation, fail-closed paths, default-cap parity. **Production wire-up done in Task #48** — `paymasterServiceRoutes.js` mounts at `/api/paymaster/sof` on every NETWORK; quota + caps + bounded validity all flow through the existing factory.
- [x] Phase 3 — Verifying-signer rotation playbook at `docs/02-architecture/paymaster-signer-rotation.md`. Covers detection, full rotation procedure (offline keygen → `setSigner` from owner → backend env push via `deploy-env.sh` → `railway redeploy` → verification with new `scripts/verify-paymaster-signer.js`), rollback (gated on `validityWindowSec > 0`), owner-key-compromise redeploy path with concrete `withdrawTo` race step, configuration knobs, quarterly drill cadence. Companion script `scripts/verify-paymaster-signer.js` recovers the signer from a `pm_getPaymasterStubData` response and asserts equality with `--expect-signer` (supports `--sender` override for non-local probes). Doc-link integrity test (`tests/docs/paymasterRotationPlaybook.test.js`) pins the runbook's references so a future rename of `setSigner` / env vars / scripts breaks CI here, prompting a doc update at the same time.
- [x] Phase 4 — Cap `preVerificationGas` via `PAYMASTER_MAX_PRE_VERIFICATION_GAS`. Added to `DEFAULT_GAS_CAPS` (LOCAL: 200k, REMOTE: 150k) and `GAS_CAP_ENV_KEYS`; `assertGasLimitsWithinCaps` now rejects oversized claims uniformly across all five gas fields, and `eth_estimateUserOperationGas` clamps the suggestion. Closes the gap where a leaked verifyingSigner could inflate per-op damage by claiming arbitrary `preVerificationGas` — per-op ceiling is now firmly bounded at ~2.91M gas (was ~2.86M with the gap). Added a meta-test (`every cap field has a matching env-var key`) so any future field added to `DEFAULT_GAS_CAPS` without a matching entry in `GAS_CAP_ENV_KEYS` fails CI. Runbook updated; doc-integrity test pins the new env var. Backend 0.15.1 → 0.16.0.

## Monorepo Migration (In Progress)

- [x] Verify all builds pass (`turbo build`) — all 3 packages pass
- [x] Verify all tests pass (`turbo test`) — 741 tests: 254 contracts + 151 backend + 336 frontend
- [x] End-to-end local dev flow validation (Docker: Anvil + Redis + Postgres + Backend, contracts deployed, frontend connected)
- [x] Archive old repos (sof-alpha, sof-backend, sof-allowlist, sof-docs) — done 2026-04-26

## Rollover Incentives

### Task 1: Add `buyTokensFor` to SOFBondingCurve
- [x] Add `ESCROW_ROLE` constant to SOFBondingCurve
- [x] Add public `buyTokensFor(address recipient, uint256 tokenAmount, uint256 maxSofAmount)` gated by `ESCROW_ROLE`
- [x] Add internal `_buyTokensFor(address payer, address recipient, ...)` splitting payer/recipient logic
- [x] Write TDD tests in `packages/contracts/test/RolloverEscrow.t.sol`
- [x] All 272 contract tests pass

### Task 2: Add `toRollover` param to PrizeDistributor
- [ ] TBD

### Task 3: RolloverEscrow — Deposit + State Machine
- [x] Create `packages/contracts/src/core/RolloverEscrow.sol` with AccessControl, ReentrancyGuard, Pausable
- [x] Implement deposit(), openCohort(), activateCohort(), closeCohort(), admin setters, view functions
- [x] Auto-expiry logic: `_checkAndUpdateExpiry` transitions Open → Expired after 30 days
- [x] Add `RolloverEscrowDepositTest` with 10 passing tests (TDD)
- [x] All 285 contract tests pass

### Task 4: RolloverEscrow — Spend with Bonus
- [x] Implemented `spendFromRollover(seasonId, sofAmount, ticketAmount, maxTotalSof)` in RolloverEscrow.sol
- [x] Added `import {SOFBondingCurve}` to RolloverEscrow.sol
- [x] Added `RolloverEscrowSpendTest` with 5 tests (TDD: tests written before implementation)
- [x] All 290 contract tests pass

### Task 5: RolloverEscrow — Refund
- [x] Implemented `refund(seasonId)` in RolloverEscrow.sol (replaced stub)
- [x] No `whenNotPaused` modifier — refunds remain available even when paused
- [x] CEI pattern: `pos.refunded = true` before `safeTransfer`
- [x] Added `RolloverEscrowRefundTest` with 5 tests (TDD: tests written before implementation)
- [x] All 295 contract tests pass

### Task 6: Deployment Script and Role Wiring
- [ ] TBD

### Task 7: Integration Tests
- [ ] TBD

### Task 8: ABI Export and Cleanup
- [ ] TBD

## UI Tasks

- [ ] Landing page background animation: scale moving elements 6-8x, pixelated style (4x4 grid with blank corners for circular appearance)

## Deferred from 2026-04-23 Code Analysis

Audit done after iCloud cleanup / github restore. The three "blockers" (backend eslint config, gating-route test mocks, treasury→RolloverEscrow approval on local) were fixed in-session, plus the 9 frontend mock-drift failures, plus the rollover setter events + Fastify bodyLimit + useTreasury ERC-5792 compliance. Residual items below are non-blocking for E2E; tackle when ready.

### Frontend cleanup
- [ ] **Bundle size** — main chunk is 1,719 kB (>Vite's 1600 kB warning). No route-level code-splitting; all 20+ routes statically imported in `main.jsx`. Convert the top offenders (`RaffleDetails`, `RaffleList`, `UIGym`, `CreateSeasonPage`, admin routes) to `React.lazy` + `Suspense`.
- [ ] **Files exceeding 500-line `lint:length` rule** (10 files; split or extract):
  - `services/onchainInfoFi.js` 1036
  - `components/admin/CreateSeasonForm.jsx` 1021
  - `routes/UIGym.jsx` 765 (dev-only, tree-shaken in prod — low priority)
  - `routes/RaffleDetails.jsx` 751
  - `components/admin/BondingCurveEditor/GraphView.jsx` 629
  - `components/admin/AllowlistPanel.jsx` 614
  - `components/admin/NftDropsPanel.jsx` 596
  - `pages/InfoFiMarketDetail.jsx` 568
  - `hooks/useSOFTransactions.js` 526
  - `routes/RaffleList.jsx` 506
- [ ] Unguarded `console.log` leaks in `onchainInfoFi.js` (several) and `LocalizationAdmin.jsx` (lines 238, 241, 250). `useFundDistributor.js` has one with an `eslint-disable` — keep if debug was intentional, otherwise remove.

### Backend hardening
- [ ] **Schema validation on route bodies** — no zod/joi; handlers do ad-hoc `if (!Array.isArray(…))` checks. 109 endpoints, inconsistent coverage. Recommend adopting Fastify's built-in JSON Schema or `@fastify/type-provider-zod` and retrofitting the high-value admin + auth routes first.
- [x] **Admin guard caches nothing** — Added `shared/accessCache.js` with `getCachedUserAccess` (read-through) and `invalidateUserAccessCache`. 60s TTL. Cache key prefers fid (`access:fid:<fid>`) over wallet (`access:wallet:<lower>`) since fid is stable across wallet rotations. Caches the full `{level, levelName, groups, entry}` shape — same Redis-op cost, benefits all 4 callers (adminGuard, authRoutes, accessRoutes.checkRouteAccess, future). Redis failures (connect refused, ECONNRESET, malformed JSON) silently fall through to the DB; cache is best-effort. Mutations explicitly invalidate on BOTH grant and revoke at 7 call sites: `accessRoutes.setUserAccessLevel`, `allowlistRoutes.addToAllowlist` (manual + import), `allowlistRoutes.removeFromAllowlist`, `authRoutes.addToAllowlist` (SIWF), `farcasterWebhookRoutes.addToAllowlist` (miniapp_added), `farcasterWebhookRoutes.removeFromAllowlist` (miniapp_removed). `adminGuard.js` swapped to use the cached version. 18 vitest cases covering hit/miss/write-through, key derivation, every Redis-failure path, multi-key invalidation.
- [ ] **Integration tests for cache invalidation call sites** — `accessCache.test.js` covers the cache module in isolation but doesn't assert that the 7 mutation routes actually call `invalidateUserAccessCache`. If a future refactor drops one of those calls (the way the initial PR shipped without invalidating the two `removeFromAllowlist` paths until code review caught it), the unit suite won't notice. Add route-level tests mirroring `gatingRoutes.test.js` that assert the invalidation hook fires after each successful mutation.
- [x] **Rollover listener has no tests** — Added `tests/backend/rolloverEventListener.test.js` (11 cases: startup gating when escrow address absent, three-watcher registration, per-event upsert shape with `onConflict: "tx_hash,event_type"` for idempotency, batch processing, error containment per-log + per-watcher, and `unwatchAll()` wiring) and `tests/api/rolloverRoutes.test.js` (8 cases: 400 on missing/malformed wallet, 200 with mapped position list, lowercase wallet + DEPOSIT-only filter, 500 on supabase error). Block-cursor recovery does NOT exist on this listener — it uses `publicClient.watchEvent` directly without a persisted cursor; tests reflect actual behavior. Filing the cursor gap as a separate followup.
- [ ] **Rollover listener missing block-cursor recovery** — `rolloverEventListener.js` uses `publicClient.watchEvent` (live tail only) instead of the `startContractEventPolling` + `createBlockCursor` pattern used by `seasonStartedListener`, `positionUpdateListener`, etc. If the backend is down when a `RolloverDeposit`/`Spend`/`Refund` fires, the event is lost and the wallet's positions table goes stale until they trigger another event. Convert to the polling+cursor pattern + add a historical scan on startup to mirror the other listeners.

## Get $SOF consolidation (2026-04-27)

- [x] **Retire `/swap` and `/faucet` routes; consolidate into `/get-sof`** — Two competing acquisition surfaces (legacy `SOFFaucet` `useFaucet` widget + newer `SOFAirdrop` claim banner above SwapWidget) collapsed onto one page. New layout: `AirdropClaimCard` + `SofTokenInfo` in the left column, `SwapWidget` (with balance row built into its CardHeader) on the right, optional `TestnetEthFaucetLinks` below (hidden on MAINNET). New i18n namespace `getsof` mirrored to all 9 locales. Header nav drops "Beta Faucets" link, "Get SOF" repointed at `/get-sof`. Mobile `BottomNav` repointed too; `MobileClaimsTab` drops the dead `MobileFaucetWidget` reference (mobile parity for the new layout is a follow-up). 14 dead `account.json` keys + the `navigation.betaFaucets` key removed across all locales. Deletes: `routes/FaucetPage.jsx`, `routes/Swap.jsx`, `components/faucet/FaucetWidget.jsx`, `components/mobile/MobileFaucetWidget.jsx`, `components/airdrop/AirdropBanner.jsx`, `hooks/useFaucet.js`. `components/faucet/AddToMetamaskButton.jsx` moved to `components/getsof/`.
- [x] **Daily streak indicator on the airdrop claim card** — Frontend-only `useAirdropStreak` hook walks `SOFAirdrop.DailyClaimed` events for the connected wallet via `publicClient.getLogs`, sorts by block timestamp, and counts the trailing run of consecutive-day claims (1.5-day grace tolerates chain/wall-clock drift). No rewards, just a flame badge with the streak count when ≥ 1. 7 vitest cases for the streak math. Caches results for 60s via TanStack Query.
- [x] **Portfolio: badge airdrop transfers as `AIRDROP`** — `useSOFTransactions` re-categorization loop now maps incoming Transfers from the SOF_AIRDROP address to `type: "AIRDROP"` (alongside the existing RAFFLE_SELL / INFOFI_SELL / PRIZE_CLAIM mappings). `SOFTransactionHistory` renders a pink Gift icon + "Airdrop" badge variant. Generic `TRANSFER_IN` ("Receive") stays as the catch-all for non-airdrop / non-trade inflows.
- [ ] **Mobile parity for Get SOF page layout** — `MobilePortfolio` has its own claim flow; the new desktop layout (welcome → token info → swap → testnet ETH onramp) hasn't been adapted for the mobile/MiniApp experience. Mobile users can hit `/get-sof` on this device and see the desktop layout, but the mobile bottom-sheet pattern would be more appropriate. Defer until the Farcaster MiniApp redesign.
- [ ] **Onboarding checklist** — Per 2026-04-27 product call: belongs primarily on the FAQ page (TBD), with a simple version possibly on `/get-sof` for users with no $SOF balance. Not in this PR.
- [ ] **Retire the `SOFFaucet` contract on-chain** — Frontend UI is gone but the contract is still deployed and seeded with admin roles in `local-dev.sh`. Drop from `DeployAll.s.sol` + remove from local-dev seeding when the alpha cleanup pass happens.
- [ ] **Server-side streak indexing** — `useAirdropStreak` walks `eth_getLogs` from block 0 every minute. Fine for alpha-scale chains; if mainnet RPC throttles `getLogs` windows or perf bites, add a backend listener that persists daily claims to a new `airdrop_claims` table and serve a `GET /api/airdrop/streak` endpoint.
- [x] **`SOFExchange` and `SOFAirdrop` are not deployed locally** — Added three new modular deploy scripts (`17_DeployUSDCMock.s.sol` local-only, `18_DeploySOFExchange.s.sol`, `19_DeploySOFAirdrop.s.sol`) and wired them into `DeployAll.s.sol` after RolloverEscrow. `SOFExchange` deploy grants `MINTER_ROLE` on SOFToken, sets ETH rate (1 ETH = 100k SOF) and USDC rate (1 USDC = 1 SOF, accounting for USDC's 6 decimals via `rate = 1e30`), seeds 10 ETH + 1M USDC sell-side reserves on local. SOFAirdrop deploy grants `MINTER_ROLE` on SOFToken and `RELAYER_ROLE` to the deployer/backend wallet so `claimInitialFor`/`claimDailyFor` work. `MockUSDC` is gated on `isLocal`. `DeployedAddresses` struct grew three new fields (`usdc`, `sofExchange`, `sofAirdrop`); `preserveKeys` shrunk from 6 to 3 (`SOFBondingCurve`, `SeasonGating`, `VRFCoordinator`); the JSON output now writes the three new addresses in a `part4` concat block. Verified live with `cast call SOFExchange.getQuote`: 1 ETH → 100k SOF and 1 USDC → 1 SOF return correctly. Operator warning logged when ETH reserves can't be seeded (e.g., on testnet/mainnet where the deployer has < 10 ETH). Contracts 0.25.0 → 0.26.0.
- [x] **Airdrop claim 500s with "PAYMASTER_RPC_URL not configured" on local** — Two bugs: (1) `paymasterService.js` hardcoded `chain = isTestnet ? baseSepolia : base` with `isTestnet = NETWORK in {TESTNET, LOCAL}`, so on local it built the wallet client against Base Sepolia (chainId 84532) and Anvil rejected the signed tx as wrong-chain. Fixed by sourcing `chainConfig` from the existing `getChainByKey(NETWORK)` helper and constructing the viem chain object from it (id, name, RPC URL). (2) `local-dev.sh` step 8 didn't pass `PAYMASTER_RPC_URL` to the backend, so `PaymasterService.initialize()` threw on first relay call. Added `PAYMASTER_RPC_URL=$RPC` (Anvil RPC — backend wallet pays its own gas on local; on testnet/mainnet this points at Pimlico). Code review caught two more: defensive `.then(() => undefined)` on `_enqueueSendTransaction`'s queue tail so a future chained handler that throws can't permanently jam the queue; promoted `PAYMASTER_RPC_URL` to always-required in `assertRequiredEnv` (was conditional on non-LOCAL — but the bug we just fixed proved every network needs it). Verified end-to-end: airdrop claim button returns success, tx mined on Anvil, backend wallet paid the gas. Backend 0.19.0 → 0.19.1.
- [x] **Daily airdrop claim 401s with "JWT wallet_address must match claim address"** — The daily-claim path required a JWT with `wallet_address` matching the claim address, but most users hit `/get-sof` with just a connected wallet (no SIWF / no wallet auth) so `request.user` is null. Mirrored the basic-claim signature flow: backend now expects `signature` over the message `Claim daily SOF airdrop for ${address}`, recovers via viem `recoverMessageAddress`, rejects on mismatch. No replay protection: `SOFAirdrop.claimDailyFor` enforces a per-user cooldown on-chain and the relay always credits `address`'s own wallet, so a replayed signature can only ever benefit the original signer. Frontend `useAirdrop.claimDaily` now signs the message via `walletClient.signMessage` and POSTs `{address, type: "daily", signature}`. Frontend 0.22.1 → 0.22.2.
- [ ] **HelperConfig needs a per-network USDC field** — On testnet/mainnet, `addrs.usdc` is `address(0)` after `17_DeployUSDCMock` skips. The SOFExchange deploy silently skips USDC rate-setting and reserves under that condition. Operator currently has to hand-set the real USDC address into the relevant `deployments/{network}.json` and call `setRate(USDC, 1e30)` + `depositTokenReserves` post-deploy. Cleaner is for `HelperConfig.NetworkConfig` to grow a `usdcAddress` field and have `17_DeployUSDCMock` populate `addrs.usdc` from there on non-local; then `18_DeploySOFExchange` runs the rate-setting and reserve-seeding in one shot. Filed as a follow-up; not a blocker for shipping `0.26.0` on local.
- [x] **Swap widget flickers "Swap failed" on keystroke when SOFExchange isn't deployed** — `SwapWidget` rebuilt `tokens` on every render (fresh array identity from `buildTokenList(contracts)` where `contracts` is also new every render), so the quote-debouncer effect fired every render. With a missing exchange address, every 400ms tick of the strobe set `quoteError = ""` then immediately back to `"Swap failed"`. Two fixes: memoize `tokens` on the underlying address strings (kills the render-loop), and short-circuit to a "Swap unavailable on this network" card when `exchangeAddress` is empty (skips the doomed `getQuote` calls entirely). Frontend 0.22.0 → 0.22.1.

## Unified Feature Gating Framework

**Goal:** every user-facing feature respects per-user access level + group membership, with a cascade rule so dependent features auto-hide when their parent is gated, and a documented framework so new features slot in by convention rather than ad-hoc wiring.

**Current primitives (already exist, used inconsistently):**
- `route_access_config` table — per-route required level + groups
- `accessService.checkRouteAccess({fid, wallet, route, resourceType, resourceId})` — evaluates a request
- `accessService.ACCESS_LEVELS` — `0=public, 1=connected, 2=allowlist, 3=beta, 4=admin`
- `adminGuard.createRequireAdmin()` — Fastify preHandler (admin-only)
- `accessCache.getCachedUserAccess` (new this PR) — Redis read-through
- `route_access_config` admin UI in `routeConfigRoutes.js` + frontend admin panel

**Features to gate (per 2026-04-27 product decision):**
1. **Raffles** — list view, season detail, buy/sell. Likely default `level=1` (connected) for buy/sell, `0` (public) for browse.
2. **InfoFi Markets** — view markets, place bets, claim winnings.
3. **Raffle Creation** — admin-only today via `createSeasonForm` admin route. Confirm gate is correct + uniform.
4. **Raffle Prize Sponsorship** — `sponsorPrizeService` + `sponsorHatListener`. Currently uses Hats Protocol membership; need to wire into the unified gate so sponsors don't bypass other rules.
5. **Airdrop / Login Allocation** — currently `addToAllowlist` in `authRoutes`. Hard-coded to grant `level=2`; should respect a per-source policy (e.g., "Farcaster webhook adds at level=2", "SIWF login adds at level=1") configurable from the gating panel.
6. **Portfolio** — composite view; cascade rule: hide InfoFi tab if user's InfoFi access is denied; hide Rollover section if Rollover gated; etc.
7. **Admin** — already gated via `createRequireAdmin`. Confirm uniform across all admin routes (audit needed; some routes may slip through).

**Subtasks (checklist):**
- [ ] **Audit:** grep every Fastify route module + frontend route component, produce a coverage matrix: `route → current gate → desired gate`. Flag every route without an explicit `preHandler` or `route_access_config` row.
- [ ] **Backend framework:** generalize `createRequireAdmin` into `createRequireLevel(level)` + `createRequireGroup(name)` + `createRequireFeature(featureKey)` (the last reads from `route_access_config` automatically). Document in `instructions/backend-guidelines.md`.
- [ ] **Frontend framework:** add a `useFeatureAccess(featureKey)` hook that reads from a single `/api/access/check` call (or context) and returns `{canAccess, reason, requiredLevel}`. UI components conditionally render or show a friendly "access required" panel. Document in `instructions/frontend-guidelines.md`.
- [ ] **Cascade resolver:** define a feature-dependency graph (e.g., `portfolio.infofi_tab → infofi.markets`); the frontend hook resolves transitively so a Portfolio section auto-hides when its parent feature is gated.
- [ ] **Seed data:** populate `route_access_config` with a default row for every feature key. Migration writes the seed; admin UI lets ops change defaults at runtime.
- [ ] **Convention:** new features get a `featureKey` constant (in a single registry file), a default access policy in the migration, and either a backend `createRequireFeature(key)` preHandler or a frontend `useFeatureAccess(key)` hook. Anything missing from the registry fails CI via a doc-integrity test.
- [ ] **Tests:** matrix tests covering each feature × each access level × each user state (anonymous, connected, allowlisted, beta, admin) for both backend route gates and frontend conditional rendering.

**Out of scope for the framework PR:**
- Rewriting per-route access *content* (i.e., what level each feature actually requires). That's a product decision per feature, applied via the admin UI after the framework lands.
- Migrating sponsor/Hats logic — separate task, but the framework should expose an extension point for "Hats-membership counts as group `sponsor`".
- [x] **Env vars validated lazily** — `BACKEND_WALLET_PRIVATE_KEY`, `NEYNAR_API_KEY`, `PAYMASTER_RPC_URL`, `PIMLICO_API_KEY`, `HATS_*` are read at call-site rather than at module load. Added `shared/assertRequiredEnv.js` + new `fastify/boot.js` entrypoint that runs the assert before dynamically importing `server.js` (ESM hoisting meant putting the call inside `server.js` fired too late — `viemClient.js → chain.js` would already have thrown on missing `RPC_URL`). Validates SUPABASE/RPC/JWT/wallet basics, format-checks the private key (32-byte hex) + JWT_SECRET (≥32 chars) + URLs, cross-checks `BACKEND_WALLET_ADDRESS` derives from `BACKEND_WALLET_PRIVATE_KEY`, requires `PAYMASTER_RPC_URL` + `PIMLICO_API_KEY` only when `NETWORK !== "LOCAL"`. Trims surrounding whitespace in place to kill the trailing-newline-from-shell-pipe class of bug. Removed the now-redundant eager throws from `shared/auth.js`. 17 vitest cases. `NEYNAR_API_KEY` + `HATS_*` stay feature-gated (already log warnings on first use).
- [x] **CORS regex is fragile** — Extracted parsing into `shared/parseCorsOrigins.js` with two exports (`parseCorsOrigins` returns `{origins, errors}`; `resolveCorsOrigin` is the boot wrapper that throws ONE error listing every bad entry). Validates string entries as http(s)/ws(s) URLs (or `*`), regex entries via `new RegExp(pattern, flags)` with full flag support (`/foo/i`), and trims whitespace per-entry. Rejects `javascript:` and other foot-gun schemes. 19 vitest cases. server.js's inline regex parsing replaced with one call site.
- [ ] **No error tracking** — global error handler in `server.js:290` returns generic "Internal Server Error" with no context. Wire Sentry (or equivalent) so 5xx and listener crashes surface somewhere.
- [ ] **Transitive `moderate` audit advisories** — 11 remaining from `@metamask/sdk`, `@coinbase/cdp-sdk`, `@solana/web3.js`, `vitest`. All require breaking upgrades of our direct deps; revisit after upstream ships patches.

### Contracts / operations
- [x] **Auto-register consolation eligibility in `Raffle.finalizeSeason`.** Gap surfaced during 2026-04-24 Test B: `claimConsolation` reverted with `NotAParticipant` because `setConsolationEligible` was never wired into finalization. `_executeFinalization` now calls `distributor.setConsolationEligible(seasonId, state.participants)` right after `configureSeason`; covered by new assertion in `FullSeasonFlow.t.sol`.
- [x] **Auto-grant `ESCROW_ROLE` to `RolloverEscrow` on every new bonding curve.** Same session gap: deployer EOA had no admin on per-season curves, so rollover spends required `anvil_impersonateAccount`. `SeasonFactory` now stores a `rolloverEscrow` address (settable by admin) and grants `ESCROW_ROLE` during `createSeasonContracts`; `DeployAll` calls `seasonFactory.setRolloverEscrow` in the 16b rollover-wiring block. Covered by `test/SeasonFactoryRollover.t.sol`.
- [x] **Bind `bondingCurve` to each cohort.** Reviewer blocker: the global `RolloverEscrow.bondingCurve` slot meant operators had to remember a separate `setBondingCurve` call per season, and two active cohorts would trample each other. Deleted the global slot + setter; `CohortState` now carries its own `bondingCurve`; `activateCohort(seasonId, nextSeasonId, curve)` locks it in atomically. Covered by `test/RolloverPerCohortCurve.t.sol` (two cohorts → two curves, no cross-contamination).
- [ ] **`14_ConfigureRoles.s.sol` still duplicates rollover wiring from `DeployAll` 16b** — the `if (addrs.rolloverEscrow != address(0))` block at lines 97–116 is a no-op during full DeployAll (rollover escrow doesn't exist yet at step 14), but fires on standalone ConfigureRoles runs and double-wires. Harmless (both calls are idempotent) but muddies ownership. Delete or move all rollover wiring to one place.
- [x] **`Raffle._executeFinalization` eligibility loop is O(participants).** Fixed by chunking: removed the inline `setConsolationEligible(seasonId, state.participants)` call from `_executeFinalization` (would have OOG'd at ~1500 participants — each cold SSTORE is 22.1k gas, 10_000 participants ≈ 221M gas, well past Base's block limit). Replaced with `Raffle.pokeConsolationEligible(seasonId, offset, limit)` — permissionless (the function reads addresses only from on-chain `state.participants` so a caller cannot register a non-participant; mirrors `finalizeSeason`), idempotent, silently clamps `limit` to the participant array length, no-ops on out-of-range offsets, rejects pre-finalize. Backend calls it in chunks post-finalize. 9 tests in `RaffleConsolationChunked.t.sol` (includes Distributing-state revert + permissionless coverage); `FullSeasonFlow.t.sol` updated to call poke after finalize. Contracts 0.23.0 → 0.24.0.
- [ ] **`SeasonFactory.setRolloverEscrow` silently accepts `address(0)`** — clears the escrow with no warning. Low risk, but a dedicated `clearRolloverEscrow()` would make intent explicit and stop accidental zeroing during mid-deploy runs.
- [ ] **No test for escrow rotation on `SeasonFactory`.** Rotating `rolloverEscrow` from A → B leaves older curves stuck on A with no way to reassign. Intentional by design, but the behavior is not asserted anywhere and could surprise an operator.
- [ ] **`FullSeasonFlow.t.sol` asserts eligibility but never calls `claimConsolation`.** Close the loop end-to-end: one non-winner actually claims after finalize, verifies SOF hits their wallet / escrow.
- [ ] **`RafflePrizeDistributor.configureSeason` (lines 142–145) and `Raffle.sol` lines 558, 601–607 use string `require` reverts.** Pre-existing, not introduced by the rollover fix, but now in the rollover happy path. Convert to custom errors per the contracts CLAUDE.md rule.
- [ ] **Stale comment at `RolloverEscrow.sol:30`** claims spend/refund are stubs — both are fully implemented (lines 280-315, 327-341). Delete or rewrite.
- [ ] **No auto-timeout on `Active` phase.** Only `Open` phase expires after 30d. If `PrizeDistributor` forgets `closeCohort()` after the spend window, users can never refund. Options: add an `activeTimeout` grace period, or surface a deadline on the state struct and let users force-close once elapsed.
- [ ] **Missing invariant test** for `totalDeposited >= totalSpent + totalRefunded` on `RolloverEscrow`. Add a forge invariant target.
- [ ] **No test for treasury zero-balance case** — `safeTransferFrom(treasury, …)` reverts with no friendly message if treasury was never funded. Add a regression.
- [ ] **Deprecated OZ import** `@openzeppelin/contracts/interfaces/draft-IERC4337.sol` in `SOFPaymaster.sol:7`. ERC-4337 is finalized upstream; verify compatibility with the production EntryPoint before mainnet and switch to the final interface when OZ ships it.
- [ ] **`testnet.json` is missing `RolloverEscrow`** — not yet deployed to Base Sepolia. Next testnet push should redeploy with the updated `DeployAll.s.sol` and include `RolloverEscrow` in the committed deployment file.
- [ ] **`SOFToken` has no treasury admin surface** — `useTreasury` / `TreasuryControls` were trimmed to the curve-only path (fees flow directly from `SOFBondingCurve.extractFeesToTreasury()` to the per-curve treasury address). If we ever want a global SOFToken-level treasury (setter, balance view, distribute action), that needs to be designed + added to the contract first. Decision deferred — today's architecture is "each curve owns its own treasury address, set at deploy time, no changing it."

## 2026-04-26 Transaction History fix

- [x] **`raffle_transactions` partition trigger ran as service_role** — `INSERT INTO season_contracts` aborted with "must be owner of table raffle_transactions" because `auto_create_raffle_tx_partition()` issues `CREATE TABLE … PARTITION OF raffle_transactions` and `service_role` doesn't own the parent. Added `SECURITY DEFINER` + locked `search_path = public, pg_temp` to both `auto_create_raffle_tx_partition()` and `create_raffle_tx_partition()` in `supabase/migrations/20260416000000_init.sql` and `docker/supabase/init.sql`. Without that row the per-season `PositionUpdate` listener never starts, so Transaction History / Token Holders stay empty.
- [x] **`local-dev.sh` missing `BACKEND_WALLET_ADDRESS`** — `getWalletClient()` in `viemClient.js:60` requires both private key and address; backend "Start Season" was failing with "Backend wallet address not configured for LOCAL". Added `BACKEND_WALLET_ADDRESS=$DEPLOYER_ADDR` to step 8 env block.
- [x] **Anvil Account[0] admin lost on `supabase db reset`** — local-dev.sh seeds the allowlist, but `db reset` wipes those rows and re-runs the migration's `INSERT … ON CONFLICT DO NOTHING` seed which had the deployer stored *checksummed* (lookup is `.toLowerCase()`-eq, so the stored row was unreachable). Three fixes: (1) migration seed now stores deployer lowercase + uses `ON CONFLICT … DO UPDATE` so wrong access_level gets corrected, (2) new `supabase/seed.sql` re-asserts deployer admin on every `db reset` as defense in depth, (3) `local-dev.sh` step 4 switched from `INSERT … WHERE NOT EXISTS` to `ON CONFLICT … DO UPDATE`, and final verification now checks Account[0] *and* Patrick (was only Patrick).
