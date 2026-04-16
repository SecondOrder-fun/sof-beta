// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {SOFToken} from "../src/token/SOFToken.sol";
import {RaffleToken} from "../src/token/RaffleToken.sol";
import {SOFBondingCurve} from "../src/curve/SOFBondingCurve.sol";
import {RaffleTypes} from "../src/lib/RaffleTypes.sol";
import {RafflePrizeDistributor, NotAParticipant, RolloverEscrowNotSet} from "../src/core/RafflePrizeDistributor.sol";
import {IRolloverEscrow} from "../src/core/IRolloverEscrow.sol";
import {RolloverEscrow} from "../src/core/RolloverEscrow.sol";
import {
    PhaseNotOpen,
    PhaseNotActive,
    AmountZero,
    ExceedsBalance,
    InvalidPhaseTransition
} from "../src/core/RolloverEscrow.sol";
import {ERC20} from "openzeppelin-contracts/contracts/token/ERC20/ERC20.sol";

/**
 * @title RolloverEscrowTest
 * @notice Tests for buyTokensFor — the escrow-gated variant that lets a contract
 *         pay SOF on behalf of a user and direct the minted tickets to that user.
 *
 * Task 1: Add `buyTokensFor` to SOFBondingCurve
 */
contract RolloverEscrowTest is Test {
    SOFToken public sofToken;
    RaffleToken public raffleToken;
    SOFBondingCurve public curve;

    address public admin = address(0xAD);
    address public treasury = address(0x7EA);
    address public escrow = address(0xE5C);     // the RolloverEscrow (acting caller)
    address public recipient = address(0xBEEF);  // user who receives the tickets

    uint256 constant INITIAL_SOF = 100_000e18;
    uint256 constant ESCROW_SOF  = 50_000e18;

    function setUp() public {
        vm.startPrank(admin);

        sofToken = new SOFToken("SOF", "SOF", INITIAL_SOF);
        // forge-lint: disable-next-line(erc20-unchecked-transfer)
        sofToken.transfer(escrow, ESCROW_SOF);

        curve = new SOFBondingCurve(address(sofToken), admin);

        raffleToken = new RaffleToken(
            "Season 1 Ticket",
            "SOF-1",
            1,
            "Season 1",
            block.timestamp,
            block.timestamp + 7 days
        );

        raffleToken.grantRole(raffleToken.MINTER_ROLE(), address(curve));
        raffleToken.grantRole(raffleToken.BURNER_ROLE(), address(curve));

        // Single-step curve: up to 10 000 tickets at 1 SOF each
        RaffleTypes.BondStep[] memory steps = new RaffleTypes.BondStep[](1);
        steps[0] = RaffleTypes.BondStep({rangeTo: 10_000, price: 1e18});

        curve.initializeCurve(address(raffleToken), steps, 100, 100, treasury);

        // Grant ESCROW_ROLE to the escrow address
        curve.grantRole(curve.ESCROW_ROLE(), escrow);

        vm.stopPrank();

        // Escrow pre-approves the curve for SOF spending
        vm.prank(escrow);
        sofToken.approve(address(curve), type(uint256).max);
    }

    // =========================================================================
    // test_buyTokensFor_mintsToRecipient
    // Escrow calls buyTokensFor; recipient gets tickets; escrow pays SOF.
    // =========================================================================
    function test_buyTokensFor_mintsToRecipient() public {
        uint256 tokenAmount = 10;
        uint256 baseCost = curve.calculateBuyPrice(tokenAmount);
        // 1% buy fee → totalCost = baseCost * 1.01
        uint256 fee = (baseCost * 100) / 10_000;
        uint256 totalCost = baseCost + fee;
        uint256 maxSof = totalCost; // exact, no extra headroom

        uint256 escrowBalanceBefore    = sofToken.balanceOf(escrow);
        uint256 recipientBalanceBefore = sofToken.balanceOf(recipient);

        vm.prank(escrow);
        curve.buyTokensFor(recipient, tokenAmount, maxSof);

        // Recipient receives raffle tokens
        assertEq(raffleToken.balanceOf(recipient), tokenAmount, "recipient raffle token balance");

        // Escrow lost exactly totalCost SOF
        assertEq(
            sofToken.balanceOf(escrow),
            escrowBalanceBefore - totalCost,
            "escrow SOF balance after buy"
        );

        // Recipient's SOF balance is untouched
        assertEq(sofToken.balanceOf(recipient), recipientBalanceBefore, "recipient SOF unchanged");

        // playerTickets tracks recipient, not escrow
        assertEq(curve.playerTickets(recipient), tokenAmount, "recipient playerTickets");
        assertEq(curve.playerTickets(escrow), 0, "escrow playerTickets should be 0");
    }

    // =========================================================================
    // test_buyTokensFor_revertIfNotEscrowRole
    // An address without ESCROW_ROLE must be rejected.
    // =========================================================================
    function test_buyTokensFor_revertIfNotEscrowRole() public {
        address unauthorized = address(0xBAD);

        vm.prank(unauthorized);
        vm.expectRevert(); // AccessControl will revert
        curve.buyTokensFor(recipient, 10, type(uint256).max);
    }
}

// =============================================================================
// MockERC20 for ClaimToRolloverTest
// =============================================================================
contract MockSOFToken is ERC20 {
    constructor() ERC20("SOF", "SOF") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

// =============================================================================
// MockRolloverEscrow — tracks deposits
// =============================================================================
contract MockRolloverEscrow is IRolloverEscrow {
    struct DepositRecord {
        address user;
        uint256 amount;
        uint256 seasonId;
    }

    DepositRecord[] public deposits;

    function deposit(address user, uint256 amount, uint256 seasonId) external override {
        deposits.push(DepositRecord({user: user, amount: amount, seasonId: seasonId}));
    }

    function depositCount() external view returns (uint256) {
        return deposits.length;
    }
}

// =============================================================================
// ClaimToRolloverTest
// =============================================================================
contract ClaimToRolloverTest is Test {
    RafflePrizeDistributor public distributor;
    MockSOFToken public sofToken;
    MockRolloverEscrow public mockEscrow;

    address public admin = address(this);
    address public raffle = address(0x1);
    address public grandWinner = address(0x2);
    address public loser1 = address(0x3);
    address public loser2 = address(0x4);

    uint256 constant SEASON_ID = 42;
    uint256 constant GRAND_AMOUNT = 6500 ether;
    uint256 constant CONSOLATION_AMOUNT = 2000 ether; // 2 losers → 1000 each
    uint256 constant TOTAL_PARTICIPANTS = 3; // 1 winner + 2 losers

    function setUp() public {
        sofToken = new MockSOFToken();
        distributor = new RafflePrizeDistributor(admin);
        mockEscrow = new MockRolloverEscrow();

        // Grant RAFFLE_ROLE
        distributor.grantRole(distributor.RAFFLE_ROLE(), raffle);

        // Configure season
        vm.startPrank(raffle);
        distributor.configureSeason(
            SEASON_ID, address(sofToken), grandWinner, GRAND_AMOUNT, CONSOLATION_AMOUNT, TOTAL_PARTICIPANTS
        );

        address[] memory participants = new address[](2);
        participants[0] = loser1;
        participants[1] = loser2;
        distributor.setConsolationEligible(SEASON_ID, participants);
        vm.stopPrank();

        // Fund
        sofToken.mint(address(distributor), GRAND_AMOUNT + CONSOLATION_AMOUNT);
        vm.prank(raffle);
        distributor.fundSeason(SEASON_ID, GRAND_AMOUNT + CONSOLATION_AMOUNT);
    }

    // =========================================================================
    // test_claimConsolation_toRollover_depositsInEscrow
    // toRollover=true: SOF goes to escrow, deposit() is called, user wallet unchanged
    // =========================================================================
    function test_claimConsolation_toRollover_depositsInEscrow() public {
        // Set escrow
        distributor.setRolloverEscrow(address(mockEscrow));

        uint256 perLoser = CONSOLATION_AMOUNT / (TOTAL_PARTICIPANTS - 1);

        uint256 userBalanceBefore = sofToken.balanceOf(loser1);
        uint256 escrowBalanceBefore = sofToken.balanceOf(address(mockEscrow));

        vm.prank(loser1);
        distributor.claimConsolation(SEASON_ID, true);

        // User wallet unchanged
        assertEq(sofToken.balanceOf(loser1), userBalanceBefore, "user wallet should not change");

        // Escrow received the SOF
        assertEq(
            sofToken.balanceOf(address(mockEscrow)),
            escrowBalanceBefore + perLoser,
            "escrow should receive SOF"
        );

        // deposit() was called with correct args
        assertEq(mockEscrow.depositCount(), 1, "deposit() should be called once");
        (address depUser, uint256 depAmount, uint256 depSeason) = mockEscrow.deposits(0);
        assertEq(depUser, loser1, "deposit user should be loser1");
        assertEq(depAmount, perLoser, "deposit amount should match per-loser share");
        assertEq(depSeason, SEASON_ID, "deposit seasonId should match");

        // Claimed flag set
        assertTrue(distributor.isConsolationClaimed(SEASON_ID, loser1), "should be marked claimed");
    }

    // =========================================================================
    // test_claimConsolation_toWallet_existingBehavior
    // toRollover=false: existing behavior — SOF goes to user wallet
    // =========================================================================
    function test_claimConsolation_toWallet_existingBehavior() public {
        uint256 perLoser = CONSOLATION_AMOUNT / (TOTAL_PARTICIPANTS - 1);

        vm.prank(loser1);
        distributor.claimConsolation(SEASON_ID, false);

        assertEq(sofToken.balanceOf(loser1), perLoser, "user should receive SOF directly");
        assertTrue(distributor.isConsolationClaimed(SEASON_ID, loser1), "should be marked claimed");
    }

    // =========================================================================
    // test_claimConsolation_toRollover_revertIfNoEscrowSet
    // toRollover=true without setting escrow must revert with RolloverEscrowNotSet
    // =========================================================================
    function test_claimConsolation_toRollover_revertIfNoEscrowSet() public {
        // No setRolloverEscrow call
        vm.prank(loser1);
        vm.expectRevert(RolloverEscrowNotSet.selector);
        distributor.claimConsolation(SEASON_ID, true);
    }
}

// =============================================================================
// RolloverEscrowDepositTest
// Task 3: Deposit + Phase State Machine
// =============================================================================
contract RolloverEscrowDepositTest is Test {
    RolloverEscrow public escrow;
    MockSOFToken public sofToken;

    address public admin     = address(0xAD);
    address public treasury  = address(0x7EA);
    address public raffle    = address(0x1);
    address public distributor = address(0xD157);
    address public user      = address(0xBEEF);

    uint256 constant SEASON_ID = 1;
    uint256 constant NEXT_SEASON_ID = 2;
    uint256 constant DEPOSIT_AMOUNT = 1000e18;

    function setUp() public {
        sofToken = new MockSOFToken();

        vm.startPrank(admin);
        escrow = new RolloverEscrow(address(sofToken), treasury, raffle);
        // Grant DISTRIBUTOR_ROLE to the distributor address
        escrow.grantRole(escrow.DISTRIBUTOR_ROLE(), distributor);
        vm.stopPrank();

        // Mint SOF to distributor and pre-approve escrow
        sofToken.mint(distributor, 100_000e18);
        vm.prank(distributor);
        sofToken.approve(address(escrow), type(uint256).max);
    }

    // =========================================================================
    // test_deposit_happyPath
    // Distributor deposits for user; position and token balances updated correctly
    // =========================================================================
    function test_deposit_happyPath() public {
        // Open cohort first
        vm.prank(admin);
        escrow.openCohort(SEASON_ID, 600);

        uint256 distributorBalBefore = sofToken.balanceOf(distributor);
        uint256 escrowBalBefore      = sofToken.balanceOf(address(escrow));

        vm.prank(distributor);
        escrow.deposit(user, DEPOSIT_AMOUNT, SEASON_ID);

        // Position recorded
        (uint256 deposited, uint256 spent, bool refunded) = escrow.getUserPosition(SEASON_ID, user);
        assertEq(deposited, DEPOSIT_AMOUNT, "deposited amount");
        assertEq(spent, 0, "spent should be 0");
        assertFalse(refunded, "refunded should be false");

        // Cohort total updated
        (RolloverEscrow.EscrowPhase phase,,, uint256 totalDeposited,,,) = escrow.getCohortState(SEASON_ID);
        assertEq(totalDeposited, DEPOSIT_AMOUNT, "cohort totalDeposited");
        assertEq(uint8(phase), uint8(RolloverEscrow.EscrowPhase.Open), "phase should still be Open");

        // Token balances
        assertEq(sofToken.balanceOf(distributor), distributorBalBefore - DEPOSIT_AMOUNT, "distributor SOF reduced");
        assertEq(sofToken.balanceOf(address(escrow)), escrowBalBefore + DEPOSIT_AMOUNT, "escrow SOF increased");
    }

    // =========================================================================
    // test_deposit_revertIfNotDistributorRole
    // =========================================================================
    function test_deposit_revertIfNotDistributorRole() public {
        vm.prank(admin);
        escrow.openCohort(SEASON_ID, 600);

        vm.prank(user); // user does NOT have DISTRIBUTOR_ROLE
        vm.expectRevert(); // AccessControl revert
        escrow.deposit(user, DEPOSIT_AMOUNT, SEASON_ID);
    }

    // =========================================================================
    // test_deposit_revertIfPhaseNotOpen
    // After activation, deposit must revert with PhaseNotOpen
    // =========================================================================
    function test_deposit_revertIfPhaseNotOpen() public {
        vm.startPrank(admin);
        escrow.openCohort(SEASON_ID, 600);
        escrow.activateCohort(SEASON_ID, NEXT_SEASON_ID);
        vm.stopPrank();

        vm.prank(distributor);
        vm.expectRevert(abi.encodeWithSelector(PhaseNotOpen.selector, SEASON_ID));
        escrow.deposit(user, DEPOSIT_AMOUNT, SEASON_ID);
    }

    // =========================================================================
    // test_deposit_revertIfZeroAmount
    // =========================================================================
    function test_deposit_revertIfZeroAmount() public {
        vm.prank(admin);
        escrow.openCohort(SEASON_ID, 600);

        vm.prank(distributor);
        vm.expectRevert(AmountZero.selector);
        escrow.deposit(user, 0, SEASON_ID);
    }

    // =========================================================================
    // test_phaseTransition_open_to_active
    // =========================================================================
    function test_phaseTransition_open_to_active() public {
        vm.startPrank(admin);
        escrow.openCohort(SEASON_ID, 600);

        (RolloverEscrow.EscrowPhase phaseBefore,,,,,,) = escrow.getCohortState(SEASON_ID);
        assertEq(uint8(phaseBefore), uint8(RolloverEscrow.EscrowPhase.Open), "should be Open");

        escrow.activateCohort(SEASON_ID, NEXT_SEASON_ID);
        vm.stopPrank();

        (RolloverEscrow.EscrowPhase phaseAfter, uint256 nextSeason,,,,,) = escrow.getCohortState(SEASON_ID);
        assertEq(uint8(phaseAfter), uint8(RolloverEscrow.EscrowPhase.Active), "should be Active");
        assertEq(nextSeason, NEXT_SEASON_ID, "nextSeasonId should be set");
    }

    // =========================================================================
    // test_phaseTransition_active_to_closed
    // =========================================================================
    function test_phaseTransition_active_to_closed() public {
        vm.startPrank(admin);
        escrow.openCohort(SEASON_ID, 600);
        escrow.activateCohort(SEASON_ID, NEXT_SEASON_ID);
        escrow.closeCohort(SEASON_ID);
        vm.stopPrank();

        (RolloverEscrow.EscrowPhase phase,,,,,,) = escrow.getCohortState(SEASON_ID);
        assertEq(uint8(phase), uint8(RolloverEscrow.EscrowPhase.Closed), "should be Closed");
    }

    // =========================================================================
    // test_phaseTransition_open_to_expired_afterTimeout
    // Warp past expiryTimeout; next call auto-transitions Open -> Expired
    // =========================================================================
    function test_phaseTransition_open_to_expired_afterTimeout() public {
        vm.prank(admin);
        escrow.openCohort(SEASON_ID, 600);

        // Warp past the 30-day expiry timeout
        vm.warp(block.timestamp + 31 days);

        // Attempting a deposit triggers _checkAndUpdateExpiry internally,
        // but the phase check will revert with PhaseNotOpen after expiry update.
        // We verify expiry by reading getCohortState which also triggers expiry check
        // via a view path — or we trigger via a state-changing call.
        // The simplest approach: call activateCohort (admin) which checks expiry first.
        vm.prank(admin);
        vm.expectRevert(); // InvalidPhaseTransition — Open was auto-expired to Expired
        escrow.activateCohort(SEASON_ID, NEXT_SEASON_ID);

        // Now getCohortState should show Expired
        (RolloverEscrow.EscrowPhase phase,,,,,, bool isExpired) = escrow.getCohortState(SEASON_ID);
        assertEq(uint8(phase), uint8(RolloverEscrow.EscrowPhase.Expired), "should be Expired");
        assertTrue(isExpired, "isExpired should be true");
    }

    // =========================================================================
    // test_phaseTransition_revertInvalidTransitions
    // Cannot close an Open cohort (must go Open -> Active -> Closed)
    // =========================================================================
    function test_phaseTransition_revertInvalidTransitions() public {
        vm.startPrank(admin);
        escrow.openCohort(SEASON_ID, 600);

        // Attempt to close directly from Open — must revert
        vm.expectRevert(abi.encodeWithSelector(PhaseNotActive.selector, SEASON_ID));
        escrow.closeCohort(SEASON_ID);
        vm.stopPrank();
    }

    // =========================================================================
    // test_getAvailableBalance
    // =========================================================================
    function test_getAvailableBalance() public {
        vm.prank(admin);
        escrow.openCohort(SEASON_ID, 600);

        vm.prank(distributor);
        escrow.deposit(user, DEPOSIT_AMOUNT, SEASON_ID);

        uint256 avail = escrow.getAvailableBalance(SEASON_ID, user);
        assertEq(avail, DEPOSIT_AMOUNT, "available balance should equal deposited");
    }

    // =========================================================================
    // test_getBonusAmount
    // =========================================================================
    function test_getBonusAmount() public {
        vm.prank(admin);
        escrow.openCohort(SEASON_ID, 600); // 6% bonus

        uint256 bonus = escrow.getBonusAmount(SEASON_ID, 1000e18);
        assertEq(bonus, 60e18, "6% of 1000 SOF = 60 SOF");
    }
}

// =============================================================================
// RolloverEscrowSpendTest
// Task 4: spendFromRollover — spend rollover balance to buy tickets with bonus
// =============================================================================
contract RolloverEscrowSpendTest is Test {
    SOFToken public sofToken;
    RaffleToken public raffleToken;
    SOFBondingCurve public curve;
    RolloverEscrow public escrow;

    address public admin       = address(0xAD);
    address public treasury    = address(0x7EA);
    address public raffle      = address(0x1);
    address public distributor = address(0xD157);
    address public user        = address(0xBEEF);

    uint256 constant SEASON_ID      = 1;
    uint256 constant NEXT_SEASON_ID = 2;
    uint256 constant DEPOSIT_AMOUNT = 100e18; // 100 SOF deposited
    uint256 constant BONUS_BPS      = 600;    // 6%
    // Treasury starts with enough SOF to pay all bonuses
    uint256 constant TREASURY_SOF   = 10_000e18;
    // Curve: 0 fees, 1 SOF per ticket, cap 100_000 tickets
    uint16 constant BUY_FEE  = 0;
    uint16 constant SELL_FEE = 0;

    function setUp() public {
        vm.startPrank(admin);

        // Deploy tokens
        sofToken = new SOFToken("SOF", "SOF", 1_000_000e18);
        sofToken.transfer(treasury, TREASURY_SOF);

        // Deploy curve (0 fees for simplicity)
        curve = new SOFBondingCurve(address(sofToken), admin);

        raffleToken = new RaffleToken(
            "Season 2 Ticket",
            "SOF-2",
            NEXT_SEASON_ID,
            "Season 2",
            block.timestamp,
            block.timestamp + 7 days
        );
        raffleToken.grantRole(raffleToken.MINTER_ROLE(), address(curve));
        raffleToken.grantRole(raffleToken.BURNER_ROLE(), address(curve));

        RaffleTypes.BondStep[] memory steps = new RaffleTypes.BondStep[](1);
        steps[0] = RaffleTypes.BondStep({rangeTo: 100_000, price: 1e18});
        curve.initializeCurve(address(raffleToken), steps, BUY_FEE, SELL_FEE, treasury);

        // Deploy escrow
        escrow = new RolloverEscrow(address(sofToken), treasury, raffle);
        escrow.grantRole(escrow.DISTRIBUTOR_ROLE(), distributor);
        escrow.setBondingCurve(address(curve));

        // Grant ESCROW_ROLE on curve to the escrow contract
        curve.grantRole(curve.ESCROW_ROLE(), address(escrow));

        vm.stopPrank();

        // Treasury approves escrow to pull bonus SOF
        vm.prank(treasury);
        sofToken.approve(address(escrow), type(uint256).max);

        // Fund distributor and deposit for user into an ACTIVE cohort
        vm.prank(admin);
        sofToken.transfer(distributor, DEPOSIT_AMOUNT);

        vm.prank(distributor);
        sofToken.approve(address(escrow), type(uint256).max);

        vm.prank(admin);
        escrow.openCohort(SEASON_ID, uint16(BONUS_BPS));

        vm.prank(distributor);
        escrow.deposit(user, DEPOSIT_AMOUNT, SEASON_ID);

        vm.prank(admin);
        escrow.activateCohort(SEASON_ID, NEXT_SEASON_ID);
    }

    // =========================================================================
    // test_spend_happyPath_bonusApplied
    // Spend 50 SOF of 100 deposited; 6% bonus (3 SOF) pulled from treasury;
    // user receives 53 tickets (53 SOF worth at 1 SOF/ticket); position updated.
    // =========================================================================
    function test_spend_happyPath_bonusApplied() public {
        uint256 sofAmount    = 50e18;
        uint256 bonusAmount  = (sofAmount * BONUS_BPS) / 10_000; // 3e18
        uint256 totalSof     = sofAmount + bonusAmount;           // 53e18
        // With 0 fees: baseCost == totalSof, ticketAmount == 53
        uint256 ticketAmount = 53; // 53 tickets @ 1 SOF each
        uint256 maxTotalSof  = totalSof; // exact, no headroom needed (0 fee)

        uint256 treasuryBefore = sofToken.balanceOf(treasury);
        uint256 escrowBefore   = sofToken.balanceOf(address(escrow));

        vm.prank(user);
        escrow.spendFromRollover(SEASON_ID, sofAmount, ticketAmount, maxTotalSof);

        // User gets the tickets
        assertEq(raffleToken.balanceOf(user), ticketAmount, "user ticket balance");

        // Treasury lost the bonus
        assertEq(sofToken.balanceOf(treasury), treasuryBefore - bonusAmount, "treasury SOF reduced by bonus");

        // Escrow SOF: sent sofAmount to curve, received bonusAmount from treasury,
        // net = escrowBefore - sofAmount (bonus came in then went to curve)
        assertEq(sofToken.balanceOf(address(escrow)), escrowBefore - sofAmount, "escrow SOF net");

        // Position updated
        (uint256 deposited, uint256 spent,) = escrow.getUserPosition(SEASON_ID, user);
        assertEq(deposited, DEPOSIT_AMOUNT, "deposited unchanged");
        assertEq(spent, sofAmount, "spent updated");

        // Cohort totals updated
        (,,,, uint256 totalSpent, uint256 totalBonusPaid,) = escrow.getCohortState(SEASON_ID);
        assertEq(totalSpent, sofAmount, "cohort totalSpent");
        assertEq(totalBonusPaid, bonusAmount, "cohort totalBonusPaid");
    }

    // =========================================================================
    // test_spend_partialSpend_remainderRefundable
    // After spending 50 SOF of 100, available balance == 50 SOF.
    // =========================================================================
    function test_spend_partialSpend_remainderRefundable() public {
        uint256 sofAmount   = 50e18;
        uint256 bonusAmount = (sofAmount * BONUS_BPS) / 10_000;
        uint256 totalSof    = sofAmount + bonusAmount;
        uint256 ticketAmount = 53;

        vm.prank(user);
        escrow.spendFromRollover(SEASON_ID, sofAmount, ticketAmount, totalSof);

        uint256 avail = escrow.getAvailableBalance(SEASON_ID, user);
        assertEq(avail, DEPOSIT_AMOUNT - sofAmount, "remaining available balance");
    }

    // =========================================================================
    // test_spend_revertIfPhaseNotActive
    // Close the cohort then try to spend — must revert with PhaseNotActive.
    // =========================================================================
    function test_spend_revertIfPhaseNotActive() public {
        vm.prank(admin);
        escrow.closeCohort(SEASON_ID);

        vm.prank(user);
        vm.expectRevert(abi.encodeWithSelector(PhaseNotActive.selector, SEASON_ID));
        escrow.spendFromRollover(SEASON_ID, 50e18, 53, type(uint256).max);
    }

    // =========================================================================
    // test_spend_revertIfExceedsBalance
    // Try to spend more than deposited — must revert with ExceedsBalance.
    // =========================================================================
    function test_spend_revertIfExceedsBalance() public {
        uint256 tooMuch = DEPOSIT_AMOUNT + 1e18;

        vm.prank(user);
        vm.expectRevert(
            abi.encodeWithSelector(ExceedsBalance.selector, tooMuch, DEPOSIT_AMOUNT)
        );
        escrow.spendFromRollover(SEASON_ID, tooMuch, 1, type(uint256).max);
    }

    // =========================================================================
    // test_spend_revertIfTreasuryBalanceInsufficient
    // Drain treasury; the safeTransferFrom for bonus must revert.
    // =========================================================================
    function test_spend_revertIfTreasuryBalanceInsufficient() public {
        // Drain all treasury SOF to admin
        vm.startPrank(treasury);
        sofToken.transfer(admin, sofToken.balanceOf(treasury));
        vm.stopPrank();

        vm.prank(user);
        vm.expectRevert(); // ERC20 transfer will fail
        escrow.spendFromRollover(SEASON_ID, 50e18, 53, type(uint256).max);
    }
}
