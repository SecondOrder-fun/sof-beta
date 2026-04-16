// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {SOFToken} from "../src/token/SOFToken.sol";
import {RaffleToken} from "../src/token/RaffleToken.sol";
import {SOFBondingCurve} from "../src/curve/SOFBondingCurve.sol";
import {RaffleTypes} from "../src/lib/RaffleTypes.sol";
import {RafflePrizeDistributor, NotAParticipant, RolloverEscrowNotSet} from "../src/core/RafflePrizeDistributor.sol";
import {IRolloverEscrow} from "../src/core/IRolloverEscrow.sol";
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
