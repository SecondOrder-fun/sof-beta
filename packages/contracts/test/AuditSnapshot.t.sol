// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {Raffle} from "../src/core/Raffle.sol";
import {SOFBondingCurve} from "../src/curve/SOFBondingCurve.sol";
import {RaffleTypes} from "../src/lib/RaffleTypes.sol";
import {SeasonFactory} from "../src/core/SeasonFactory.sol";
import {RafflePrizeDistributor} from "../src/core/RafflePrizeDistributor.sol";

// Reuse the same harness pattern from RaffleVRF.t.sol
contract AuditSnapshotHarness is Raffle {
    constructor(address sof, address coord, uint64 subId, bytes32 keyHash) Raffle(sof, coord, subId, keyHash) {}

    function testFulfill(uint256 requestId, uint256[] calldata words) external {
        fulfillRandomWords(requestId, words);
    }

    function testFulfillAndFinalize(uint256 requestId, uint256[] calldata words) external {
        fulfillRandomWords(requestId, words);
        uint256 seasonId = vrfRequestToSeason[requestId];
        if (seasonStates[seasonId].status == SeasonStatus.Distributing) {
            this.finalizeSeason(seasonId);
        }
    }

    function testRequestSeasonEnd(uint256 seasonId, uint256 requestId) external {
        SOFBondingCurve(seasons[seasonId].bondingCurve).lockTrading();
        seasonStates[seasonId].totalPrizePool = SOFBondingCurve(seasons[seasonId].bondingCurve).getSofReserves();
        seasons[seasonId].isActive = false;
        seasonStates[seasonId].status = SeasonStatus.VRFPending;
        seasonStates[seasonId].vrfRequestTimestamp = block.timestamp;
        vrfRequestToSeason[requestId] = seasonId;
        // Should also compute and store the audit snapshot
        _snapshotParticipants(seasonId);
    }

    function testSetPrizePool(uint256 seasonId, uint256 amount) external {
        seasonStates[seasonId].totalPrizePool = amount;
    }
}

contract MockERC20ForSnapshot {
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

contract AuditSnapshotTest is Test {
    AuditSnapshotHarness public raffle;
    MockERC20ForSnapshot public sof;
    address public player1 = address(0xA1);
    address public player2 = address(0xA2);
    address public player3 = address(0xA3);
    address public treasury = address(0xFEE);

    event SeasonSnapshotted(uint256 indexed seasonId, bytes32 snapshotHash);

    function setUp() public {
        sof = new MockERC20ForSnapshot("SOF", "SOF", 18);
        sof.mint(player1, 10000 ether);
        sof.mint(player2, 10000 ether);
        sof.mint(player3, 10000 ether);
        address mockCoordinator = address(0xCAFE);
        raffle = new AuditSnapshotHarness(address(sof), mockCoordinator, 0, bytes32(0));
        SeasonFactory factory = new SeasonFactory(address(raffle));
        raffle.setSeasonFactory(address(factory));
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
        cfg.name = "Snap";
        cfg.startTime = block.timestamp + 1;
        cfg.endTime = block.timestamp + 3 days;
        cfg.winnerCount = 1;
        cfg.grandPrizeBps = 6500;
        cfg.treasuryAddress = treasury;
        seasonId = raffle.createSeason(cfg, _steps(), 50, 70);
        (RaffleTypes.SeasonConfig memory out,,,,) = raffle.getSeasonDetails(seasonId);
        curve = SOFBondingCurve(out.bondingCurve);
    }

    // ========================================================================
    // TEST 1: Snapshot hash is stored and non-zero after season lock
    // ========================================================================
    function testSnapshotStoredOnSeasonLock() public {
        (uint256 seasonId, SOFBondingCurve curve) = _createSeason();
        vm.warp(block.timestamp + 1);
        raffle.startSeason(seasonId);

        // Two players buy tickets
        vm.startPrank(player1);
        sof.approve(address(curve), type(uint256).max);
        curve.buyTokens(10, 20 ether);
        vm.stopPrank();

        vm.startPrank(player2);
        sof.approve(address(curve), type(uint256).max);
        curve.buyTokens(5, 15 ether);
        vm.stopPrank();

        // Lock season
        uint256 reqId = 100;
        raffle.testRequestSeasonEnd(seasonId, reqId);

        // Snapshot should be stored
        bytes32 snapshot = raffle.getSeasonSnapshot(seasonId);
        assertTrue(snapshot != bytes32(0), "Snapshot should be non-zero");
    }

    // ========================================================================
    // TEST 2: Snapshot matches expected hash of participants + ticket counts
    // ========================================================================
    function testSnapshotMatchesExpectedHash() public {
        (uint256 seasonId, SOFBondingCurve curve) = _createSeason();
        vm.warp(block.timestamp + 1);
        raffle.startSeason(seasonId);

        vm.startPrank(player1);
        sof.approve(address(curve), type(uint256).max);
        curve.buyTokens(10, 20 ether);
        vm.stopPrank();

        vm.startPrank(player2);
        sof.approve(address(curve), type(uint256).max);
        curve.buyTokens(5, 15 ether);
        vm.stopPrank();

        // Lock season
        uint256 reqId = 200;
        raffle.testRequestSeasonEnd(seasonId, reqId);

        // Compute expected hash off-chain
        address[] memory participants = raffle.getParticipants(seasonId);
        uint256[] memory ticketCounts = new uint256[](participants.length);
        for (uint256 i = 0; i < participants.length; i++) {
            ticketCounts[i] = raffle.getParticipantPosition(seasonId, participants[i]).ticketCount;
        }
        bytes32 expectedHash = keccak256(abi.encode(participants, ticketCounts));

        bytes32 snapshot = raffle.getSeasonSnapshot(seasonId);
        assertEq(snapshot, expectedHash, "Snapshot should match expected hash");
    }

    // ========================================================================
    // TEST 3: Snapshot emits event with correct hash
    // ========================================================================
    function testSnapshotEmitsEvent() public {
        (uint256 seasonId, SOFBondingCurve curve) = _createSeason();
        vm.warp(block.timestamp + 1);
        raffle.startSeason(seasonId);

        vm.startPrank(player1);
        sof.approve(address(curve), type(uint256).max);
        curve.buyTokens(10, 20 ether);
        vm.stopPrank();

        // We expect the SeasonSnapshotted event when locking
        // We can't predict the exact hash here, so just check indexed seasonId
        vm.expectEmit(true, false, false, false);
        emit SeasonSnapshotted(seasonId, bytes32(0));

        uint256 reqId = 300;
        raffle.testRequestSeasonEnd(seasonId, reqId);
    }

    // ========================================================================
    // TEST 4: Zero participants produces zero snapshot
    // ========================================================================
    function testSnapshotZeroParticipants() public {
        (uint256 seasonId,) = _createSeason();
        vm.warp(block.timestamp + 1);
        raffle.startSeason(seasonId);

        // Lock with no participants
        uint256 reqId = 400;
        raffle.testRequestSeasonEnd(seasonId, reqId);

        // Empty participant list should produce a deterministic hash (of empty arrays)
        address[] memory empty = new address[](0);
        uint256[] memory emptyTickets = new uint256[](0);
        bytes32 expectedHash = keccak256(abi.encode(empty, emptyTickets));

        bytes32 snapshot = raffle.getSeasonSnapshot(seasonId);
        assertEq(snapshot, expectedHash, "Empty snapshot should match hash of empty arrays");
    }

    // ========================================================================
    // TEST 5: Three participants snapshot is deterministic and correct
    // ========================================================================
    function testSnapshotThreeParticipants() public {
        (uint256 seasonId, SOFBondingCurve curve) = _createSeason();
        vm.warp(block.timestamp + 1);
        raffle.startSeason(seasonId);

        // Three players buy different amounts
        vm.startPrank(player1);
        sof.approve(address(curve), type(uint256).max);
        curve.buyTokens(20, 40 ether);
        vm.stopPrank();

        vm.startPrank(player2);
        sof.approve(address(curve), type(uint256).max);
        curve.buyTokens(10, 20 ether);
        vm.stopPrank();

        vm.startPrank(player3);
        sof.approve(address(curve), type(uint256).max);
        curve.buyTokens(5, 15 ether);
        vm.stopPrank();

        // Lock season
        uint256 reqId = 500;
        raffle.testRequestSeasonEnd(seasonId, reqId);

        // Verify snapshot matches
        address[] memory participants = raffle.getParticipants(seasonId);
        assertEq(participants.length, 3, "Should have 3 participants");

        uint256[] memory ticketCounts = new uint256[](3);
        for (uint256 i = 0; i < 3; i++) {
            ticketCounts[i] = raffle.getParticipantPosition(seasonId, participants[i]).ticketCount;
        }
        bytes32 expectedHash = keccak256(abi.encode(participants, ticketCounts));

        bytes32 snapshot = raffle.getSeasonSnapshot(seasonId);
        assertEq(snapshot, expectedHash, "Three-participant snapshot should match");
    }

    // ========================================================================
    // TEST 6: Snapshot is not overwritten by VRF fulfillment
    // ========================================================================
    function testSnapshotNotOverwrittenByVRF() public {
        (uint256 seasonId, SOFBondingCurve curve) = _createSeason();
        vm.warp(block.timestamp + 1);
        raffle.startSeason(seasonId);

        vm.startPrank(player1);
        sof.approve(address(curve), type(uint256).max);
        curve.buyTokens(10, 20 ether);
        vm.stopPrank();

        // Lock and capture snapshot
        uint256 reqId = 600;
        raffle.testRequestSeasonEnd(seasonId, reqId);
        bytes32 snapshotBeforeVRF = raffle.getSeasonSnapshot(seasonId);

        // Fulfill VRF
        uint256[] memory words = new uint256[](1);
        words[0] = 42;
        raffle.testFulfillAndFinalize(reqId, words);

        // Snapshot should be unchanged
        bytes32 snapshotAfterVRF = raffle.getSeasonSnapshot(seasonId);
        assertEq(snapshotAfterVRF, snapshotBeforeVRF, "Snapshot should not change after VRF");
    }
}
