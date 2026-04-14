# VRF Multi-Winner Improvements

**Date:** 2026-04-13
**Status:** Approved design
**Scope:** `packages/contracts/` — Raffle.sol, RaffleTypes.sol, RaffleStorage.sol, RaffleLogic.sol

## Problem

Three issues with the current multi-winner VRF system:

1. **M-1:** The VRF callback attempts auto-finalization (`_tryAutoFinalize`) inside the callback. For multi-winner seasons with many participants, this can exceed the `vrfCallbackGasLimit` (500K default). The fallback exists (manual `finalizeSeason()`), but auto-finalization is the primary path and its failure is treated as exceptional rather than expected.

2. **M-2:** `requestSeasonEnd` idempotency — verified as already handled. The status state machine (`Active` → `EndRequested` → `VRFPending`) prevents double VRF requests. Manual finalization using stored random words is the correct recovery path. No changes needed.

3. **M-3:** No participant cap exists. The participant list grows unboundedly, which affects finalization gas costs (O(n) prefix sum, O(n) memory allocation). Need an optional per-season `maxParticipants` for gas safety.

## Changes

### M-1: Remove Auto-Finalization from VRF Callback

**Current behavior:** `fulfillRandomWords` stores random words, transitions to `Distributing`, then calls `_tryAutoFinalize()` in a try/catch. If it succeeds, season completes in one transaction. If it fails, manual `finalizeSeason()` is needed.

**New behavior:** `fulfillRandomWords` stores random words, transitions to `Distributing`, and returns. `finalizeSeason()` is always called separately. This makes the two-step flow (VRF callback → finalize) the standard path, not a fallback.

**Rationale:**
- VRF callback gas is paid from the LINK subscription. Lower gas = lower cost per season.
- Separating makes gas cost predictable regardless of winner count or participant count.
- The backend already has infrastructure to call `finalizeSeason()` (it monitors VRF events).
- Removes a code path that is hard to test (callback gas limit failures).

**Changes:**
- In `fulfillRandomWords`: remove the `_tryAutoFinalize(seasonId)` call and its try/catch wrapper
- Reduce `vrfCallbackGasLimit` default from 500,000 to 200,000 (storing words + status change only)
- Keep `finalizeSeason()` as-is — it already works correctly
- Add an event `SeasonReadyToFinalize(uint256 indexed seasonId)` so the backend knows when to call `finalizeSeason()`

### M-2: No Changes (Verified)

`requestSeasonEnd` is already idempotent via the status state machine. Documented as verified.

### M-3: Add `maxParticipants` to SeasonConfig

**Design:**
- Add `uint32 maxParticipants` to `SeasonConfig` struct (after `gated` field)
- `0` means unlimited (backwards compatible with existing seasons)
- Enforced at participant registration time in Raffle — when a new address buys tickets for the first time, check `totalParticipants < maxParticipants` (or maxParticipants == 0)
- Add `uint32 public defaultMaxParticipants = 10000` to Raffle — used when season creator sets 0
- Add `uint32 public constant ABSOLUTE_MAX_PARTICIPANTS = 50000` — hard ceiling nobody can exceed
- Season creators can set any value from 1 to ABSOLUTE_MAX_PARTICIPANTS
- Existing participants can always buy more tickets (the cap only affects new entrants)

**Where to enforce:**
The participant count check belongs in the Raffle contract's internal function that registers new participants (called when processing a buy from a new address). This is `_registerParticipant` or equivalent — the point where `totalParticipants` increments and the address is added to the `participants` array.

**Error:**
```solidity
error SeasonFull(uint256 seasonId, uint32 maxParticipants);
```

## Non-Goals

- Changing the winner selection algorithm (hash-and-extend with binary search is correct)
- Changing the VRF timeout recovery mechanism (48h + `cancelStuckSeason` is correct)
- Adding UI for maxParticipants display (separate frontend task)
- Re-requesting VRF after failure (intentionally prevented — re-roll attack vector)

## Testing

- Update `fulfillRandomWords` tests to verify it no longer auto-finalizes
- Add test: VRF callback only stores words and transitions to `Distributing`
- Add test: `finalizeSeason()` must be called separately after VRF callback
- Add test: season with `maxParticipants = 3` rejects 4th participant
- Add test: `maxParticipants = 0` allows unlimited participants
- Add test: existing participants can buy more tickets even when season is full
- Add test: `maxParticipants` above ABSOLUTE_MAX_PARTICIPANTS is rejected at season creation

## Migration

- Existing deployed seasons have no `maxParticipants` field. Since we're adding it to the struct with a default of 0 (unlimited), existing seasons are unaffected.
- The `vrfCallbackGasLimit` change only affects new VRF requests. Pending VRF requests use their original gas limit.
- The backend needs to be updated to call `finalizeSeason()` after detecting the `SeasonReadyToFinalize` event. Currently, the backend may rely on auto-finalization completing in the callback. This backend change is minimal — add an event listener that calls `finalizeSeason()` when `SeasonReadyToFinalize` fires.
