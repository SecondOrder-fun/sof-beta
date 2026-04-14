// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {Raffle} from "../src/core/Raffle.sol";
import {SOFBondingCurve} from "../src/curve/SOFBondingCurve.sol";
import {RaffleTypes} from "../src/lib/RaffleTypes.sol";
import {SeasonFactory} from "../src/core/SeasonFactory.sol";
import {RafflePrizeDistributor} from "../src/core/RafflePrizeDistributor.sol";

// ============================================================================
// Test Harness - Exposes internal functions for testing
// ============================================================================

contract RaffleEdgeCaseHarness is Raffle {
    constructor(address sof, address coord, uint64 subId, bytes32 keyHash)
        Raffle(sof, coord, subId, keyHash) {}

    function testSetVrf(uint256 seasonId, uint256 requestId) external {
        seasonStates[seasonId].status = SeasonStatus.VRFPending;
        vrfRequestToSeason[requestId] = seasonId;
    }

    function testFulfill(uint256 requestId, uint256[] calldata words) external {
        fulfillRandomWords(requestId, words);
    }

    function testFulfillAndFinalize(uint256 requestId, uint256[] calldata words) external {
        fulfillRandomWords(requestId, words);
        uint256 seasonId = vrfRequestToSeason[requestId];
        // Only call finalizeSeason if auto-finalize failed (season still in Distributing)
        if (seasonStates[seasonId].status == SeasonStatus.Distributing) {
            this.finalizeSeason(seasonId);
        }
        // If auto-finalize succeeded, season is already Completed
    }

    function testLockTrading(uint256 seasonId) external {
        SOFBondingCurve(seasons[seasonId].bondingCurve).lockTrading();
    }

    function testRequestSeasonEnd(uint256 seasonId, uint256 requestId) external {
        SOFBondingCurve(seasons[seasonId].bondingCurve).lockTrading();
        seasonStates[seasonId].status = SeasonStatus.VRFPending;
        vrfRequestToSeason[requestId] = seasonId;
    }

    function testSetStatus(uint256 seasonId, SeasonStatus status) external {
        seasonStates[seasonId].status = status;
    }

    function getStatus(uint256 seasonId) external view returns (SeasonStatus) {
        return seasonStates[seasonId].status;
    }
}

// ============================================================================
// Mock Contracts
// ============================================================================

contract MockERC20EdgeCase {
    string public name;
    string public symbol;
    uint8 public decimals;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    constructor(string memory _n, string memory _s, uint8 _d) {
        name = _n;
        symbol = _s;
        decimals = _d;
    }

    function mint(address to, uint256 amount) public {
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function approve(address spender, uint256 amount) public returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) public returns (bool) {
        require(balanceOf[msg.sender] >= amount, "bal");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        emit Transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) public returns (bool) {
        require(balanceOf[from] >= amount, "bal");
        require(allowance[from][msg.sender] >= amount, "allow");
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        allowance[from][msg.sender] -= amount;
        emit Transfer(from, to, amount);
        return true;
    }
}

// ============================================================================
// Edge Cases Test Suite
// ============================================================================

contract EdgeCasesTest is Test {
    RaffleEdgeCaseHarness public raffle;
    MockERC20EdgeCase public sof;
    SeasonFactory public factory;
    RafflePrizeDistributor public distributor;

    address public admin = address(this);
    address public player1 = address(0xA1);
    address public player2 = address(0xA2);
    address public player3 = address(0xA3);
    address public treasury = address(0xFEE);

    function setUp() public {
        sof = new MockERC20EdgeCase("SOF", "SOF", 18);
        sof.mint(admin, 100_000_000 ether);
        sof.mint(player1, 100_000 ether);
        sof.mint(player2, 100_000 ether);
        sof.mint(player3, 100_000 ether);

        address mockCoordinator = address(0xCAFE);
        raffle = new RaffleEdgeCaseHarness(address(sof), mockCoordinator, 0, bytes32(0));

        factory = new SeasonFactory(address(raffle));
        raffle.setSeasonFactory(address(factory));

        distributor = new RafflePrizeDistributor(admin);
        distributor.grantRole(distributor.RAFFLE_ROLE(), address(raffle));
        raffle.setPrizeDistributor(address(distributor));
    }

    function _steps() internal pure returns (RaffleTypes.BondStep[] memory s) {
        s = new RaffleTypes.BondStep[](2);
        s[0] = RaffleTypes.BondStep({rangeTo: uint128(1000), price: uint128(1 ether)});
        s[1] = RaffleTypes.BondStep({rangeTo: uint128(5000), price: uint128(2 ether)});
    }

    function _createSeason() internal returns (uint256 seasonId, SOFBondingCurve curve) {
        RaffleTypes.SeasonConfig memory cfg;
        cfg.name = "EdgeCaseTest";
        cfg.startTime = block.timestamp + 1;
        cfg.endTime = block.timestamp + 3 days;
        cfg.winnerCount = 2;
        cfg.grandPrizeBps = 6500;
        cfg.treasuryAddress = treasury;
        seasonId = raffle.createSeason(cfg, _steps(), 50, 70);
        (RaffleTypes.SeasonConfig memory out,,,,) = raffle.getSeasonDetails(seasonId);
        curve = SOFBondingCurve(out.bondingCurve);
    }

    function _getTotalSupply(SOFBondingCurve curve) internal view returns (uint256) {
        (uint256 totalSupply,,,,,,, ) = curve.curveConfig();
        return totalSupply;
    }

    // ========================================================================
    // Test 1: Season Timing Edge Cases
    // ========================================================================

    function test_SeasonTiming_ExactStartTimeBoundary() public {
        uint256 startTs = block.timestamp + 100;
        RaffleTypes.SeasonConfig memory cfg;
        cfg.name = "ExactStart";
        cfg.startTime = startTs;
        cfg.endTime = startTs + 1 days;
        cfg.winnerCount = 1;
        cfg.grandPrizeBps = 6500;
        cfg.treasuryAddress = treasury;

        uint256 seasonId = raffle.createSeason(cfg, _steps(), 50, 70);

        // Warp to exactly startTime
        vm.warp(startTs);
        raffle.startSeason(seasonId);

        (RaffleTypes.SeasonConfig memory out,,,,) = raffle.getSeasonDetails(seasonId);
        assertTrue(out.isActive, "Season should be active at exact startTime");
    }

    function test_SeasonTiming_StartTimeInPast_Reverts() public {
        RaffleTypes.SeasonConfig memory cfg;
        cfg.name = "PastStart";
        cfg.startTime = block.timestamp - 1; // In the past
        cfg.endTime = block.timestamp + 1 days;
        cfg.winnerCount = 1;
        cfg.grandPrizeBps = 6500;
        cfg.treasuryAddress = treasury;

        vm.expectRevert();
        raffle.createSeason(cfg, _steps(), 50, 70);
    }

    function test_SeasonTiming_EndTimeBeforeStartTime_Reverts() public {
        RaffleTypes.SeasonConfig memory cfg;
        cfg.name = "InvalidTimes";
        cfg.startTime = block.timestamp + 1 days;
        cfg.endTime = block.timestamp + 1; // Before startTime
        cfg.winnerCount = 1;
        cfg.grandPrizeBps = 6500;
        cfg.treasuryAddress = treasury;

        vm.expectRevert();
        raffle.createSeason(cfg, _steps(), 50, 70);
    }

    function test_SeasonTiming_VeryShortDuration() public {
        uint256 startTs = block.timestamp + 100;
        RaffleTypes.SeasonConfig memory cfg;
        cfg.name = "ShortSeason";
        cfg.startTime = startTs;
        cfg.endTime = startTs + 1 minutes; // Only 1 minute
        cfg.winnerCount = 1;
        cfg.grandPrizeBps = 6500;
        cfg.treasuryAddress = treasury;

        uint256 seasonId = raffle.createSeason(cfg, _steps(), 50, 70);
        vm.warp(startTs);
        raffle.startSeason(seasonId);

        (RaffleTypes.SeasonConfig memory out,,,,) = raffle.getSeasonDetails(seasonId);
        assertTrue(out.isActive, "Short season should be active");
    }

    function test_SeasonTiming_VeryLongDuration() public {
        uint256 startTs = block.timestamp + 100;
        RaffleTypes.SeasonConfig memory cfg;
        cfg.name = "LongSeason";
        cfg.startTime = startTs;
        cfg.endTime = startTs + 365 days; // Full year
        cfg.winnerCount = 1;
        cfg.grandPrizeBps = 6500;
        cfg.treasuryAddress = treasury;

        uint256 seasonId = raffle.createSeason(cfg, _steps(), 50, 70);
        vm.warp(startTs);
        raffle.startSeason(seasonId);

        (RaffleTypes.SeasonConfig memory out,,,,) = raffle.getSeasonDetails(seasonId);
        assertTrue(out.isActive, "Long season should be active");
    }

    // ========================================================================
    // Test 2: VRF Edge Cases
    // ========================================================================

    function test_VRF_InvalidRequestId_Handled() public {
        (uint256 seasonId, SOFBondingCurve curve) = _createSeason();
        vm.warp(block.timestamp + 1);
        raffle.startSeason(seasonId);

        vm.startPrank(player1);
        sof.approve(address(curve), type(uint256).max);
        curve.buyTokens(10, 20 ether);
        vm.stopPrank();

        // Set up VRF with request 123
        raffle.testRequestSeasonEnd(seasonId, 123);

        // Try to fulfill with different request ID - should revert or be ignored
        uint256[] memory words = new uint256[](2);
        words[0] = 111;
        words[1] = 222;

        // Fulfilling with invalid requestId should revert
        vm.expectRevert();
        raffle.testFulfill(999, words); // Wrong requestId
    }

    function test_VRF_ZeroRandomWord() public {
        (uint256 seasonId, SOFBondingCurve curve) = _createSeason();
        vm.warp(block.timestamp + 1);
        raffle.startSeason(seasonId);

        vm.startPrank(player1);
        sof.approve(address(curve), type(uint256).max);
        curve.buyTokens(10, 20 ether);
        vm.stopPrank();

        vm.startPrank(player2);
        sof.approve(address(curve), type(uint256).max);
        curve.buyTokens(10, 20 ether);
        vm.stopPrank();

        raffle.testRequestSeasonEnd(seasonId, 123);

        // VRF with zero values - should still select winners
        uint256[] memory words = new uint256[](2);
        words[0] = 0;
        words[1] = 0;
        raffle.testFulfillAndFinalize(123, words);

        address[] memory winners = raffle.getWinners(seasonId);
        assertGt(winners.length, 0, "Should have winners even with zero random words");
    }

    function test_VRF_MaxUint256RandomWord() public {
        (uint256 seasonId, SOFBondingCurve curve) = _createSeason();
        vm.warp(block.timestamp + 1);
        raffle.startSeason(seasonId);

        vm.startPrank(player1);
        sof.approve(address(curve), type(uint256).max);
        curve.buyTokens(10, 20 ether);
        vm.stopPrank();

        vm.startPrank(player2);
        sof.approve(address(curve), type(uint256).max);
        curve.buyTokens(10, 20 ether);
        vm.stopPrank();

        raffle.testRequestSeasonEnd(seasonId, 123);

        // VRF with max uint256 values
        uint256[] memory words = new uint256[](2);
        words[0] = type(uint256).max;
        words[1] = type(uint256).max;
        raffle.testFulfillAndFinalize(123, words);

        address[] memory winners = raffle.getWinners(seasonId);
        assertGt(winners.length, 0, "Should handle max uint256 random words");
    }

    // ========================================================================
    // Test 3: Participant Edge Cases
    // ========================================================================

    function test_Participant_BuyExactlyOneTicket() public {
        (uint256 seasonId, SOFBondingCurve curve) = _createSeason();
        vm.warp(block.timestamp + 1);
        raffle.startSeason(seasonId);

        vm.startPrank(player1);
        sof.approve(address(curve), type(uint256).max);
        curve.buyTokens(1, 5 ether);
        vm.stopPrank();

        Raffle.ParticipantPosition memory pos = raffle.getParticipantPosition(seasonId, player1);
        assertEq(pos.ticketCount, 1, "Should have exactly 1 ticket");
        assertTrue(pos.isActive, "Should be active participant");
    }

    function test_Participant_SellExactlyOneTicket() public {
        (uint256 seasonId, SOFBondingCurve curve) = _createSeason();
        vm.warp(block.timestamp + 1);
        raffle.startSeason(seasonId);

        vm.startPrank(player1);
        sof.approve(address(curve), type(uint256).max);
        curve.buyTokens(5, 10 ether);

        // Sell exactly 1 ticket
        curve.sellTokens(1, 0);
        vm.stopPrank();

        Raffle.ParticipantPosition memory pos = raffle.getParticipantPosition(seasonId, player1);
        assertEq(pos.ticketCount, 4, "Should have 4 tickets after selling 1");
    }

    function test_Participant_RapidBuySellSequence() public {
        (uint256 seasonId, SOFBondingCurve curve) = _createSeason();
        vm.warp(block.timestamp + 1);
        raffle.startSeason(seasonId);

        vm.startPrank(player1);
        sof.approve(address(curve), type(uint256).max);

        // Rapid buy/sell sequence
        for (uint i = 0; i < 5; i++) {
            curve.buyTokens(10, 25 ether);
            curve.sellTokens(5, 0);
        }
        vm.stopPrank();

        // Final position should be 5 iterations * (10-5) = 25 tickets
        Raffle.ParticipantPosition memory pos = raffle.getParticipantPosition(seasonId, player1);
        assertEq(pos.ticketCount, 25, "Should have accumulated correct tickets");
    }

    function test_Participant_ManyUniqueParticipants() public {
        // Create season with more winners
        RaffleTypes.SeasonConfig memory cfg;
        cfg.name = "ManyParticipants";
        cfg.startTime = block.timestamp + 1;
        cfg.endTime = block.timestamp + 3 days;
        cfg.winnerCount = 5;
        cfg.grandPrizeBps = 6500;
        cfg.treasuryAddress = treasury;
        uint256 seasonId = raffle.createSeason(cfg, _steps(), 50, 70);
        (RaffleTypes.SeasonConfig memory out,,,,) = raffle.getSeasonDetails(seasonId);
        SOFBondingCurve curve = SOFBondingCurve(out.bondingCurve);

        vm.warp(block.timestamp + 1);
        raffle.startSeason(seasonId);

        // Create 20 unique participants
        for (uint i = 1; i <= 20; i++) {
            // forge-lint: disable-next-line(unsafe-typecast) Safe: i is bounded 1-20 by loop
            address participant = address(uint160(0x1000 + i));
            sof.mint(participant, 100 ether);

            vm.startPrank(participant);
            sof.approve(address(curve), type(uint256).max);
            curve.buyTokens(5, 10 ether);
            vm.stopPrank();
        }

        address[] memory participants = raffle.getParticipants(seasonId);
        assertEq(participants.length, 20, "Should have 20 unique participants");
    }

    // ========================================================================
    // Test 4: Bonding Curve Pricing Edge Cases
    // ========================================================================

    function test_BondingCurve_PurchaseAcrossMultipleSteps() public {
        (uint256 seasonId, SOFBondingCurve curve) = _createSeason();
        vm.warp(block.timestamp + 1);
        raffle.startSeason(seasonId);

        // Steps: 0-1000 at 1 ether, 1000-5000 at 2 ether
        vm.startPrank(player1);
        sof.approve(address(curve), type(uint256).max);

        // Buy across both steps (1500 tickets = 1000 at 1 ether + 500 at 2 ether)
        uint256 cost = curve.calculateBuyPrice(1500);
        curve.buyTokens(1500, (cost * 110) / 100); // 10% slippage allowance
        vm.stopPrank();

        (RaffleTypes.SeasonConfig memory out,,,,) = raffle.getSeasonDetails(seasonId);
        assertEq(_getTotalSupply(curve), 1500, "Should have 1500 tickets");
    }

    function test_BondingCurve_SaleAcrossMultipleSteps() public {
        (uint256 seasonId, SOFBondingCurve curve) = _createSeason();
        vm.warp(block.timestamp + 1);
        raffle.startSeason(seasonId);

        vm.startPrank(player1);
        sof.approve(address(curve), type(uint256).max);

        // Buy 1500 tickets (across both steps)
        uint256 buyCost = curve.calculateBuyPrice(1500);
        curve.buyTokens(1500, (buyCost * 110) / 100);

        // Sell back across steps
        curve.sellTokens(700, 0); // Sell some from step 2 back into step 1
        vm.stopPrank();

        assertEq(_getTotalSupply(curve), 800, "Should have 800 tickets remaining");
    }

    function test_BondingCurve_PurchaseAtExactStepBoundary() public {
        (uint256 seasonId, SOFBondingCurve curve) = _createSeason();
        vm.warp(block.timestamp + 1);
        raffle.startSeason(seasonId);

        vm.startPrank(player1);
        sof.approve(address(curve), type(uint256).max);

        // Buy exactly 1000 tickets (end of first step)
        uint256 cost = curve.calculateBuyPrice(1000);
        curve.buyTokens(1000, (cost * 110) / 100);
        vm.stopPrank();

        assertEq(_getTotalSupply(curve), 1000, "Should be exactly at step boundary");
    }

    function test_BondingCurve_SlippageExactBoundary() public {
        (uint256 seasonId, SOFBondingCurve curve) = _createSeason();
        vm.warp(block.timestamp + 1);
        raffle.startSeason(seasonId);

        vm.startPrank(player1);
        sof.approve(address(curve), type(uint256).max);

        uint256 cost = curve.calculateBuyPrice(100);
        uint256 totalCost = cost + (cost * 50) / 10000; // Add buy fee (0.5%)

        // Exact cost should work
        curve.buyTokens(100, totalCost);
        vm.stopPrank();

        assertEq(_getTotalSupply(curve), 100, "Purchase with exact slippage should work");
    }

    function test_BondingCurve_SlippageExceeded_Reverts() public {
        (uint256 seasonId, SOFBondingCurve curve) = _createSeason();
        vm.warp(block.timestamp + 1);
        raffle.startSeason(seasonId);

        vm.startPrank(player1);
        sof.approve(address(curve), type(uint256).max);

        uint256 cost = curve.calculateBuyPrice(100);
        // Set max cost below actual cost (should revert)
        vm.expectRevert();
        curve.buyTokens(100, cost - 1);
        vm.stopPrank();
    }

    // ========================================================================
    // Test 5: State Transition Edge Cases
    // ========================================================================

    function test_StateTransition_PendingToActive() public {
        (uint256 seasonId, SOFBondingCurve curve) = _createSeason();

        // Before start: season is not active (trading should fail)
        vm.startPrank(player1);
        sof.approve(address(curve), type(uint256).max);
        vm.expectRevert();
        curve.buyTokens(1, 5 ether);
        vm.stopPrank();

        vm.warp(block.timestamp + 1);
        raffle.startSeason(seasonId);

        // After start: season is active (trading should work)
        vm.startPrank(player1);
        curve.buyTokens(1, 5 ether);
        vm.stopPrank();

        (RaffleTypes.SeasonConfig memory out,,,,) = raffle.getSeasonDetails(seasonId);
        assertTrue(out.isActive, "Season should be active after start");
    }

    function test_StateTransition_TradingOnlyAllowedInActive() public {
        (uint256 seasonId, SOFBondingCurve curve) = _createSeason();

        // Try to buy before season starts - should fail
        vm.startPrank(player1);
        sof.approve(address(curve), type(uint256).max);
        vm.expectRevert();
        curve.buyTokens(10, 20 ether);
        vm.stopPrank();

        // Start season
        vm.warp(block.timestamp + 1);
        raffle.startSeason(seasonId);

        // Now buying should work
        vm.startPrank(player1);
        curve.buyTokens(10, 20 ether);
        vm.stopPrank();

        // Lock trading
        raffle.testLockTrading(seasonId);

        // Buying should fail again
        vm.startPrank(player1);
        vm.expectRevert(abi.encodeWithSignature("TradingLocked()"));
        curve.buyTokens(10, 20 ether);
        vm.stopPrank();
    }

    function test_StateTransition_FinalizeOnlyFromDistributing() public {
        (uint256 seasonId, SOFBondingCurve curve) = _createSeason();
        vm.warp(block.timestamp + 1);
        raffle.startSeason(seasonId);

        vm.startPrank(player1);
        sof.approve(address(curve), type(uint256).max);
        curve.buyTokens(10, 20 ether);
        vm.stopPrank();

        // Cannot finalize from Active state
        vm.expectRevert();
        raffle.finalizeSeason(seasonId);

        // Set to VRFPending state - still cannot finalize
        raffle.testRequestSeasonEnd(seasonId, 123);
        vm.expectRevert();
        raffle.finalizeSeason(seasonId);

        // Fulfill VRF transitions to Distributing
        uint256[] memory words = new uint256[](2);
        words[0] = 111;
        words[1] = 222;
        raffle.testFulfill(123, words);

        // Cannot finalize from Completed — first must finalize from Distributing
        raffle.finalizeSeason(seasonId);

        // After finalization, getWinners should work (it requires Completed status)
        address[] memory winners = raffle.getWinners(seasonId);
        assertGt(winners.length, 0, "Should have winners after finalization");
    }

    function test_StateTransition_CannotRestartCompleted() public {
        (uint256 seasonId, SOFBondingCurve curve) = _createSeason();
        vm.warp(block.timestamp + 1);
        raffle.startSeason(seasonId);

        vm.startPrank(player1);
        sof.approve(address(curve), type(uint256).max);
        curve.buyTokens(10, 20 ether);
        vm.stopPrank();

        // Complete the season
        raffle.testRequestSeasonEnd(seasonId, 123);
        uint256[] memory words = new uint256[](2);
        words[0] = 111;
        words[1] = 222;
        raffle.testFulfillAndFinalize(123, words);

        // Try to restart - should fail
        vm.expectRevert();
        raffle.startSeason(seasonId);
    }
}
