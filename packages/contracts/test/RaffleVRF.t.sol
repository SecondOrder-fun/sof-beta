// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {Raffle} from "../src/core/Raffle.sol";
import {RaffleStorage} from "../src/core/RaffleStorage.sol";
import {SOFBondingCurve} from "../src/curve/SOFBondingCurve.sol";
import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {RaffleTypes} from "../src/lib/RaffleTypes.sol";
import {SeasonFactory} from "../src/core/SeasonFactory.sol";
import {RafflePrizeDistributor} from "../src/core/RafflePrizeDistributor.sol";
import {IRafflePrizeDistributor} from "../src/lib/IRafflePrizeDistributor.sol";

// Harness that exposes fulfillRandomWords and VRF state setter
contract RaffleHarness is Raffle {
    constructor(address sof, address coord, uint64 subId, bytes32 keyHash) Raffle(sof, coord, subId, keyHash) {}

    function testSetVrf(uint256 seasonId, uint256 requestId) external {
        seasonStates[seasonId].status = SeasonStatus.VRFPending;
        vrfRequestToSeason[requestId] = seasonId;
    }

    function testFulfill(uint256 requestId, uint256[] calldata words) external {
        fulfillRandomWords(requestId, words);
    }

    /// @notice Complete VRF flow: fulfill random words then finalize separately
    /// @dev fulfillRandomWords only stores words + transitions to Distributing.
    ///      finalizeSeason must always be called as a separate step.
    function testFulfillAndFinalize(uint256 requestId, uint256[] calldata words) external {
        fulfillRandomWords(requestId, words);
        uint256 seasonId = vrfRequestToSeason[requestId];
        this.finalizeSeason(seasonId);
    }

    /// @notice Test VRF callback only (no finalization)
    function testFulfillOnly(uint256 requestId, uint256[] calldata words) external {
        fulfillRandomWords(requestId, words);
    }

    function testLockTrading(uint256 seasonId) external {
        SOFBondingCurve(seasons[seasonId].bondingCurve).lockTrading();
    }

    function testRequestSeasonEnd(uint256 seasonId, uint256 requestId) external {
        // simulate requestSeasonEnd: lock trading and set VRFPending + request mapping
        SOFBondingCurve(seasons[seasonId].bondingCurve).lockTrading();
        seasonStates[seasonId].totalPrizePool = SOFBondingCurve(seasons[seasonId].bondingCurve).getSofReserves();
        seasons[seasonId].isActive = false;
        seasonStates[seasonId].status = SeasonStatus.VRFPending;
        seasonStates[seasonId].vrfRequestTimestamp = block.timestamp;
        vrfRequestToSeason[requestId] = seasonId;
    }

    /// @notice Set total prize pool for testing (needed before finalizeSeason)
    function testSetPrizePool(uint256 seasonId, uint256 amount) external {
        seasonStates[seasonId].totalPrizePool = amount;
    }
}

// Minimal mock SOF token
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

contract RaffleVRFTest is Test {
    RaffleHarness public raffle;
    MockERC20 public sof;
    address public player1 = address(0xA1);
    address public player2 = address(0xA2);
    address public treasury = address(0xFEE);

    function setUp() public {
        sof = new MockERC20("SOF", "SOF", 18);
        sof.mint(player1, 10000 ether);
        sof.mint(player2, 10000 ether);
        address mockCoordinator = address(0xCAFE);
        raffle = new RaffleHarness(address(sof), mockCoordinator, 0, bytes32(0));
        // Wire SeasonFactory required by Raffle.createSeason
        SeasonFactory factory = new SeasonFactory(address(raffle));
        raffle.setSeasonFactory(address(factory));

        // Set up prize distributor
        RafflePrizeDistributor distributor = new RafflePrizeDistributor(address(this));
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
        cfg.name = "S1";
        cfg.startTime = block.timestamp + 1;
        cfg.endTime = block.timestamp + 3 days;
        cfg.winnerCount = 2;
        cfg.grandPrizeBps = 6500;
        cfg.treasuryAddress = treasury;
        seasonId = raffle.createSeason(cfg, _steps(), 50, 70);
        (RaffleTypes.SeasonConfig memory out,,,,) = raffle.getSeasonDetails(seasonId);
        curve = SOFBondingCurve(out.bondingCurve);
    }

    function testVRFFlow_SelectsWinnersAndCompletes() public {
        (uint256 seasonId, SOFBondingCurve curve) = _createSeason();
        vm.warp(block.timestamp + 1);
        raffle.startSeason(seasonId);

        // players buy tickets
        vm.startPrank(player1);
        sof.approve(address(curve), type(uint256).max);
        curve.buyTokens(10, 20 ether);
        vm.stopPrank();
        vm.startPrank(player2);
        sof.approve(address(curve), type(uint256).max);
        curve.buyTokens(5, 15 ether);
        vm.stopPrank();

        // simulate VRF pending state for requestId=123
        uint256 reqId = 123;
        raffle.testRequestSeasonEnd(seasonId, reqId);

        // build random words and fulfill + finalize
        uint256[] memory words = new uint256[](2);
        words[0] = 777;
        words[1] = 888;
        raffle.testFulfillAndFinalize(reqId, words);

        // assert season completed and winners set
        // Since getWinners requires Completed, calling it asserts status implicitly
        address[] memory winners = raffle.getWinners(seasonId);
        assertGt(winners.length, 0);
        // winners must be among participants
        address[] memory parts = raffle.getParticipants(seasonId);
        for (uint256 i = 0; i < winners.length; i++) {
            bool found;
            for (uint256 j = 0; j < parts.length; j++) {
                if (winners[i] == parts[j]) {
                    found = true;
                    break;
                }
            }
            assertTrue(found, "winner not a participant");
        }
    }

    function testTradingLockBlocksBuySellAfterLock() public {
        (uint256 seasonId, SOFBondingCurve curve) = _createSeason();
        vm.warp(block.timestamp + 1);
        raffle.startSeason(seasonId);

        // initial buy
        vm.startPrank(player1);
        sof.approve(address(curve), type(uint256).max);
        curve.buyTokens(2, 5 ether);
        vm.stopPrank();

        // lock trading via harness (Raffle holds the role on curve)
        raffle.testLockTrading(seasonId);

        // further buy/sell should revert with TradingLocked custom error
        vm.startPrank(player1);
        vm.expectRevert(abi.encodeWithSignature("TradingLocked()"));
        curve.buyTokens(1, 5 ether);
        vm.expectRevert(abi.encodeWithSignature("TradingLocked()"));
        curve.sellTokens(1, 0);
        vm.stopPrank();
    }

    function testZeroParticipantsProducesNoWinners() public {
        (uint256 seasonId,) = _createSeason();
        vm.warp(block.timestamp + 1);
        raffle.startSeason(seasonId);

        // simulate VRF without any participants
        uint256 reqId = 321;
        raffle.testRequestSeasonEnd(seasonId, reqId);
        uint256[] memory words = new uint256[](2);
        words[0] = 1;
        words[1] = 2;
        raffle.testFulfillAndFinalize(reqId, words);

        address[] memory winners = raffle.getWinners(seasonId);
        assertEq(winners.length, 0);
    }

    function testWinnerCountExceedsParticipantsDedup() public {
        // create season with winnerCount = 3
        RaffleTypes.SeasonConfig memory cfg;
        cfg.name = "S2";
        cfg.startTime = block.timestamp + 1;
        cfg.endTime = block.timestamp + 3 days;
        cfg.winnerCount = 3;
        cfg.grandPrizeBps = 6500;
        cfg.treasuryAddress = treasury;
        uint256 seasonId = raffle.createSeason(cfg, _steps(), 50, 70);
        (RaffleTypes.SeasonConfig memory out,,,,) = raffle.getSeasonDetails(seasonId);
        SOFBondingCurve curve = SOFBondingCurve(out.bondingCurve);

        vm.warp(block.timestamp + 1);
        raffle.startSeason(seasonId);

        // only one participant buys tickets
        vm.startPrank(player1);
        sof.approve(address(curve), type(uint256).max);
        curve.buyTokens(5, 10 ether);
        vm.stopPrank();

        uint256 reqId = 654;
        raffle.testRequestSeasonEnd(seasonId, reqId);
        uint256[] memory words = new uint256[](3);
        words[0] = 7;
        words[1] = 7;
        words[2] = 7; // all map to same participant
        raffle.testFulfillAndFinalize(reqId, words);

        address[] memory winners = raffle.getWinners(seasonId);
        assertEq(winners.length, 1);
        assertEq(winners[0], player1);
    }

    function testPrizePoolCapturedFromCurveReserves() public {
        (uint256 seasonId, SOFBondingCurve curve) = _createSeason();
        vm.warp(block.timestamp + 1);
        raffle.startSeason(seasonId);

        // buys to accumulate reserves
        vm.startPrank(player1); sof.approve(address(curve), type(uint256).max); curve.buyTokens(4, 10 ether); vm.stopPrank();
        vm.startPrank(player2); sof.approve(address(curve), type(uint256).max); curve.buyTokens(3, 10 ether); vm.stopPrank();

        uint256 reservesBefore = curve.getSofReserves();

        // Lock trading and set the prize pool
        raffle.testRequestSeasonEnd(seasonId, 999);

        // Now fulfill the VRF request
        uint256 reqId = 999;
        uint256[] memory words = new uint256[](2);
        words[0] = 123; words[1] = 456;
        raffle.testFulfillAndFinalize(reqId, words);

        // Get the season state and verify the prize pool was captured correctly
        (,, , , uint256 totalPrizePool) = raffle.getSeasonDetails(seasonId);

        // The prize pool should match the reserves that were in the curve
        assertEq(totalPrizePool, reservesBefore, "Prize pool should match curve reserves");
    }

    function testAccessControlEnforced() public {
        (uint256 seasonId,) = _createSeason();
        // recordParticipant/removeParticipant are curve-callback only; should revert when called by others
        vm.expectRevert();
        raffle.recordParticipant(seasonId, address(this), 1);
        vm.expectRevert();
        raffle.removeParticipant(seasonId, address(this), 1);
    }

    function testRequestSeasonEndFlowLocksAndCompletes() public {
        (uint256 seasonId, SOFBondingCurve curve) = _createSeason();
        vm.warp(block.timestamp + 1);
        raffle.startSeason(seasonId);

        // have some activity
        vm.startPrank(player1);
        sof.approve(address(curve), type(uint256).max);
        curve.buyTokens(3, 10 ether);
        vm.stopPrank();

        // simulate requestSeasonEnd path
        uint256 reqId = 1001;
        raffle.testRequestSeasonEnd(seasonId, reqId);

        // curve should be locked
        vm.startPrank(player1);
        vm.expectRevert(abi.encodeWithSignature("TradingLocked()"));
        curve.buyTokens(1, 5 ether);
        vm.stopPrank();

        // fulfill VRF and finalize, then assert completion
        uint256[] memory words = new uint256[](2);
        words[0] = 11;
        words[1] = 22;
        raffle.testFulfillAndFinalize(reqId, words);
        address[] memory winners = raffle.getWinners(seasonId);
        assertGt(winners.length, 0);
    }

    function testZeroTicketsAfterSellProducesNoWinners() public {
        (uint256 seasonId, SOFBondingCurve curve) = _createSeason();
        vm.warp(block.timestamp + 1);
        raffle.startSeason(seasonId);

        // player buys then fully exits
        vm.startPrank(player1);
        sof.approve(address(curve), type(uint256).max);
        curve.buyTokens(4, 10 ether);
        IERC20(address(curve.raffleToken())).approve(address(curve), type(uint256).max);
        curve.sellTokens(4, 0);
        vm.stopPrank();

        // simulate VRF
        uint256 reqId = 2002;
        raffle.testRequestSeasonEnd(seasonId, reqId);
        uint256[] memory words = new uint256[](2);
        words[0] = 5;
        words[1] = 6;
        raffle.testFulfillAndFinalize(reqId, words);

        address[] memory winners = raffle.getWinners(seasonId);
        assertEq(winners.length, 0);
    }

    function testRevertOnEmptySeasonName() public {
        RaffleTypes.SeasonConfig memory cfg;
        cfg.name = ""; // Empty name
        cfg.startTime = block.timestamp + 1;
        cfg.endTime = block.timestamp + 3 days;
        cfg.winnerCount = 1;
        cfg.grandPrizeBps = 6500;
        cfg.treasuryAddress = treasury;

        vm.expectRevert(abi.encodeWithSignature("InvalidSeasonName()"));
        raffle.createSeason(cfg, _steps(), 50, 70);
    }

    // ============================================================================
    // VRF CALLBACK + SEPARATE FINALIZATION TESTS
    // ============================================================================

    function testVRFCallbackTransitionsToDistributing() public {
        (uint256 seasonId, SOFBondingCurve curve) = _createSeason();
        vm.warp(block.timestamp + 1);
        raffle.startSeason(seasonId);

        // Add participants
        vm.startPrank(player1);
        sof.approve(address(curve), type(uint256).max);
        curve.buyTokens(10, 20 ether);
        vm.stopPrank();

        vm.startPrank(player2);
        sof.approve(address(curve), type(uint256).max);
        curve.buyTokens(5, 15 ether);
        vm.stopPrank();

        // Simulate VRF pending state
        uint256 reqId = 500;
        raffle.testRequestSeasonEnd(seasonId, reqId);

        // Only call testFulfillOnly — no finalization
        uint256[] memory words = new uint256[](2);
        words[0] = 111;
        words[1] = 222;

        // Expect VRFFulfilled and SeasonReadyToFinalize events
        vm.expectEmit(true, true, false, false);
        emit VRFFulfilled(seasonId, reqId);

        raffle.testFulfillOnly(reqId, words);

        // Season should be in Distributing (NOT Completed) — no auto-finalization
        (,RaffleStorage.SeasonStatus status,,,) = raffle.getSeasonDetails(seasonId);
        assertEq(uint8(status), uint8(RaffleStorage.SeasonStatus.Distributing), "Should be Distributing after VRF callback");

        // Now finalize separately
        raffle.finalizeSeason(seasonId);

        // After separate finalization, season should be Completed
        address[] memory winners = raffle.getWinners(seasonId);
        assertGt(winners.length, 0, "Separate finalizeSeason should have selected winners");
    }

    function testSeparateFinalizeAfterVRF() public {
        (uint256 seasonId, SOFBondingCurve curve) = _createSeason();
        vm.warp(block.timestamp + 1);
        raffle.startSeason(seasonId);

        // Add a participant
        vm.startPrank(player1);
        sof.approve(address(curve), type(uint256).max);
        curve.buyTokens(5, 10 ether);
        vm.stopPrank();

        // Simulate VRF pending state and fulfill + finalize (two-step)
        uint256 reqId = 600;
        raffle.testRequestSeasonEnd(seasonId, reqId);

        uint256[] memory words = new uint256[](2);
        words[0] = 333;
        words[1] = 444;
        raffle.testFulfillAndFinalize(reqId, words);

        // Verify season completed via separate finalizeSeason call
        address[] memory winners = raffle.getWinners(seasonId);
        assertGt(winners.length, 0, "Season should be finalized");
    }

    function testVRFDataStoredBeforeFinalization() public {
        (uint256 seasonId, SOFBondingCurve curve) = _createSeason();
        vm.warp(block.timestamp + 1);
        raffle.startSeason(seasonId);

        // Add a participant
        vm.startPrank(player1);
        sof.approve(address(curve), type(uint256).max);
        curve.buyTokens(3, 10 ether);
        vm.stopPrank();

        // Simulate VRF
        uint256 reqId = 700;
        raffle.testSetVrf(seasonId, reqId);

        uint256[] memory words = new uint256[](2);
        words[0] = 555;
        words[1] = 666;
        raffle.testFulfill(reqId, words);

        // Season should be in Distributing — VRF data stored, awaiting finalization
        (,RaffleStorage.SeasonStatus status,,,) = raffle.getSeasonDetails(seasonId);
        assertEq(uint8(status), uint8(RaffleStorage.SeasonStatus.Distributing), "VRF data stored, season in Distributing");
    }

    // ============================================================================
    // SINGLE-PARTICIPANT FULL PRIZE POOL TEST
    // ============================================================================

    function testSingleParticipantGetsFullPrizePool() public {
        // Create season with winnerCount = 3 and 65% grand prize BPS
        RaffleTypes.SeasonConfig memory cfg;
        cfg.name = "Solo";
        cfg.startTime = block.timestamp + 1;
        cfg.endTime = block.timestamp + 3 days;
        cfg.winnerCount = 3;
        cfg.grandPrizeBps = 6500;
        cfg.treasuryAddress = treasury;
        uint256 seasonId = raffle.createSeason(cfg, _steps(), 50, 70);
        (RaffleTypes.SeasonConfig memory out,,,,) = raffle.getSeasonDetails(seasonId);
        SOFBondingCurve curve = SOFBondingCurve(out.bondingCurve);

        vm.warp(block.timestamp + 1);
        raffle.startSeason(seasonId);

        // Only one participant buys tickets
        vm.startPrank(player1);
        sof.approve(address(curve), type(uint256).max);
        curve.buyTokens(5, 10 ether);
        vm.stopPrank();

        uint256 prizePool = curve.getSofReserves();
        assertGt(prizePool, 0, "Prize pool should be non-zero");

        // Set prize pool before VRF (simulating requestSeasonEnd capturing reserves)
        raffle.testSetPrizePool(seasonId, prizePool);

        // Simulate VRF + finalize
        uint256 reqId = 8888;
        raffle.testRequestSeasonEnd(seasonId, reqId);
        uint256[] memory words = new uint256[](3);
        words[0] = 7;
        words[1] = 7;
        words[2] = 7;
        raffle.testFulfillAndFinalize(reqId, words);

        // Verify winner
        address[] memory winners = raffle.getWinners(seasonId);
        assertEq(winners.length, 1, "Should have exactly 1 winner");
        assertEq(winners[0], player1, "Winner should be the solo player");

        // Verify grandAmount == full prize pool and consolationAmount == 0
        address distAddr = raffle.prizeDistributor();
        IRafflePrizeDistributor.SeasonPayouts memory payouts =
            IRafflePrizeDistributor(distAddr).getSeason(seasonId);
        assertEq(payouts.grandAmount, prizePool, "Grand amount should be the full prize pool");
        assertEq(payouts.consolationAmount, 0, "Consolation amount should be zero");
        assertTrue(payouts.funded, "Season should be funded");

        // Verify the solo player can claim the full pool
        uint256 balBefore = sof.balanceOf(player1);
        vm.prank(player1);
        IRafflePrizeDistributor(distAddr).claimGrand(seasonId);
        uint256 balAfter = sof.balanceOf(player1);
        assertEq(balAfter - balBefore, prizePool, "Player should receive the full prize pool");
    }

    // ============================================================================
    // CANCEL STUCK SEASON TESTS (C-2 FIX)
    // ============================================================================

    function testCancelStuckSeason_Success() public {
        (uint256 seasonId, SOFBondingCurve curve) = _createSeason();
        vm.warp(block.timestamp + 1);
        raffle.startSeason(seasonId);

        // Player buys tickets
        vm.startPrank(player1);
        sof.approve(address(curve), type(uint256).max);
        curve.buyTokens(10, 20 ether);
        vm.stopPrank();

        // Simulate VRF pending (season end requested)
        uint256 reqId = 900;
        raffle.testRequestSeasonEnd(seasonId, reqId);

        // Warp past VRF timeout (48 hours)
        vm.warp(block.timestamp + 48 hours + 1);

        // Cancel stuck season
        raffle.cancelStuckSeason(seasonId);

        // Verify season is Cancelled
        (,RaffleStorage.SeasonStatus status,,,) = raffle.getSeasonDetails(seasonId);
        assertEq(uint8(status), uint8(RaffleStorage.SeasonStatus.Cancelled));

        // Verify player can sell tokens (curve in sell-only mode)
        uint256 balBefore = sof.balanceOf(player1);
        vm.startPrank(player1);
        curve.sellTokens(10, 0);
        vm.stopPrank();
        uint256 balAfter = sof.balanceOf(player1);
        assertGt(balAfter, balBefore, "Player should receive SOF from selling");
    }

    function testCancelStuckSeason_RevertBeforeTimeout() public {
        (uint256 seasonId, SOFBondingCurve curve) = _createSeason();
        vm.warp(block.timestamp + 1);
        raffle.startSeason(seasonId);

        vm.startPrank(player1);
        sof.approve(address(curve), type(uint256).max);
        curve.buyTokens(5, 10 ether);
        vm.stopPrank();

        uint256 reqId = 901;
        raffle.testRequestSeasonEnd(seasonId, reqId);

        // Try to cancel before timeout — should revert
        vm.warp(block.timestamp + 24 hours); // only 24h, not 48h
        vm.expectRevert();
        raffle.cancelStuckSeason(seasonId);
    }

    function testCancelStuckSeason_RevertIfNotVRFPending() public {
        (uint256 seasonId,) = _createSeason();
        vm.warp(block.timestamp + 1);
        raffle.startSeason(seasonId);

        // Season is Active, not VRFPending
        vm.expectRevert();
        raffle.cancelStuckSeason(seasonId);
    }

    function testCancelStuckSeason_BuyBlockedAfterCancel() public {
        (uint256 seasonId, SOFBondingCurve curve) = _createSeason();
        vm.warp(block.timestamp + 1);
        raffle.startSeason(seasonId);

        vm.startPrank(player1);
        sof.approve(address(curve), type(uint256).max);
        curve.buyTokens(5, 10 ether);
        vm.stopPrank();

        uint256 reqId = 902;
        raffle.testRequestSeasonEnd(seasonId, reqId);
        vm.warp(block.timestamp + 48 hours + 1);
        raffle.cancelStuckSeason(seasonId);

        // Buying should be blocked (sell-only mode)
        vm.startPrank(player2);
        sof.approve(address(curve), type(uint256).max);
        vm.expectRevert();
        curve.buyTokens(5, 10 ether);
        vm.stopPrank();
    }

    function testCancelStuckSeason_LateVRFIgnored() public {
        (uint256 seasonId, SOFBondingCurve curve) = _createSeason();
        vm.warp(block.timestamp + 1);
        raffle.startSeason(seasonId);

        vm.startPrank(player1);
        sof.approve(address(curve), type(uint256).max);
        curve.buyTokens(5, 10 ether);
        vm.stopPrank();

        uint256 reqId = 903;
        raffle.testRequestSeasonEnd(seasonId, reqId);
        vm.warp(block.timestamp + 48 hours + 1);
        raffle.cancelStuckSeason(seasonId);

        // Late VRF arrival should be silently ignored (no revert)
        uint256[] memory words = new uint256[](2);
        words[0] = 111;
        words[1] = 222;
        raffle.testFulfill(reqId, words);

        // Season should still be Cancelled, not Distributing
        (,RaffleStorage.SeasonStatus status,,,) = raffle.getSeasonDetails(seasonId);
        assertEq(uint8(status), uint8(RaffleStorage.SeasonStatus.Cancelled));
    }

    // Event declaration for expectEmit
    event VRFFulfilled(uint256 indexed seasonId, uint256 indexed requestId);
    event SeasonReadyToFinalize(uint256 indexed seasonId);
    event SeasonCancelled(uint256 indexed seasonId);
}
