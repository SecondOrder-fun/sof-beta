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
- [x] Phase 2 — Server-side gas caps + per-EOA sponsorship quota. Per-network gas-cap defaults (LOCAL: 8M call / 1M verification / 500k pmVerification / 100k pmPostOp; REMOTE: 2M / 500k / 200k / 60k) with env overrides. `assertGasLimitsWithinCaps` rejects oversized userOps with -32602; `eth_estimateUserOperationGas` clamps suggestions to caps. Per-EOA Redis quota (atomic INCR+EXPIRE pipeline, 40 calls/hr default REMOTE, applied to BOTH stub and real calls so the stub endpoint isn't a free-signature oracle), keyed by `chainId:sender` for multi-tenant isolation. Fail-closed on Redis errors (-32000) so an outage can't silently turn into unbounded sponsorship. Sender format validated before the quota call. Total 34 tests covering gas caps, quota across stub/real, multi-tenant chainId isolation, fail-closed paths, default-cap parity. **Production wire-up note:** quota only takes effect once `redis` is passed to `createBundlerService`; `localBundlerRoutes.js` already wires `redisClient.getClient()` (no-op on LOCAL since `quotaPerHour=0`), so when SOFPaymaster ships on testnet a single new route registration is enough.
- [x] Phase 3 — Verifying-signer rotation playbook at `docs/02-architecture/paymaster-signer-rotation.md`. Covers detection, full rotation procedure (offline keygen → `setSigner` from owner → backend env push via `deploy-env.sh` → `railway redeploy` → verification with new `scripts/verify-paymaster-signer.js`), rollback (gated on `validityWindowSec > 0`), owner-key-compromise redeploy path with concrete `withdrawTo` race step, configuration knobs, quarterly drill cadence. Companion script `scripts/verify-paymaster-signer.js` recovers the signer from a `pm_getPaymasterStubData` response and asserts equality with `--expect-signer` (supports `--sender` override for non-local probes). Doc-link integrity test (`tests/docs/paymasterRotationPlaybook.test.js`) pins the runbook's references so a future rename of `setSigner` / env vars / scripts breaks CI here, prompting a doc update at the same time.
- [ ] Phase 4 — Cap `preVerificationGas` in `assertGasLimitsWithinCaps`. Currently only the four `GAS_CAP_ENV_KEYS` fields are bounded (callGasLimit, verificationGasLimit, paymasterVerificationGasLimit, paymasterPostOpGasLimit). EntryPoint also charges paymaster for `preVerificationGas`, so an attacker with a leaked verifyingSigner can claim arbitrary `preVerificationGas` and inflate per-op damage beyond the documented ~2.86M ceiling. Add `PAYMASTER_MAX_PRE_VERIFICATION_GAS` (REMOTE default ~150k, generous enough for our real ops) and assert.

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
- [ ] **Admin guard caches nothing** — `shared/adminGuard.js:14` does a fresh `getUserAccess()` DB roundtrip per request. Cache access level in Redis (TTL ~60s) keyed by fid/wallet.
- [ ] **Rollover listener has no tests** — `src/listeners/rolloverEventListener.js` and `fastify/routes/rolloverRoutes.js` are the newest code (commits e093cb3, d00519c) with zero coverage. Add unit tests for idempotent upsert and block-cursor recovery.
- [ ] **Env vars validated lazily** — `BACKEND_WALLET_PRIVATE_KEY`, `NEYNAR_API_KEY`, `PAYMASTER_RPC_URL`, `PIMLICO_API_KEY`, `HATS_*` are read at call-site rather than at module load. A single `assertRequiredEnv()` called from `server.js` would fail fast on boot instead of at first user request.
- [ ] **CORS regex is fragile** — `CORS_ORIGINS` supports wildcards; a trailing space in the env var silently breaks pattern matching. Trim + validate on load.
- [ ] **No error tracking** — global error handler in `server.js:290` returns generic "Internal Server Error" with no context. Wire Sentry (or equivalent) so 5xx and listener crashes surface somewhere.
- [ ] **Transitive `moderate` audit advisories** — 11 remaining from `@metamask/sdk`, `@coinbase/cdp-sdk`, `@solana/web3.js`, `vitest`. All require breaking upgrades of our direct deps; revisit after upstream ships patches.

### Contracts / operations
- [x] **Auto-register consolation eligibility in `Raffle.finalizeSeason`.** Gap surfaced during 2026-04-24 Test B: `claimConsolation` reverted with `NotAParticipant` because `setConsolationEligible` was never wired into finalization. `_executeFinalization` now calls `distributor.setConsolationEligible(seasonId, state.participants)` right after `configureSeason`; covered by new assertion in `FullSeasonFlow.t.sol`.
- [x] **Auto-grant `ESCROW_ROLE` to `RolloverEscrow` on every new bonding curve.** Same session gap: deployer EOA had no admin on per-season curves, so rollover spends required `anvil_impersonateAccount`. `SeasonFactory` now stores a `rolloverEscrow` address (settable by admin) and grants `ESCROW_ROLE` during `createSeasonContracts`; `DeployAll` calls `seasonFactory.setRolloverEscrow` in the 16b rollover-wiring block. Covered by `test/SeasonFactoryRollover.t.sol`.
- [x] **Bind `bondingCurve` to each cohort.** Reviewer blocker: the global `RolloverEscrow.bondingCurve` slot meant operators had to remember a separate `setBondingCurve` call per season, and two active cohorts would trample each other. Deleted the global slot + setter; `CohortState` now carries its own `bondingCurve`; `activateCohort(seasonId, nextSeasonId, curve)` locks it in atomically. Covered by `test/RolloverPerCohortCurve.t.sol` (two cohorts → two curves, no cross-contamination).
- [ ] **`14_ConfigureRoles.s.sol` still duplicates rollover wiring from `DeployAll` 16b** — the `if (addrs.rolloverEscrow != address(0))` block at lines 97–116 is a no-op during full DeployAll (rollover escrow doesn't exist yet at step 14), but fires on standalone ConfigureRoles runs and double-wires. Harmless (both calls are idempotent) but muddies ownership. Delete or move all rollover wiring to one place.
- [ ] **`Raffle._executeFinalization` eligibility loop is O(participants).** At default `maxParticipants = 10_000` the single `setConsolationEligible` call burns ~200M gas — will OOG on most blocks (Base block limit is higher but not infinite). Either cap `defaultMaxParticipants` at a safe value (~1_500 fits comfortably) or chunk the eligibility registration into a separate `pokeConsolationEligible(seasonId, offset, limit)` that admins/backend can call after finalize.
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
