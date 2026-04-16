// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {SOFToken} from "../src/token/SOFToken.sol";
import {RaffleToken} from "../src/token/RaffleToken.sol";
import {SOFBondingCurve} from "../src/curve/SOFBondingCurve.sol";
import {RaffleTypes} from "../src/lib/RaffleTypes.sol";

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
