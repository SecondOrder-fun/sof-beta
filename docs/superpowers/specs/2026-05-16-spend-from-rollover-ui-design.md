# Spend-from-Rollover UI — Design Spec

**Status:** Draft → pending user approval
**Date:** 2026-05-16
**Author:** brainstormed with user
**Followups this spec defers to:** task #20 (auto-`activateCohort` in `Raffle.startSeason`), task #30 (rollover qualification for concurrent raffles)

## Problem

After PR #83 landed the claim-to-rollover half of the rollover lifecycle, users can deposit their consolation prize into `RolloverEscrow`. The next half — **spending** that deposit on tickets in season N+1 — is implemented on-chain (`RolloverEscrow.spendFromRollover` + `SOFBondingCurve.buyTokensFor`) but the BuySellWidget never invokes the spend path. Validated live on testnet 2026-05-15: P1 had 455 SOF rollover in cohort 1 (phase `Active`, `nextSeasonId=2`, 6% bonus) and bought 450 tickets in S2 — the entire 450.45 SOF came from P1's SMA wallet, escrow balance was untouched.

## Root cause

The wiring is mostly already in place:

- `BuySellWidget.jsx` imports `useRollover`, holds `rolloverEnabled` state (default `true`), renders `<RolloverBanner>` when `isRolloverAvailable`.
- `useBuySellTransactions.executeBuy` at `:90-101` branches on `rolloverSeasonId && rolloverAmount > 0n` and builds a `spendFromRollover` call instead of `buyTokens`.
- `useRollover(seasonId)` exposes `isRolloverAvailable`, `rolloverBalance`, `bonusBps`, `bonusAmount`.

The bug is in cohort-ID semantics: the widget calls `useRollover(currentSeasonId)`, but rollover deposits live at `cohort = prevSeasonId` (the cohort whose `nextSeasonId === currentSeasonId && phase === Active`). For P1's S2 buy: deposit is in cohort **1**, widget reads cohort **2**, `isRolloverAvailable` is `false`, banner stays hidden, path falls through to plain wallet `buyTokens`.

## Goal

When the connected SMA has an eligible rollover deposit funding the current season's buys, the BuySellWidget defaults to spending from rollover first and supplements with wallet SOF when the requested ticket count exceeds the rollover balance. A single ERC-4337 userOp executes both calls atomically.

## Non-goals

- Multi-cohort/concurrent-raffle qualification (task #30, future Beta).
- Auto-`activateCohort` wiring into `Raffle.startSeason(N+1)` (task #20). For this PR's testing, `activateCohort` continues to be a manual `cast send`.
- A `useEligibleRolloverCohort` variant that walks back more than one season. The current rollover qualification rule is strictly N → N+1.
- A Portfolio-side "spend rollover" surface. The spend affordance lives in the buy flow only; Portfolio retains the existing claim/refund surfaces.

## Scope decisions

| Question | Decision |
|---|---|
| Cohort lookup mechanism | JS hook, single read at `cohortId = currentSeasonId − 1n`. Returns `isEligible: false` for `currentSeasonId <= 1n`. |
| Default behavior when eligible | Auto-prefer rollover (`rolloverEnabled` defaults to `true`, matches existing widget state). |
| Shortfall when requested buy > rollover available | Mixed batch: one ERC-7821 userOp containing `spendFromRollover` + `approve` + `buyTokens`. Atomic on revert. |
| Multi-cohort eligibility | Out of scope (task #30). Spec assumes single-raffle-at-a-time during Beta. |
| Manual amount override | Already present (`rolloverAmountOverride`). No changes needed. |
| New contract or backend surfaces | None. All changes confined to `packages/frontend`. |

## Architecture

```
BuySellWidget (existing — modified call sites)
  │
  ├─ NEW: useEligibleRolloverCohort(currentSeasonId)
  │     reads cohortState + userPosition for (currentSeasonId − 1n)
  │     returns { cohortSeasonId, available, bonusBps, bonusAmount, isEligible, isLoading, error }
  │
  ├─ EXISTING: useRollover(seasonId)
  │     still in use by Portfolio / ClaimCenter for the "your own cohort" view at claim time.
  │     Not modified.
  │
  ├─ wires: rolloverSeasonId={cohortSeasonId}, rolloverAmount={...}
  │
  └─ uses: useBuySellTransactions.executeBuy(...)
        ├─ rolloverAmount === 0n:            [approve, buyTokens]
        ├─ rolloverAmount ≥ estBuyWithFees:  [spendFromRollover]
        └─ 0 < rolloverAmount < estBuyWithFees:
                                              [spendFromRollover, approve, buyTokens]

RolloverBanner (existing — refreshed)
  Adds conditional "+ X SOF from wallet → Y more tickets" line when mixed-batch is active.

useBalanceValidation (existing — tweaked)
  Effective balance now includes rolloverAvailable + bonus on top of wallet SOF.
```

Rationale for keeping `useRollover` and `useEligibleRolloverCohort` as separate hooks: they answer different questions. `useRollover(seasonId)` answers *"what's my position in season N's cohort?"* (claim-time, Portfolio). `useEligibleRolloverCohort(currentSeasonId)` answers *"can I spend rollover in season N?"* (buy-time, widget). Conflating them would muddy the claim-time consumers.

## Components

### `useEligibleRolloverCohort(currentSeasonId)` (new)

**File:** `packages/frontend/src/hooks/useEligibleRolloverCohort.js`

**Return shape:**
```js
{
  cohortSeasonId: bigint | null,    // currentSeasonId − 1n when isEligible, else null
  available:      bigint,           // deposited − spent (SOF, in wei)
  bonusBps:       number,           // 600 = 6%
  bonusAmount:    (sofAmount: bigint) => bigint,
  isEligible:     boolean,
  isLoading:      boolean,
  error:          Error | null,
}
```

**Eligibility predicate:**
```
isEligible = cohort.phase === "active"
          && cohort.nextSeasonId === currentSeasonId
          && available > 0n
```

**Caching:** React Query, queryKey `["rollover-eligible", sma, currentSeasonId, netKey]`, `staleTime: 30_000`, `refetchInterval: 60_000` — same cadence as `useRollover`, so RPC load doesn't grow.

**Short-circuits:**
- `currentSeasonId <= 1n` → return `{ isEligible: false, ... }` synchronously without firing reads.
- SMA address falsy (counterfactual, wallet disconnected) → return `{ isEligible: false, ... }` without reads.
- `ROLLOVER_ESCROW` address missing in network config → return `{ isEligible: false, ... }` without reads.

### `useBuySellTransactions.executeBuy` (modified)

**File:** `packages/frontend/src/hooks/buysell/useBuySellTransactions.js`

**Existing signature additions** (additive, all existing callers unchanged):
```js
executeBuy({
  tokenAmount,            // bigint — total tickets requested
  maxSofAmount,           // bigint — overall slippage cap
  slippagePct,
  rolloverSeasonId,       // existing — bigint | null
  rolloverAmount,         // existing — bigint
  walletTopupTickets,     // NEW — bigint, tickets to fund from wallet (0 unless mixed-batch)
  walletTopupMaxSof,      // NEW — bigint, slippage cap on wallet portion
  onComplete,
})
```

**Branch table:**

| Condition | Resulting `calls` array (single ERC-7821 userOp) |
|---|---|
| `rolloverAmount === 0n` | `[approve(curve, maxSofAmount), buyTokens(tokenAmount, maxSofAmount)]` |
| `rolloverAmount >= estBuyWithFees` | `[spendFromRollover(cohortId, rolloverAmount, tokenAmount, maxSofAmount)]` |
| `0n < rolloverAmount < estBuyWithFees` | `[spendFromRollover(cohortId, rolloverAmount, rolloverTickets, maxRolloverTotalSof), approve(curve, walletTopupMaxSof), buyTokens(walletTopupTickets, walletTopupMaxSof)]` |

`rolloverTickets` = the number of tickets the rollover portion alone funds, computed via the same `usePriceEstimation` flow already in the widget. `walletTopupTickets = tokenAmount - rolloverTickets`.

**Atomicity:** ERC-7821 batch executes inner calls in order within the same EVM transaction; any inner revert reverts the entire batch. No partial state.

### `RolloverBanner` (modified)

**File:** `packages/frontend/src/components/curve/RolloverBanner.jsx`

**New prop:** `estBuyWithFees: bigint` (already in widget scope).

**Render:** existing "Rolling over X SOF + Y SOF bonus" line is unchanged. When `rolloverAmount < estBuyWithFees`, an additional line:

```
+ Z SOF from wallet → W more tickets
Total: T tickets
```

Where `Z = estBuyWithFees - rolloverAmount`, `W = walletTopupTickets`, `T = tokenAmount`.

### `useBalanceValidation` (one-line tweak)

**File:** `packages/frontend/src/hooks/buysell/useBalanceValidation.js`

Add a `rolloverEffectiveAmount` parameter (default `0n`). Effective check becomes:
```
hasInsufficientBalance =
  estBuyWithFees > (walletBalance + rolloverEffectiveAmount)
```
Widget passes `rolloverEffectiveAmount = rolloverAmount + bonusAmount(rolloverAmount)` when rollover is enabled, `0n` otherwise.

## Data flow

### Read path (mount + refresh interval)

```
BuySellWidget mounts/refreshes
  ↓
useEligibleRolloverCohort(currentSeasonId)
  ↓ short-circuits unless currentSeasonId > 1n && SMA && ROLLOVER_ESCROW configured
  ↓
  Promise.all([
    readCohortState(currentSeasonId − 1n),
    readAvailableBalance(currentSeasonId − 1n, sma),
    readUserPosition(currentSeasonId − 1n, sma),
  ])
  ↓
  isEligible flag + cohort metadata → BuySellWidget
  ↓
  if isEligible: render RolloverBanner, rolloverEnabled defaults to true
                 rolloverAmount = override ?? min(available, estBuyWithFees)
  if !isEligible: render normal buy form, rolloverAmount = 0n
```

### Write path (Buy submit)

```
BuySellWidget submit
  ↓
useTransactionHandlers.handleBuy({ tokenAmount, maxSofAmount, slippagePct, rolloverAmount, rolloverSeasonId })
  ↓
useBuySellTransactions.executeBuy({ ...,
  walletTopupTickets = max(0n, tokenAmount − rolloverTickets),
  walletTopupMaxSof  = walletTopupTickets × priceEst × (1 + slippage),
})
  ↓
branch table → calls[]
  ↓
executeBatch(calls)
  ↓
ERC-4337 userOp → bundler → paymaster → EntryPoint → SMA.execute(batch) → atomic on-chain
```

## Error handling

| Source | Surface |
|---|---|
| `useEligibleRolloverCohort` RPC blip | React Query 3× retry; if all fail, `error` exposed, widget logs to console, banner hides, normal buy form still works. No toast. |
| `spendFromRollover` reverts `PhaseNotActive` (race after read) | Toast: "Rollover unavailable. Cohort was closed. Try again without rollover." |
| `spendFromRollover` reverts `ExceedsBalance` (race) | Toast: "Insufficient rollover balance. Reduce buy size or disable rollover." |
| Wallet-portion slippage revert in mixed batch | Entire batch reverts (ERC-7821 atomicity); rollover spend undone; toast shows existing "buy reverted" message. No partial spend. |
| User insufficient wallet SOF for top-up | Pre-flight `useBalanceValidation` catches in widget; submit disabled. |
| Treasury allowance exhausted for bonus transfer | Standard "tx reverted" toast; not pre-validated in widget (ops concern, out of scope). |

## Testing

### Unit tests (6 new, ~3 modified)

1. **`useEligibleRolloverCohort.test.js`** (new) — 6 cases: short-circuit at `currentSeasonId=1n`, phase Active + match + available, phase Open + match (false), phase Active + mismatch nextSeasonId (false), phase Active + match + available=0n (false), SMA undefined (no reads fire).
2. **`useBuySellTransactions.test.js`** (extend) — add mixed-batch case; assert 3-call `calls` array, correct ticket split, correct per-call slippage caps. Keep existing wallet-only and full-rollover cases.
3. **`RolloverBanner.test.jsx`** (extend / create) — full-rollover line renders alone; mixed-batch additionally renders wallet-topup line; toggle off fires `onEnabledChange`.
4. **`useBalanceValidation.test.js`** (extend) — effective balance includes `rolloverAmount + bonus`; insufficient check fires only when both wallet AND rollover combined are short.

### Integration test

5. **`BuySellWidget.test.jsx`** (extend) — three scenarios: rollover banner renders when `useEligibleRolloverCohort` mock returns `isEligible: true`; mixed-batch submit produces 3-call payload via `executeBatch`; rollover-disabled submit preserves existing wallet-only path.

### What this PR does not test

- End-to-end browser test against testnet — manual smoke test during PR review covers it.
- Treasury bonus depletion (ops concern).
- Concurrent-raffle cohort lookup (task #30).

### Acceptance threshold

Current frontend suite: **396/396 pass**. Target after this PR: **402/402** (6 new cases). Plus modifications to ~3 existing test files for additive props (must not regress the existing assertions). Backend and contracts: zero changes, zero new test files.

## Files changed

**Created:**
- `packages/frontend/src/hooks/useEligibleRolloverCohort.js`
- `packages/frontend/tests/hooks/useEligibleRolloverCohort.test.js`

**Modified:**
- `packages/frontend/src/components/curve/BuySellWidget.jsx` — swap `useRollover` → `useEligibleRolloverCohort` at the buy site; compute `walletTopupTickets`/`walletTopupMaxSof`; pass `estBuyWithFees` to banner.
- `packages/frontend/src/components/curve/RolloverBanner.jsx` — accept `estBuyWithFees`; render wallet-topup line when mixed.
- `packages/frontend/src/hooks/buysell/useBuySellTransactions.js` — add mixed-batch branch in `executeBuy`.
- `packages/frontend/src/hooks/buysell/useBalanceValidation.js` — accept `rolloverEffectiveAmount`; widen effective-balance check.
- `packages/frontend/tests/hooks/useBuySellTransactions.test.js` — add mixed-batch case.
- `packages/frontend/tests/components/RolloverBanner.test.jsx` — add mixed-batch line case (create file if absent).
- `packages/frontend/tests/components/BuySellWidget.test.jsx` — add three scenarios.
- `packages/frontend/tests/hooks/useBalanceValidation.test.js` — add rollover-aware case.
- `packages/frontend/package.json` — minor version bump (new component-level public surface).

**Untouched:** all contracts, all backend, deploy scripts, ABIs.

## Open questions / future work

- **Task #30** (future Beta): rollover qualification under concurrent raffles. This spec hardcodes "current season − 1" which only holds while one raffle runs at a time.
- **Task #20** (followup): wire `Raffle.startSeason(N+1)` to call `activateCohort` automatically so manual `cast send` is no longer required between seasons.
- **Task #22** (this PR closes it): the original "wire spendFromRollover into BuySellWidget" — this spec is the implementation.
