// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {Raffle} from "../src/core/Raffle.sol";
import {RaffleStorage} from "../src/core/RaffleStorage.sol";
import {SeasonFactory} from "../src/core/SeasonFactory.sol";
import {RafflePrizeDistributor} from "../src/core/RafflePrizeDistributor.sol";
import {RolloverEscrow} from "../src/core/RolloverEscrow.sol";
import {SOFBondingCurve} from "../src/curve/SOFBondingCurve.sol";
import {RaffleTypes} from "../src/lib/RaffleTypes.sol";

// ---------------------------------------------------------------------------
// Minimal mock SOF token (mirrors RaffleFinalizeSeason.t.sol)
// ---------------------------------------------------------------------------
contract MockSOFOC {
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

// ---------------------------------------------------------------------------
// Harness: re-use the same pattern from RaffleFinalizeSeason.t.sol
// ---------------------------------------------------------------------------
contract RaffleFinalizeHarnessOC is Raffle {
    constructor(address sof, address coord, uint64 subId, bytes32 keyHash)
        Raffle(sof, coord, subId, keyHash)
    {}

    function testSetVrfState(uint256 seasonId, uint256 requestId, uint256[] calldata words) external {
        seasonStates[seasonId].status = SeasonStatus.VRFPending;
        vrfRequestToSeason[requestId] = seasonId;
        fulfillRandomWords(requestId, words);
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
contract RaffleOpenCohortIntegrationTest is Test {
    RaffleFinalizeHarnessOC public raffle;
    MockSOFOC public sof;
    SeasonFactory public factory;
    RafflePrizeDistributor public distributor;
    RolloverEscrow public escrow;

    address public player1  = address(0x11);
    address public player2  = address(0x22);
    address public treasury = address(0x33);

    function setUp() public {
        sof = new MockSOFOC("SOF", "SOF", 18);
        sof.mint(player1, 10000 ether);
        sof.mint(player2, 10000 ether);

        address mockCoordinator = address(0xCAFE);
        raffle = new RaffleFinalizeHarnessOC(address(sof), mockCoordinator, 0, bytes32(0));

        factory = new SeasonFactory(address(raffle));
        raffle.setSeasonFactory(address(factory));
        raffle.grantRole(raffle.SEASON_FACTORY_ROLE(), address(factory));

        distributor = new RafflePrizeDistributor(address(this));
        distributor.grantRole(distributor.RAFFLE_ROLE(), address(raffle));
        raffle.setPrizeDistributor(address(distributor));

        // Deploy RolloverEscrow: constructor(address sof, address treasury, address raffle)
        escrow = new RolloverEscrow(address(sof), treasury, address(raffle));

        // Grant DEFAULT_ADMIN_ROLE on escrow to raffle so it can call openCohort
        escrow.grantRole(escrow.DEFAULT_ADMIN_ROLE(), address(raffle));

        // Wire escrow into distributor (mirrors RolloverIntegration.t.sol)
        distributor.grantRole(distributor.RAFFLE_ROLE(), address(distributor)); // needed for fundSeason
        escrow.grantRole(escrow.DISTRIBUTOR_ROLE(), address(distributor));
        distributor.setRolloverEscrow(address(escrow));

        // Wire escrow into raffle
        raffle.setRolloverEscrow(address(escrow));
    }

    function _steps() internal pure returns (RaffleTypes.BondStep[] memory s) {
        s = new RaffleTypes.BondStep[](1);
        s[0] = RaffleTypes.BondStep({rangeTo: uint128(1000), price: uint128(1 ether)});
    }

    function _createAndRunToVrf() internal returns (uint256 seasonId) {
        RaffleTypes.SeasonConfig memory cfg;
        cfg.name = "S-rollover";
        cfg.startTime = block.timestamp + 1;
        cfg.endTime = block.timestamp + 3 days;
        cfg.winnerCount = 2;
        cfg.grandPrizeBps = 6500;
        cfg.treasuryAddress = treasury;
        seasonId = raffle.createSeason(cfg, _steps(), 50, 70);
        (RaffleTypes.SeasonConfig memory out,,,,) = raffle.getSeasonDetails(seasonId);
        SOFBondingCurve curve = SOFBondingCurve(out.bondingCurve);

        vm.warp(block.timestamp + 1);
        raffle.startSeason(seasonId);

        vm.startPrank(player1);
        sof.approve(address(curve), type(uint256).max);
        curve.buyTokens(10, 20 ether);
        vm.stopPrank();

        vm.startPrank(player2);
        sof.approve(address(curve), type(uint256).max);
        curve.buyTokens(5, 20 ether);
        vm.stopPrank();

        // Inject VRF words to advance to Distributing
        uint256[] memory words = new uint256[](2);
        words[0] = 777;
        words[1] = 888;
        raffle.testSetVrfState(seasonId, 42, words);
    }

    // -----------------------------------------------------------------------
    // Test 1: finalizeSeason opens the rollover cohort
    // -----------------------------------------------------------------------
    function test_finalizeSeason_opensRolloverCohort() public {
        uint256 seasonId = _createAndRunToVrf();

        // Pre-finalize: cohort must be in phase None
        (RolloverEscrow.EscrowPhase phaseBefore,,,,,,) = escrow.getCohortState(seasonId);
        assertEq(uint8(phaseBefore), uint8(RolloverEscrow.EscrowPhase.None), "Pre-finalize phase should be None");

        raffle.finalizeSeason(seasonId);

        // Post-finalize: cohort must be Open and bonusBps == defaultBonusBps
        (RolloverEscrow.EscrowPhase phaseAfter,, uint16 bonusBps,,,,) = escrow.getCohortState(seasonId);
        assertEq(uint8(phaseAfter), uint8(RolloverEscrow.EscrowPhase.Open), "Post-finalize phase should be Open");
        assertEq(bonusBps, escrow.defaultBonusBps(), "bonusBps should equal defaultBonusBps");
    }

    // -----------------------------------------------------------------------
    // Test 2: finalizeSeason without escrow wired must not revert
    // -----------------------------------------------------------------------
    function test_finalizeSeason_withoutEscrow_doesNotRevert() public {
        // Unwire escrow
        raffle.setRolloverEscrow(address(0));

        uint256 seasonId = _createAndRunToVrf();

        // Should complete without revert
        raffle.finalizeSeason(seasonId);

        (, RaffleStorage.SeasonStatus status,,,) = raffle.getSeasonDetails(seasonId);
        assertEq(uint8(status), uint8(RaffleStorage.SeasonStatus.Completed), "Season should be Completed");
    }
}
