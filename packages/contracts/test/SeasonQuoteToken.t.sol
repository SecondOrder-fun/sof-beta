// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Raffle, InvalidQuoteToken} from "../src/core/Raffle.sol";
import {SeasonFactory} from "../src/core/SeasonFactory.sol";
import {SOFBondingCurve} from "../src/curve/SOFBondingCurve.sol";
import {MockERC20} from "../src/test-helpers/MockERC20.sol";
import {RaffleTypes} from "../src/lib/RaffleTypes.sol";

contract QuoteToken18 is ERC20 {
    constructor(string memory n, string memory s) ERC20(n, s) {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// @notice Covers per-season quote tokens: a season's ticket curve is denominated in
///         `SeasonConfig.quoteToken`, not in one protocol-wide token.
///
///         This is the Phase 0 groundwork for the launchpad, where every launched token
///         denominates its own raffle seasons. Until every caller supplies one, a zero
///         `quoteToken` falls back to the Raffle's default so existing callers keep working.
contract SeasonQuoteTokenTest is Test {
    MockERC20 public defaultToken;
    QuoteToken18 public launchToken;
    Raffle public raffle;
    SeasonFactory public seasonFactory;

    address public treasury = address(0xFEE);
    address public player = address(0xBEEF);

    function setUp() public {
        defaultToken = new MockERC20("Default Quote", "DQ", 1_000_000 ether);
        launchToken = new QuoteToken18("Launched Token", "LAUNCH");

        raffle = new Raffle(address(0xCAFE), 1, bytes32(0));
        seasonFactory = new SeasonFactory(address(raffle));
        raffle.setSeasonFactory(address(seasonFactory));
        raffle.grantRole(raffle.SEASON_FACTORY_ROLE(), address(seasonFactory));
    }

    function _createSeason(address quoteToken) internal returns (uint256 id, SOFBondingCurve curve) {
        RaffleTypes.BondStep[] memory steps = new RaffleTypes.BondStep[](1);
        steps[0] = RaffleTypes.BondStep({rangeTo: 10_000, price: 1 ether});

        RaffleTypes.SeasonConfig memory cfg;
        cfg.name = "Quote Token Season";
        cfg.startTime = block.timestamp + 1;
        cfg.endTime = block.timestamp + 1 days;
        cfg.winnerCount = 1;
        cfg.grandPrizeBps = 6500;
        cfg.treasuryAddress = treasury;
        cfg.quoteToken = quoteToken;

        id = raffle.createSeason(cfg, steps, 0, 0);
        (RaffleTypes.SeasonConfig memory deployed,,,,) = raffle.getSeasonDetails(id);
        curve = SOFBondingCurve(deployed.bondingCurve);
    }

    /// A season that names a quote token gets a curve denominated in THAT token.
    function test_seasonCurveUsesConfiguredQuoteToken() public {
        (uint256 id, SOFBondingCurve curve) = _createSeason(address(launchToken));

        assertEq(address(curve.quoteToken()), address(launchToken), "curve should be quoted in the launch token");
        assertTrue(address(curve.quoteToken()) != address(defaultToken), "must not fall back to the default");

        (RaffleTypes.SeasonConfig memory cfg,,,,) = raffle.getSeasonDetails(id);
        assertEq(cfg.quoteToken, address(launchToken), "persisted config should record the quote token");
    }

    /// There is no protocol-wide default quote token: every season must name one.
    /// A zero address is a configuration error, not a request for a fallback.
    function test_zeroQuoteTokenReverts() public {
        vm.expectRevert(InvalidQuoteToken.selector);
        _createSeason(address(0));
    }

    /// Two concurrent seasons on the same Raffle can use different quote tokens.
    /// This is the property the launchpad depends on and the one a single protocol-wide
    /// token made impossible.
    function test_concurrentSeasonsUseDifferentQuoteTokens() public {
        (, SOFBondingCurve curveA) = _createSeason(address(launchToken));
        (, SOFBondingCurve curveB) = _createSeason(address(defaultToken));

        assertEq(address(curveA.quoteToken()), address(launchToken));
        assertEq(address(curveB.quoteToken()), address(defaultToken));
        assertTrue(address(curveA) != address(curveB), "seasons should have distinct curves");
    }

    /// Tickets are actually bought with the configured quote token, not merely labelled
    /// with it: the launch token leaves the buyer and lands in the curve.
    function test_buyingTicketsSpendsTheQuoteToken() public {
        (uint256 id, SOFBondingCurve curve) = _createSeason(address(launchToken));

        launchToken.mint(player, 1_000 ether);
        vm.warp(block.timestamp + 2);
        raffle.startSeason(id);

        uint256 balanceBefore = launchToken.balanceOf(player);

        vm.startPrank(player);
        launchToken.approve(address(curve), type(uint256).max);
        curve.buyTokens(10, type(uint256).max);
        vm.stopPrank();

        assertLt(launchToken.balanceOf(player), balanceBefore, "launch token should have been spent");
        assertGt(launchToken.balanceOf(address(curve)), 0, "curve should hold the launch token as reserves");
        assertEq(defaultToken.balanceOf(address(curve)), 0, "curve must not touch the default token");
    }
}
