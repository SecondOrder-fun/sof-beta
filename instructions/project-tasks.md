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
- [ ] End-to-end testing with MetaMask + Rabby
- [x] Add delegation locale strings for de, es, fr, it, ja, pt, ru, zh

## Monorepo Migration (In Progress)

- [x] Verify all builds pass (`turbo build`) — all 3 packages pass
- [x] Verify all tests pass (`turbo test`) — 741 tests: 254 contracts + 151 backend + 336 frontend
- [x] End-to-end local dev flow validation (Docker: Anvil + Redis + Postgres + Backend, contracts deployed, frontend connected)
- [ ] Archive old repos (sof-alpha, sof-backend, sof-allowlist, sof-docs)

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
- [ ] TBD

### Task 6: Deployment Script and Role Wiring
- [ ] TBD

### Task 7: Integration Tests
- [ ] TBD

### Task 8: ABI Export and Cleanup
- [ ] TBD

## UI Tasks

- [ ] Landing page background animation: scale moving elements 6-8x, pixelated style (4x4 grid with blank corners for circular appearance)
