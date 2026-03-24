// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/token/SOFToken.sol";
import "../src/curve/SOFBondingCurve.sol";
import "../src/token/RaffleToken.sol";
import "../src/lib/RaffleTypes.sol";

contract TreasurySystemTest is Test {
    SOFToken public sofToken;
    SOFBondingCurve public bondingCurve;
    RaffleToken public raffleToken;

    address public admin = address(1);
    address public treasury = address(2);
    address public user1 = address(3);
    address public user2 = address(4);

    uint256 constant INITIAL_SUPPLY = 100_000_000 ether;
    uint16 constant BUY_FEE = 10; // 0.1%
    uint16 constant SELL_FEE = 70; // 0.7%

    event FeesExtracted(address indexed to, uint256 amount);

    function setUp() public {
        vm.startPrank(admin);

        // Deploy SOF token (simplified - no treasury param)
        sofToken = new SOFToken("SOF Token", "SOF", INITIAL_SUPPLY);

        // Deploy bonding curve with admin parameter
        bondingCurve = new SOFBondingCurve(address(sofToken), admin);

        // Deploy raffle token with season info
        raffleToken = new RaffleToken(
            "Raffle Token",
            "RAFFLE",
            1, // seasonId
            "Test Season",
            block.timestamp,
            block.timestamp + 14 days
        );

        // Set up bond steps
        RaffleTypes.BondStep[] memory bondSteps = new RaffleTypes.BondStep[](3);
        bondSteps[0] = RaffleTypes.BondStep({rangeTo: 1000, price: 10 ether});
        bondSteps[1] = RaffleTypes.BondStep({rangeTo: 2000, price: 20 ether});
        bondSteps[2] = RaffleTypes.BondStep({rangeTo: 3000, price: 30 ether});

        // Initialize curve with treasury address (direct transfer)
        bondingCurve.initializeCurve(address(raffleToken), bondSteps, BUY_FEE, SELL_FEE, treasury);

        // Grant roles for raffle token minting/burning
        raffleToken.grantRole(raffleToken.MINTER_ROLE(), address(bondingCurve));
        raffleToken.grantRole(raffleToken.BURNER_ROLE(), address(bondingCurve));

        // Transfer SOF to users for testing
        sofToken.transfer(user1, 50_000 ether);
        sofToken.transfer(user2, 50_000 ether);

        vm.stopPrank();
    }

    function testTreasuryAddressStoredInCurve() public view {
        assertEq(bondingCurve.treasuryAddress(), treasury, "Treasury address should be stored in curve");
    }

    function testFeeAccumulationOnBuy() public {
        vm.startPrank(user1);

        uint256 tokenAmount = 100;
        uint256 baseCost = bondingCurve.calculateBuyPrice(tokenAmount);
        uint256 expectedFee = (baseCost * BUY_FEE) / 10000;
        uint256 totalCost = baseCost + expectedFee;

        sofToken.approve(address(bondingCurve), totalCost);
        bondingCurve.buyTokens(tokenAmount, totalCost);

        assertEq(bondingCurve.accumulatedFees(), expectedFee, "Fees should accumulate on buy");

        vm.stopPrank();
    }

    function testFeeAccumulationOnSell() public {
        // First buy some tokens
        vm.startPrank(user1);

        uint256 tokenAmount = 100;
        uint256 buyCost = bondingCurve.calculateBuyPrice(tokenAmount);
        uint256 buyFee = (buyCost * BUY_FEE) / 10000;

        sofToken.approve(address(bondingCurve), buyCost + buyFee);
        bondingCurve.buyTokens(tokenAmount, buyCost + buyFee);

        uint256 feesAfterBuy = bondingCurve.accumulatedFees();

        // Now sell tokens
        uint256 sellAmount = 50;
        uint256 baseReturn = bondingCurve.calculateSellPrice(sellAmount);
        uint256 sellFee = (baseReturn * SELL_FEE) / 10000;

        raffleToken.approve(address(bondingCurve), sellAmount);
        bondingCurve.sellTokens(sellAmount, 0);

        assertEq(bondingCurve.accumulatedFees(), feesAfterBuy + sellFee, "Fees should accumulate on sell");

        vm.stopPrank();
    }

    function testExtractFeesDirectlyToTreasury() public {
        // User buys tokens to accumulate fees
        vm.startPrank(user1);
        uint256 tokenAmount = 100;
        uint256 totalCost = bondingCurve.calculateBuyPrice(tokenAmount) * 10010 / 10000;
        sofToken.approve(address(bondingCurve), totalCost);
        bondingCurve.buyTokens(tokenAmount, totalCost);
        vm.stopPrank();

        uint256 accumulatedFees = bondingCurve.accumulatedFees();
        assertTrue(accumulatedFees > 0, "Fees should be accumulated");

        uint256 treasuryBalanceBefore = sofToken.balanceOf(treasury);

        // Admin extracts fees - should go directly to treasury
        vm.prank(admin);
        vm.expectEmit(true, false, false, true);
        emit FeesExtracted(treasury, accumulatedFees);
        bondingCurve.extractFeesToTreasury();

        assertEq(bondingCurve.accumulatedFees(), 0, "Accumulated fees should be zero after extraction");
        assertEq(
            sofToken.balanceOf(treasury),
            treasuryBalanceBefore + accumulatedFees,
            "Fees should be sent directly to treasury"
        );
    }

    function testCannotExtractWithoutRole() public {
        // User buys tokens to accumulate fees
        vm.startPrank(user1);
        uint256 tokenAmount = 100;
        uint256 totalCost = bondingCurve.calculateBuyPrice(tokenAmount) * 10010 / 10000;
        sofToken.approve(address(bondingCurve), totalCost);
        bondingCurve.buyTokens(tokenAmount, totalCost);
        vm.stopPrank();

        // Non-admin tries to extract
        vm.prank(user2);
        vm.expectRevert();
        bondingCurve.extractFeesToTreasury();
    }

    function testCannotExtractZeroFees() public {
        vm.prank(admin);
        vm.expectRevert(AmountZero.selector);
        bondingCurve.extractFeesToTreasury();
    }

    function testReservesNotAffectedByFees() public {
        vm.startPrank(user1);

        uint256 tokenAmount = 100;
        uint256 baseCost = bondingCurve.calculateBuyPrice(tokenAmount);
        uint256 fee = (baseCost * BUY_FEE) / 10000;
        uint256 totalCost = baseCost + fee;

        sofToken.approve(address(bondingCurve), totalCost);
        bondingCurve.buyTokens(tokenAmount, totalCost);

        // Reserves should only include base cost, not fees
        assertEq(bondingCurve.getSofReserves(), baseCost, "Reserves should equal base cost");
        assertEq(bondingCurve.accumulatedFees(), fee, "Fees should be tracked separately");

        vm.stopPrank();
    }

    function testMultipleUsersFeesAccumulate() public {
        // User 1 buys
        vm.startPrank(user1);
        uint256 tokenAmount1 = 100;
        uint256 totalCost1 = bondingCurve.calculateBuyPrice(tokenAmount1) * 10010 / 10000;
        sofToken.approve(address(bondingCurve), totalCost1);
        bondingCurve.buyTokens(tokenAmount1, totalCost1);
        vm.stopPrank();

        uint256 feesAfterUser1 = bondingCurve.accumulatedFees();

        // User 2 buys
        vm.startPrank(user2);
        uint256 tokenAmount2 = 50;
        uint256 totalCost2 = bondingCurve.calculateBuyPrice(tokenAmount2) * 10010 / 10000;
        sofToken.approve(address(bondingCurve), totalCost2);
        bondingCurve.buyTokens(tokenAmount2, totalCost2);
        vm.stopPrank();

        uint256 feesAfterUser2 = bondingCurve.accumulatedFees();

        assertTrue(feesAfterUser2 > feesAfterUser1, "Fees should accumulate from multiple users");
    }

    function testMultipleExtractions() public {
        // First buy and extract
        vm.startPrank(user1);
        uint256 tokenAmount1 = 100;
        uint256 totalCost1 = bondingCurve.calculateBuyPrice(tokenAmount1) * 10010 / 10000;
        sofToken.approve(address(bondingCurve), totalCost1);
        bondingCurve.buyTokens(tokenAmount1, totalCost1);
        vm.stopPrank();

        uint256 fees1 = bondingCurve.accumulatedFees();
        uint256 treasuryBalanceBefore = sofToken.balanceOf(treasury);

        vm.prank(admin);
        bondingCurve.extractFeesToTreasury();

        assertEq(sofToken.balanceOf(treasury), treasuryBalanceBefore + fees1, "First extraction to treasury");

        // Second buy and extract
        vm.startPrank(user2);
        uint256 tokenAmount2 = 50;
        uint256 totalCost2 = bondingCurve.calculateBuyPrice(tokenAmount2) * 10010 / 10000;
        sofToken.approve(address(bondingCurve), totalCost2);
        bondingCurve.buyTokens(tokenAmount2, totalCost2);
        vm.stopPrank();

        uint256 fees2 = bondingCurve.accumulatedFees();

        vm.prank(admin);
        bondingCurve.extractFeesToTreasury();

        assertEq(
            sofToken.balanceOf(treasury),
            treasuryBalanceBefore + fees1 + fees2,
            "Second extraction should add to treasury balance"
        );
    }

    function testDifferentTreasuryPerCurve() public {
        // This test verifies that different curves can have different treasuries
        // (enabling 3rd party raffles with their own fee destinations)

        address treasury2 = address(10);

        vm.startPrank(admin);

        // Deploy second bonding curve with different treasury
        SOFBondingCurve bondingCurve2 = new SOFBondingCurve(address(sofToken), admin);

        RaffleToken raffleToken2 = new RaffleToken(
            "Raffle Token 2",
            "RAFFLE2",
            2,
            "Test Season 2",
            block.timestamp,
            block.timestamp + 14 days
        );

        RaffleTypes.BondStep[] memory bondSteps = new RaffleTypes.BondStep[](2);
        bondSteps[0] = RaffleTypes.BondStep({rangeTo: 500, price: 5 ether});
        bondSteps[1] = RaffleTypes.BondStep({rangeTo: 1000, price: 10 ether});

        // Initialize with different treasury
        bondingCurve2.initializeCurve(address(raffleToken2), bondSteps, BUY_FEE, SELL_FEE, treasury2);

        raffleToken2.grantRole(raffleToken2.MINTER_ROLE(), address(bondingCurve2));
        raffleToken2.grantRole(raffleToken2.BURNER_ROLE(), address(bondingCurve2));

        vm.stopPrank();

        // Verify different treasuries
        assertEq(bondingCurve.treasuryAddress(), treasury, "First curve has treasury 1");
        assertEq(bondingCurve2.treasuryAddress(), treasury2, "Second curve has treasury 2");

        // Buy on curve2 and extract
        vm.startPrank(user1);
        uint256 tokenAmount = 50;
        uint256 totalCost = bondingCurve2.calculateBuyPrice(tokenAmount) * 10010 / 10000;
        sofToken.approve(address(bondingCurve2), totalCost);
        bondingCurve2.buyTokens(tokenAmount, totalCost);
        vm.stopPrank();

        uint256 treasury2BalanceBefore = sofToken.balanceOf(treasury2);
        uint256 fees = bondingCurve2.accumulatedFees();

        vm.prank(admin);
        bondingCurve2.extractFeesToTreasury();

        // Fees should go to treasury2, not treasury
        assertEq(
            sofToken.balanceOf(treasury2),
            treasury2BalanceBefore + fees,
            "Fees should go to curve's designated treasury"
        );
    }
}
