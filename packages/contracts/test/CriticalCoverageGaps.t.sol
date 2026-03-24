// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import {Raffle} from "../src/core/Raffle.sol";
import {SOFBondingCurve} from "../src/curve/SOFBondingCurve.sol";
import {RaffleToken} from "../src/token/RaffleToken.sol";
import {RaffleTypes} from "../src/lib/RaffleTypes.sol";
import {ISeasonFactory} from "../src/lib/ISeasonFactory.sol";
import {SeasonFactory} from "../src/core/SeasonFactory.sol";
import {RafflePrizeDistributor} from "../src/core/RafflePrizeDistributor.sol";

// ============================================================================
// Test Harness - Exposes internal functions for testing
// ============================================================================

contract RaffleTestHarness is Raffle {
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

    function testSetPrizePool(uint256 seasonId, uint256 amount) external {
        seasonStates[seasonId].totalPrizePool = amount;
    }
}

// ============================================================================
// Mock Contracts
// ============================================================================

contract MockERC20 {
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
// Critical Coverage Gaps Test Suite
// ============================================================================

contract CriticalCoverageGapsTest is Test {
    RaffleTestHarness public raffle;
    MockERC20 public sof;
    SeasonFactory public factory;
    RafflePrizeDistributor public distributor;

    address public admin = address(this);
    address public player1 = address(0xA1);
    address public player2 = address(0xA2);
    address public player3 = address(0xA3);
    address public nonAdmin = address(0xB1);
    address public treasury = address(0xC1);

    function setUp() public {
        sof = new MockERC20("SOF", "SOF", 18);
        sof.mint(admin, 10_000_000 ether);
        sof.mint(player1, 10_000 ether);
        sof.mint(player2, 10_000 ether);
        sof.mint(player3, 10_000 ether);

        address mockCoordinator = address(0xCAFE);
        raffle = new RaffleTestHarness(address(sof), mockCoordinator, 0, bytes32(0));

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
        cfg.name = "TestSeason";
        cfg.startTime = block.timestamp + 1;
        cfg.endTime = block.timestamp + 3 days;
        cfg.winnerCount = 2;
        cfg.grandPrizeBps = 6500;
        cfg.treasuryAddress = treasury;
        seasonId = raffle.createSeason(cfg, _steps(), 50, 70);
        (RaffleTypes.SeasonConfig memory out,,,,) = raffle.getSeasonDetails(seasonId);
        curve = SOFBondingCurve(out.bondingCurve);
    }

    // ========================================================================
    // Test 1: SOFBondingCurve.extractSof() Tests
    // ========================================================================

    function test_ExtractSof_Success() public {
        (uint256 seasonId, SOFBondingCurve curve) = _createSeason();
        vm.warp(block.timestamp + 1);
        raffle.startSeason(seasonId);

        // Player buys some tickets to create reserves
        vm.startPrank(player1);
        sof.approve(address(curve), type(uint256).max);
        curve.buyTokens(100, 200 ether);
        vm.stopPrank();

        uint256 reservesBefore = curve.getSofReserves();
        assertGt(reservesBefore, 0, "Should have reserves after buy");

        // Lock trading (required before extraction)
        raffle.testLockTrading(seasonId);

        // Extract SOF via raffle contract (which has RAFFLE_MANAGER_ROLE)
        uint256 extractAmount = reservesBefore / 2;
        vm.prank(address(raffle));
        curve.extractSof(treasury, extractAmount);

        assertEq(curve.getSofReserves(), reservesBefore - extractAmount, "Reserves should decrease");
        assertEq(sof.balanceOf(treasury), extractAmount, "Treasury should receive SOF");
    }

    function test_ExtractSof_RevertsWhenTradingNotLocked() public {
        (uint256 seasonId, SOFBondingCurve curve) = _createSeason();
        vm.warp(block.timestamp + 1);
        raffle.startSeason(seasonId);

        // Player buys tickets
        vm.startPrank(player1);
        sof.approve(address(curve), type(uint256).max);
        curve.buyTokens(100, 200 ether);
        vm.stopPrank();

        // Try to extract without locking trading - should revert
        vm.prank(address(raffle));
        vm.expectRevert(abi.encodeWithSignature("TradingNotLocked()"));
        curve.extractSof(treasury, 1 ether);
    }

    function test_ExtractSof_RevertsWithInsufficientReserves() public {
        (uint256 seasonId, SOFBondingCurve curve) = _createSeason();
        vm.warp(block.timestamp + 1);
        raffle.startSeason(seasonId);

        // Player buys tickets
        vm.startPrank(player1);
        sof.approve(address(curve), type(uint256).max);
        curve.buyTokens(10, 20 ether);
        vm.stopPrank();

        uint256 reserves = curve.getSofReserves();
        raffle.testLockTrading(seasonId);

        // Try to extract more than reserves
        vm.prank(address(raffle));
        vm.expectRevert(abi.encodeWithSelector(
            bytes4(keccak256("InsufficientReserves(uint256,uint256)")),
            reserves + 1,
            reserves
        ));
        curve.extractSof(treasury, reserves + 1);
    }

    function test_ExtractSof_RevertsWithZeroAddress() public {
        (uint256 seasonId, SOFBondingCurve curve) = _createSeason();
        vm.warp(block.timestamp + 1);
        raffle.startSeason(seasonId);

        vm.startPrank(player1);
        sof.approve(address(curve), type(uint256).max);
        curve.buyTokens(10, 20 ether);
        vm.stopPrank();

        raffle.testLockTrading(seasonId);

        vm.prank(address(raffle));
        vm.expectRevert(abi.encodeWithSignature("InvalidAddress()"));
        curve.extractSof(address(0), 1 ether);
    }

    function test_ExtractSof_RevertsWithNonRaffleManagerRole() public {
        (uint256 seasonId, SOFBondingCurve curve) = _createSeason();
        vm.warp(block.timestamp + 1);
        raffle.startSeason(seasonId);

        vm.startPrank(player1);
        sof.approve(address(curve), type(uint256).max);
        curve.buyTokens(10, 20 ether);
        vm.stopPrank();

        raffle.testLockTrading(seasonId);

        // Try to extract as non-admin
        vm.prank(nonAdmin);
        vm.expectRevert();
        curve.extractSof(treasury, 1 ether);
    }

    function test_ExtractSof_FullReservesExtraction() public {
        (uint256 seasonId, SOFBondingCurve curve) = _createSeason();
        vm.warp(block.timestamp + 1);
        raffle.startSeason(seasonId);

        vm.startPrank(player1);
        sof.approve(address(curve), type(uint256).max);
        curve.buyTokens(100, 200 ether);
        vm.stopPrank();

        uint256 fullReserves = curve.getSofReserves();
        raffle.testLockTrading(seasonId);

        vm.prank(address(raffle));
        curve.extractSof(treasury, fullReserves);

        assertEq(curve.getSofReserves(), 0, "Reserves should be zero after full extraction");
    }

    // ========================================================================
    // Test 2: Raffle.requestSeasonEndEarly() Tests
    // ========================================================================

    function test_RequestSeasonEndEarly_RequiresEmergencyRole() public {
        // NOTE: Full success test for requestSeasonEndEarly requires a real VRF coordinator mock.
        // The existing RaffleVRF.t.sol uses harness methods (testRequestSeasonEnd) to test the VRF flow.
        // This test validates the access control checks work correctly.

        (uint256 seasonId, SOFBondingCurve curve) = _createSeason();
        vm.warp(block.timestamp + 1);
        raffle.startSeason(seasonId);

        // Have a participant
        vm.startPrank(player1);
        sof.approve(address(curve), type(uint256).max);
        curve.buyTokens(10, 20 ether);
        vm.stopPrank();

        // Verify: nonAdmin cannot call (without EMERGENCY_ROLE)
        vm.prank(nonAdmin);
        vm.expectRevert();
        raffle.requestSeasonEndEarly(seasonId);

        // Verify: admin without EMERGENCY_ROLE cannot call either
        vm.expectRevert();
        raffle.requestSeasonEndEarly(seasonId);

        // Grant EMERGENCY_ROLE to admin
        raffle.grantRole(raffle.EMERGENCY_ROLE(), admin);

        // Verify the role was granted
        assertTrue(raffle.hasRole(raffle.EMERGENCY_ROLE(), admin), "Admin should have EMERGENCY_ROLE");

        // The actual VRF call would work now, but our mock coordinator at 0xCAFE doesn't
        // implement requestRandomWords. The complete VRF flow is tested in RaffleVRF.t.sol.
    }

    function test_RequestSeasonEndEarly_RevertsWhenNotActive() public {
        (uint256 seasonId,) = _createSeason();
        // Season is in Pending state, not Active

        raffle.grantRole(raffle.EMERGENCY_ROLE(), admin);

        vm.expectRevert();
        raffle.requestSeasonEndEarly(seasonId);
    }

    function test_RequestSeasonEndEarly_RevertsForNonEmergencyRole() public {
        (uint256 seasonId, SOFBondingCurve curve) = _createSeason();
        vm.warp(block.timestamp + 1);
        raffle.startSeason(seasonId);

        // Try without EMERGENCY_ROLE
        vm.prank(nonAdmin);
        vm.expectRevert();
        raffle.requestSeasonEndEarly(seasonId);
    }

    // ========================================================================
    // Test 3: Raffle.pauseSeason() Tests
    // ========================================================================

    function test_PauseSeason_Success() public {
        (uint256 seasonId, SOFBondingCurve curve) = _createSeason();
        vm.warp(block.timestamp + 1);
        raffle.startSeason(seasonId);

        raffle.grantRole(raffle.EMERGENCY_ROLE(), admin);
        raffle.pauseSeason(seasonId);

        // Season should be paused (isActive = false)
        (RaffleTypes.SeasonConfig memory cfg,,,,) = raffle.getSeasonDetails(seasonId);
        assertFalse(cfg.isActive, "Season should be paused");
    }

    function test_PauseSeason_RevertsForNonEmergencyRole() public {
        (uint256 seasonId,) = _createSeason();
        vm.warp(block.timestamp + 1);
        raffle.startSeason(seasonId);

        vm.prank(nonAdmin);
        vm.expectRevert();
        raffle.pauseSeason(seasonId);
    }

    function test_PauseSeason_RevertsForInvalidSeason() public {
        raffle.grantRole(raffle.EMERGENCY_ROLE(), admin);

        vm.expectRevert("Raffle: no season");
        raffle.pauseSeason(999);
    }

    // ========================================================================
    // Test 4: Winner Selection Edge Cases
    // ========================================================================

    function test_WinnerSelection_ExactlyWinnerCountParticipants() public {
        // Create season with 2 winners
        RaffleTypes.SeasonConfig memory cfg;
        cfg.name = "ExactWinners";
        cfg.startTime = block.timestamp + 1;
        cfg.endTime = block.timestamp + 3 days;
        cfg.winnerCount = 2;
        cfg.grandPrizeBps = 6500;
        cfg.treasuryAddress = treasury;
        uint256 seasonId = raffle.createSeason(cfg, _steps(), 50, 70);
        (RaffleTypes.SeasonConfig memory out,,,,) = raffle.getSeasonDetails(seasonId);
        SOFBondingCurve curve = SOFBondingCurve(out.bondingCurve);

        vm.warp(block.timestamp + 1);
        raffle.startSeason(seasonId);

        // Exactly 2 participants
        vm.startPrank(player1);
        sof.approve(address(curve), type(uint256).max);
        curve.buyTokens(10, 20 ether);
        vm.stopPrank();

        vm.startPrank(player2);
        sof.approve(address(curve), type(uint256).max);
        curve.buyTokens(10, 20 ether);
        vm.stopPrank();

        uint256 reqId = 111;
        raffle.testRequestSeasonEnd(seasonId, reqId);
        uint256[] memory words = new uint256[](2);
        words[0] = 12345;
        words[1] = 67890;
        raffle.testFulfillAndFinalize(reqId, words);

        address[] memory winners = raffle.getWinners(seasonId);
        assertEq(winners.length, 2, "Should have exactly 2 winners");
    }

    function test_WinnerSelection_FewerParticipantsThanWinnerCount() public {
        // Create season with 5 winners
        RaffleTypes.SeasonConfig memory cfg;
        cfg.name = "FewParticipants";
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

        // Only 2 participants (less than winnerCount of 5)
        vm.startPrank(player1);
        sof.approve(address(curve), type(uint256).max);
        curve.buyTokens(10, 20 ether);
        vm.stopPrank();

        vm.startPrank(player2);
        sof.approve(address(curve), type(uint256).max);
        curve.buyTokens(10, 20 ether);
        vm.stopPrank();

        uint256 reqId = 222;
        raffle.testRequestSeasonEnd(seasonId, reqId);
        uint256[] memory words = new uint256[](5);
        for (uint i = 0; i < 5; i++) {
            words[i] = i + 100;
        }
        raffle.testFulfillAndFinalize(reqId, words);

        address[] memory winners = raffle.getWinners(seasonId);
        // Winners should be deduped to unique participants (max 2)
        assertLe(winners.length, 2, "Should have at most 2 winners (unique participants)");
    }

    function test_WinnerSelection_DuplicateRandomWords() public {
        (uint256 seasonId, SOFBondingCurve curve) = _createSeason();
        vm.warp(block.timestamp + 1);
        raffle.startSeason(seasonId);

        // 3 participants
        vm.startPrank(player1);
        sof.approve(address(curve), type(uint256).max);
        curve.buyTokens(10, 20 ether);
        vm.stopPrank();

        vm.startPrank(player2);
        sof.approve(address(curve), type(uint256).max);
        curve.buyTokens(10, 20 ether);
        vm.stopPrank();

        vm.startPrank(player3);
        sof.approve(address(curve), type(uint256).max);
        curve.buyTokens(10, 20 ether);
        vm.stopPrank();

        uint256 reqId = 333;
        raffle.testRequestSeasonEnd(seasonId, reqId);
        // Same random word - should still produce unique winners via dedup
        uint256[] memory words = new uint256[](2);
        words[0] = 42;
        words[1] = 42; // duplicate
        raffle.testFulfillAndFinalize(reqId, words);

        address[] memory winners = raffle.getWinners(seasonId);
        // Should deduplicate
        for (uint i = 0; i < winners.length; i++) {
            for (uint j = i + 1; j < winners.length; j++) {
                assertTrue(winners[i] != winners[j], "Winners should be unique");
            }
        }
    }

    // ========================================================================
    // Test 5: Access Control Enforcement Tests
    // ========================================================================

    function test_AccessControl_SOFBondingCurve_LockTrading() public {
        (uint256 seasonId, SOFBondingCurve curve) = _createSeason();
        vm.warp(block.timestamp + 1);
        raffle.startSeason(seasonId);

        // Non-admin should not be able to lock trading
        vm.prank(nonAdmin);
        vm.expectRevert();
        curve.lockTrading();
    }

    function test_AccessControl_Raffle_CreateSeason() public {
        // Only DEFAULT_ADMIN_ROLE should be able to create seasons
        RaffleTypes.SeasonConfig memory cfg;
        cfg.name = "Test";
        cfg.startTime = block.timestamp + 1;
        cfg.endTime = block.timestamp + 3 days;
        cfg.winnerCount = 1;
        cfg.grandPrizeBps = 6500;
        cfg.treasuryAddress = treasury;

        vm.prank(nonAdmin);
        vm.expectRevert();
        raffle.createSeason(cfg, _steps(), 50, 70);
    }

    function test_AccessControl_Raffle_StartSeason() public {
        (uint256 seasonId,) = _createSeason();
        vm.warp(block.timestamp + 1);

        // Non-admin should not be able to start season
        vm.prank(nonAdmin);
        vm.expectRevert();
        raffle.startSeason(seasonId);
    }

    function test_AccessControl_RoleRevocation() public {
        raffle.grantRole(raffle.EMERGENCY_ROLE(), nonAdmin);

        // nonAdmin should be able to pause
        (uint256 seasonId,) = _createSeason();
        vm.warp(block.timestamp + 1);
        raffle.startSeason(seasonId);

        vm.prank(nonAdmin);
        raffle.pauseSeason(seasonId);

        // Revoke role
        raffle.revokeRole(raffle.EMERGENCY_ROLE(), nonAdmin);

        // Create new season with adjusted timing (need future startTime)
        uint256 newStartTime = block.timestamp + 100; // Must be in the future
        RaffleTypes.SeasonConfig memory cfg;
        cfg.name = "Test2";
        cfg.startTime = newStartTime;
        cfg.endTime = newStartTime + 3 days;
        cfg.winnerCount = 1;
        cfg.grandPrizeBps = 6500;
        cfg.treasuryAddress = treasury;
        uint256 seasonId2 = raffle.createSeason(cfg, _steps(), 50, 70);
        vm.warp(newStartTime); // Warp exactly to startTime
        raffle.startSeason(seasonId2);

        vm.prank(nonAdmin);
        vm.expectRevert();
        raffle.pauseSeason(seasonId2);
    }

    function test_AccessControl_RoleGrant() public {
        // Grant EMERGENCY_ROLE to nonAdmin
        assertFalse(raffle.hasRole(raffle.EMERGENCY_ROLE(), nonAdmin));

        raffle.grantRole(raffle.EMERGENCY_ROLE(), nonAdmin);

        assertTrue(raffle.hasRole(raffle.EMERGENCY_ROLE(), nonAdmin));

        // Now nonAdmin should be able to pause
        (uint256 seasonId,) = _createSeason();
        vm.warp(block.timestamp + 1);
        raffle.startSeason(seasonId);

        vm.prank(nonAdmin);
        raffle.pauseSeason(seasonId);

        (RaffleTypes.SeasonConfig memory cfg,,,,) = raffle.getSeasonDetails(seasonId);
        assertFalse(cfg.isActive, "Season should be paused by nonAdmin with granted role");
    }
}
