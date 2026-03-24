// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/faucet/SOFFaucet.sol";
import "../src/token/SOFToken.sol";

/**
 * @title SOFFaucetTest
 * @dev Test contract for SOFFaucet
 */
contract SOFFaucetTest is Test {
    SOFFaucet public faucet;
    SOFToken public sofToken;

    address public owner = address(1);
    address public user1 = address(2);
    address public user2 = address(3);

    uint256 public constant INITIAL_SUPPLY = 1_000_000 * 10 ** 18;
    uint256 public constant FAUCET_SUPPLY = 100_000 * 10 ** 18; // Increased to 100k SOF
    uint256 public constant AMOUNT_PER_REQUEST = 10_000 * 10 ** 18; // 10,000 SOF tokens
    uint256 public constant COOLDOWN_PERIOD = 6 * 60 * 60; // 6 hours

    function setUp() public {
        vm.startPrank(owner);

        // Deploy SOF token
        sofToken = new SOFToken("SecondOrder Fun Token", "SOF", INITIAL_SUPPLY);

        // Set up allowed chain IDs
        uint256[] memory allowedChainIds = new uint256[](2);
        allowedChainIds[0] = 31337; // Anvil
        allowedChainIds[1] = 11155111; // Sepolia

        // Deploy faucet
        faucet = new SOFFaucet(address(sofToken), AMOUNT_PER_REQUEST, COOLDOWN_PERIOD, allowedChainIds);

        // Fund faucet
        sofToken.transfer(address(faucet), FAUCET_SUPPLY);

        vm.stopPrank();
    }

    function testInitialState() public view {
        assertEq(address(faucet.sofToken()), address(sofToken));
        assertEq(faucet.amountPerRequest(), AMOUNT_PER_REQUEST);
        assertEq(faucet.cooldownPeriod(), COOLDOWN_PERIOD);
        assertEq(sofToken.balanceOf(address(faucet)), FAUCET_SUPPLY);
    }

    function testClaim() public {
        vm.prank(user1);
        faucet.claim();

        assertEq(sofToken.balanceOf(user1), AMOUNT_PER_REQUEST);
        assertEq(faucet.lastClaimTime(user1), block.timestamp);
    }

    function testCooldownPeriod() public {
        vm.prank(user1);
        faucet.claim();

        // Try to claim again immediately
        vm.prank(user1);
        vm.expectRevert("Cooldown period not yet passed");
        faucet.claim();

        // Advance time by cooldown period
        vm.warp(block.timestamp + COOLDOWN_PERIOD);

        // Should be able to claim again
        vm.prank(user1);
        faucet.claim();

        assertEq(sofToken.balanceOf(user1), AMOUNT_PER_REQUEST * 2);
    }

    function testChainIdRestriction() public {
        // Set chain ID to unsupported value
        vm.chainId(999);

        vm.prank(user1);
        vm.expectRevert("Faucet not available on this network");
        faucet.claim();

        // Set chain ID back to supported value
        vm.chainId(31337);

        vm.prank(user1);
        faucet.claim(); // Should succeed
    }

    function testAdminFunctions() public {
        uint256 newAmount = 200 * 10 ** 18;
        uint256 newCooldown = 12 * 60 * 60; // 12 hours

        vm.prank(owner);
        faucet.setAmountPerRequest(newAmount);

        vm.prank(owner);
        faucet.setCooldownPeriod(newCooldown);

        assertEq(faucet.amountPerRequest(), newAmount);
        assertEq(faucet.cooldownPeriod(), newCooldown);

        // Non-owner should not be able to call admin functions
        vm.prank(user1);
        vm.expectRevert();
        faucet.setAmountPerRequest(100);
    }

    function testWithdrawTokens() public {
        uint256 withdrawAmount = 1000 * 10 ** 18;

        vm.prank(owner);
        faucet.withdrawTokens(withdrawAmount);

        assertEq(sofToken.balanceOf(owner), INITIAL_SUPPLY - FAUCET_SUPPLY + withdrawAmount);
        assertEq(sofToken.balanceOf(address(faucet)), FAUCET_SUPPLY - withdrawAmount);
    }

    function testContributeKarma() public {
        // Give user1 some tokens
        vm.prank(owner);
        sofToken.transfer(user1, 1000 * 10 ** 18);

        // User1 approves faucet to spend their tokens
        vm.prank(user1);
        sofToken.approve(address(faucet), 500 * 10 ** 18);

        // Initial balances
        uint256 initialFaucetBalance = sofToken.balanceOf(address(faucet));
        uint256 initialUserBalance = sofToken.balanceOf(user1);

        // User1 contributes karma
        vm.prank(user1);
        faucet.contributeKarma(500 * 10 ** 18);

        // Check balances after karma contribution
        assertEq(sofToken.balanceOf(address(faucet)), initialFaucetBalance + 500 * 10 ** 18);
        assertEq(sofToken.balanceOf(user1), initialUserBalance - 500 * 10 ** 18);
    }

    function testContributeKarmaZeroAmount() public {
        // Give user1 some tokens
        vm.prank(owner);
        sofToken.transfer(user1, 1000 * 10 ** 18);

        // User1 approves faucet to spend their tokens
        vm.prank(user1);
        sofToken.approve(address(faucet), 500 * 10 ** 18);

        // Try to contribute zero karma
        vm.prank(user1);
        vm.expectRevert("Amount must be positive");
        faucet.contributeKarma(0);
    }
}
