// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {SOFToken} from "../src/token/SOFToken.sol";
import {RaffleToken} from "../src/token/RaffleToken.sol";
import {SOFBondingCurve} from "../src/curve/SOFBondingCurve.sol";
import {RolloverEscrow} from "../src/core/RolloverEscrow.sol";
import {RaffleTypes} from "../src/lib/RaffleTypes.sol";

/// @notice Verifies that spendFromRollover targets the exact bonding curve locked in
///         at activateCohort time — never a stale/global one. Closes the reviewer
///         blocker: the global `bondingCurve` slot is replaced by a per-cohort field,
///         so two simultaneously-active cohorts cannot cross-contaminate.
contract RolloverPerCohortCurveTest is Test {
    SOFToken public sof;
    RolloverEscrow public escrow;

    SOFBondingCurve public curveA;
    SOFBondingCurve public curveB;
    RaffleToken public tokenA;
    RaffleToken public tokenB;

    address public admin = address(this);
    address public treasury = address(0xFEE);
    address public raffleAddr = makeAddr("raffle"); // synthetic holder of deposit role
    address public distributor = makeAddr("distributor");
    address public user = address(0xBEEF);

    uint256 constant COHORT_A     = 1;  // source season
    uint256 constant COHORT_B     = 3;
    uint256 constant NEXT_A       = 2;  // destination — curveA
    uint256 constant NEXT_B       = 4;  // destination — curveB
    uint256 constant DEPOSIT      = 100e18;

    function setUp() public {
        sof = new SOFToken("SOF", "SOF", 10_000_000e18);
        escrow = new RolloverEscrow(address(sof), treasury, raffleAddr);
        escrow.grantRole(escrow.DISTRIBUTOR_ROLE(), distributor);

        (curveA, tokenA) = _deployCurve("Season A", NEXT_A);
        (curveB, tokenB) = _deployCurve("Season B", NEXT_B);

        sof.transfer(treasury, 1_000e18);
        sof.transfer(distributor, 10_000e18);

        vm.prank(treasury);
        sof.approve(address(escrow), type(uint256).max);

        vm.prank(distributor);
        sof.approve(address(escrow), type(uint256).max);

        // Open + fund + activate both cohorts — each locked to its own curve.
        _openFundActivate(COHORT_A, NEXT_A, address(curveA));
        _openFundActivate(COHORT_B, NEXT_B, address(curveB));
    }

    function _deployCurve(string memory name, uint256 seasonId)
        internal
        returns (SOFBondingCurve c, RaffleToken t)
    {
        c = new SOFBondingCurve(address(sof), admin);
        t = new RaffleToken(name, "TKT", seasonId, name, block.timestamp, block.timestamp + 30 days);
        t.grantRole(t.MINTER_ROLE(), address(c));
        t.grantRole(t.BURNER_ROLE(), address(c));

        RaffleTypes.BondStep[] memory steps = new RaffleTypes.BondStep[](1);
        steps[0] = RaffleTypes.BondStep({rangeTo: 100_000, price: 1e18});
        c.initializeCurve(address(t), steps, 0, 0, treasury);
        c.grantRole(c.ESCROW_ROLE(), address(escrow));
    }

    function _openFundActivate(uint256 seasonId, uint256 nextSeasonId, address curve) internal {
        escrow.openCohort(seasonId, 600);

        vm.startPrank(distributor);
        sof.transfer(address(escrow), DEPOSIT);
        escrow.deposit(user, DEPOSIT, seasonId);
        vm.stopPrank();

        escrow.activateCohort(seasonId, nextSeasonId, curve);
    }

    function test_spendHitsCurveA_notCurveB() public {
        uint256 aBefore = tokenA.balanceOf(user);
        uint256 bBefore = tokenB.balanceOf(user);

        // 50 SOF + 3 SOF bonus → 53 tickets on curveA
        vm.prank(user);
        escrow.spendFromRollover(COHORT_A, 50e18, 53, 53e18);

        assertEq(tokenA.balanceOf(user) - aBefore, 53, "tickets minted on curveA");
        assertEq(tokenB.balanceOf(user), bBefore, "curveB must not mint for cohort A spend");
    }

    function test_spendHitsCurveB_notCurveA() public {
        uint256 aBefore = tokenA.balanceOf(user);
        uint256 bBefore = tokenB.balanceOf(user);

        vm.prank(user);
        escrow.spendFromRollover(COHORT_B, 50e18, 53, 53e18);

        assertEq(tokenB.balanceOf(user) - bBefore, 53, "tickets minted on curveB");
        assertEq(tokenA.balanceOf(user), aBefore, "curveA must not mint for cohort B spend");
    }

    function test_activateCohortRejectsZeroCurve() public {
        escrow.openCohort(99, 600);
        vm.expectRevert(); // BondingCurveNotSet
        escrow.activateCohort(99, 100, address(0));
    }
}
