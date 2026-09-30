// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {
    Raffle, InvalidQuoteToken, QuoteTokenDecimals, QuoteTokenDecimalsUnavailable, QuoteTokenNotAllowed
} from "../src/core/Raffle.sol";
import {MockUSDC} from "../src/test-helpers/MockUSDC.sol";
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
///         denominates its own raffle seasons. A zero `quoteToken` reverts, and a non-zero
///         one must be a launch token or on the Raffle's admin allowlist.
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
        // Allowlisted so these tests exercise the checks after the allowlist; the gate
        // itself is tested at the bottom of this file.
        raffle.setQuoteTokenAllowed(address(defaultToken), true);
        raffle.setQuoteTokenAllowed(address(launchToken), true);
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

    /// Tickets are 0-decimal and quote tokens are 18-decimal, so the pricing path only
    /// ever handles one decimal pair. A 6-decimal token must be rejected at the boundary
    /// rather than silently mispricing everything downstream by 1e12.
    function test_nonEighteenDecimalQuoteTokenReverts() public {
        MockUSDC usdc = new MockUSDC(); // 6 decimals
        raffle.setQuoteTokenAllowed(address(usdc), true);
        vm.expectRevert(abi.encodeWithSelector(QuoteTokenDecimals.selector, address(usdc), uint8(6)));
        _createSeason(address(usdc));
    }

    /// `decimals()` lives in IERC20Metadata, not core ERC-20, so a token may omit it.
    /// Assuming 18 in that case would be the same silent mispricing, so it must revert.
    function test_quoteTokenWithoutDecimalsReverts() public {
        address noMetadata = address(new NoDecimalsToken());
        raffle.setQuoteTokenAllowed(noMetadata, true);
        vm.expectRevert(abi.encodeWithSelector(QuoteTokenDecimalsUnavailable.selector, noMetadata));
        _createSeason(noMetadata);
    }

    // ------------------------------------------------------------------
    // Which tokens may price a season
    // ------------------------------------------------------------------

    function _cfgFor(address quoteToken)
        internal
        view
        returns (RaffleTypes.SeasonConfig memory cfg, RaffleTypes.BondStep[] memory steps)
    {
        steps = new RaffleTypes.BondStep[](1);
        steps[0] = RaffleTypes.BondStep({rangeTo: 10_000, price: 1 ether});
        cfg.name = "Gated Season";
        cfg.startTime = block.timestamp + 1;
        cfg.endTime = block.timestamp + 1 days;
        cfg.winnerCount = 1;
        cfg.grandPrizeBps = 6500;
        cfg.treasuryAddress = treasury;
        cfg.quoteToken = quoteToken;
    }

    function test_arbitraryTokenIsRejected() public {
        MockERC20 random = new MockERC20("Random", "RND", 0);
        (RaffleTypes.SeasonConfig memory cfg, RaffleTypes.BondStep[] memory steps) = _cfgFor(address(random));
        vm.expectRevert(abi.encodeWithSelector(QuoteTokenNotAllowed.selector, address(random)));
        raffle.createSeason(cfg, steps, 0, 0);
    }

    function test_launchTokensAreAcceptedWithoutAllowlisting() public {
        raffle.setQuoteTokenAllowed(address(launchToken), false);
        MockLaunchRegistry registry = new MockLaunchRegistry();
        registry.setLaunched(address(launchToken));
        raffle.setLaunchpad(address(registry));
        assertTrue(raffle.isAllowedQuoteToken(address(launchToken)));

        (RaffleTypes.SeasonConfig memory cfg, RaffleTypes.BondStep[] memory steps) = _cfgFor(address(launchToken));
        raffle.createSeason(cfg, steps, 0, 0);
    }

    function test_removingATokenFromTheAllowlistBlocksNewSeasons() public {
        raffle.setQuoteTokenAllowed(address(defaultToken), true);
        raffle.setQuoteTokenAllowed(address(defaultToken), false);
        (RaffleTypes.SeasonConfig memory cfg, RaffleTypes.BondStep[] memory steps) = _cfgFor(address(defaultToken));
        vm.expectRevert(abi.encodeWithSelector(QuoteTokenNotAllowed.selector, address(defaultToken)));
        raffle.createSeason(cfg, steps, 0, 0);
    }

    function test_onlyAdminManagesQuoteTokens() public {
        vm.startPrank(address(0xBAD));
        vm.expectRevert();
        raffle.setQuoteTokenAllowed(address(defaultToken), true);
        vm.expectRevert();
        raffle.setLaunchpad(address(0x1234));
        vm.stopPrank();
    }
}

/// @dev An ERC-20 that deliberately omits `decimals()`, which the standard permits.
contract NoDecimalsToken {
    function totalSupply() external pure returns (uint256) {
        return 0;
    }

    function balanceOf(address) external pure returns (uint256) {
        return 0;
    }
}

/// @dev Stands in for TokenLaunchpad: the one view Raffle calls on it.
contract MockLaunchRegistry {
    mapping(address => bool) public isLaunchToken;

    function setLaunched(address token) external {
        isLaunchToken[token] = true;
    }
}
