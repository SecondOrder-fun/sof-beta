// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {Raffle} from "../src/core/Raffle.sol";
import {SeasonFactory} from "../src/core/SeasonFactory.sol";
import {RafflePrizeDistributor} from "../src/core/RafflePrizeDistributor.sol";
import {RolloverEscrow} from "../src/core/RolloverEscrow.sol";
import {SOFBondingCurve} from "../src/curve/SOFBondingCurve.sol";
import {SOFToken} from "../src/token/SOFToken.sol";
import {RaffleTypes} from "../src/lib/RaffleTypes.sol";

/// @notice Verifies SeasonFactory auto-grants ESCROW_ROLE to the configured RolloverEscrow
///         on every newly-deployed bonding curve. Covers the gap where rollover spends
///         would revert on fresh seasons because nobody had a public path to grant the role.
contract SeasonFactoryRolloverTest is Test {
    SOFToken public sof;
    Raffle public raffle;
    SeasonFactory public seasonFactory;
    RafflePrizeDistributor public distributor;
    RolloverEscrow public escrow;

    address public admin = address(this);
    address public treasury = address(0xFEE);

    function setUp() public {
        sof = new SOFToken("SecondOrder Fun Token", "SOF", 1_000_000 ether);
        raffle = new Raffle(address(sof), address(0xCAFE), 1, bytes32(0));
        seasonFactory = new SeasonFactory(address(raffle));
        raffle.setSeasonFactory(address(seasonFactory));

        distributor = new RafflePrizeDistributor(admin);
        distributor.grantRole(distributor.RAFFLE_ROLE(), address(raffle));
        raffle.setPrizeDistributor(address(distributor));

        escrow = new RolloverEscrow(address(sof), treasury, address(raffle));
    }

    function _createSeason() internal returns (uint256 id, SOFBondingCurve curve) {
        RaffleTypes.BondStep[] memory steps = new RaffleTypes.BondStep[](1);
        steps[0] = RaffleTypes.BondStep({rangeTo: 10_000, price: 1 ether});

        RaffleTypes.SeasonConfig memory cfg;
        cfg.name = "Rollover Role Test";
        cfg.startTime = block.timestamp + 1;
        cfg.endTime = block.timestamp + 1 days;
        cfg.winnerCount = 1;
        cfg.grandPrizeBps = 6500;
        cfg.treasuryAddress = treasury;

        id = raffle.createSeason(cfg, steps, 0, 0);
        (RaffleTypes.SeasonConfig memory deployed,,,,) = raffle.getSeasonDetails(id);
        curve = SOFBondingCurve(deployed.bondingCurve);
    }

    function test_setRolloverEscrow_grantsEscrowRoleOnNewCurve() public {
        seasonFactory.setRolloverEscrow(address(escrow));
        assertEq(seasonFactory.rolloverEscrow(), address(escrow));

        (, SOFBondingCurve curve) = _createSeason();

        assertTrue(
            curve.hasRole(curve.ESCROW_ROLE(), address(escrow)),
            "Escrow should have ESCROW_ROLE on new curve"
        );
    }

    function test_unsetRolloverEscrow_skipsGrant() public {
        // No setRolloverEscrow call — default zero address.
        (, SOFBondingCurve curve) = _createSeason();

        assertFalse(
            curve.hasRole(curve.ESCROW_ROLE(), address(escrow)),
            "Escrow must not have ESCROW_ROLE when factory has no escrow configured"
        );
    }

    function test_setRolloverEscrow_requiresAdmin() public {
        address notAdmin = address(0xBEEF);
        vm.prank(notAdmin);
        // OZ AccessControlUnauthorizedAccount(account, role)
        vm.expectRevert();
        seasonFactory.setRolloverEscrow(address(escrow));
    }
}
