// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {PoolManager} from "@uniswap/v4-core/src/PoolManager.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {
    TokenLaunchpad,
    CreatorBuyNeedsRouter,
    EthAmountMismatch as LaunchEthAmountMismatch,
    OnlyRouter
} from "../src/launchpad/TokenLaunchpad.sol";
import {UniV4LiquidityPlacer, TickSpacingOutOfRange} from "../src/launchpad/UniV4LiquidityPlacer.sol";
import {UniV4LaunchRouter, EthAmountMismatch, InsufficientOutput} from "../src/launchpad/UniV4LaunchRouter.sol";
import {MockERC20} from "../src/test-helpers/MockERC20.sol";
import {MockUSDC} from "../src/test-helpers/MockUSDC.sol";
import {PlacerDeployer} from "./helpers/PlacerDeployer.sol";

/// @notice Launches paired with an allowlisted ERC-20 instead of native ETH, against a
///         REAL PoolManager.
///
///         v4 sorts a pool's currencies by address, so an ERC-20 quote can land on either
///         side of the launch token. ETH (address 0) only ever exercises "quote is
///         currency0"; these tests pin a quote token at a very low address and one at a
///         very high address so both orientations run, each through the same properties:
///         single-sided placement, the requested valuation, buys and sells through the
///         router, partial fills and fee collection.
///
///         The main quote is 6-decimal (USDC-shaped), the case a per-token price could not
///         express: a 5,000 USDC valuation is 5 raw units per token.
contract LaunchQuoteTokensTest is Test, PlacerDeployer {
    using StateLibrary for IPoolManager;

    PoolManager internal manager;
    TokenLaunchpad internal launchpad;
    UniV4LiquidityPlacer internal placer;
    UniV4LaunchRouter internal router;

    /// Below any CREATE address the launchpad will produce, so the quote is currency0.
    address internal constant LOW = address(0x0000000000000000000000000000000000100000);
    /// Above any CREATE address the launchpad will produce, so the token is currency0.
    address internal constant HIGH = address(0xFFfFfFffFFfffFFfFFfFFFFFffFFFffffFfFFFfF);

    address internal creator = address(0xC0FFEE);
    address internal trader = address(0x7EADE5);
    address internal treasury = address(0x7EA5);

    uint256 internal constant SUPPLY = 1_000_000_000e18;
    uint256 internal constant USDC_FDV = 5_000e6; // 5,000 USDC
    uint256 internal constant USDC_MIN_FDV = 2_500e6;
    uint256 internal constant USDC_MAX_FDV = 10_000_000e6;
    int24 internal constant SPACING = 200;

    function setUp() public {
        manager = new PoolManager(address(this));
        launchpad = new TokenLaunchpad(address(this), address(0), 1 ether, 1000 ether);
        placer = _deployPlacer(address(manager), address(launchpad), address(this), SPACING);
        launchpad.setPlacer(address(placer));
        placer.setFeeTreasury(treasury);
        router = new UniV4LaunchRouter(address(manager), address(launchpad));
        launchpad.setRouter(address(router));

        deployCodeTo("MockUSDC.sol:MockUSDC", LOW);
        deployCodeTo("MockUSDC.sol:MockUSDC", HIGH);
        launchpad.setQuoteToken(LOW, USDC_MIN_FDV, USDC_MAX_FDV);
        launchpad.setQuoteToken(HIGH, USDC_MIN_FDV, USDC_MAX_FDV);

        MockUSDC(LOW).mint(trader, 1_000_000e6);
        MockUSDC(HIGH).mint(trader, 1_000_000e6);
        vm.startPrank(trader);
        IERC20(LOW).approve(address(router), type(uint256).max);
        IERC20(HIGH).approve(address(router), type(uint256).max);
        vm.stopPrank();
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    function _launch(address quote) internal returns (address token) {
        vm.prank(creator);
        (, token) = launchpad.launch("Paired", "PAIR", "", quote, USDC_FDV, TEST_TRADE_FEE, CLASSIC, 0, 0);
    }

    function _buy(address token, uint256 quoteIn) internal returns (uint256) {
        vm.prank(trader);
        return router.buy(token, quoteIn, 0, trader, block.timestamp);
    }

    function _sell(address token, uint256 tokensIn) internal returns (uint256) {
        vm.startPrank(trader);
        IERC20(token).approve(address(router), tokensIn);
        uint256 out = router.sell(token, tokensIn, 0, trader, block.timestamp);
        vm.stopPrank();
        return out;
    }

    /// The pool's current valuation of the whole supply, in quote raw units.
    function _currentFdv(address token) internal view returns (uint256) {
        UniV4LiquidityPlacer.Placement memory p = placer.getPlacement(token);
        (uint160 sqrtP,,,) = IPoolManager(address(manager)).getSlot0(PoolId.wrap(placer.poolIdOf(token)));
        // price1/0 in raw units = sqrtP^2 / 2^192
        uint256 priceX96 = FullMath.mulDiv(sqrtP, sqrtP, 1 << 96);
        return p.tokenIsCurrency0
            ? FullMath.mulDiv(SUPPLY, priceX96, 1 << 96)  // quote per token
            : FullMath.mulDiv(SUPPLY, 1 << 96, priceX96); // token per quote, inverted
    }

    function _currentTick(address token) internal view returns (int24 tick) {
        (, tick,,) = IPoolManager(address(manager)).getSlot0(PoolId.wrap(placer.poolIdOf(token)));
    }

    // ------------------------------------------------------------------
    // Orientation
    // ------------------------------------------------------------------

    function test_aLowQuoteIsCurrency0AndAHighQuoteIsNot() public {
        address low = _launch(LOW);
        address high = _launch(HIGH);
        assertFalse(placer.getPlacement(low).tokenIsCurrency0, "low quote sorts first");
        assertTrue(placer.getPlacement(high).tokenIsCurrency0, "high quote sorts second");
        assertEq(placer.quoteTokenOf(low), LOW);
        assertEq(placer.quoteTokenOf(high), HIGH);
        assertEq(launchpad.quoteTokenOf(high), HIGH);
    }

    // ------------------------------------------------------------------
    // Properties every orientation must have
    // ------------------------------------------------------------------

    function test_low_placementIsSingleSided() public {
        _checkSingleSided(LOW);
    }

    function test_high_placementIsSingleSided() public {
        _checkSingleSided(HIGH);
    }

    /// No quote token entered the pool or the placer: the position holds only the launch
    /// token, essentially all of it.
    function _checkSingleSided(address quote) internal {
        address token = _launch(quote);
        assertEq(IERC20(quote).balanceOf(address(manager)), 0, "no quote in the pool");
        assertEq(IERC20(quote).balanceOf(address(placer)), 0, "no quote in the placer");
        assertGt(IERC20(token).balanceOf(address(manager)), SUPPLY - 1e9, "essentially all supply in the pool");
    }

    function test_low_poolStartsAtTheTokenOnlyEdge() public {
        address token = _launch(LOW);
        UniV4LiquidityPlacer.Placement memory p = placer.getPlacement(token);
        assertEq(_currentTick(token), p.tickUpper, "quote is currency0: starts at the top");
    }

    function test_high_poolStartsAtTheTokenOnlyEdge() public {
        address token = _launch(HIGH);
        UniV4LiquidityPlacer.Placement memory p = placer.getPlacement(token);
        assertEq(_currentTick(token), p.tickLower, "token is currency0: starts at the bottom");
    }

    function test_low_opensAtTheRequestedValuation() public {
        _checkOpeningFdv(LOW);
    }

    function test_high_opensAtTheRequestedValuation() public {
        _checkOpeningFdv(HIGH);
    }

    /// Snapping to a usable tick may only raise the valuation, by at most one spacing
    /// (200 ticks ≈ 2%) — never open cheaper than the creator chose. ETH launches round
    /// the same way (pinned by the frontend quote fixture).
    function _checkOpeningFdv(address quote) internal {
        address token = _launch(quote);
        uint256 fdv = _currentFdv(token);
        assertGe(fdv, (USDC_FDV * 9999) / 10000, "never below the requested valuation");
        assertLe(fdv, (USDC_FDV * 103) / 100, "within one tick spacing of it");
    }

    function test_low_buysAndSellsThroughTheRouter() public {
        _checkTrades(LOW);
    }

    function test_high_buysAndSellsThroughTheRouter() public {
        _checkTrades(HIGH);
    }

    /// 100 USDC into a 5,000 USDC valuation buys roughly 2% of supply, the price rises
    /// with each buy, a sell pays out the quote token, and the router keeps nothing.
    function _checkTrades(address quote) internal {
        address token = _launch(quote);
        uint256 usdcBefore = IERC20(quote).balanceOf(trader);

        uint256 first = _buy(token, 100e6);
        assertEq(IERC20(quote).balanceOf(trader), usdcBefore - 100e6, "exactly quoteIn was pulled");
        assertGt(first, (SUPPLY * 19) / 1000, "about 2% of supply, less fee and slippage");
        assertLt(first, (SUPPLY * 21) / 1000);
        assertGt(_currentFdv(token), USDC_FDV, "a buy raises the valuation");

        uint256 second = _buy(token, 100e6);
        assertLt(second, first, "the same spend buys fewer tokens as the price rises");

        uint256 quoteOut = _sell(token, first + second);
        assertGt(quoteOut, 0);
        assertLt(quoteOut, 200e6, "a round trip loses fees");
        assertGt(quoteOut, 195e6, "but only about 1% each way");

        assertEq(IERC20(quote).balanceOf(address(router)), 0, "router keeps no quote");
        assertEq(IERC20(token).balanceOf(address(router)), 0, "router keeps no tokens");
    }

    function test_low_aHugeBuyNeverSellsOut() public {
        _checkHugeBuy(LOW);
    }

    function test_high_aHugeBuyNeverSellsOut() public {
        _checkHugeBuy(HIGH);
    }

    /// A buy of 200x the opening valuation fills in full on either side: the position runs
    /// to the end of v4's price scale, so there is no ceiling to sell out at, the payer is
    /// charged exactly what they offered, and supply remains in the pool.
    function _checkHugeBuy(address quote) internal {
        address token = _launch(quote);
        uint256 usdcBefore = IERC20(quote).balanceOf(trader);

        uint256 out = _buy(token, 1_000_000e6);
        assertEq(usdcBefore - IERC20(quote).balanceOf(trader), 1_000_000e6, "filled in full");
        assertLt(out, SUPPLY, "supply is left in the pool");
        assertGt(IPoolManager(address(manager)).getLiquidity(PoolId.wrap(placer.poolIdOf(token))), 0, "still in range");
        assertGt(_sell(token, out), 0, "and it all sells back");
    }

    function test_low_feesAreCollectedAndClaimedInTheQuote() public {
        _checkFees(LOW);
    }

    function test_high_feesAreCollectedAndClaimedInTheQuote() public {
        _checkFees(HIGH);
    }

    function _checkFees(address quote) internal {
        address token = _launch(quote);
        uint256 bought = _buy(token, 1_000e6);
        _sell(token, bought / 2);

        uint256 quoteFees = placer.collectFees(token);
        // 1% of the 1,000 USDC buy, plus 1% of what the sell paid out — all in USDC.
        assertGt(quoteFees, 10e6, "the buy's 10 USDC and the sell's share");
        assertLt(quoteFees, 20e6);
        assertEq(placer.claimable(token, creator), 0, "never a launch-token fee");

        uint256 creatorQuote = (quoteFees * 8_800) / 10_000;
        assertEq(placer.claimable(quote, creator), creatorQuote);
        assertEq(placer.claimable(quote, treasury), quoteFees - creatorQuote);

        vm.prank(creator);
        assertEq(placer.claim(quote, creator), creatorQuote);
        assertEq(IERC20(quote).balanceOf(creator), creatorQuote);
        vm.prank(treasury);
        placer.claim(quote, treasury);
        assertEq(manager.balanceOf(address(placer), uint256(uint160(quote))), 0, "every quote fee paid out");
    }

    /// Across the whole allowed valuation range, on both sides: the pool opens at or
    /// within one spacing above the requested valuation, and owes no quote token.
    function testFuzz_anyAllowedValuationOpensWhereRequested(uint256 fdv, bool high) public {
        fdv = bound(fdv, USDC_MIN_FDV, USDC_MAX_FDV);
        address quote = high ? HIGH : LOW;
        vm.prank(creator);
        (, address token) = launchpad.launch("Fuzzed", "FUZZ", "", quote, fdv, TEST_TRADE_FEE, CLASSIC, 0, 0);

        uint256 opened = _currentFdv(token);
        assertGe(opened, (fdv * 9999) / 10000, "never below the requested valuation");
        assertLe(opened, (fdv * 103) / 100, "within one tick spacing of it");
        assertEq(IERC20(quote).balanceOf(address(manager)), 0, "single-sided");
    }

    // ------------------------------------------------------------------
    // The creator's buy, inside the launch transaction
    // ------------------------------------------------------------------

    /// 0.1 ETH into a 1 ETH launch: the same trade the frontend fixture pins
    /// (UniV4LaunchRouter.t.sol FIXTURE_BUY1_OUT). Getting exactly that amount proves the
    /// creator bought first, at the launch price, before anyone could trade.
    uint256 internal constant FIXTURE_BUY1_OUT = 89729910215527505885256588;

    function test_anEthCreatorBuyIsTheFirstTradeAtTheLaunchPrice() public {
        vm.deal(creator, 1 ether);
        vm.prank(creator);
        (uint256 id, address token) = launchpad.launch{value: 0.1 ether}(
            "Mine", "MINE", "", address(0), 1 ether, TEST_TRADE_FEE, CLASSIC, 0.1 ether, 0
        );

        assertEq(IERC20(token).balanceOf(creator), FIXTURE_BUY1_OUT, "creator bought first, at the launch price");
        assertEq(creator.balance, 0.9 ether, "exactly the buy was spent");
        assertEq(address(launchpad).balance, 0, "launchpad keeps no ETH");
        assertEq(IERC20(token).balanceOf(address(launchpad)), 0, "launchpad keeps no tokens");
        assertEq(id, 0);
    }

    function test_anErc20CreatorBuyPullsTheQuoteFromTheCreator() public {
        MockUSDC(HIGH).mint(creator, 100e6);
        vm.startPrank(creator);
        IERC20(HIGH).approve(address(launchpad), 100e6);
        vm.recordLogs();
        (, address token) = launchpad.launch("Mine", "MINE", "", HIGH, USDC_FDV, TEST_TRADE_FEE, CLASSIC, 100e6, 1);
        vm.stopPrank();

        uint256 got = IERC20(token).balanceOf(creator);
        assertGt(got, (SUPPLY * 19) / 1000, "about 2% of supply for 100 USDC at 5,000");
        assertEq(IERC20(HIGH).balanceOf(creator), 0, "the 100 USDC was spent");
        assertEq(IERC20(HIGH).balanceOf(address(launchpad)), 0, "launchpad keeps no quote");
        assertEq(IERC20(HIGH).allowance(address(launchpad), address(router)), 0, "router approval reset");
    }

    function test_aCreatorBuyBelowItsMinimumRevertsTheWholeLaunch() public {
        vm.deal(creator, 1 ether);
        vm.prank(creator);
        vm.expectRevert();
        launchpad.launch{value: 0.1 ether}(
            "Mine", "MINE", "", address(0), 1 ether, TEST_TRADE_FEE, CLASSIC, 0.1 ether, FIXTURE_BUY1_OUT + 1
        );
        assertEq(launchpad.launchCount(), 0, "no token was launched");
        assertEq(creator.balance, 1 ether, "nothing was spent");
    }

    function test_launchEthMustMatchTheCreatorBuy() public {
        vm.deal(creator, 1 ether);
        vm.startPrank(creator);
        vm.expectRevert(abi.encodeWithSelector(LaunchEthAmountMismatch.selector, 0.1 ether, 0));
        launchpad.launch{value: 0.1 ether}("NoBuy", "NOB", "", address(0), 1 ether, TEST_TRADE_FEE, CLASSIC, 0, 0);

        vm.expectRevert(abi.encodeWithSelector(LaunchEthAmountMismatch.selector, 0.05 ether, 0.1 ether));
        launchpad.launch{value: 0.05 ether}(
            "Short", "SHT", "", address(0), 1 ether, TEST_TRADE_FEE, CLASSIC, 0.1 ether, 0
        );

        // An ERC-20 launch takes no ETH, even alongside a creator buy.
        vm.expectRevert(abi.encodeWithSelector(LaunchEthAmountMismatch.selector, 0.1 ether, 0));
        launchpad.launch{value: 0.1 ether}("Usdc", "USD", "", HIGH, USDC_FDV, TEST_TRADE_FEE, CLASSIC, 100e6, 0);
        vm.stopPrank();
    }

    function test_aCreatorBuyNeedsARouterButALaunchDoesNot() public {
        launchpad.setRouter(address(0));
        vm.deal(creator, 1 ether);
        vm.startPrank(creator);
        vm.expectRevert(CreatorBuyNeedsRouter.selector);
        launchpad.launch{value: 0.1 ether}(
            "Mine", "MINE", "", address(0), 1 ether, TEST_TRADE_FEE, CLASSIC, 0.1 ether, 0
        );

        launchpad.launch("Plain", "PLN", "", address(0), 1 ether, TEST_TRADE_FEE, CLASSIC, 0, 0);
        vm.stopPrank();
        assertEq(launchpad.launchCount(), 1);
    }

    function test_theLaunchpadRejectsStrayEth() public {
        vm.deal(address(this), 1 ether);
        (bool ok, bytes memory ret) = address(launchpad).call{value: 1 wei}("");
        assertFalse(ok);
        assertEq(bytes4(ret), OnlyRouter.selector);
    }

    // ------------------------------------------------------------------
    // Router guards specific to the quote
    // ------------------------------------------------------------------

    function test_buyingAnErc20PairWithEthReverts() public {
        address token = _launch(LOW);
        vm.deal(trader, 1 ether);
        vm.prank(trader);
        vm.expectRevert(abi.encodeWithSelector(EthAmountMismatch.selector, 1 ether, 100e6));
        router.buy{value: 1 ether}(token, 100e6, 0, trader, block.timestamp);
    }

    function test_buyingAnEthPairNeedsTheValueToMatch() public {
        vm.prank(creator);
        (, address token) = launchpad.launch("Eth", "ETHP", "", address(0), 1 ether, TEST_TRADE_FEE, CLASSIC, 0, 0);
        vm.deal(trader, 1 ether);
        vm.prank(trader);
        vm.expectRevert(abi.encodeWithSelector(EthAmountMismatch.selector, 0.05 ether, 0.1 ether));
        router.buy{value: 0.05 ether}(token, 0.1 ether, 0, trader, block.timestamp);
    }

    function test_minOutIsEnforcedOnErc20Pairs() public {
        address token = _launch(HIGH);
        vm.prank(trader);
        vm.expectRevert();
        router.buy(token, 100e6, SUPPLY, trader, block.timestamp);

        uint256 bought = _buy(token, 100e6);
        vm.startPrank(trader);
        IERC20(token).approve(address(router), bought);
        vm.expectRevert();
        router.sell(token, bought, 1_000e6, trader, block.timestamp);
        vm.stopPrank();
    }

    function test_anUnapprovedErc20BuyReverts() public {
        address token = _launch(LOW);
        address broke = address(0xB40CE);
        MockUSDC(LOW).mint(broke, 100e6);
        vm.prank(broke);
        vm.expectRevert();
        router.buy(token, 100e6, 0, broke, block.timestamp);
    }

    // ------------------------------------------------------------------
    // An 18-decimal ERC-20 quote, both sides
    // ------------------------------------------------------------------

    /// The math is in raw units, so an 18-decimal quote needs no special case: a valuation
    /// of 10 whole tokens behaves like a 10 ETH launch.
    function test_an18DecimalQuoteTradesLikeEth() public {
        address high18 = address(0xffffFFFfFFffffffffffffffFfFFFfffFFFfFFfE);
        deployCodeTo("MockERC20.sol:MockERC20", abi.encode("Wrapped Thing", "WTHG", uint256(0)), high18);
        launchpad.setQuoteToken(high18, 1e18, 1000e18);
        MockERC20(high18).mint(trader, 100e18);

        vm.prank(creator);
        (, address token) = launchpad.launch("Eighteen", "EIGHT", "", high18, 10e18, TEST_TRADE_FEE, CLASSIC, 0, 0);
        assertTrue(placer.getPlacement(token).tokenIsCurrency0);

        vm.startPrank(trader);
        IERC20(high18).approve(address(router), type(uint256).max);
        uint256 out = router.buy(token, 0.1e18, 0, trader, block.timestamp);
        vm.stopPrank();
        // 0.1 into a 10 valuation is ~1% of supply.
        assertGt(out, (SUPPLY * 9) / 1000);
        assertLt(out, (SUPPLY * 11) / 1000);
    }

    // ------------------------------------------------------------------
    // Pool-parameter ceilings
    // ------------------------------------------------------------------

    function test_tickSpacingMustBeOneV4Accepts() public {
        vm.expectRevert(abi.encodeWithSelector(TickSpacingOutOfRange.selector, int24(0)));
        placer.setTickSpacing(0);

        int24 tooWide = TickMath.MAX_TICK_SPACING + 1;
        vm.expectRevert(abi.encodeWithSelector(TickSpacingOutOfRange.selector, tooWide));
        placer.setTickSpacing(tooWide);
    }
}
