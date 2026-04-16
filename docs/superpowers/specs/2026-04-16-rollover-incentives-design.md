# Rollover Incentives System Design

**Status:** Approved  
**Date:** 2026-04-16  
**Scope:** New `RolloverEscrow.sol` contract + minor changes to `RafflePrizeDistributor` and `SOFBondingCurve`

## Overview

A rollover incentive system that rewards users who commit their consolation winnings to the next season. Users who roll over receive a bonus (default 6%) on the $SOF they actually spend on tickets in the following season.

Design philosophy: make staying attractive, not leaving expensive. No exit penalties, no haircuts, no graduated unlocking. The rollover bonus is the only incentive — simple and positive.

## Core Mechanics

### Claim Decision

When a season completes and a loser claims their consolation prize, they make a single all-or-nothing choice:

- **Wallet** — full consolation amount transferred to their wallet (existing behavior)
- **Rollover** — full consolation amount deposited into `RolloverEscrow` for the next season

This is a single transaction. No partial commitments.

### Spending From Rollover

When the next season starts, the user buys tickets and can fund from:

- Their rollover balance (bonus applies)
- Their wallet (no bonus)
- A mix of both (bonus applies only to the rollover portion)

When spending from rollover, the escrow contract calculates the bonus and calls `buyTokensFor` on the bonding curve, sending `baseAmount + bonusAmount` worth of $SOF. The user receives tickets for the full amount.

The `spendFromRollover` call is wrapped in `executeBatch` for gasless execution via the ERC-7702 delegation pattern (Pimlico paymaster). The escrow handles the curve interaction internally — one call in the batch.

### Unspent Balance

If the user doesn't spend their entire rollover balance during the season, the unspent portion is returned to their wallet without bonus when they call `refund()` or when the cohort is closed.

### Eligibility

The bonus requires continuous participation:

1. User participated in Season N (bought tickets)
2. User committed consolation to rollover at end of Season N
3. User spends from rollover in Season N+1 → bonus applies

If the user commits at end of Season N but doesn't play Season N+1:
- Unspent escrow is returned (no bonus)
- They play Season N+2 and commit at its end
- Bonus is available in Season N+3

There is no explicit cooldown — the requirement is simply that you played the immediately preceding season and committed at its end.

### Bonus Rate

- Default: 600 basis points (6%)
- Configurable per season cohort via `openCohort(seasonId, bonusBps)`
- Global default adjustable via `setDefaultBonusBps(newBps)` (ADMIN_ROLE)

### Bonus Funding

- Source: treasury allocation (accumulated bonding curve trading fees)
- Bonus $SOF is pulled directly from the treasury on each `spendFromRollover` call — no pre-funding step
- Treasury must have a standing $SOF approval to the escrow contract (`approve(escrow, type(uint256).max)`)
- If treasury balance is insufficient, the `safeTransferFrom` reverts naturally
- Prize pool split (grand/consolation) is untouched

Note: $SOF total supply is 100 billion. TGE tokenomics allocation will earmark a rollover incentives budget. Treasury trading fees supplement this ongoing.

## Architecture

### Approach: Standalone Escrow Contract

A new `RolloverEscrow.sol` contract that lives outside the season lifecycle. Chosen over integrating into PrizeDistributor (per-season lifecycle mismatch) or Raffle (already 37KB).

### Contract Interaction Flows

**Season End — Claim Flow:**
```
User → PrizeDistributor.claimConsolation(toRollover=true)
       → RolloverEscrow.deposit(user, amount, seasonId)
       → $SOF transferred from PrizeDistributor to Escrow
       → Emits RolloverDeposit(user, seasonId, amount)
```

**Next Season — Buy Flow:**
```
User → executeBatch([escrow.spendFromRollover(seasonId, amount)])
       → Escrow calculates bonus: bonusAmount = amount * bonusBps / 10000
       → Escrow calls curve.buyTokensFor(user, amount + bonusAmount)
       → Tickets minted to user's address
       → Emits RolloverSpend(user, seasonId, nextSeasonId, amount, bonusAmount)
```

**Refund Flow:**
```
User → RolloverEscrow.refund(seasonId)
       → Returns (deposited - spent) to user wallet
       → No bonus on refunded amount
       → Emits RolloverRefund(user, seasonId, refundAmount)
```

### OpenZeppelin Building Blocks

- **AccessControl** — ADMIN_ROLE (config, lifecycle), DISTRIBUTOR_ROLE (deposit on behalf of users)
- **ReentrancyGuard** — on all state-changing external functions
- **SafeERC20** — all $SOF transfers
- **Pausable** — emergency stops (refunds remain enabled even when paused)

ERC-2612 permit support on the SOFToken is already available for the funding flow.

## State Machine

Each season cohort progresses through phases:

```
OPEN → ACTIVE → CLOSED
  ↓
EXPIRED
```

| Phase | Entry Condition | Allowed Actions |
|-------|----------------|-----------------|
| OPEN | `openCohort()` called after season ends | deposit |
| ACTIVE | `activateCohort()` called when next season starts | spendFromRollover, refund |
| CLOSED | `closeCohort()` called when linked season ends | refund |
| EXPIRED | `block.timestamp > openedAt + expiryTimeout` while still OPEN | refund |

- OPEN → ACTIVE: triggered by admin/backend when next season starts. Sets `nextSeasonId`.
- ACTIVE → CLOSED: triggered when linked season ends. Spending stops, remaining balances refundable.
- OPEN → EXPIRED: auto-detected on next interaction if timeout exceeded (default 30 days). All deposits fully refundable.

## Data Model

### Contract-Level Config

| Field | Type | Description |
|-------|------|-------------|
| `sofToken` | IERC20 | Immutable. The $SOF token address. |
| `treasury` | address | Receives unused bonus. |
| `raffle` | address | For participation verification. |
| `defaultBonusBps` | uint16 | Default 600 (6%). |
| `expiryTimeout` | uint32 | Default 30 days (2592000 seconds). |

### Per-Cohort State (`mapping(uint256 seasonId => CohortState)`)

| Field | Type | Description |
|-------|------|-------------|
| `phase` | EscrowPhase | Open, Active, Closed, Expired |
| `nextSeasonId` | uint256 | Which season this cohort rolls into |
| `bonusBps` | uint16 | Override per cohort (0 = use default) |
| `totalDeposited` | uint256 | Sum of all user deposits |
| `totalSpent` | uint256 | Sum spent on tickets |
| `totalBonusPaid` | uint256 | Total bonus $SOF pulled from treasury (for accounting/events) |
| `openedAt` | uint40 | Timestamp for expiry calculation |

### Per-User Position (`mapping(uint256 seasonId => mapping(address => UserPosition))`)

| Field | Type | Description |
|-------|------|-------------|
| `deposited` | uint256 | $SOF committed to rollover |
| `spent` | uint256 | $SOF spent on tickets (base, excluding bonus) |
| `refunded` | bool | Whether remaining balance was refunded |

## Contract Interface

### RolloverEscrow.sol — External Functions

```solidity
// Deposit (called by PrizeDistributor)
function deposit(address user, uint256 amount, uint256 seasonId) external;
// - Only DISTRIBUTOR_ROLE
// - Requires phase == OPEN
// - Verifies user participated in season via Raffle
// - Transfers $SOF from PrizeDistributor to escrow

// Spend (called by user via executeBatch for gasless tx)
function spendFromRollover(uint256 seasonId, uint256 amount) external;
// - msg.sender == user, nonReentrant
// - Requires phase == ACTIVE
// - amount <= deposited - spent
// - bonusAmount = amount * bonusBps / 10000
// - Pulls bonusAmount from treasury via safeTransferFrom
// - Calls curve.buyTokensFor(user, amount + bonusAmount)

// Refund (called by user)
function refund(uint256 seasonId) external;
// - msg.sender == user, nonReentrant
// - Requires phase == ACTIVE or CLOSED or EXPIRED
// - Returns deposited - spent to user (no bonus)
// - Sets refunded = true
```

### Admin Functions

```solidity
function openCohort(uint256 seasonId, uint16 bonusBps) external;       // ADMIN_ROLE
function activateCohort(uint256 seasonId, uint256 nextSeasonId) external; // ADMIN_ROLE
function closeCohort(uint256 seasonId) external;                         // ADMIN_ROLE
function setDefaultBonusBps(uint16 newBps) external;                     // ADMIN_ROLE
```

### View Functions

```solidity
function getUserPosition(uint256 seasonId, address user) external view returns (uint256 deposited, uint256 spent, bool refunded);
function getCohortState(uint256 seasonId) external view returns (EscrowPhase phase, uint256 nextSeasonId, uint16 bonusBps, uint256 totalDeposited, uint256 totalSpent, uint256 totalBonusPaid, uint40 openedAt);
function getAvailableBalance(uint256 seasonId, address user) external view returns (uint256);
function getBonusAmount(uint256 seasonId, uint256 amount) external view returns (uint256);
```

### Events

```solidity
event RolloverDeposit(address indexed user, uint256 indexed seasonId, uint256 amount);
event RolloverSpend(address indexed user, uint256 indexed seasonId, uint256 indexed nextSeasonId, uint256 baseAmount, uint256 bonusAmount);
event RolloverRefund(address indexed user, uint256 indexed seasonId, uint256 amount);
event CohortOpened(uint256 indexed seasonId, uint16 bonusBps);
event CohortActivated(uint256 indexed seasonId, uint256 indexed nextSeasonId);
event CohortClosed(uint256 indexed seasonId);
```

## Changes to Existing Contracts

### RafflePrizeDistributor.sol

Add `toRollover` boolean parameter to `claimConsolation()`:

- When `false`: existing behavior (transfer $SOF to user wallet)
- When `true`: call `escrow.deposit(user, amount, seasonId)` instead
- Requires `DISTRIBUTOR_ROLE` granted to PrizeDistributor on the escrow
- Approximately 15 lines changed

### SOFBondingCurve.sol

Add `buyTokensFor(address recipient, uint256 sofAmount)`:

- Same logic as `buyTokens` but mints RaffleTokens to `recipient` instead of `msg.sender`
- Only callable by `ESCROW_ROLE`
- Emits the standard `PositionUpdate` event with the recipient's address (so backend indexes correctly and user's transaction history is accurate)
- Approximately 20 lines added

## Edge Cases & Error Handling

| Scenario | Handling |
|----------|----------|
| Next season never starts | Auto-expires after `expiryTimeout` (30 days). All deposits refundable. Bonus pool returned to treasury. |
| Treasury balance insufficient for bonus | `safeTransferFrom` reverts naturally. Admin must ensure treasury has sufficient $SOF. Refund always works regardless. |
| User tries to deposit twice | PrizeDistributor marks claim as completed after first call. Second attempt reverts at distributor level. |
| Reentrancy on spend/refund | `nonReentrant` modifier. State updates before external calls. Checks-effects-interactions throughout. |
| Season cancelled (VRF timeout) | Cancelled seasons have no consolation prizes. Users sell tickets via sell-only curve. Escrow unaffected. |
| Emergency | `Pausable` — admin can pause deposits and spends. Refunds remain enabled even when paused. Users can always exit. |

## Security Checklist

- ReentrancyGuard on all state-changing external functions
- SafeERC20 for all token transfers
- AccessControl with minimal roles (ADMIN, DISTRIBUTOR, ESCROW on curve)
- Checks-effects-interactions pattern on spend and refund
- Bonus pulled directly from treasury — no minting, no unbacked promises, no pre-funding step
- Refund always available (ACTIVE, CLOSED, EXPIRED) — users can never be locked out
- Expiry timeout prevents indefinite lock if next season never starts
- Pausable for emergency stops (refunds still enabled)
- No delegatecall, no selfdestruct, no assembly
- Integer overflow safe (Solidity 0.8+)

## Testing Strategy

Tests written before implementation (TDD). Using Foundry forge-std, matching existing project patterns.

### Unit Tests (`test/RolloverEscrow.t.sol`)

**Deposit:**
- `testDeposit_happyPath`
- `testDeposit_revertIfNotDistributorRole`
- `testDeposit_revertIfPhaseNotOpen`
- `testDeposit_revertIfUserDidNotParticipate`
- `testDeposit_revertIfZeroAmount`

**Spend:**
- `testSpend_happyPath_bonusApplied`
- `testSpend_partialSpend_remainderRefundable`
- `testSpend_revertIfPhaseNotActive`
- `testSpend_revertIfExceedsBalance`
- `testSpend_revertIfTreasuryBalanceInsufficient`

**Refund:**
- `testRefund_fromActive_returnsUnspent`
- `testRefund_fromClosed_returnsUnspent`
- `testRefund_fromExpired_returnsFull`
- `testRefund_revertIfAlreadyRefunded`
- `testRefund_revertIfNothingToRefund`

### State Machine Tests

- `testPhaseTransition_open_to_active`
- `testPhaseTransition_active_to_closed`
- `testPhaseTransition_open_to_expired_afterTimeout`
- `testPhaseTransition_revertInvalidTransitions`
- `testExpiry_autoDetectedOnInteraction`

### Admin & Accounting Tests

- `testCloseCohort_onlyAdmin`
- `testBonusAccounting_totalBonusPaidMatchesSumOfUserBonuses`
- `testSpend_pullsBonusFromTreasury`
- `testSetDefaultBonusBps_onlyAdmin`

### Integration Tests (add to `FullSeasonFlow.t.sol`)

- `testFullRolloverCycle_depositSpendRefund`
- `testTwoConsecutiveRollovers_userPlaysThreeSeasons`
- `testRolloverEligibility_skippedSeasonBreaksChain`
- `testBuyTokensFor_curveMintsToCorrectUser`
- `testClaimConsolation_toRolloverTrue_depositsToEscrow`

## Frontend Integration Notes

- Rollover-funded purchases use `executeBatch` with single `spendFromRollover` call (gasless via ERC-7702/Pimlico paymaster)
- Ticket purchase UI offers "Pay from Rollover" / "Pay from Wallet" funding source selection
- `RolloverSpend` events must be indexed and displayed as visually distinct from regular purchases in transaction history and user profile pages
- View functions (`getAvailableBalance`, `getBonusAmount`) power the UI showing available rollover balance and projected bonus

## Out of Scope

- Loyalty tiers / streak multipliers (flat rate keeps it simple)
- Graduated unlocking phases (no exit penalties)
- Patience rewards (no time-locked bonus accrual)
- Treasury burn mechanics
- Recovery schedules for unclaimed assets
