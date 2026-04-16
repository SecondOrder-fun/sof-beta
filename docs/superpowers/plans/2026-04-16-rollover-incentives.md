# Rollover Incentives Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a `RolloverEscrow` contract that lets users commit consolation winnings to the next season and receive a 6% bonus when they buy tickets.

**Architecture:** Standalone `RolloverEscrow.sol` contract. PrizeDistributor gets a `toRollover` param on `claimConsolation`. BondingCurve gets a `buyTokensFor` method. Escrow pulls bonus $SOF directly from treasury on each spend.

**Tech Stack:** Solidity ^0.8.20, Foundry, OpenZeppelin (AccessControl, ReentrancyGuard, SafeERC20, Pausable)

**Spec:** `docs/superpowers/specs/2026-04-16-rollover-incentives-design.md`

---

## File Structure

| Action | Path | Responsibility |
|--------|------|---------------|
| Create | `packages/contracts/src/core/RolloverEscrow.sol` | Escrow contract: deposit, spend, refund, lifecycle |
| Create | `packages/contracts/src/core/IRolloverEscrow.sol` | Interface for cross-contract references |
| Create | `packages/contracts/test/RolloverEscrow.t.sol` | Unit + state machine tests |
| Create | `packages/contracts/test/RolloverIntegration.t.sol` | Multi-season integration tests |
| Create | `packages/contracts/script/deploy/16_DeployRolloverEscrow.s.sol` | Deployment script |
| Modify | `packages/contracts/src/core/RafflePrizeDistributor.sol:190-210` | Add `toRollover` param to `claimConsolation` |
| Modify | `packages/contracts/src/curve/SOFBondingCurve.sol:187-256` | Add `buyTokensFor(recipient, amount)` |
| Modify | `packages/contracts/script/deploy/DeployedAddresses.sol` | Add `rolloverEscrow` field |
| Modify | `packages/contracts/script/deploy/14_ConfigureRoles.s.sol` | Wire escrow roles |
| Modify | `packages/contracts/script/deploy/DeployAll.s.sol` | Add step 16 to deploy chain |

---

### Task 1: Add `buyTokensFor` to SOFBondingCurve

The escrow needs to buy tickets on behalf of users. Add a role-gated `buyTokensFor` function to the bonding curve.

**Files:**
- Modify: `packages/contracts/src/curve/SOFBondingCurve.sol:187-256`
- Test: `packages/contracts/test/RolloverEscrow.t.sol` (created here, expanded in later tasks)

- [ ] **Step 1: Write the failing test for `buyTokensFor`**

Create `packages/contracts/test/RolloverEscrow.t.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {SOFToken} from "../src/token/SOFToken.sol";
import {RaffleToken} from "../src/token/RaffleToken.sol";
import {SOFBondingCurve} from "../src/curve/SOFBondingCurve.sol";
import {RaffleTypes} from "../src/lib/RaffleTypes.sol";

contract RolloverEscrowTest is Test {
    SOFToken sofToken;
    RaffleToken raffleToken;
    SOFBondingCurve curve;

    address admin = makeAddr("admin");
    address escrow = makeAddr("escrow");
    address treasury = makeAddr("treasury");
    address buyer = makeAddr("buyer");
    address recipient = makeAddr("recipient");

    uint256 constant INITIAL_SOF = 1_000_000e18;
    uint256 constant TICKET_PRICE = 1e18;

    function setUp() public {
        vm.startPrank(admin);

        sofToken = new SOFToken("SOF", "SOF", INITIAL_SOF);
        sofToken.transfer(escrow, 100_000e18);

        curve = new SOFBondingCurve(address(sofToken), admin);

        raffleToken = new RaffleToken(
            "Season 1 Ticket", "SOF-1",
            1, "Season 1",
            block.timestamp, block.timestamp + 7 days
        );

        raffleToken.grantRole(raffleToken.MINTER_ROLE(), address(curve));
        raffleToken.grantRole(raffleToken.BURNER_ROLE(), address(curve));

        RaffleTypes.BondStep[] memory steps = new RaffleTypes.BondStep[](1);
        steps[0] = RaffleTypes.BondStep({rangeTo: 1000, price: TICKET_PRICE});

        curve.initializeCurve(address(raffleToken), steps, 100, 100, treasury);

        // Grant ESCROW_ROLE to escrow address
        curve.grantRole(curve.ESCROW_ROLE(), escrow);

        vm.stopPrank();
    }

    function test_buyTokensFor_mintsToRecipient() public {
        uint256 tokenAmount = 5;
        uint256 maxSof = 10e18;

        // Escrow approves curve to spend SOF
        vm.prank(escrow);
        sofToken.approve(address(curve), maxSof);

        // Escrow calls buyTokensFor on behalf of recipient
        vm.prank(escrow);
        curve.buyTokensFor(recipient, tokenAmount, maxSof);

        // Recipient should have the tickets
        assertEq(raffleToken.balanceOf(recipient), tokenAmount);
        // Escrow should have paid the SOF
        assertLt(sofToken.balanceOf(escrow), 100_000e18);
    }

    function test_buyTokensFor_revertIfNotEscrowRole() public {
        vm.prank(buyer);
        vm.expectRevert();
        curve.buyTokensFor(recipient, 1, 10e18);
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/contracts && forge test --match-test "test_buyTokensFor" -v`
Expected: Compilation error — `ESCROW_ROLE` and `buyTokensFor` don't exist yet.

- [ ] **Step 3: Add `ESCROW_ROLE` and `buyTokensFor` to SOFBondingCurve**

In `packages/contracts/src/curve/SOFBondingCurve.sol`, add the role constant near line 49 (after `EMERGENCY_ROLE`):

```solidity
bytes32 public constant ESCROW_ROLE = keccak256("ESCROW_ROLE");
```

Add the public function near line 189 (after `buyTokens`):

```solidity
function buyTokensFor(address recipient, uint256 tokenAmount, uint256 maxSofAmount)
    external
    nonReentrant
    whenNotPaused
    onlyRole(ESCROW_ROLE)
{
    _buyTokensFor(msg.sender, recipient, tokenAmount, maxSofAmount);
}
```

Add the internal function. This reuses the existing `_buyTokens` logic but separates the payer from the recipient. Add near the end of the internal functions section:

```solidity
function _buyTokensFor(address payer, address recipient, uint256 tokenAmount, uint256 maxSofAmount) internal {
    if (!curveConfig.initialized) revert CurveNotInitialized();
    if (curveConfig.tradingLocked) revert TradingLocked();
    if (curveConfig.sellOnly) revert TradingSellOnly();
    if (tokenAmount == 0) revert AmountZero();

    uint256 baseCost = calculateBuyPrice(tokenAmount);
    uint256 fee = (baseCost * curveConfig.buyFee) / 10000;
    uint256 totalCost = baseCost + fee;
    if (totalCost > maxSofAmount) revert SlippageExceeded(totalCost, maxSofAmount);

    uint256 oldTickets = playerTickets[recipient];

    // Transfer SOF from payer (the escrow)
    sofToken.safeTransferFrom(payer, address(this), totalCost);

    // Mint tickets to recipient
    _mintRaffleTokens(recipient, tokenAmount);

    // Update curve state
    curveConfig.totalSupply += tokenAmount;
    curveConfig.sofReserves += baseCost;
    accumulatedFees += fee;

    // Track tickets under recipient
    uint256 newTickets = oldTickets + tokenAmount;
    playerTickets[recipient] = newTickets;

    _updateCurrentStep();

    emit TokensPurchased(recipient, totalCost, tokenAmount, fee);

    uint256 totalTickets = curveConfig.totalSupply;
    uint256 newBps = totalTickets > 0 ? (newTickets * 10000) / totalTickets : 0;
    emit PositionUpdate(raffleSeasonId, recipient, oldTickets, newTickets, totalTickets, newBps);

    // Record participant in Raffle under recipient's address
    if (raffle != address(0)) {
        IRaffle(raffle).recordParticipant(raffleSeasonId, recipient, tokenAmount);
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/contracts && forge test --match-test "test_buyTokensFor" -v`
Expected: Both tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/curve/SOFBondingCurve.sol packages/contracts/test/RolloverEscrow.t.sol
git commit -m "feat(contracts): add buyTokensFor to SOFBondingCurve for escrow purchases"
```

---

### Task 2: Add `toRollover` param to PrizeDistributor `claimConsolation`

Modify the claim function so users can choose to send consolation to rollover instead of their wallet.

**Files:**
- Modify: `packages/contracts/src/core/RafflePrizeDistributor.sol:190-210`
- Create: `packages/contracts/src/core/IRolloverEscrow.sol`
- Test: `packages/contracts/test/RolloverEscrow.t.sol` (add tests)

- [ ] **Step 1: Create the IRolloverEscrow interface**

Create `packages/contracts/src/core/IRolloverEscrow.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IRolloverEscrow {
    function deposit(address user, uint256 amount, uint256 seasonId) external;
}
```

- [ ] **Step 2: Write the failing test for `claimConsolation` with `toRollover`**

Add to `packages/contracts/test/RolloverEscrow.t.sol` — a new test contract in the same file:

```solidity
import {RafflePrizeDistributor} from "../src/core/RafflePrizeDistributor.sol";
import {IRolloverEscrow} from "../src/core/IRolloverEscrow.sol";

contract MockRolloverEscrow is IRolloverEscrow {
    mapping(address => mapping(uint256 => uint256)) public deposits;

    function deposit(address user, uint256 amount, uint256 seasonId) external {
        deposits[user][seasonId] = amount;
    }
}

contract ClaimToRolloverTest is Test {
    SOFToken sofToken;
    RafflePrizeDistributor distributor;
    MockRolloverEscrow mockEscrow;

    address raffle = makeAddr("raffle");
    address grandWinner = makeAddr("grandWinner");
    address loser1 = makeAddr("loser1");
    address loser2 = makeAddr("loser2");

    uint256 constant SEASON_ID = 1;
    uint256 constant GRAND_AMOUNT = 650e18;
    uint256 constant CONSOLATION_AMOUNT = 350e18;
    uint256 constant TOTAL_PARTICIPANTS = 3;

    function setUp() public {
        sofToken = new SOFToken("SOF", "SOF", 1_000_000e18);
        distributor = new RafflePrizeDistributor(address(this));
        mockEscrow = new MockRolloverEscrow();

        // Grant RAFFLE_ROLE
        distributor.grantRole(distributor.RAFFLE_ROLE(), raffle);

        // Set rollover escrow
        distributor.setRolloverEscrow(address(mockEscrow));

        // Configure season
        vm.startPrank(raffle);
        distributor.configureSeason(
            SEASON_ID, address(sofToken), grandWinner,
            GRAND_AMOUNT, CONSOLATION_AMOUNT, TOTAL_PARTICIPANTS
        );

        address[] memory participants = new address[](2);
        participants[0] = loser1;
        participants[1] = loser2;
        distributor.setConsolationEligible(SEASON_ID, participants);
        vm.stopPrank();

        // Fund distributor
        sofToken.transfer(address(distributor), GRAND_AMOUNT + CONSOLATION_AMOUNT);
        vm.prank(raffle);
        distributor.fundSeason(SEASON_ID, GRAND_AMOUNT + CONSOLATION_AMOUNT);

        // Approve escrow to pull SOF from distributor
        // (distributor needs to approve escrow internally when toRollover=true)
    }

    function test_claimConsolation_toRollover_depositsInEscrow() public {
        uint256 expectedAmount = CONSOLATION_AMOUNT / 2; // 2 losers

        vm.prank(loser1);
        distributor.claimConsolation(SEASON_ID, true);

        // SOF should be in the escrow mock, not in loser1's wallet
        assertEq(sofToken.balanceOf(loser1), 0);
        assertEq(mockEscrow.deposits(loser1, SEASON_ID), expectedAmount);
    }

    function test_claimConsolation_toWallet_existingBehavior() public {
        uint256 expectedAmount = CONSOLATION_AMOUNT / 2;

        vm.prank(loser1);
        distributor.claimConsolation(SEASON_ID, false);

        // SOF should be in loser1's wallet
        assertEq(sofToken.balanceOf(loser1), expectedAmount);
        assertEq(mockEscrow.deposits(loser1, SEASON_ID), 0);
    }

    function test_claimConsolation_toRollover_revertIfNoEscrowSet() public {
        // Deploy a fresh distributor without escrow set
        RafflePrizeDistributor dist2 = new RafflePrizeDistributor(address(this));
        dist2.grantRole(dist2.RAFFLE_ROLE(), raffle);

        vm.startPrank(raffle);
        dist2.configureSeason(
            SEASON_ID, address(sofToken), grandWinner,
            GRAND_AMOUNT, CONSOLATION_AMOUNT, TOTAL_PARTICIPANTS
        );
        address[] memory p = new address[](1);
        p[0] = loser1;
        dist2.setConsolationEligible(SEASON_ID, p);
        vm.stopPrank();

        sofToken.transfer(address(dist2), GRAND_AMOUNT + CONSOLATION_AMOUNT);
        vm.prank(raffle);
        dist2.fundSeason(SEASON_ID, GRAND_AMOUNT + CONSOLATION_AMOUNT);

        vm.prank(loser1);
        vm.expectRevert();
        dist2.claimConsolation(SEASON_ID, true);
    }
}
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd packages/contracts && forge test --match-contract "ClaimToRolloverTest" -v`
Expected: Compilation error — `claimConsolation` doesn't accept a `bool` param, `setRolloverEscrow` doesn't exist.

- [ ] **Step 4: Modify RafflePrizeDistributor**

In `packages/contracts/src/core/RafflePrizeDistributor.sol`:

Add import at the top:

```solidity
import {IRolloverEscrow} from "./IRolloverEscrow.sol";
```

Add state variable (near other storage declarations):

```solidity
IRolloverEscrow public rolloverEscrow;

error RolloverEscrowNotSet();
```

Add setter function (admin only):

```solidity
function setRolloverEscrow(address escrow) external onlyRole(DEFAULT_ADMIN_ROLE) {
    rolloverEscrow = IRolloverEscrow(escrow);
}
```

Modify `claimConsolation` — change signature from `claimConsolation(uint256 seasonId)` to:

```solidity
function claimConsolation(uint256 seasonId, bool toRollover) external override nonReentrant {
    Season storage s = _seasons[seasonId];
    require(s.funded, "Distributor: not funded");
    require(msg.sender != s.grandWinner, "Distributor: winner cannot claim consolation");
    require(!_consolationClaimed[seasonId][msg.sender], "Distributor: already claimed");
    require(s.totalParticipants > 1, "Distributor: no other participants");

    if (!_consolationEligible[seasonId][msg.sender]) {
        revert NotAParticipant(seasonId, msg.sender);
    }

    uint256 loserCount = s.totalParticipants - 1;
    uint256 amount = s.consolationAmount / loserCount;
    require(amount > 0, "Distributor: amount zero");

    _consolationClaimed[seasonId][msg.sender] = true;

    if (toRollover) {
        if (address(rolloverEscrow) == address(0)) revert RolloverEscrowNotSet();
        IERC20(s.token).safeTransfer(address(rolloverEscrow), amount);
        rolloverEscrow.deposit(msg.sender, amount, seasonId);
    } else {
        IERC20(s.token).safeTransfer(msg.sender, amount);
    }

    emit ConsolationClaimed(seasonId, msg.sender, amount);
}
```

Also update the interface if `claimConsolation` is in an interface — check `IRafflePrizeDistributor` or the `override` keyword source and update the signature there too.

- [ ] **Step 5: Fix any existing tests that call `claimConsolation` without the bool param**

Existing tests in `packages/contracts/test/ConsolationClaims.t.sol` call `claimConsolation(seasonId)` — update all calls to `claimConsolation(seasonId, false)` to preserve existing behavior.

Run: `cd packages/contracts && grep -rn "claimConsolation(" test/`

Update each call site.

- [ ] **Step 6: Run all tests to verify everything passes**

Run: `cd packages/contracts && forge test -v`
Expected: All tests PASS (existing + new).

- [ ] **Step 7: Commit**

```bash
git add packages/contracts/src/core/IRolloverEscrow.sol packages/contracts/src/core/RafflePrizeDistributor.sol packages/contracts/test/RolloverEscrow.t.sol packages/contracts/test/ConsolationClaims.t.sol
git commit -m "feat(contracts): add toRollover param to claimConsolation, create IRolloverEscrow interface"
```

---

### Task 3: Build RolloverEscrow — Deposit and State Machine

Core escrow contract with deposit functionality and phase transitions.

**Files:**
- Create: `packages/contracts/src/core/RolloverEscrow.sol`
- Test: `packages/contracts/test/RolloverEscrow.t.sol` (add deposit + phase tests)

- [ ] **Step 1: Write failing tests for deposit and phase transitions**

Add to `packages/contracts/test/RolloverEscrow.t.sol`:

```solidity
import {RolloverEscrow} from "../src/core/RolloverEscrow.sol";

contract RolloverEscrowDepositTest is Test {
    SOFToken sofToken;
    RolloverEscrow escrow;

    address admin = makeAddr("admin");
    address distributorAddr = makeAddr("distributor");
    address treasury = makeAddr("treasury");
    address raffleAddr = makeAddr("raffle");
    address user1 = makeAddr("user1");

    uint256 constant SEASON_ID = 1;
    uint256 constant NEXT_SEASON_ID = 2;
    uint256 constant DEPOSIT_AMOUNT = 100e18;

    function setUp() public {
        vm.startPrank(admin);
        sofToken = new SOFToken("SOF", "SOF", 1_000_000e18);
        escrow = new RolloverEscrow(address(sofToken), treasury, raffleAddr);

        // Grant DISTRIBUTOR_ROLE
        escrow.grantRole(escrow.DISTRIBUTOR_ROLE(), distributorAddr);

        // Open cohort for season 1
        escrow.openCohort(SEASON_ID, 600); // 6% bonus

        // Fund distributor with SOF
        sofToken.transfer(distributorAddr, 10_000e18);
        vm.stopPrank();

        // Distributor approves escrow
        vm.prank(distributorAddr);
        sofToken.approve(address(escrow), type(uint256).max);
    }

    function test_deposit_happyPath() public {
        vm.prank(distributorAddr);
        escrow.deposit(user1, DEPOSIT_AMOUNT, SEASON_ID);

        (uint256 deposited, uint256 spent, bool refunded) = escrow.getUserPosition(SEASON_ID, user1);
        assertEq(deposited, DEPOSIT_AMOUNT);
        assertEq(spent, 0);
        assertFalse(refunded);
        assertEq(sofToken.balanceOf(address(escrow)), DEPOSIT_AMOUNT);
    }

    function test_deposit_revertIfNotDistributorRole() public {
        vm.prank(user1);
        vm.expectRevert();
        escrow.deposit(user1, DEPOSIT_AMOUNT, SEASON_ID);
    }

    function test_deposit_revertIfPhaseNotOpen() public {
        // Activate the cohort first
        vm.prank(admin);
        escrow.activateCohort(SEASON_ID, NEXT_SEASON_ID);

        vm.prank(distributorAddr);
        vm.expectRevert();
        escrow.deposit(user1, DEPOSIT_AMOUNT, SEASON_ID);
    }

    function test_deposit_revertIfZeroAmount() public {
        vm.prank(distributorAddr);
        vm.expectRevert();
        escrow.deposit(user1, 0, SEASON_ID);
    }

    function test_phaseTransition_open_to_active() public {
        vm.prank(admin);
        escrow.activateCohort(SEASON_ID, NEXT_SEASON_ID);

        (RolloverEscrow.EscrowPhase phase,,,,,,,) = escrow.getCohortState(SEASON_ID);
        assertEq(uint8(phase), uint8(RolloverEscrow.EscrowPhase.Active));
    }

    function test_phaseTransition_active_to_closed() public {
        vm.prank(admin);
        escrow.activateCohort(SEASON_ID, NEXT_SEASON_ID);

        vm.prank(admin);
        escrow.closeCohort(SEASON_ID);

        (RolloverEscrow.EscrowPhase phase,,,,,,,) = escrow.getCohortState(SEASON_ID);
        assertEq(uint8(phase), uint8(RolloverEscrow.EscrowPhase.Closed));
    }

    function test_phaseTransition_open_to_expired_afterTimeout() public {
        // Warp past the expiry timeout (30 days)
        vm.warp(block.timestamp + 31 days);

        // Any interaction should detect expiry — try a deposit
        vm.prank(distributorAddr);
        vm.expectRevert(); // Phase is expired, not open
        escrow.deposit(user1, DEPOSIT_AMOUNT, SEASON_ID);
    }

    function test_phaseTransition_revertInvalidTransitions() public {
        // Cannot close a cohort that's still OPEN (not ACTIVE)
        vm.prank(admin);
        vm.expectRevert();
        escrow.closeCohort(SEASON_ID);
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/contracts && forge test --match-contract "RolloverEscrowDepositTest" -v`
Expected: Compilation error — `RolloverEscrow` doesn't exist yet.

- [ ] **Step 3: Implement RolloverEscrow.sol**

Create `packages/contracts/src/core/RolloverEscrow.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IRolloverEscrow} from "./IRolloverEscrow.sol";

contract RolloverEscrow is IRolloverEscrow, AccessControl, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    // --- Roles ---
    bytes32 public constant DISTRIBUTOR_ROLE = keccak256("DISTRIBUTOR_ROLE");

    // --- Enums ---
    enum EscrowPhase { None, Open, Active, Closed, Expired }

    // --- Structs ---
    struct CohortState {
        EscrowPhase phase;
        uint256 nextSeasonId;
        uint16 bonusBps;
        uint256 totalDeposited;
        uint256 totalSpent;
        uint256 totalBonusPaid;
        uint40 openedAt;
    }

    struct UserPosition {
        uint256 deposited;
        uint256 spent;
        bool refunded;
    }

    // --- Immutables ---
    IERC20 public immutable sofToken;

    // --- Config ---
    address public treasury;
    address public raffle;
    uint16 public defaultBonusBps;
    uint32 public expiryTimeout;
    address public bondingCurve;

    // --- Storage ---
    mapping(uint256 => CohortState) internal _cohorts;
    mapping(uint256 => mapping(address => UserPosition)) internal _positions;

    // --- Errors ---
    error PhaseNotOpen(uint256 seasonId);
    error PhaseNotActive(uint256 seasonId);
    error PhaseNotActiveOrClosedOrExpired(uint256 seasonId);
    error CohortNotActive(uint256 seasonId);
    error InvalidPhaseTransition(uint256 seasonId, EscrowPhase current, EscrowPhase target);
    error AmountZero();
    error ExceedsBalance(uint256 requested, uint256 available);
    error AlreadyRefunded(uint256 seasonId, address user);
    error NothingToRefund(uint256 seasonId, address user);
    error BondingCurveNotSet();

    // --- Events ---
    event RolloverDeposit(address indexed user, uint256 indexed seasonId, uint256 amount);
    event RolloverSpend(address indexed user, uint256 indexed seasonId, uint256 indexed nextSeasonId, uint256 baseAmount, uint256 bonusAmount);
    event RolloverRefund(address indexed user, uint256 indexed seasonId, uint256 amount);
    event CohortOpened(uint256 indexed seasonId, uint16 bonusBps);
    event CohortActivated(uint256 indexed seasonId, uint256 indexed nextSeasonId);
    event CohortClosed(uint256 indexed seasonId);

    constructor(address _sofToken, address _treasury, address _raffle) {
        sofToken = IERC20(_sofToken);
        treasury = _treasury;
        raffle = _raffle;
        defaultBonusBps = 600; // 6%
        expiryTimeout = 30 days;

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    // --- Modifiers ---

    modifier whenPhaseOpen(uint256 seasonId) {
        _checkAndUpdateExpiry(seasonId);
        if (_cohorts[seasonId].phase != EscrowPhase.Open) revert PhaseNotOpen(seasonId);
        _;
    }

    modifier whenPhaseActive(uint256 seasonId) {
        if (_cohorts[seasonId].phase != EscrowPhase.Active) revert PhaseNotActive(seasonId);
        _;
    }

    modifier whenPhaseRefundable(uint256 seasonId) {
        _checkAndUpdateExpiry(seasonId);
        EscrowPhase p = _cohorts[seasonId].phase;
        if (p != EscrowPhase.Active && p != EscrowPhase.Closed && p != EscrowPhase.Expired) {
            revert PhaseNotActiveOrClosedOrExpired(seasonId);
        }
        _;
    }

    // --- Deposit ---

    function deposit(address user, uint256 amount, uint256 seasonId)
        external
        override
        onlyRole(DISTRIBUTOR_ROLE)
        whenNotPaused
        whenPhaseOpen(seasonId)
    {
        if (amount == 0) revert AmountZero();

        _positions[seasonId][user].deposited += amount;
        _cohorts[seasonId].totalDeposited += amount;

        sofToken.safeTransferFrom(msg.sender, address(this), amount);

        emit RolloverDeposit(user, seasonId, amount);
    }

    // --- Spend (implemented in Task 4) ---

    // --- Refund (implemented in Task 5) ---

    // --- Admin ---

    function openCohort(uint256 seasonId, uint16 bonusBps) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (_cohorts[seasonId].phase != EscrowPhase.None) {
            revert InvalidPhaseTransition(seasonId, _cohorts[seasonId].phase, EscrowPhase.Open);
        }

        _cohorts[seasonId] = CohortState({
            phase: EscrowPhase.Open,
            nextSeasonId: 0,
            bonusBps: bonusBps,
            totalDeposited: 0,
            totalSpent: 0,
            totalBonusPaid: 0,
            openedAt: uint40(block.timestamp)
        });

        emit CohortOpened(seasonId, bonusBps);
    }

    function activateCohort(uint256 seasonId, uint256 nextSeasonId)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        _checkAndUpdateExpiry(seasonId);
        if (_cohorts[seasonId].phase != EscrowPhase.Open) {
            revert InvalidPhaseTransition(seasonId, _cohorts[seasonId].phase, EscrowPhase.Active);
        }

        _cohorts[seasonId].phase = EscrowPhase.Active;
        _cohorts[seasonId].nextSeasonId = nextSeasonId;

        emit CohortActivated(seasonId, nextSeasonId);
    }

    function closeCohort(uint256 seasonId) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (_cohorts[seasonId].phase != EscrowPhase.Active) {
            revert InvalidPhaseTransition(seasonId, _cohorts[seasonId].phase, EscrowPhase.Closed);
        }

        _cohorts[seasonId].phase = EscrowPhase.Closed;

        emit CohortClosed(seasonId);
    }

    function setDefaultBonusBps(uint16 newBps) external onlyRole(DEFAULT_ADMIN_ROLE) {
        defaultBonusBps = newBps;
    }

    function setBondingCurve(address _curve) external onlyRole(DEFAULT_ADMIN_ROLE) {
        bondingCurve = _curve;
    }

    function setTreasury(address _treasury) external onlyRole(DEFAULT_ADMIN_ROLE) {
        treasury = _treasury;
    }

    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    // --- Views ---

    function getUserPosition(uint256 seasonId, address user)
        external
        view
        returns (uint256 deposited, uint256 spent, bool refunded)
    {
        UserPosition storage pos = _positions[seasonId][user];
        return (pos.deposited, pos.spent, pos.refunded);
    }

    function getCohortState(uint256 seasonId)
        external
        view
        returns (
            EscrowPhase phase,
            uint256 nextSeasonId,
            uint16 bonusBps,
            uint256 totalDeposited,
            uint256 totalSpent,
            uint256 totalBonusPaid,
            uint40 openedAt,
            bool isExpired
        )
    {
        CohortState storage c = _cohorts[seasonId];
        bool expired = c.phase == EscrowPhase.Open
            && c.openedAt > 0
            && block.timestamp > c.openedAt + expiryTimeout;

        return (
            expired ? EscrowPhase.Expired : c.phase,
            c.nextSeasonId,
            c.bonusBps,
            c.totalDeposited,
            c.totalSpent,
            c.totalBonusPaid,
            c.openedAt,
            expired
        );
    }

    function getAvailableBalance(uint256 seasonId, address user) external view returns (uint256) {
        UserPosition storage pos = _positions[seasonId][user];
        if (pos.refunded) return 0;
        return pos.deposited - pos.spent;
    }

    function getBonusAmount(uint256 seasonId, uint256 amount) external view returns (uint256) {
        uint16 bps = _cohorts[seasonId].bonusBps;
        return (amount * bps) / 10000;
    }

    // --- Internal ---

    function _checkAndUpdateExpiry(uint256 seasonId) internal {
        CohortState storage c = _cohorts[seasonId];
        if (c.phase == EscrowPhase.Open && c.openedAt > 0 && block.timestamp > c.openedAt + expiryTimeout) {
            c.phase = EscrowPhase.Expired;
        }
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/contracts && forge test --match-contract "RolloverEscrowDepositTest" -v`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/core/RolloverEscrow.sol packages/contracts/test/RolloverEscrow.t.sol
git commit -m "feat(contracts): implement RolloverEscrow with deposit and state machine"
```

---

### Task 4: RolloverEscrow — Spend with Bonus

Add `spendFromRollover` — pulls bonus from treasury, buys tickets via bonding curve.

**Files:**
- Modify: `packages/contracts/src/core/RolloverEscrow.sol`
- Test: `packages/contracts/test/RolloverEscrow.t.sol` (add spend tests)

- [ ] **Step 1: Write failing tests for spendFromRollover**

Add to `packages/contracts/test/RolloverEscrow.t.sol`:

```solidity
import {SOFBondingCurve} from "../src/curve/SOFBondingCurve.sol";

contract RolloverEscrowSpendTest is Test {
    SOFToken sofToken;
    RaffleToken raffleToken;
    SOFBondingCurve curve;
    RolloverEscrow escrow;

    address admin = makeAddr("admin");
    address distributorAddr = makeAddr("distributor");
    address treasury = makeAddr("treasury");
    address raffleAddr = makeAddr("raffle");
    address user1 = makeAddr("user1");

    uint256 constant SEASON_ID = 1;
    uint256 constant NEXT_SEASON_ID = 2;
    uint256 constant DEPOSIT_AMOUNT = 100e18;
    uint256 constant TICKET_PRICE = 1e18;

    function setUp() public {
        vm.startPrank(admin);

        sofToken = new SOFToken("SOF", "SOF", 1_000_000e18);

        // Deploy bonding curve for next season
        curve = new SOFBondingCurve(address(sofToken), admin);
        raffleToken = new RaffleToken(
            "Season 2 Ticket", "SOF-2",
            NEXT_SEASON_ID, "Season 2",
            block.timestamp, block.timestamp + 7 days
        );
        raffleToken.grantRole(raffleToken.MINTER_ROLE(), address(curve));
        raffleToken.grantRole(raffleToken.BURNER_ROLE(), address(curve));

        RaffleTypes.BondStep[] memory steps = new RaffleTypes.BondStep[](1);
        steps[0] = RaffleTypes.BondStep({rangeTo: 10000, price: TICKET_PRICE});
        curve.initializeCurve(address(raffleToken), steps, 0, 0, treasury); // 0 fees for simplicity

        // Deploy escrow
        escrow = new RolloverEscrow(address(sofToken), treasury, raffleAddr);
        escrow.grantRole(escrow.DISTRIBUTOR_ROLE(), distributorAddr);
        escrow.setBondingCurve(address(curve));

        // Grant ESCROW_ROLE on curve to escrow
        curve.grantRole(curve.ESCROW_ROLE(), address(escrow));

        // Fund treasury with bonus SOF
        sofToken.transfer(treasury, 50_000e18);

        // Fund distributor
        sofToken.transfer(distributorAddr, 10_000e18);

        // Open and deposit
        escrow.openCohort(SEASON_ID, 600); // 6%
        vm.stopPrank();

        // Distributor approves escrow and deposits for user
        vm.startPrank(distributorAddr);
        sofToken.approve(address(escrow), type(uint256).max);
        escrow.deposit(user1, DEPOSIT_AMOUNT, SEASON_ID);
        vm.stopPrank();

        // Treasury approves escrow for bonus pulls
        vm.prank(treasury);
        sofToken.approve(address(escrow), type(uint256).max);

        // Activate cohort
        vm.prank(admin);
        escrow.activateCohort(SEASON_ID, NEXT_SEASON_ID);
    }

    function test_spend_happyPath_bonusApplied() public {
        uint256 spendAmount = 50e18;
        uint256 expectedBonus = (spendAmount * 600) / 10000; // 3e18
        uint256 totalTickets = (spendAmount + expectedBonus) / TICKET_PRICE; // 53 tickets

        uint256 treasuryBefore = sofToken.balanceOf(treasury);

        vm.prank(user1);
        escrow.spendFromRollover(SEASON_ID, spendAmount, type(uint256).max);

        // User should have tickets
        assertEq(raffleToken.balanceOf(user1), totalTickets);

        // Treasury should have lost the bonus amount
        assertEq(sofToken.balanceOf(treasury), treasuryBefore - expectedBonus);

        // Position should be updated
        (uint256 deposited, uint256 spent, bool refunded) = escrow.getUserPosition(SEASON_ID, user1);
        assertEq(deposited, DEPOSIT_AMOUNT);
        assertEq(spent, spendAmount);
        assertFalse(refunded);
    }

    function test_spend_partialSpend_remainderRefundable() public {
        uint256 spendAmount = 30e18;

        vm.prank(user1);
        escrow.spendFromRollover(SEASON_ID, spendAmount, type(uint256).max);

        uint256 available = escrow.getAvailableBalance(SEASON_ID, user1);
        assertEq(available, DEPOSIT_AMOUNT - spendAmount); // 70e18
    }

    function test_spend_revertIfPhaseNotActive() public {
        // Close the cohort
        vm.prank(admin);
        escrow.closeCohort(SEASON_ID);

        vm.prank(user1);
        vm.expectRevert();
        escrow.spendFromRollover(SEASON_ID, 50e18, type(uint256).max);
    }

    function test_spend_revertIfExceedsBalance() public {
        vm.prank(user1);
        vm.expectRevert();
        escrow.spendFromRollover(SEASON_ID, DEPOSIT_AMOUNT + 1, type(uint256).max);
    }

    function test_spend_revertIfTreasuryBalanceInsufficient() public {
        // Drain treasury
        vm.prank(treasury);
        sofToken.transfer(admin, sofToken.balanceOf(treasury));

        vm.prank(user1);
        vm.expectRevert(); // safeTransferFrom will revert
        escrow.spendFromRollover(SEASON_ID, 50e18, type(uint256).max);
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/contracts && forge test --match-contract "RolloverEscrowSpendTest" -v`
Expected: Compilation error — `spendFromRollover` doesn't exist yet.

- [ ] **Step 3: Implement `spendFromRollover` in RolloverEscrow.sol**

Add to `packages/contracts/src/core/RolloverEscrow.sol`:

Import the curve interface at the top:

```solidity
import {SOFBondingCurve} from "../curve/SOFBondingCurve.sol";
```

Add the spend function (replace the placeholder comment):

```solidity
function spendFromRollover(uint256 seasonId, uint256 amount, uint256 maxSofForCurve)
    external
    nonReentrant
    whenNotPaused
    whenPhaseActive(seasonId)
{
    if (amount == 0) revert AmountZero();
    if (bondingCurve == address(0)) revert BondingCurveNotSet();

    UserPosition storage pos = _positions[seasonId][msg.sender];
    uint256 available = pos.deposited - pos.spent;
    if (amount > available) revert ExceedsBalance(amount, available);

    uint16 bps = _cohorts[seasonId].bonusBps;
    uint256 bonusAmount = (amount * bps) / 10000;

    // Update state before external calls (checks-effects-interactions)
    pos.spent += amount;
    _cohorts[seasonId].totalSpent += amount;
    _cohorts[seasonId].totalBonusPaid += bonusAmount;

    // Pull bonus from treasury
    sofToken.safeTransferFrom(treasury, address(this), bonusAmount);

    // Approve curve for total amount (base + bonus)
    uint256 totalSof = amount + bonusAmount;
    sofToken.approve(address(bondingCurve), totalSof);

    // Calculate how many tickets this buys
    SOFBondingCurve curveContract = SOFBondingCurve(bondingCurve);
    uint256 ticketAmount = totalSof / curveContract.calculateBuyPrice(1);

    // Buy tickets for user
    curveContract.buyTokensFor(msg.sender, ticketAmount, maxSofForCurve);

    emit RolloverSpend(msg.sender, seasonId, _cohorts[seasonId].nextSeasonId, amount, bonusAmount);
}
```

Note: The ticket calculation above is simplified. The actual implementation should use the curve's pricing to determine exact ticket count from SOF amount. If the curve exposes a `calculateTokensForSof(uint256 sofAmount)` view, use that. Otherwise, pass `tokenAmount` as a parameter and let the curve's slippage check handle it. Adjust the function signature to:

```solidity
function spendFromRollover(uint256 seasonId, uint256 amount, uint256 ticketAmount, uint256 maxSofForCurve)
```

Or more simply — since the user knows how many tickets they want and the UI calculates the optimal split:

```solidity
function spendFromRollover(uint256 seasonId, uint256 sofAmount, uint256 ticketAmount, uint256 maxTotalSof)
    external
    nonReentrant
    whenNotPaused
    whenPhaseActive(seasonId)
{
    if (sofAmount == 0) revert AmountZero();
    if (bondingCurve == address(0)) revert BondingCurveNotSet();

    UserPosition storage pos = _positions[seasonId][msg.sender];
    uint256 available = pos.deposited - pos.spent;
    if (sofAmount > available) revert ExceedsBalance(sofAmount, available);

    uint16 bps = _cohorts[seasonId].bonusBps;
    uint256 bonusAmount = (sofAmount * bps) / 10000;

    // Update state before external calls
    pos.spent += sofAmount;
    _cohorts[seasonId].totalSpent += sofAmount;
    _cohorts[seasonId].totalBonusPaid += bonusAmount;

    // Pull bonus from treasury
    sofToken.safeTransferFrom(treasury, address(this), bonusAmount);

    // Approve curve
    uint256 totalSof = sofAmount + bonusAmount;
    sofToken.approve(address(bondingCurve), totalSof);

    // Buy tickets for user via curve
    SOFBondingCurve(bondingCurve).buyTokensFor(msg.sender, ticketAmount, maxTotalSof);

    emit RolloverSpend(msg.sender, seasonId, _cohorts[seasonId].nextSeasonId, sofAmount, bonusAmount);
}
```

Update the test accordingly to pass `ticketAmount` and `maxTotalSof`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/contracts && forge test --match-contract "RolloverEscrowSpendTest" -v`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/core/RolloverEscrow.sol packages/contracts/test/RolloverEscrow.t.sol
git commit -m "feat(contracts): implement spendFromRollover with treasury bonus pull"
```

---

### Task 5: RolloverEscrow — Refund

Add `refund` — returns unspent balance to user without bonus.

**Files:**
- Modify: `packages/contracts/src/core/RolloverEscrow.sol`
- Test: `packages/contracts/test/RolloverEscrow.t.sol` (add refund tests)

- [ ] **Step 1: Write failing tests for refund**

Add to `packages/contracts/test/RolloverEscrow.t.sol`:

```solidity
contract RolloverEscrowRefundTest is Test {
    SOFToken sofToken;
    RolloverEscrow escrow;

    address admin = makeAddr("admin");
    address distributorAddr = makeAddr("distributor");
    address treasury = makeAddr("treasury");
    address raffleAddr = makeAddr("raffle");
    address user1 = makeAddr("user1");

    uint256 constant SEASON_ID = 1;
    uint256 constant NEXT_SEASON_ID = 2;
    uint256 constant DEPOSIT_AMOUNT = 100e18;

    function setUp() public {
        vm.startPrank(admin);
        sofToken = new SOFToken("SOF", "SOF", 1_000_000e18);
        escrow = new RolloverEscrow(address(sofToken), treasury, raffleAddr);
        escrow.grantRole(escrow.DISTRIBUTOR_ROLE(), distributorAddr);
        escrow.openCohort(SEASON_ID, 600);
        sofToken.transfer(distributorAddr, 10_000e18);
        vm.stopPrank();

        vm.startPrank(distributorAddr);
        sofToken.approve(address(escrow), type(uint256).max);
        escrow.deposit(user1, DEPOSIT_AMOUNT, SEASON_ID);
        vm.stopPrank();

        vm.prank(admin);
        escrow.activateCohort(SEASON_ID, NEXT_SEASON_ID);
    }

    function test_refund_fromActive_returnsUnspent() public {
        vm.prank(user1);
        escrow.refund(SEASON_ID);

        assertEq(sofToken.balanceOf(user1), DEPOSIT_AMOUNT);
        (uint256 deposited, uint256 spent, bool refunded) = escrow.getUserPosition(SEASON_ID, user1);
        assertEq(deposited, DEPOSIT_AMOUNT);
        assertEq(spent, 0);
        assertTrue(refunded);
    }

    function test_refund_fromClosed_returnsUnspent() public {
        vm.prank(admin);
        escrow.closeCohort(SEASON_ID);

        vm.prank(user1);
        escrow.refund(SEASON_ID);

        assertEq(sofToken.balanceOf(user1), DEPOSIT_AMOUNT);
    }

    function test_refund_fromExpired_returnsFull() public {
        // Rewind: open a fresh cohort and let it expire without activating
        uint256 seasonId2 = 99;
        vm.prank(admin);
        escrow.openCohort(seasonId2, 600);

        vm.startPrank(distributorAddr);
        escrow.deposit(user1, DEPOSIT_AMOUNT, seasonId2);
        vm.stopPrank();

        // Warp past timeout
        vm.warp(block.timestamp + 31 days);

        vm.prank(user1);
        escrow.refund(seasonId2);

        // user1 should have gotten their deposit back
        assertEq(sofToken.balanceOf(user1), DEPOSIT_AMOUNT);
    }

    function test_refund_revertIfAlreadyRefunded() public {
        vm.prank(user1);
        escrow.refund(SEASON_ID);

        vm.prank(user1);
        vm.expectRevert();
        escrow.refund(SEASON_ID);
    }

    function test_refund_revertIfNothingToRefund() public {
        // user2 never deposited
        address user2 = makeAddr("user2");
        vm.prank(user2);
        vm.expectRevert();
        escrow.refund(SEASON_ID);
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/contracts && forge test --match-contract "RolloverEscrowRefundTest" -v`
Expected: Compilation error — `refund` doesn't exist yet.

- [ ] **Step 3: Implement `refund` in RolloverEscrow.sol**

Add to `packages/contracts/src/core/RolloverEscrow.sol` (replace the refund placeholder comment):

```solidity
function refund(uint256 seasonId)
    external
    nonReentrant
    whenPhaseRefundable(seasonId)
{
    UserPosition storage pos = _positions[seasonId][msg.sender];
    if (pos.refunded) revert AlreadyRefunded(seasonId, msg.sender);

    uint256 refundAmount = pos.deposited - pos.spent;
    if (refundAmount == 0) revert NothingToRefund(seasonId, msg.sender);

    // Update state before transfer
    pos.refunded = true;

    sofToken.safeTransfer(msg.sender, refundAmount);

    emit RolloverRefund(msg.sender, seasonId, refundAmount);
}
```

Note: Refunds are NOT gated by `whenNotPaused` — users can always exit, even when the contract is paused. This is intentional per the design spec.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/contracts && forge test --match-contract "RolloverEscrowRefundTest" -v`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/core/RolloverEscrow.sol packages/contracts/test/RolloverEscrow.t.sol
git commit -m "feat(contracts): implement refund for RolloverEscrow"
```

---

### Task 6: Deployment Script and Role Wiring

Add the deployment script and wire up roles across contracts.

**Files:**
- Create: `packages/contracts/script/deploy/16_DeployRolloverEscrow.s.sol`
- Modify: `packages/contracts/script/deploy/DeployedAddresses.sol`
- Modify: `packages/contracts/script/deploy/14_ConfigureRoles.s.sol`
- Modify: `packages/contracts/script/deploy/DeployAll.s.sol`

- [ ] **Step 1: Add `rolloverEscrow` to DeployedAddresses**

In `packages/contracts/script/deploy/DeployedAddresses.sol`, add after `paymasterAddress`:

```solidity
address rolloverEscrow;
```

- [ ] **Step 2: Create deployment script**

Create `packages/contracts/script/deploy/16_DeployRolloverEscrow.s.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {DeployedAddresses} from "./DeployedAddresses.sol";
import {RolloverEscrow} from "../../src/core/RolloverEscrow.sol";

contract DeployRolloverEscrow is Script {
    function run(DeployedAddresses memory addrs) public returns (DeployedAddresses memory) {
        address deployer = vm.addr(vm.envUint("PRIVATE_KEY"));
        address treasury = vm.envAddress("TREASURY_ADDRESS");

        vm.startBroadcast(vm.envUint("PRIVATE_KEY"));

        RolloverEscrow escrow = new RolloverEscrow(
            addrs.sofToken,
            treasury,
            addrs.raffle
        );

        vm.stopBroadcast();

        addrs.rolloverEscrow = address(escrow);

        console2.log("RolloverEscrow:", address(escrow));

        return addrs;
    }
}
```

- [ ] **Step 3: Add role wiring to ConfigureRoles**

In `packages/contracts/script/deploy/14_ConfigureRoles.s.sol`, add import:

```solidity
import {RolloverEscrow} from "../../src/core/RolloverEscrow.sol";
import {SOFBondingCurve} from "../../src/curve/SOFBondingCurve.sol";
```

Add after the existing role grants (before `vm.stopBroadcast()`):

```solidity
// 10. Grant DISTRIBUTOR_ROLE on RolloverEscrow to PrizeDistributor
if (addrs.rolloverEscrow != address(0)) {
    RolloverEscrow rolloverEscrow = RolloverEscrow(addrs.rolloverEscrow);

    try rolloverEscrow.grantRole(rolloverEscrow.DISTRIBUTOR_ROLE(), addrs.prizeDistributor) {
        console2.log("Granted DISTRIBUTOR_ROLE on RolloverEscrow to PrizeDistributor");
    } catch {
        console2.log("DISTRIBUTOR_ROLE on RolloverEscrow already set");
    }

    // 11. Set RolloverEscrow on PrizeDistributor
    try distributor.setRolloverEscrow(addrs.rolloverEscrow) {
        console2.log("Set RolloverEscrow on PrizeDistributor");
    } catch {
        console2.log("RolloverEscrow on PrizeDistributor already set");
    }

    // NOTE: ESCROW_ROLE on bonding curves is granted per-season when the curve is created.
    // The escrow.setBondingCurve() is also called per-season by the backend.
    // Treasury must approve RolloverEscrow for SOF spending (like InfoFiFactory approval).
    console2.log("IMPORTANT: Treasury must approve RolloverEscrow for SOF spending");
    console2.log("  Run: sof.approve(", vm.toString(addrs.rolloverEscrow), ", type(uint256).max)");
    console2.log("  From the treasury wallet");
}
```

- [ ] **Step 4: Add step 16 to DeployAll.s.sol**

In `packages/contracts/script/deploy/DeployAll.s.sol`, add after the step 15 (paymaster) call:

```solidity
addrs = new DeployRolloverEscrow().run(addrs);
```

Add the import at the top:

```solidity
import {DeployRolloverEscrow} from "./16_DeployRolloverEscrow.s.sol";
```

Add `"RolloverEscrow"` to the deployment JSON output section.

- [ ] **Step 5: Run full build to verify compilation**

Run: `cd packages/contracts && forge build`
Expected: Build succeeds with no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/contracts/script/deploy/16_DeployRolloverEscrow.s.sol packages/contracts/script/deploy/DeployedAddresses.sol packages/contracts/script/deploy/14_ConfigureRoles.s.sol packages/contracts/script/deploy/DeployAll.s.sol
git commit -m "feat(contracts): add RolloverEscrow deployment script and role wiring"
```

---

### Task 7: Integration Tests

Multi-season rollover scenarios testing the full lifecycle.

**Files:**
- Create: `packages/contracts/test/RolloverIntegration.t.sol`

- [ ] **Step 1: Write the full rollover cycle integration test**

Create `packages/contracts/test/RolloverIntegration.t.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {SOFToken} from "../src/token/SOFToken.sol";
import {RaffleToken} from "../src/token/RaffleToken.sol";
import {SOFBondingCurve} from "../src/curve/SOFBondingCurve.sol";
import {RafflePrizeDistributor} from "../src/core/RafflePrizeDistributor.sol";
import {RolloverEscrow} from "../src/core/RolloverEscrow.sol";
import {RaffleTypes} from "../src/lib/RaffleTypes.sol";

contract RolloverIntegrationTest is Test {
    SOFToken sofToken;
    RolloverEscrow escrow;
    RafflePrizeDistributor distributor;

    // Season 1 contracts
    RaffleToken raffleToken1;
    SOFBondingCurve curve1;

    // Season 2 contracts
    RaffleToken raffleToken2;
    SOFBondingCurve curve2;

    address admin = makeAddr("admin");
    address treasury = makeAddr("treasury");
    address raffleAddr = makeAddr("raffle");
    address grandWinner = makeAddr("grandWinner");
    address user1 = makeAddr("user1");
    address user2 = makeAddr("user2");

    uint256 constant SEASON_1 = 1;
    uint256 constant SEASON_2 = 2;
    uint256 constant TICKET_PRICE = 1e18;

    function setUp() public {
        vm.startPrank(admin);

        sofToken = new SOFToken("SOF", "SOF", 10_000_000e18);

        // Deploy escrow
        escrow = new RolloverEscrow(address(sofToken), treasury, raffleAddr);

        // Deploy distributor
        distributor = new RafflePrizeDistributor(admin);
        distributor.grantRole(distributor.RAFFLE_ROLE(), raffleAddr);
        distributor.setRolloverEscrow(address(escrow));
        escrow.grantRole(escrow.DISTRIBUTOR_ROLE(), address(distributor));

        // Deploy season 2 curve (the one users will roll into)
        curve2 = new SOFBondingCurve(address(sofToken), admin);
        raffleToken2 = new RaffleToken(
            "Season 2 Ticket", "SOF-2",
            SEASON_2, "Season 2",
            block.timestamp, block.timestamp + 14 days
        );
        raffleToken2.grantRole(raffleToken2.MINTER_ROLE(), address(curve2));
        raffleToken2.grantRole(raffleToken2.BURNER_ROLE(), address(curve2));

        RaffleTypes.BondStep[] memory steps = new RaffleTypes.BondStep[](1);
        steps[0] = RaffleTypes.BondStep({rangeTo: 100000, price: TICKET_PRICE});
        curve2.initializeCurve(address(raffleToken2), steps, 0, 0, treasury);

        // Wire escrow to curve2
        curve2.grantRole(curve2.ESCROW_ROLE(), address(escrow));
        escrow.setBondingCurve(address(curve2));

        // Fund treasury
        sofToken.transfer(treasury, 1_000_000e18);

        vm.stopPrank();

        // Treasury approves escrow
        vm.prank(treasury);
        sofToken.approve(address(escrow), type(uint256).max);
    }

    function test_fullRolloverCycle_depositSpendRefund() public {
        // === Season 1 ends, set up consolation ===
        uint256 consolationAmount = 200e18;
        uint256 totalParticipants = 3; // 1 winner + 2 losers

        vm.startPrank(raffleAddr);
        distributor.configureSeason(
            SEASON_1, address(sofToken), grandWinner,
            500e18, consolationAmount, totalParticipants
        );
        address[] memory losers = new address[](2);
        losers[0] = user1;
        losers[1] = user2;
        distributor.setConsolationEligible(SEASON_1, losers);
        vm.stopPrank();

        // Fund distributor
        vm.prank(admin);
        sofToken.transfer(address(distributor), 700e18);
        vm.prank(raffleAddr);
        distributor.fundSeason(SEASON_1, 700e18);

        // Open rollover cohort
        vm.prank(admin);
        escrow.openCohort(SEASON_1, 600);

        // === User1 claims to rollover, User2 claims to wallet ===
        vm.prank(user1);
        distributor.claimConsolation(SEASON_1, true); // rollover

        vm.prank(user2);
        distributor.claimConsolation(SEASON_1, false); // wallet

        uint256 sharePerLoser = consolationAmount / 2; // 100e18

        // Verify: user1's SOF is in escrow, user2 got SOF directly
        assertEq(sofToken.balanceOf(user1), 0);
        assertEq(sofToken.balanceOf(user2), sharePerLoser);
        (uint256 deposited,,) = escrow.getUserPosition(SEASON_1, user1);
        assertEq(deposited, sharePerLoser);

        // === Activate cohort for season 2 ===
        vm.prank(admin);
        escrow.activateCohort(SEASON_1, SEASON_2);

        // === User1 spends from rollover ===
        uint256 spendAmount = 60e18;
        uint256 bonus = (spendAmount * 600) / 10000; // 3.6e18
        uint256 expectedTickets = (spendAmount + bonus) / TICKET_PRICE;

        vm.prank(user1);
        escrow.spendFromRollover(SEASON_1, spendAmount, expectedTickets, type(uint256).max);

        assertEq(raffleToken2.balanceOf(user1), expectedTickets);

        // === User1 refunds the remainder ===
        uint256 remaining = sharePerLoser - spendAmount; // 40e18

        vm.prank(user1);
        escrow.refund(SEASON_1);

        assertEq(sofToken.balanceOf(user1), remaining);
    }

    function test_rolloverEligibility_skippedSeasonBreaksChain() public {
        // Setup season 1 consolation
        vm.startPrank(raffleAddr);
        distributor.configureSeason(SEASON_1, address(sofToken), grandWinner, 500e18, 200e18, 3);
        address[] memory losers = new address[](1);
        losers[0] = user1;
        distributor.setConsolationEligible(SEASON_1, losers);
        vm.stopPrank();

        vm.prank(admin);
        sofToken.transfer(address(distributor), 700e18);
        vm.prank(raffleAddr);
        distributor.fundSeason(SEASON_1, 700e18);

        // Open cohort, user deposits
        vm.prank(admin);
        escrow.openCohort(SEASON_1, 600);

        vm.prank(user1);
        distributor.claimConsolation(SEASON_1, true);

        // Activate, but user never spends
        vm.prank(admin);
        escrow.activateCohort(SEASON_1, SEASON_2);

        // Close without spending
        vm.prank(admin);
        escrow.closeCohort(SEASON_1);

        // User refunds — gets base back, no bonus
        vm.prank(user1);
        escrow.refund(SEASON_1);

        uint256 sharePerLoser = 200e18 / 2;
        assertEq(sofToken.balanceOf(user1), sharePerLoser);
        // No tickets minted — user skipped
        assertEq(raffleToken2.balanceOf(user1), 0);
    }
}
```

- [ ] **Step 2: Run integration tests**

Run: `cd packages/contracts && forge test --match-contract "RolloverIntegrationTest" -v`
Expected: All tests PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/contracts/test/RolloverIntegration.t.sol
git commit -m "test(contracts): add integration tests for full rollover lifecycle"
```

---

### Task 8: ABI Export and Cleanup

Export ABIs for frontend/backend consumption. Run full test suite.

**Files:**
- Modify: ABI export (automatic via `npm run build`)

- [ ] **Step 1: Run full test suite**

Run: `cd packages/contracts && forge test -v`
Expected: All tests PASS — existing tests + new rollover tests.

- [ ] **Step 2: Build and export ABIs**

Run: `cd packages/contracts && npm run build`

This runs `forge build && node ../../scripts/export-abis.js`, which generates `abi/index.js` with the new `RolloverEscrowABI` export.

- [ ] **Step 3: Verify ABI export includes RolloverEscrow**

Run: `grep -l "RolloverEscrow" packages/contracts/abi/index.js`
Expected: File found with the RolloverEscrow ABI exported.

- [ ] **Step 4: Run lint**

Run: `cd packages/contracts && npm run lint` (if configured)
Expected: No new warnings.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/abi/
git commit -m "build(contracts): export RolloverEscrow ABI"
```

- [ ] **Step 6: Bump version**

In `packages/contracts/package.json`, bump the minor version (new feature).

```bash
git add packages/contracts/package.json
git commit -m "chore(contracts): bump version for rollover incentives"
```
