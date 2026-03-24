// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/core/Raffle.sol";
import "../src/core/SeasonFactory.sol";
import "../src/core/RafflePrizeDistributor.sol";
import "../src/lib/IRafflePrizeDistributor.sol";
import "../src/curve/SOFBondingCurve.sol";
import "../src/lib/RaffleTypes.sol";
import "../src/token/RaffleToken.sol";

// Minimal mock SOF token (duplicated from existing tests for isolation)
contract MockSOF {
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

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "bal");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        emit Transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(balanceOf[from] >= amount, "bal");
        require(allowance[from][msg.sender] >= amount, "allow");
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        allowance[from][msg.sender] -= amount;
        emit Transfer(from, to, amount);
        return true;
    }
}

// Harness exposing a way to simulate the VRF callback with custom words
contract RaffleFinalizeHarness is Raffle {
    constructor(address sof, address coord, uint64 subId, bytes32 keyHash)
        Raffle(sof, coord, subId, keyHash)
    {}

    function testSetVrfState(uint256 seasonId, uint256 requestId, uint256[] calldata words) external {
        seasonStates[seasonId].status = SeasonStatus.VRFPending;
        vrfRequestToSeason[requestId] = seasonId;
        fulfillRandomWords(requestId, words);
    }
}

contract RaffleFinalizeSeasonTest is Test {
    RaffleFinalizeHarness public raffle;
    MockSOF public sof;
    SeasonFactory public factory;
    RafflePrizeDistributor public distributor;

    address public player1 = address(0x11);
    address public player2 = address(0x22);
    address public treasury = address(0x33);

    function setUp() public {
        sof = new MockSOF("SOF", "SOF", 18);
        sof.mint(player1, 10000 ether);
        sof.mint(player2, 10000 ether);

        address mockCoordinator = address(0xCAFE);
        raffle = new RaffleFinalizeHarness(address(sof), mockCoordinator, 0, bytes32(0));

        factory = new SeasonFactory(address(raffle));
        raffle.setSeasonFactory(address(factory));

        distributor = new RafflePrizeDistributor(address(this));
        distributor.grantRole(distributor.RAFFLE_ROLE(), address(raffle));
        raffle.setPrizeDistributor(address(distributor));
    }

    function _steps() internal pure returns (RaffleTypes.BondStep[] memory s) {
        s = new RaffleTypes.BondStep[](1);
        s[0] = RaffleTypes.BondStep({rangeTo: uint128(1000), price: uint128(1 ether)});
    }

    function _createSeason() internal returns (uint256 seasonId, SOFBondingCurve curve) {
        RaffleTypes.SeasonConfig memory cfg;
        cfg.name = "S-finalize";
        cfg.startTime = block.timestamp + 1;
        cfg.endTime = block.timestamp + 3 days;
        cfg.winnerCount = 2;
        cfg.grandPrizeBps = 6500;
        cfg.treasuryAddress = treasury;
        seasonId = raffle.createSeason(cfg, _steps(), 50, 70);
        (RaffleTypes.SeasonConfig memory out,,,,) = raffle.getSeasonDetails(seasonId);
        curve = SOFBondingCurve(out.bondingCurve);
    }

    function testFinalizeSeason_UsesStoredRandomnessAndCompletes() public {
        (uint256 seasonId, SOFBondingCurve curve) = _createSeason();

        vm.warp(block.timestamp + 1);
        raffle.startSeason(seasonId);

        // Players buy tickets so there is a prize pool
        vm.startPrank(player1);
        sof.approve(address(curve), type(uint256).max);
        curve.buyTokens(10, 20 ether);
        vm.stopPrank();

        vm.startPrank(player2);
        sof.approve(address(curve), type(uint256).max);
        curve.buyTokens(5, 20 ether);
        vm.stopPrank();


        // Simulate VRF callback: VRFPending -> auto-finalize triggers Completed
        uint256 reqId = 42;
        uint256[] memory words = new uint256[](2);
        words[0] = 777;
        words[1] = 888;
        raffle.testSetVrfState(seasonId, reqId, words);

        // With auto-finalization, the season should now be Completed (not Distributing)
        // The VRF callback automatically triggers finalization
        (
            ,
            RaffleStorage.SeasonStatus status,
            uint256 totalParticipants,
            uint256 totalTickets,
            uint256 totalPrizePool
        ) = raffle.getSeasonDetails(seasonId);

        // Auto-finalization completes the season during VRF callback
        assertEq(uint8(status), uint8(RaffleStorage.SeasonStatus.Completed), "Auto-finalize should complete season");
        assertEq(totalParticipants, 2);
        assertEq(totalTickets, 15);

        // Season should be completed and winners available (set by auto-finalize)
        address[] memory winners = raffle.getWinners(seasonId);
        assertGt(winners.length, 0, "Winners should be selected by auto-finalize");

        // Verify status is Completed
        ( , status, , , ) = raffle.getSeasonDetails(seasonId);
        assertEq(uint8(status), uint8(RaffleStorage.SeasonStatus.Completed));
    }
}
