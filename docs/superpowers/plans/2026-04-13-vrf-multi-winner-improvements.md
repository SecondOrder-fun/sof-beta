# VRF Multi-Winner Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove auto-finalization from VRF callback (predictable gas cost), add `maxParticipants` cap to SeasonConfig (gas safety), and update existing tests.

**Architecture:** Two contract changes to Raffle.sol: (1) strip `_tryAutoFinalize` from `fulfillRandomWords`, lower default gas limit, emit `SeasonReadyToFinalize` event; (2) add `maxParticipants` field to SeasonConfig with enforcement in `recordParticipant`. Both changes are backwards-compatible (existing seasons unaffected).

**Tech Stack:** Solidity 0.8.20 (Foundry), Chainlink VRF v2.5

**Spec:** `docs/superpowers/specs/2026-04-13-vrf-multi-winner-improvements.md`

---

## File Map

### Modified Files

| File | Change |
|------|--------|
| `packages/contracts/src/lib/RaffleTypes.sol:5-18` | Add `uint32 maxParticipants` to SeasonConfig struct |
| `packages/contracts/src/core/Raffle.sol:61` | Reduce `vrfCallbackGasLimit` default from 500000 to 200000 |
| `packages/contracts/src/core/Raffle.sol:401-425` | Remove `_tryAutoFinalize` call from `fulfillRandomWords`, add `SeasonReadyToFinalize` event |
| `packages/contracts/src/core/Raffle.sol:28-48` | Add `SeasonFull` error |
| `packages/contracts/src/core/Raffle.sol:564-596` | Add maxParticipants check in `recordParticipant` |
| `packages/contracts/src/core/Raffle.sol:220-229` | Add maxParticipants validation in `_createSeasonInternal` |
| `packages/contracts/src/core/RaffleStorage.sol:58-90` | Add `SeasonReadyToFinalize` event |
| `packages/contracts/test/RaffleVRF.t.sol` | Update tests for two-step finalization |
| `packages/contracts/test/Raffle.t.sol` | Add maxParticipants tests |

---

## Task 1: Remove Auto-Finalization from VRF Callback

**Files:**
- Modify: `packages/contracts/src/core/RaffleStorage.sol` (add event)
- Modify: `packages/contracts/src/core/Raffle.sol` (modify `fulfillRandomWords`, change gas default)
- Modify: `packages/contracts/test/RaffleVRF.t.sol` (update tests)

### Step 1: Add SeasonReadyToFinalize event

- [ ] **Step 1a: Add event to RaffleStorage.sol**

In `packages/contracts/src/core/RaffleStorage.sol`, after the `VRFFulfilled` event (line 78), add:

```solidity
    event SeasonReadyToFinalize(uint256 indexed seasonId);
```

### Step 2: Modify fulfillRandomWords

- [ ] **Step 2a: Remove auto-finalize and add event**

In `packages/contracts/src/core/Raffle.sol`, replace lines 401-425 (the `fulfillRandomWords` function) with:

```solidity
    function fulfillRandomWords(uint256 requestId, uint256[] calldata randomWords) internal override {
        uint256 seasonId = vrfRequestToSeason[requestId];
        if (seasonId == 0) revert VRFRequestNotFound(requestId);

        // Late VRF arrival for a cancelled season — ignore silently to avoid wasting VRF node gas
        if (seasonStates[seasonId].status == SeasonStatus.Cancelled) {
            return;
        }

        if (seasonStates[seasonId].status != SeasonStatus.VRFPending) {
            revert InvalidSeasonStatus(seasonId, uint8(seasonStates[seasonId].status), uint8(SeasonStatus.VRFPending));
        }

        SeasonState storage state = seasonStates[seasonId];
        delete state.vrfRandomWords;
        for (uint256 i = 0; i < randomWords.length; i++) {
            state.vrfRandomWords.push(randomWords[i]);
        }

        state.status = SeasonStatus.Distributing;
        emit VRFFulfilled(seasonId, requestId);
        emit SeasonReadyToFinalize(seasonId);
    }
```

The key change: removed `_tryAutoFinalize(seasonId)` call. Added `SeasonReadyToFinalize` event for backend listeners.

- [ ] **Step 2b: Reduce default callback gas limit**

In `packages/contracts/src/core/Raffle.sol`, line 61, change:

```solidity
    uint32 public vrfCallbackGasLimit = 500000;
```

to:

```solidity
    uint32 public vrfCallbackGasLimit = 200000;
```

### Step 3: Update VRF tests

- [ ] **Step 3a: Update testAutoFinalizeOnVRFCallback**

In `packages/contracts/test/RaffleVRF.t.sol`, find the test `testAutoFinalizeOnVRFCallback` and rename/rewrite it to verify the two-step flow. The VRF callback should leave the season in `Distributing` state, then a separate `finalizeSeason()` call completes it.

Find the test and replace it with:

```solidity
    function testVRFCallbackDoesNotAutoFinalize() public {
        // Setup: create season, add participants, request VRF
        _setupSeasonWithParticipants();
        _requestSeasonEnd();

        // Simulate VRF callback
        _fulfillVRF();

        // Season should be in Distributing, NOT Completed
        (,,,, RaffleStorage.SeasonStatus status) = _getSeasonState(seasonId);
        assertEq(uint8(status), uint8(RaffleStorage.SeasonStatus.Distributing), "Should be Distributing after VRF");

        // Now finalize separately
        raffle.finalizeSeason(seasonId);

        // Now it should be Completed
        (,,,, RaffleStorage.SeasonStatus finalStatus) = _getSeasonState(seasonId);
        assertEq(uint8(finalStatus), uint8(RaffleStorage.SeasonStatus.Completed), "Should be Completed after finalize");
    }
```

Note: adapt this to match the exact test helper functions used in the existing `RaffleVRF.t.sol`. Read the file to find the setup pattern.

- [ ] **Step 3b: Update testManualFinalizeStillWorksAsFallback**

This test should still pass as-is since we're now ALWAYS using manual finalization. Verify it still passes. If it was testing the fallback-after-auto-fail path, simplify it to just test the standard two-step flow.

- [ ] **Step 3c: Run tests**

Run: `cd packages/contracts && forge test --match-contract RaffleVRF -vvv`
Expected: All tests pass.

- [ ] **Step 3d: Commit**

```bash
git add packages/contracts/src/core/Raffle.sol \
  packages/contracts/src/core/RaffleStorage.sol \
  packages/contracts/test/RaffleVRF.t.sol
git commit -m "feat(contracts): remove auto-finalization from VRF callback (M-1)

fulfillRandomWords now only stores random words and transitions to
Distributing. finalizeSeason() must be called separately.
Reduces callback gas from 500K to 200K. Adds SeasonReadyToFinalize
event for backend listeners."
```

---

## Task 2: Add maxParticipants to SeasonConfig

**Files:**
- Modify: `packages/contracts/src/lib/RaffleTypes.sol`
- Modify: `packages/contracts/src/core/Raffle.sol`
- Modify: `packages/contracts/test/Raffle.t.sol`

### Step 1: Add field to struct and constants/error to Raffle

- [ ] **Step 1a: Add maxParticipants to SeasonConfig**

In `packages/contracts/src/lib/RaffleTypes.sol`, add `uint32 maxParticipants` after the `gated` field:

```solidity
    struct SeasonConfig {
        string name;
        uint256 startTime;
        uint256 endTime;
        uint16 winnerCount;
        uint16 grandPrizeBps;
        address treasuryAddress;
        address raffleToken;
        address bondingCurve;
        address sponsor;
        bool isActive;
        bool isCompleted;
        bool gated;
        uint32 maxParticipants; // 0 = use default; capped at ABSOLUTE_MAX_PARTICIPANTS
    }
```

- [ ] **Step 1b: Add error and constants to Raffle.sol**

In `packages/contracts/src/core/Raffle.sol`, after the existing errors (around line 48), add:

```solidity
error SeasonFull(uint256 seasonId, uint32 maxParticipants);
```

After `MAX_WINNER_COUNT` (line 70), add:

```solidity
    uint32 public defaultMaxParticipants = 10000;
    uint32 public constant ABSOLUTE_MAX_PARTICIPANTS = 50000;
```

### Step 2: Add validation in season creation

- [ ] **Step 2a: Validate maxParticipants in _createSeasonInternal**

In `packages/contracts/src/core/Raffle.sol`, in `_createSeasonInternal`, after the winnerCount validation (line 229), add:

```solidity
        // Apply default maxParticipants if not set, and validate ceiling
        if (config.maxParticipants == 0) {
            config.maxParticipants = defaultMaxParticipants;
        }
        if (config.maxParticipants > ABSOLUTE_MAX_PARTICIPANTS) {
            config.maxParticipants = ABSOLUTE_MAX_PARTICIPANTS;
        }
```

### Step 3: Enforce in recordParticipant

- [ ] **Step 3a: Add participant cap check**

In `packages/contracts/src/core/Raffle.sol`, in `recordParticipant` (around line 584), inside the `if (!pos.isActive)` block, add the cap check BEFORE adding the participant:

```solidity
        if (!pos.isActive) {
            // Check participant cap
            uint32 maxP = seasons[seasonId].maxParticipants;
            if (maxP > 0 && state.totalParticipants >= maxP) {
                revert SeasonFull(seasonId, maxP);
            }
            state.participants.push(participant);
            state.totalParticipants++;
            pos.entryBlock = block.number;
            pos.isActive = true;
            emit ParticipantAdded(seasonId, participant, ticketAmount, newTotalTickets);
```

- [ ] **Step 3b: Compile**

Run: `cd packages/contracts && forge build`
Expected: Compiles (may have pre-existing Yul error, but our contracts compile).

### Step 4: Write tests

- [ ] **Step 4a: Add maxParticipants tests to Raffle.t.sol**

In `packages/contracts/test/Raffle.t.sol`, add these tests. Adapt the setup pattern from the existing test file (use the same helper functions and deploy pattern):

```solidity
    function testMaxParticipants_RejectsWhenFull() public {
        // Create a season with maxParticipants = 2
        // Add 2 participants (should succeed)
        // Try to add 3rd participant (should revert with SeasonFull)
    }

    function testMaxParticipants_ZeroUsesDefault() public {
        // Create a season with maxParticipants = 0
        // Verify the stored config has defaultMaxParticipants (10000)
    }

    function testMaxParticipants_ExistingParticipantCanBuyMore() public {
        // Create a season with maxParticipants = 2
        // Add 2 participants
        // First participant buys more tickets (should succeed — cap only affects new entrants)
    }

    function testMaxParticipants_CappedAtAbsoluteMax() public {
        // Create a season with maxParticipants = 100000 (exceeds ABSOLUTE_MAX)
        // Verify stored value is capped at ABSOLUTE_MAX_PARTICIPANTS (50000)
    }
```

Note: Read the existing `Raffle.t.sol` to understand the exact setup helpers (`_createSeason`, etc.) and replicate the pattern. The tests need to create seasons, have players buy tickets through the bonding curve, and verify the cap enforcement.

- [ ] **Step 4b: Run tests**

Run: `cd packages/contracts && forge test --match-contract RaffleTest -vvv`
Expected: All tests pass including new maxParticipants tests.

- [ ] **Step 4c: Run full suite**

Run: `cd packages/contracts && forge test`
Expected: All tests pass (250+ total). The struct change may require updating other test files that construct SeasonConfig — add `maxParticipants: 0` to any existing SeasonConfig literals.

- [ ] **Step 4d: Commit**

```bash
git add packages/contracts/src/lib/RaffleTypes.sol \
  packages/contracts/src/core/Raffle.sol \
  packages/contracts/test/Raffle.t.sol
git commit -m "feat(contracts): add maxParticipants to SeasonConfig (M-3)

Optional per-season participant cap for gas safety. Defaults to
10,000, hard ceiling at 50,000. Enforced at participant registration
time — existing participants can always buy more tickets."
```

---

## Task 3: Version Bump & Task Updates

**Files:**
- Modify: `packages/contracts/package.json`
- Modify: `instructions/project-tasks.md`

- [ ] **Step 1: Bump contracts version**

In `packages/contracts/package.json`, change version from `0.16.1` to `0.17.0` (minor — new feature).

- [ ] **Step 2: Update project-tasks.md**

Mark M-1, M-2, M-3 as done:

```markdown
### VRF / Multi-Winner Expansion
- [x] **M-1**: Remove auto-finalization from VRF callback, reduce gas to 200K
- [x] **M-2**: Validate `requestSeasonEnd` idempotency (verified — no changes needed)
- [x] **M-3**: Add optional `maxParticipants` to SeasonConfig (default 10K, ceiling 50K)
```

- [ ] **Step 3: Commit**

```bash
git add packages/contracts/package.json instructions/project-tasks.md
git commit -m "chore: bump contracts to 0.17.0, update VRF task tracking"
```

---

## Execution Order

| Task | Dependency |
|------|-----------|
| 1. Remove auto-finalize from VRF callback | None |
| 2. Add maxParticipants to SeasonConfig | None (independent of Task 1) |
| 3. Version bump & task updates | Tasks 1, 2 |

**Tasks 1 and 2 can run in parallel** but will both modify `Raffle.sol`, so sequential execution is safer to avoid merge conflicts.
