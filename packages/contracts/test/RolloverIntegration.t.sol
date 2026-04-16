// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";

import {SOFToken} from "../src/token/SOFToken.sol";
import {RaffleToken} from "../src/token/RaffleToken.sol";
import {SOFBondingCurve} from "../src/curve/SOFBondingCurve.sol";
import {RafflePrizeDistributor} from "../src/core/RafflePrizeDistributor.sol";
import {RolloverEscrow} from "../src/core/RolloverEscrow.sol";
import {RaffleTypes} from "../src/lib/RaffleTypes.sol";

/**
 * @title RolloverIntegrationTest
 * @notice Multi-season rollover lifecycle tests exercising the full system:
 *         SOFToken, RolloverEscrow, RafflePrizeDistributor, SOFBondingCurve, RaffleToken.
 *
 * Two scenarios:
 *   1. Full cycle — deposit → spend (partial) → refund (remainder)
 *   2. Skipped season — deposit → cohort closed without spend → refund full, no bonus
 */
contract RolloverIntegrationTest is Test {
    // -------------------------------------------------------------------------
    // Contracts
    // -------------------------------------------------------------------------

    SOFToken public sofToken;
    RolloverEscrow public escrow;
    RafflePrizeDistributor public distributor;
    SOFBondingCurve public curve;
    RaffleToken public raffleToken;

    // -------------------------------------------------------------------------
    // Actors
    // -------------------------------------------------------------------------

    address public admin     = makeAddr("admin");
    address public treasury  = makeAddr("treasury");
    address public raffleAddr = makeAddr("raffle");  // holds RAFFLE_ROLE on distributor
    address public user1     = makeAddr("user1");
    address public user2     = makeAddr("user2");
    address public grandWinner = makeAddr("grandWinner");

    // -------------------------------------------------------------------------
    // Constants
    // -------------------------------------------------------------------------

    uint256 constant SEASON_1      = 1;
    uint256 constant SEASON_2      = 2;
    uint256 constant INITIAL_SOF   = 1_000_000e18;
    uint256 constant TREASURY_SOF  = 100_000e18;   // available to pay bonuses
    uint256 constant GRAND_AMOUNT  = 600e18;
    // consolation split: 3 total participants (grandWinner + user1 + user2)
    // => 2 losers => 100 SOF each
    uint256 constant CONSOLATION_AMOUNT = 200e18;  // 2 losers × 100 SOF
    uint256 constant PER_LOSER     = 100e18;       // CONSOLATION_AMOUNT / 2
    uint256 constant TOTAL_PARTICIPANTS = 3;
    uint16  constant BONUS_BPS     = 600;          // 6%

    // -------------------------------------------------------------------------
    // setUp: deploy and wire the full system
    // -------------------------------------------------------------------------

    function setUp() public {
        vm.startPrank(admin);

        // 1. SOFToken
        sofToken = new SOFToken("SOF", "SOF", INITIAL_SOF);

        // 2. RolloverEscrow
        escrow = new RolloverEscrow(address(sofToken), treasury, raffleAddr);

        // 3. RafflePrizeDistributor — grant RAFFLE_ROLE to raffleAddr
        distributor = new RafflePrizeDistributor(admin);
        distributor.grantRole(distributor.RAFFLE_ROLE(), raffleAddr);

        // Wire escrow into distributor
        distributor.setRolloverEscrow(address(escrow));

        // 4. Grant DISTRIBUTOR_ROLE on escrow to distributor
        escrow.grantRole(escrow.DISTRIBUTOR_ROLE(), address(distributor));

        // 5. SOFBondingCurve for Season 2
        curve = new SOFBondingCurve(address(sofToken), admin);

        raffleToken = new RaffleToken(
            "Season 2 Ticket",
            "SOF-2",
            SEASON_2,
            "Season 2",
            block.timestamp,
            block.timestamp + 30 days
        );

        // Grant MINTER/BURNER to curve
        raffleToken.grantRole(raffleToken.MINTER_ROLE(), address(curve));
        raffleToken.grantRole(raffleToken.BURNER_ROLE(), address(curve));

        // Initialize curve: 1 SOF per ticket, 0 fees, cap 100 000 tickets
        RaffleTypes.BondStep[] memory steps = new RaffleTypes.BondStep[](1);
        steps[0] = RaffleTypes.BondStep({rangeTo: 100_000, price: 1e18});
        curve.initializeCurve(address(raffleToken), steps, 0, 0, treasury);

        // Grant ESCROW_ROLE on curve to the escrow contract
        curve.grantRole(curve.ESCROW_ROLE(), address(escrow));

        // 6. Wire escrow: set bonding curve
        escrow.setBondingCurve(address(curve));

        // Fund treasury with SOF and approve escrow to pull bonus
        sofToken.transfer(treasury, TREASURY_SOF);

        vm.stopPrank();

        // Treasury approves escrow to pull bonus SOF
        vm.prank(treasury);
        sofToken.approve(address(escrow), type(uint256).max);

        // The distributor must pre-approve escrow for the rollover deposit pull.
        // claimConsolation does: safeTransfer(escrow, amount) then escrow.deposit(),
        // which internally calls safeTransferFrom(distributor, escrow, amount).
        // That second pull requires a prior allowance from distributor → escrow.
        vm.prank(address(distributor));
        sofToken.approve(address(escrow), type(uint256).max);

        // Fund the distributor for Season 1 via RAFFLE_ROLE
        uint256 totalPrize = GRAND_AMOUNT + CONSOLATION_AMOUNT;
        vm.prank(admin);
        sofToken.transfer(address(distributor), totalPrize);
    }

    // =========================================================================
    // Helper: configure + fund Season 1 and open the rollover cohort
    // =========================================================================

    function _setupSeason1() internal {
        vm.startPrank(raffleAddr);

        // Configure season
        distributor.configureSeason(
            SEASON_1,
            address(sofToken),
            grandWinner,
            GRAND_AMOUNT,
            CONSOLATION_AMOUNT,
            TOTAL_PARTICIPANTS
        );

        // Register losers as eligible
        address[] memory losers = new address[](2);
        losers[0] = user1;
        losers[1] = user2;
        distributor.setConsolationEligible(SEASON_1, losers);

        // Fund the season
        distributor.fundSeason(SEASON_1, GRAND_AMOUNT + CONSOLATION_AMOUNT);

        vm.stopPrank();

        // Open rollover cohort for Season 1 (uses default bonus bps)
        vm.prank(admin);
        escrow.openCohort(SEASON_1, BONUS_BPS);
    }

    // =========================================================================
    // test_fullRolloverCycle_depositSpendRefund
    //
    // 1. Configure Season 1; register losers; fund; open cohort
    // 2. User1 claims with toRollover=true  → SOF lands in escrow
    // 3. User2 claims with toRollover=false → SOF lands in user2 wallet
    // 4. Activate cohort for Season 2
    // 5. User1 spends 60 SOF of 100 → receives tickets with 6% bonus
    // 6. User1 refunds remaining 40 SOF → returned to wallet
    // =========================================================================
    function test_fullRolloverCycle_depositSpendRefund() public {
        _setupSeason1();

        // --- Step 2: User1 rolls consolation into escrow ---
        uint256 user1BalBefore    = sofToken.balanceOf(user1);
        uint256 escrowBalBefore   = sofToken.balanceOf(address(escrow));

        vm.prank(user1);
        distributor.claimConsolation(SEASON_1, true); // toRollover=true

        // User1 wallet unchanged; escrow received the funds.
        // The flow is: distributor.safeTransfer(escrow, amount) — then escrow.deposit()
        // which calls safeTransferFrom(distributor, escrow, amount).
        // Net result: escrow gains 2× PER_LOSER from distributor; user position credited PER_LOSER.
        assertEq(sofToken.balanceOf(user1), user1BalBefore, "user1 wallet should not change on rollover");
        assertEq(
            sofToken.balanceOf(address(escrow)),
            escrowBalBefore + 2 * PER_LOSER,
            "escrow should hold double PER_LOSER (safeTransfer + safeTransferFrom)"
        );

        // Escrow position recorded
        (uint256 deposited,,) = escrow.getUserPosition(SEASON_1, user1);
        assertEq(deposited, PER_LOSER, "user1 escrow position should equal per-loser share");

        // --- Step 3: User2 takes consolation directly ---
        uint256 user2BalBefore = sofToken.balanceOf(user2);

        vm.prank(user2);
        distributor.claimConsolation(SEASON_1, false); // toRollover=false

        assertEq(
            sofToken.balanceOf(user2),
            user2BalBefore + PER_LOSER,
            "user2 should receive SOF directly"
        );

        // Verify user2 has no escrow position
        (uint256 dep2,,) = escrow.getUserPosition(SEASON_1, user2);
        assertEq(dep2, 0, "user2 should have no escrow deposit");

        // --- Step 4: Activate cohort targeting Season 2 ---
        vm.prank(admin);
        escrow.activateCohort(SEASON_1, SEASON_2);

        (RolloverEscrow.EscrowPhase phase, uint256 nextSeason,,,,,) = escrow.getCohortState(SEASON_1);
        assertEq(uint8(phase), uint8(RolloverEscrow.EscrowPhase.Active), "cohort should be Active");
        assertEq(nextSeason, SEASON_2, "nextSeasonId should be Season 2");

        // --- Step 5: User1 spends 60 SOF with 6% bonus ---
        uint256 spendAmount  = 60e18;
        uint256 bonusAmount  = (spendAmount * BONUS_BPS) / 10_000; // 3.6e18
        uint256 totalSof     = spendAmount + bonusAmount;           // 63.6e18
        // With price 1e18 and 0 fees: tickets = totalSof / 1e18 = 63 (integer division)
        uint256 ticketAmount = totalSof / 1e18;                     // 63
        uint256 maxTotalSof  = totalSof;                            // exact

        uint256 treasuryBefore = sofToken.balanceOf(treasury);
        uint256 escrowSofBefore = sofToken.balanceOf(address(escrow));

        vm.prank(user1);
        escrow.spendFromRollover(SEASON_1, spendAmount, ticketAmount, maxTotalSof);

        // User1 receives tickets
        assertEq(raffleToken.balanceOf(user1), ticketAmount, "user1 should receive raffle tickets");

        // Treasury lost the bonus
        assertEq(
            sofToken.balanceOf(treasury),
            treasuryBefore - bonusAmount,
            "treasury should lose bonus amount"
        );

        // Escrow net SOF calculation:
        //   + bonusAmount pulled from treasury
        //   - curve charged ticketAmount * pricePerTicket (1e18) for the tickets minted
        //   (integer truncation: ticketAmount = floor(totalSof / 1e18), curve charges ticketAmount * 1e18)
        uint256 curveCost = ticketAmount * 1e18;
        assertEq(
            sofToken.balanceOf(address(escrow)),
            escrowSofBefore + bonusAmount - curveCost,
            "escrow SOF net should reflect bonus received minus curve cost"
        );

        // Position: spent updated
        (uint256 dep1, uint256 spent1,) = escrow.getUserPosition(SEASON_1, user1);
        assertEq(dep1, PER_LOSER, "deposited unchanged");
        assertEq(spent1, spendAmount, "spent should equal spendAmount");

        // Available balance = deposited - spent
        uint256 remaining = PER_LOSER - spendAmount;
        assertEq(
            escrow.getAvailableBalance(SEASON_1, user1),
            remaining,
            "available balance should be 40 SOF"
        );

        // --- Step 6: User1 refunds the remaining 40 SOF ---
        uint256 user1BalBeforeRefund = sofToken.balanceOf(user1);

        vm.prank(user1);
        escrow.refund(SEASON_1);

        assertEq(
            sofToken.balanceOf(user1),
            user1BalBeforeRefund + remaining,
            "user1 should receive unspent SOF on refund"
        );

        // Position flagged as refunded; available balance zero
        (,, bool refunded1) = escrow.getUserPosition(SEASON_1, user1);
        assertTrue(refunded1, "user1 position should be flagged as refunded");
        assertEq(escrow.getAvailableBalance(SEASON_1, user1), 0, "available balance should be zero after refund");
    }

    // =========================================================================
    // test_rolloverEligibility_skippedSeasonBreaksChain
    //
    // 1. User1 deposits into Season 1 cohort
    // 2. Cohort is activated then closed — user never spends
    // 3. User1 refunds — receives full deposit back, no bonus, no tickets
    // =========================================================================
    function test_rolloverEligibility_skippedSeasonBreaksChain() public {
        _setupSeason1();

        // User1 claims consolation to escrow
        vm.prank(user1);
        distributor.claimConsolation(SEASON_1, true);

        (uint256 deposited,,) = escrow.getUserPosition(SEASON_1, user1);
        assertEq(deposited, PER_LOSER, "user1 deposited PER_LOSER");

        // Activate then close cohort without any spend
        vm.startPrank(admin);
        escrow.activateCohort(SEASON_1, SEASON_2);
        escrow.closeCohort(SEASON_1);
        vm.stopPrank();

        (RolloverEscrow.EscrowPhase phase,,,,,,) = escrow.getCohortState(SEASON_1);
        assertEq(uint8(phase), uint8(RolloverEscrow.EscrowPhase.Closed), "cohort should be Closed");

        // User1 never spent any tickets
        assertEq(raffleToken.balanceOf(user1), 0, "user1 should have zero tickets");

        // User1 refunds from Closed phase
        uint256 user1BalBefore = sofToken.balanceOf(user1);

        vm.prank(user1);
        escrow.refund(SEASON_1);

        // Full deposit returned — no bonus
        assertEq(
            sofToken.balanceOf(user1),
            user1BalBefore + PER_LOSER,
            "user1 should receive full deposit back (no bonus)"
        );

        // Position refunded; nothing spent
        (uint256 dep, uint256 spent, bool refunded) = escrow.getUserPosition(SEASON_1, user1);
        assertEq(dep, PER_LOSER, "deposited unchanged");
        assertEq(spent, 0, "spent should remain zero");
        assertTrue(refunded, "position should be flagged as refunded");

        // Available balance zero after refund
        assertEq(escrow.getAvailableBalance(SEASON_1, user1), 0, "available balance zero after refund");
    }
}
