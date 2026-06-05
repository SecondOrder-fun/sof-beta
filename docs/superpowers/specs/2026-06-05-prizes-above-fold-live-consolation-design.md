# Design: Promote prizes above the fold + live consolation ticker

**Issue:** #106 — "Consolation pool: switch to live SSE ticker when promoted above the fold"
**Date:** 2026-06-05
**Status:** Approved design, pending implementation plan

## Problem

The Grand Prize / Consolation Pool distribution currently lives inside the
`TokenInfoTab` ("Activity & Details" tabbed card), below the fold on the active
Raffle Detail page. Issue #106 was filed as gated future-work: *if* the layout
is redesigned to promote the consolation pool above the fold, the static
mount-only cache (`useConsolationStatus` with `staleTime: Infinity`) would feel
dead, and a live participant ticker should reinforce the "pool grows as more
people play" mental model.

This work makes that layout decision and ships the live ticker in the same pass,
so the promoted panel is never a "dead" static display.

## Scope

In scope (one PR):

1. **Layout move** — promote a combined Grand + Consolation prize card above the
   fold, into the active-season right column directly under `BuySellWidget`.
2. **Live consolation ticker** — the actual #106 deliverable: a new
   `ConsolationPoolUpdated` SSE projection on the existing `raffle` channel
   driving a live participant count, plus the frontend hook wiring.
3. **Transaction overlay** — replace the two center-screen buy/sell
   `TransactionModal` dialogs with an overlay scoped to the `BuySellWidget`.

Explicitly deferred (later pass, per user):

- Fine-tuning the exact bonding-curve height bump. First pass scales it up
  ~12–15%; visual polish comes after the first implementation pass.

## Affected layout (active, desktop)

Today the active-season body is a `grid grid-cols-1 lg:grid-cols-3` row:

- Bonding Curve card → `lg:col-span-2`
- Right column (`1/3`) → `BuySellWidget` + "Your Current Position"

After:

- Bonding Curve card → `lg:col-span-2`, ~12–15% taller
- Right column (`1/3`) → `BuySellWidget` + "Your Current Position" + **new
  `PrizePoolCard`** stacked below
- The "Prize Pool Distribution" block is **removed** from `TokenInfoTab`

Mobile (`MobileRaffleDetail`) is out of scope for this pass; verify it is
unaffected by the shared-helper extraction.

## Architecture — three independent units

### Unit 1 — `PrizePoolCard` (layout move)

**New component:** `packages/frontend/src/components/prizes/PrizePoolCard.jsx`

A single combined card rendered in the active right column. Fields (confirmed via
mockup):

- 🏆 **Grand Prize** — 65% of reserves
- 🎁 **Consolation Pool** — 35% of reserves (total)
- **Per-player share** — consolation ÷ (participants − 1)
- **Players** — live count (driven by Unit 2), with a "live" affordance

**Data sources (active season):**

- Grand / Consolation amounts derive from **live curve reserves**
  (`curveReserves`), already computed in `RaffleDetails.jsx` via `useCurveState`
  and already kept live by its existing `raffle`-channel `PositionUpdate`
  subscription. Reserves are passed into `PrizePoolCard` as a prop.
- Participant count comes live from Unit 2.

**Shared math helper:** `packages/frontend/src/lib/prizeMath.js`

The Grand/Consolation bps math is currently inline in `TokenInfoTab.jsx`
(`grandPrizeBps = 6500n`, lines ~111–131). Extract to a shared helper:

```js
// prizeMath.js
export const GRAND_PRIZE_BPS = 6500n; // 65% — contract default
export function splitPrizePool(reservesWei) {
  const grand = (reservesWei * GRAND_PRIZE_BPS) / 10000n;
  return { grandWei: grand, consolationWei: reservesWei - grand };
}
export function perLoserShareWei(consolationWei, totalParticipants) {
  const losers = totalParticipants > 1n ? totalParticipants - 1n : 0n;
  return consolationWei > 0n && losers > 0n ? consolationWei / losers : 0n;
}
```

Both `PrizePoolCard` and `TokenInfoTab` consume this helper (no duplicated bps).

**TokenInfoTab change:** remove the "Prize Pool Distribution" section (lines
~214–245). Active seasons now show it above the fold; completed seasons already
surface winner + consolation via `CompletedRaffleResults`. Verify the completed
view loses nothing user-facing.

### Unit 2 — Live consolation data

**Backend** — `packages/backend/src/listeners/positionUpdateListener.js`

The listener already reads curve reserves and broadcasts a `PositionUpdate`
event on the `raffle` channel. Extend it to ALSO broadcast a companion event
when the season is **Active**:

```js
sseService.broadcast('raffle', {
  type: 'ConsolationPoolUpdated',
  seasonId: seasonIdNum,
  totalParticipants,        // number — from getSeasonDetails / season_contracts
  totalPoolWei,             // string — curve reserves (full pool)
  blockNumber: Number(log.blockNumber),
  txHash: log.transactionHash,
});
```

- `totalParticipants` — unique ticket holders, sourced from
  `Raffle.getSeasonDetails(seasonId)` (index `[2]`) or the `season_contracts`
  row; whichever is already loaded in the listener path with least extra RPC.
- `totalPoolWei` — the full reserves (the frontend derives Grand/Consolation by
  bps via `prizeMath`). Included to satisfy issue AC#1's
  `{ seasonId, totalParticipants, totalPoolWei }` shape even though reserves are
  also delivered by the existing `PositionUpdate` curve-state path.
- **Active-gate:** only emit while season status is Active (status `1`). No emit
  for pre-start, settling, completed, or cancelled.

Reuses the existing `raffle` channel — **no new SSE channel** is added (issue
AC#1 says "to the raffle SSE channel").

**Frontend** — `packages/frontend/src/hooks/useConsolationStatus.js`

Extend the hook signature to `useConsolationStatus(seasonId, { isActive })` and
split behavior by season phase (issue AC#2 + AC#3):

- **Active season:**
  - `totalParticipants` becomes a live value. A warm query keyed
    `['consolationPool', seasonId]` is invalidated by a `useLiveSubscription`
    consumer on the `raffle` channel filtered to
    `e.type === 'ConsolationPoolUpdated' && e.seasonId === seasonId` — mirroring
    the `useCurveState` invalidate-on-event pattern.
  - `totalPoolWei` / Grand / Consolation derive from live `curveReserves` (the
    card already has reserves), not the distributor snapshot (which is empty
    pre-settlement).
- **Completed season:** unchanged — distributor settlement snapshot via
  `useRafflePrizes`, `staleTime: Infinity` (data is immutable).
- **Claim-status reads** (`isEligibleForConsolation`, `hasClaimedConsolation`)
  stay `staleTime: Infinity` in BOTH phases (AC#3) — they're user-specific and
  flip only on the viewer's own claim tx (already invalidated by
  `touches: [distributorAddress]`).

### Unit 3 — `TransactionStatusOverlay`

**New component:**
`packages/frontend/src/components/buysell/TransactionStatusOverlay.jsx`

Replaces the two `<TransactionModal>` instances at the bottom of
`BuySellWidget.jsx` (lines ~491–498). Absolutely positioned over the already-
`relative` `BuySellWidget` container — same pattern as the existing
`TradingStatusOverlay` / `SignInRequiredOverlay`.

**State machine (driven by the buy/sell mutation status):**

| State | Render | Lifecycle |
|-------|--------|-----------|
| pending | spinner + "Buying/Selling tickets…" + "Confirm in wallet" | until tx settles |
| success | ✓ + "Tickets purchased/sold" + explorer link + decay bar | **auto-decay 4s**, or ✕ |
| error | ✕ + title + `extractErrorDetails` message | **stays until ✕** (no auto-decay) |

- ✕ dismiss available in all states.
- **Blocks click-through** to the widget underneath while visible (prevents
  double-submit during pending). Confirmed by user.
- Reuses the explorer-URL builder and `extractErrorDetails` logic currently in
  `TransactionModal.jsx`.
- `TransactionModal` itself is **kept** — it's still used by admin flows
  (`components/admin/*`). Only `BuySellWidget`'s usage is replaced.

Two overlays (buy + sell) collapse to one in practice: only one mutation is
in-flight at a time, so a single overlay reads whichever of buy/sell status is
active.

## Data flow (active season, on a buy)

```
on-chain PositionUpdate
   ↓ (backend listener)
broadcast 'raffle' { PositionUpdate, … }  →  useCurveState invalidates curve reserves
broadcast 'raffle' { ConsolationPoolUpdated, totalParticipants, totalPoolWei }
   ↓ (frontend)                              →  useConsolationStatus invalidates ['consolationPool', seasonId]
PrizePoolCard re-renders:
   Grand   = splitPrizePool(liveReserves).grandWei
   Consol. = splitPrizePool(liveReserves).consolationWei
   Players = live totalParticipants
   Share   = perLoserShareWei(consolationWei, totalParticipants)
```

## Error handling

- **SSE drop:** `useLiveSubscription` reconnects with backoff (existing
  `sseRegistry`). On reconnect the warm query refetches; participant count
  self-heals. Stale count between drop and reconnect is acceptable (read-only
  display).
- **Backend read failure** (getSeasonDetails throws): skip the
  `ConsolationPoolUpdated` emit for that event; never throw out of the listener
  (would drop the `PositionUpdate` too). Log and continue.
- **Overlay error state:** surfaces `extractErrorDetails`, persists until
  dismissed.

## Testing (TDD)

**Frontend:**

- `prizeMath` — `splitPrizePool` / `perLoserShareWei` unit tests (incl.
  participants ≤ 1 → 0 share; zero reserves).
- `PrizePoolCard` — renders Grand/Consolation from reserves prop; per-player
  share; participant count; updates when the live participant value changes.
- `TransactionStatusOverlay` — state machine: pending→success shows decay +
  auto-hides after 4s (fake timers); error persists until ✕; ✕ dismiss; blocks
  pointer events while visible.
- `useConsolationStatus` — active path live-subscribes + invalidates on
  `ConsolationPoolUpdated`; completed path unchanged snapshot; claim reads stay
  `staleTime: Infinity`.

**Backend:**

- `positionUpdateListener` — emits `ConsolationPoolUpdated` with correct
  `{ seasonId, totalParticipants, totalPoolWei }` while Active; does NOT emit
  for non-Active statuses; a thrown read does not drop the `PositionUpdate`
  broadcast.

## Versioning

- `@sof/frontend` — **minor** bump (new feature)
- `@sof/backend` — **minor** bump (new SSE projection)

## i18n

All new user-facing strings (`Grand Prize`, `Consolation Pool`, `Per-player
share`, `Players`, overlay status text) via `react-i18next`. Hooks return data;
components translate.

## Out of scope / follow-ups

- Bonding-curve height fine-tuning (deferred to a later visual pass).
- Mobile prize-card promotion (this pass is desktop layout only).
- Issue #106 is fully closed by this PR (`Closes #106`).
