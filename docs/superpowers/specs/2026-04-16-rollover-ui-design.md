# Rollover UI Design

**Status:** Approved
**Date:** 2026-04-16
**Scope:** Frontend components for rollover claim, spend, status display, and transaction tagging
**Depends on:** Rollover Incentives contract spec (2026-04-16-rollover-incentives-design.md)

## Overview

Four UI modifications that surface the rollover incentives system to users. Built around a single shared hook (`useRollover`) that reads escrow contract state and builds transactions. Follows existing component patterns, theming, and i18n conventions.

Design philosophy: rollover is the default, smart choice. The UI nudges toward it without hiding the wallet alternative.

## Component 1: `useRollover` Hook

**File:** `packages/frontend/src/hooks/useRollover.js`

Central hook for all rollover UI. Follows the patterns in `useClaims.js` and `useCurve.js`.

### Interface

```javascript
useRollover(seasonId) returns {
  // State (React Query reads)
  rolloverBalance,          // uint256 — available SOF in escrow
  rolloverDeposited,        // uint256 — total deposited
  rolloverSpent,            // uint256 — total spent so far
  isRefunded,               // boolean
  cohortPhase,              // 'none'|'open'|'active'|'closed'|'expired'
  bonusBps,                 // uint16 — basis points (600 = 6%)
  nextSeasonId,             // uint256 — linked season

  // Computed
  bonusAmount(sofAmount),   // function — sofAmount * bonusBps / 10000
  isRolloverAvailable,      // boolean — balance > 0 && phase == 'active'
  hasClaimableRollover,     // boolean — phase == 'open' (for claim UI)
  bonusPercent,             // string — "6%" for display

  // Mutations (via executeBatch, gasless)
  claimToRollover,          // mutation({ seasonId }) — claimConsolation(seasonId, true)
  spendFromRollover,        // mutation({ seasonId, sofAmount, ticketAmount, maxSof })
  refundRollover,           // mutation({ seasonId })

  // Loading/error
  isLoading,
  error
}
```

### Contract Reads

Uses `publicClient.readContract` against `RolloverEscrowABI` (imported from `@sof/contracts`):

- `getUserPosition(seasonId, address)` → (deposited, spent, refunded)
- `getCohortState(seasonId)` → (phase, nextSeasonId, bonusBps, totalDeposited, totalSpent, totalBonusPaid, openedAt, isExpired)
- `getAvailableBalance(seasonId, address)` → uint256
- `getBonusAmount(seasonId, amount)` → uint256

### Query Key

```javascript
['rollover', address, seasonId, networkKey]
```

Invalidated on: `claimToRollover` success, `spendFromRollover` success, `refundRollover` success.

### Transaction Building

All mutations use `useSmartTransactions().executeBatch()` for gasless execution:

**claimToRollover:**
```javascript
calls: [{
  to: prizeDistributorAddress,
  data: encodeFunctionData({
    abi: RafflePrizeDistributorABI,
    functionName: 'claimConsolation',
    args: [seasonId, true]
  })
}]
```

**spendFromRollover:**
```javascript
calls: [{
  to: rolloverEscrowAddress,
  data: encodeFunctionData({
    abi: RolloverEscrowABI,
    functionName: 'spendFromRollover',
    args: [seasonId, sofAmount, ticketAmount, maxSof]
  })
}]
```

**refundRollover:**
```javascript
calls: [{
  to: rolloverEscrowAddress,
  data: encodeFunctionData({
    abi: RolloverEscrowABI,
    functionName: 'refund',
    args: [seasonId]
  })
}]
```

## Component 2: Claim Toggle (ClaimCenterRaffles)

**File:** `packages/frontend/src/components/infofi/claim/ClaimCenterRaffles.jsx` (modify)

### Behavior

When a consolation prize is claimable AND `useRollover(seasonId).hasClaimableRollover` is true:

1. Replace the current "Claim" button with the rollover-default layout
2. If no open cohort exists (phase != 'open'), show existing claim button with `toRollover=false`

### Layout (Rollover Available)

```
┌─────────────────────────────────────────────┐
│  Season 1 — Consolation Prize               │
│              175.00 SOF                      │
│                                              │
│  ┌─────────────────────────────────────────┐ │
│  │ Rollover to Next Season                 │ │
│  │ Earn +6% bonus         +10.50 SOF       │ │
│  └─────────────────────────────────────────┘ │
│                                              │
│  [ ■■■■ Rollover 175 SOF ■■■■■■■■■■■■■■■ ] │ ← primary green button
│                                              │
│        Claim to wallet instead               │ ← subtle text link
└─────────────────────────────────────────────┘
```

### Layout (No Rollover Available)

Existing behavior — single "Claim" button calling `claimConsolation(seasonId, false)`.

### Actions

- **"Rollover 175 SOF" button:** calls `useRollover().claimToRollover.mutate({ seasonId })`
- **"Claim to wallet instead" link:** calls existing `useClaims().claimRaffleConsolation.mutate({ seasonId })` which now passes `toRollover=false`
- On success: invalidate `raffle_claims`, `rollover`, `sofBalance` query keys
- Pending/success states: reuse existing `pendingClaims`/`successfulClaims` pattern from `useClaims`

### Mobile

Same layout — single-column card adapts naturally. No separate mobile component needed.

### i18n Keys

```
raffle:rolloverToNextSeason    — "Rollover to Next Season"
raffle:earnBonusPercent        — "Earn +{{percent}}% bonus"
raffle:rolloverAmount          — "Rollover {{amount}} SOF"
raffle:claimToWalletInstead    — "Claim to wallet instead"
```

## Component 3: Buy Widget Rollover Banner (BuySellWidget)

**File:** `packages/frontend/src/components/curve/BuySellWidget.jsx` (modify)
**File:** `packages/frontend/src/components/mobile/BuySellSheet.jsx` (modify)

### Behavior

When `useRollover(seasonId).isRolloverAvailable` is true, a banner appears at the top of the **buy tab only** (not sell tab).

### Banner States

**Collapsed (default — toggle ON):**
```
┌─────────────────────────────────────────────┐
│ ● Rollover Available                   [ON] │
│   175 SOF from Season 1 · +6% bonus        │
│                               Adjust ›      │
└─────────────────────────────────────────────┘
```

**Toggle OFF:**
Banner greys out. Buy proceeds from wallet only (existing behavior). Cost breakdown reverts to normal.

**Adjust expanded:**
```
┌─────────────────────────────────────────────┐
│ ● Rollover Available                   [ON] │
│   175 SOF from Season 1 · +6% bonus        │
│                                             │
│   Use [___150___] of 175 SOF    Adjust ›    │
└─────────────────────────────────────────────┘
```

Input pre-filled with `min(rolloverBalance, estimatedTicketCost)`. Clamped to 0–rolloverBalance.

### Cost Breakdown (Rollover Active)

Replaces the existing single-line "Estimated cost" when rollover is toggled on:

```
From rollover              150.00 SOF
Bonus (6%)                  +9.00 SOF
From wallet                 41.00 SOF
─────────────────────────────────────
Total ticket value         200.00 SOF
```

If rollover covers everything, "From wallet" shows "0.00 SOF" in green.

### Transaction Routing

When rollover is active and user clicks "Buy":

**Case 1: Rollover covers full cost**
Single call in `executeBatch`:
- `escrow.spendFromRollover(seasonId, rolloverPortion, totalTickets, maxSof)`

**Case 2: Mixed funding (rollover + wallet)**
Two calls in a single `executeBatch`:
1. `escrow.spendFromRollover(seasonId, rolloverPortion, rolloverTickets, maxSof)` — buys tickets from rollover with bonus
2. `curve.buyTokens(remainingTickets, maxSof)` — buys remaining tickets from wallet

The frontend calculates the ticket split based on the curve's pricing:
- `rolloverTickets = calculateTicketsForSof(rolloverPortion + bonusAmount)`
- `remainingTickets = totalTickets - rolloverTickets`

### State

New state in BuySellWidget:
- `rolloverEnabled` — boolean, default `true` when rollover available
- `rolloverAdjustOpen` — boolean, default `false`
- `rolloverAmount` — string, the adjusted amount (default: full balance or ticket cost, whichever is smaller)

### Mobile (BuySellSheet)

Same banner rendered inside the bottom sheet above BuyForm. Same state and logic.

### i18n Keys

```
raffle:rolloverAvailable       — "Rollover Available"
raffle:rolloverFromSeason      — "{{amount}} SOF from Season {{season}} · +{{percent}}% bonus"
raffle:adjust                  — "Adjust"
raffle:useOfRollover           — "Use {{amount}} of {{total}} SOF"
raffle:fromRollover            — "From rollover"
raffle:fromWallet              — "From wallet"
raffle:bonusPercent             — "Bonus ({{percent}}%)"
raffle:totalTicketValue        — "Total ticket value"
```

## Component 4: Portfolio Rollover Card

**File:** `packages/frontend/src/components/user/RolloverPortfolioCard.jsx` (new)
**Rendered in:** Portfolio section of user profile/account page

### Behavior

Only renders when the user has at least one active rollover position. Queries for rollover positions via the backend API.

### Layout

```
┌─────────────────────────────────────────────┐
│  Rollover Balance                           │
│                                             │
│  175.00 SOF                    [Ready]      │ ← phase badge
│  From Season 1 · +6% bonus                 │
│                                             │
│  Buy Tickets in Season 2 →                  │ ← link to season (if Active)
│  Refund to Wallet                           │ ← action (if balance > 0)
└─────────────────────────────────────────────┘
```

### Phase Badges

| Phase | Badge | Color |
|-------|-------|-------|
| Open | "Pending" | yellow/muted |
| Active | "Ready" | green |
| Closed | "Closed" | grey |
| Expired | "Expired" | red/muted |

### Actions

- **"Buy Tickets in Season 2 →":** navigates to `/raffles/:nextSeasonId` (only shown when phase == Active)
- **"Refund to Wallet":** calls `useRollover().refundRollover.mutate({ seasonId })` (shown when phase is Active/Closed/Expired and balance > 0)

### Data Source

The backend needs to provide a list of seasons where the user has rollover positions. Options:

**Recommended:** Add a backend endpoint `GET /api/rollover/positions?wallet=0x...` that queries `RolloverDeposit` events from the indexed transaction data, filtered by wallet. Returns season IDs with deposit status.

The frontend then calls `useRollover(seasonId)` for each returned season to get current on-chain state (balance, phase). This keeps the source of truth on-chain while using the backend index for discovery.

### i18n Keys

```
account:rolloverBalance        — "Rollover Balance"
account:fromSeason             — "From Season {{season}}"
account:rolloverBonusRate      — "+{{percent}}% bonus"
account:buyTicketsInSeason     — "Buy Tickets in Season {{season}}"
account:refundToWallet         — "Refund to Wallet"
account:rolloverPending        — "Pending"
account:rolloverReady          — "Ready"
account:rolloverClosed         — "Closed"
account:rolloverExpired        — "Expired"
```

## Component 5: Transaction History Badge (SOFTransactionHistory)

**File:** `packages/frontend/src/components/user/SOFTransactionHistory.jsx` (modify)
**File:** `packages/frontend/src/hooks/useSOFTransactions.js` (modify)

### New Transaction Type

Add `ROLLOVER_BUY` to the transaction type enum alongside existing `BONDING_CURVE_BUY`, `BONDING_CURVE_SELL`, `PRIZE_CLAIM_CONSOLATION`, etc.

### Badge

`ROLLOVER` badge in green (matching rollover accent). Follows existing badge pattern — same component, new variant.

### Display

```
[ROLLOVER]  +185.50 SOF    2 min ago
            Season 2 · incl. 10.50 bonus
```

The amount shows the total ticket value (base + bonus). The subtitle shows the bonus portion.

### Backend Indexing

The backend event listener needs to index `RolloverSpend` events as `ROLLOVER_BUY` type in the `raffle_transactions` table. The event provides `baseAmount` and `bonusAmount` — store both, display `baseAmount + bonusAmount` as the total with the bonus noted.

Also index `RolloverDeposit` as `ROLLOVER_DEPOSIT` and `RolloverRefund` as `ROLLOVER_REFUND` for complete history.

### Filter

Add `ROLLOVER` to the transaction filter buttons: `ALL | IN | OUT | TRADES | PRIZES | ROLLOVER`

Or keep it simple and include rollover transactions under `TRADES` since they are ticket purchases. The badge distinguishes them visually.

## Backend Changes

### Event Listener

Add rollover event indexing to the existing event listener infrastructure (or a new listener):

- `RolloverDeposit(user, seasonId, amount)` → insert `raffle_transactions` with type `ROLLOVER_DEPOSIT`
- `RolloverSpend(user, seasonId, nextSeasonId, baseAmount, bonusAmount)` → insert with type `ROLLOVER_BUY`, store both amounts
- `RolloverRefund(user, seasonId, amount)` → insert with type `ROLLOVER_REFUND`

### API Endpoint

`GET /api/rollover/positions?wallet=0x...`

Returns array of season IDs where the user has rollover deposits (non-zero deposited amount). Used by the portfolio card for discovery.

```json
{
  "positions": [
    { "seasonId": 1, "deposited": "175000000000000000000", "depositedAt": "2026-04-16T..." }
  ]
}
```

### Contract Address Config

Add `ROLLOVER_ESCROW` to `packages/frontend/src/config/contracts.js` loaded from `deployments/{network}.json`.

## Testing

### Frontend Tests (Vitest)

**useRollover hook:**
- Mock contract reads, verify computed state (isRolloverAvailable, bonusAmount, etc.)
- Mock executeBatch, verify correct call encoding for each mutation
- Test query key invalidation on mutation success

**ClaimCenterRaffles:**
- Render with rollover available → verify rollover CTA is primary, wallet link is secondary
- Render with no rollover → verify existing claim button
- Click rollover → verify claimToRollover mutation called
- Click wallet link → verify claimConsolation(false) called

**BuySellWidget:**
- Render with rollover available → verify banner appears on buy tab
- Toggle off → verify wallet-only cost display
- Adjust amount → verify cost breakdown updates
- Submit with mixed funding → verify two-call batch

**RolloverPortfolioCard:**
- Render with active position → verify balance, badge, season link
- Render with closed position → verify refund action shown
- Click refund → verify refundRollover mutation called

**SOFTransactionHistory:**
- Render with ROLLOVER_BUY transaction → verify green ROLLOVER badge
- Verify bonus amount displayed in subtitle

## Out of Scope

- Rollover admin UI (opening/activating/closing cohorts — done via cast or backend scripts)
- Animated transitions between claim states
- Push notifications for rollover reminders
- Rollover analytics dashboard
