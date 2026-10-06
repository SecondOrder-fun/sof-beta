// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {PoolManager} from "@uniswap/v4-core/src/PoolManager.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {SqrtPriceMath} from "@uniswap/v4-core/src/libraries/SqrtPriceMath.sol";
import {Position} from "@uniswap/v4-core/src/libraries/Position.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {TokenLaunchpad} from "../src/launchpad/TokenLaunchpad.sol";
import {UniV4LiquidityPlacer, UnknownLiquidityPreset} from "../src/launchpad/UniV4LiquidityPlacer.sol";
import {UniV4LaunchRouter} from "../src/launchpad/UniV4LaunchRouter.sol";
import {MockUSDC} from "../src/test-helpers/MockUSDC.sol";
import {PlacerDeployer} from "./helpers/PlacerDeployer.sol";
import {DirectSwapper} from "./helpers/DirectSwapper.sol";

/// @notice The four liquidity presets, against a real PoolManager: each lays its ladder of
///         single-sided positions end to end from the starting price, with the preset's
///         share of supply in each, in every pool orientation — and the market walks across
///         the band edges as one continuous curve that never sells out.
contract LaunchLiquidityPresetsTest is Test, PlacerDeployer {
    using StateLibrary for IPoolManager;

    PoolManager internal manager;
    TokenLaunchpad internal launchpad;
    UniV4LiquidityPlacer internal placer;
    UniV4LaunchRouter internal router;
    DirectSwapper internal swapper;

    /// Below any CREATE address the launchpad will produce, so the quote is currency0.
    address internal constant LOW = address(0x0000000000000000000000000000000000100000);
    /// Above any CREATE address the launchpad will produce, so the token is currency0.
    address internal constant HIGH = address(0xFFfFfFffFFfffFFfFFfFFFFFffFFFffffFfFFFfF);

    address internal creator = address(0xC0FFEE);
    address internal trader = address(0xB0B);
    uint256 internal constant SUPPLY = 1_000_000_000e18;
    int24 internal constant SPACING = 200;

    uint8 internal constant STEADY_START = 1;
    uint8 internal constant THICK_MIDDLE = 2;
    uint8 internal constant WIDE_OPEN = 3;

    function setUp() public {
        manager = new PoolManager(address(this));
        launchpad = new TokenLaunchpad(address(this), address(0), 1 ether, 1000 ether);
        placer = _deployPlacer(address(manager), address(launchpad), address(this), SPACING, 0);
        launchpad.setPlacer(address(placer));
        placer.setFeeTreasury(address(0x7EA5));
        router = new UniV4LaunchRouter(address(manager), address(launchpad));
        launchpad.setRouter(address(router));
        swapper = new DirectSwapper(IPoolManager(address(manager)));

        deployCodeTo("MockUSDC.sol:MockUSDC", LOW);
        deployCodeTo("MockUSDC.sol:MockUSDC", HIGH);
        launchpad.setQuoteToken(LOW, 2_500e6, 10_000_000e6);
        launchpad.setQuoteToken(HIGH, 2_500e6, 10_000_000e6);

        vm.deal(address(swapper), 100_000 ether);
        MockUSDC(LOW).mint(address(swapper), 1e15);
        MockUSDC(HIGH).mint(address(swapper), 1e15);
        vm.deal(trader, 1_000 ether);
    }

    function _launch(address quote, uint8 preset, uint24 fee) internal returns (address token) {
        vm.prank(creator);
        (, token) =
            launchpad.launch("Ladder", "LAD", "", quote, quote == address(0) ? 1 ether : 5_000e6, fee, preset, 0, 0);
    }

    /// Tokens a band holds: it sits wholly on the token side of the price at launch.
    function _tokensIn(UniV4LiquidityPlacer.Band memory b, bool tokenIsCurrency0) internal pure returns (uint256) {
        uint160 lo = TickMath.getSqrtPriceAtTick(b.tickLower);
        uint160 hi = TickMath.getSqrtPriceAtTick(b.tickUpper);
        return tokenIsCurrency0
            ? SqrtPriceMath.getAmount0Delta(lo, hi, b.liquidity, false)
            : SqrtPriceMath.getAmount1Delta(lo, hi, b.liquidity, false);
    }

    // ------------------------------------------------------------------
    // The ladder is laid as the preset says
    // ------------------------------------------------------------------

    function test_everyPresetInEveryOrientation() public {
        address[3] memory quotes = [address(0), LOW, HIGH];
        for (uint8 preset; preset < placer.PRESET_COUNT(); ++preset) {
            for (uint256 q; q < 3; ++q) {
                _checkLadder(_launch(quotes[q], preset, TEST_TRADE_FEE), preset);
            }
        }
    }

    function _checkLadder(address token, uint8 preset) internal view {
        UniV4LiquidityPlacer.Placement memory p = placer.getPlacement(token);
        UniV4LiquidityPlacer.Band[] memory bands = placer.bandsOf(token);
        (uint24[] memory ends, uint16[] memory shares) = placer.presetBands(preset);
        bool t0 = p.tokenIsCurrency0;

        assertEq(p.liquidityPreset, preset, "preset recorded");
        assertEq(bands.length, ends.length, "one band per step");
        assertEq(p.liquidity, bands[0].liquidity, "Placement.liquidity is the launch-price band's");

        // The pool starts at the ladder's launch edge.
        (, int24 tick,,) = IPoolManager(address(manager)).getSlot0(p.key.toId());
        int24 start = t0 ? p.tickLower : p.tickUpper;
        assertEq(tick, start, "pool starts at the launch edge");

        uint256 total;
        for (uint256 i; i < bands.length; ++i) {
            UniV4LiquidityPlacer.Band memory b = bands[i];
            // End to end, from the start outward, the last to the edge of the scale.
            if (t0) {
                assertEq(b.tickLower, i == 0 ? start : bands[i - 1].tickUpper, "contiguous (up)");
                if (i == bands.length - 1) assertEq(b.tickUpper, TickMath.maxUsableTick(SPACING), "tail to the edge");
            } else {
                assertEq(b.tickUpper, i == 0 ? start : bands[i - 1].tickLower, "contiguous (down)");
                if (i == bands.length - 1) assertEq(b.tickLower, TickMath.minUsableTick(SPACING), "tail to the edge");
            }
            // Each boundary within half a spacing of its 2x / 3x / 30x.
            if (i < bands.length - 1) {
                int24 boundary = t0 ? b.tickUpper : b.tickLower;
                uint256 distance = uint256(int256(t0 ? boundary - start : start - boundary));
                assertApproxEqAbs(distance, ends[i], uint256(int256(SPACING / 2)), "boundary at its multiple");
            }
            // The pool's own accounting agrees.
            bytes32 positionId = Position.calculatePositionKey(address(placer), b.tickLower, b.tickUpper, bytes32(0));
            assertEq(IPoolManager(address(manager)).getPositionLiquidity(p.key.toId(), positionId), b.liquidity);

            uint256 held = _tokensIn(b, t0);
            total += held;
            assertApproxEqRel(held, (SUPPLY * shares[i]) / 10_000, 1e9, "band holds its share"); // 1e-9
        }
        assertLe(total, SUPPLY);
        assertGt(total, SUPPLY - 1e12, "all but dust is in the pool");
        assertEq(manager.balanceOf(address(placer), 0), 0);
    }

    function test_unknownPresetReverts() public {
        vm.prank(creator);
        vm.expectRevert(abi.encodeWithSelector(UnknownLiquidityPreset.selector, uint8(4)));
        launchpad.launch("Bad", "BAD", "", address(0), 1 ether, TEST_TRADE_FEE, 4, 0, 0);
    }

    /// Boundaries snap to whatever spacing is configured, and the ladder stays contiguous.
    function test_ladderFollowsTheTickSpacing() public {
        placer.setTickSpacing(60);
        address token = _launch(address(0), STEADY_START, TEST_TRADE_FEE);
        UniV4LiquidityPlacer.Band[] memory bands = placer.bandsOf(token);
        assertEq(bands.length, 3);
        for (uint256 i; i < bands.length; ++i) {
            assertEq(bands[i].tickLower % 60, 0);
            assertEq(bands[i].tickUpper % 60, 0);
            if (i > 0) assertEq(bands[i].tickUpper, bands[i - 1].tickLower);
        }
        assertEq(bands[2].tickLower, TickMath.minUsableTick(60));
    }

    // ------------------------------------------------------------------
    // Trading walks across the ladder
    // ------------------------------------------------------------------

    /// Buying up to each boundary takes exactly the shares below it: 30% by 3x, 85% by 30x
    /// for Steady start; 40% by 2x for Wide open. (A zero-fee launch, so a swap may stop at
    /// the price limit.)
    function test_buyingToEachBoundaryTakesTheSharesBelowIt() public {
        _checkCumulative(address(0), STEADY_START);
        _checkCumulative(HIGH, STEADY_START);
        _checkCumulative(address(0), THICK_MIDDLE);
        _checkCumulative(LOW, WIDE_OPEN);
    }

    function _checkCumulative(address quote, uint8 preset) internal {
        address token = _launch(quote, preset, 0);
        UniV4LiquidityPlacer.Placement memory p = placer.getPlacement(token);
        UniV4LiquidityPlacer.Band[] memory bands = placer.bandsOf(token);
        (, uint16[] memory shares) = placer.presetBands(preset);
        bool buyZeroForOne = !p.tokenIsCurrency0; // a buy spends the quote
        uint256 before = IERC20(token).balanceOf(address(swapper));
        uint256 cumulativeBps;
        for (uint256 i; i < bands.length - 1; ++i) {
            int24 boundary = p.tokenIsCurrency0 ? bands[i].tickUpper : bands[i].tickLower;
            swapper.swap(
                p.key,
                buyZeroForOne,
                -int256(uint256(quote == address(0) ? 10_000 ether : 1e14)),
                TickMath.getSqrtPriceAtTick(boundary)
            );
            cumulativeBps += shares[i];
            uint256 bought = IERC20(token).balanceOf(address(swapper)) - before;
            assertApproxEqRel(bought, (SUPPLY * cumulativeBps) / 10_000, 1e9, "the shares below the boundary");
            (, int24 tick,,) = IPoolManager(address(manager)).getSlot0(p.key.toId());
            assertEq(tick, p.tokenIsCurrency0 ? boundary : boundary - 1, "stopped at the boundary");
        }
    }

    /// A round trip through our router across band edges, at a real fee: buys climb the
    /// ladder, sells walk it back, and nothing strands.
    function test_routerTradesAcrossBandEdges() public {
        address token = _launch(address(0), STEADY_START, TEST_TRADE_FEE);
        vm.startPrank(trader);
        uint256 bought = router.buy{value: 20 ether}(token, 20 ether, 0, trader, block.timestamp);
        IERC20(token).approve(address(router), bought);
        uint256 back = router.sell(token, bought, 0, trader, block.timestamp);
        vm.stopPrank();
        assertGt(bought, (SUPPLY * 85) / 100, "20 ETH buys past 30x on a 1 ETH launch");
        assertLt(back, 20 ether, "a round trip never makes money");
        assertGt(back, 19 ether, "and loses only the two fees and rounding");
    }

    /// No preset sells out: the tail runs to the edge of the price scale.
    function test_noPresetSellsOut() public {
        for (uint8 preset; preset < placer.PRESET_COUNT(); ++preset) {
            address token = _launch(address(0), preset, 0);
            PoolKey memory key = placer.getPlacement(token).key;
            // 5,000 ETH into a 1 ETH launch: a 5,000x-plus buy.
            swapper.swap(key, true, -int256(5_000 ether), TickMath.MIN_SQRT_PRICE + 1);
            assertGt(IERC20(token).balanceOf(address(manager)), 0, "tokens left in the pool");
            assertGt(IPoolManager(address(manager)).getLiquidity(key.toId()), 0, "liquidity at the price");
        }
    }

    // ------------------------------------------------------------------
    // Frontend fixture
    // ------------------------------------------------------------------

    /// The numbers frontend/tests/lib/v4PoolMath.test.js reproduces for a multi-band
    /// ladder: Steady start, 1 ETH valuation, 1% trade fee, router buys and a sell that
    /// cross band edges. Run with -vv.
    function test_fixture_presetQuoteMathForFrontend() public {
        address token = _launch(address(0), STEADY_START, TEST_TRADE_FEE);
        UniV4LiquidityPlacer.Placement memory p = placer.getPlacement(token);
        UniV4LiquidityPlacer.Band[] memory bands = placer.bandsOf(token);
        PoolId id = p.key.toId();
        for (uint256 i; i < bands.length; ++i) {
            emit log_named_int("band.tickLower", bands[i].tickLower);
            emit log_named_int("band.tickUpper", bands[i].tickUpper);
            emit log_named_uint("band.liquidity", bands[i].liquidity);
        }
        (uint160 sqrt0,,,) = IPoolManager(address(manager)).getSlot0(id);
        emit log_named_uint("launch.sqrtPriceX96", sqrt0);

        vm.startPrank(trader);
        uint256 out1 = router.buy{value: 0.2 ether}(token, 0.2 ether, 0, trader, block.timestamp);
        (uint160 sqrt1,,,) = IPoolManager(address(manager)).getSlot0(id);
        emit log_named_uint("buy1.ethIn", 0.2 ether);
        emit log_named_uint("buy1.tokensOut", out1);
        emit log_named_uint("buy1.sqrtPriceAfter", sqrt1);
        emit log_named_uint("buy1.activeLiquidityAfter", IPoolManager(address(manager)).getLiquidity(id));

        uint256 out2 = router.buy{value: 3 ether}(token, 3 ether, 0, trader, block.timestamp);
        (uint160 sqrt2,,,) = IPoolManager(address(manager)).getSlot0(id);
        emit log_named_uint("buy2.ethIn", 3 ether);
        emit log_named_uint("buy2.tokensOut", out2);
        emit log_named_uint("buy2.sqrtPriceAfter", sqrt2);
        emit log_named_uint("buy2.activeLiquidityAfter", IPoolManager(address(manager)).getLiquidity(id));

        uint256 sellAmount = (out1 + out2) / 2;
        IERC20(token).approve(address(router), sellAmount);
        uint256 ethBack = router.sell(token, sellAmount, 0, trader, block.timestamp);
        (uint160 sqrt3,,,) = IPoolManager(address(manager)).getSlot0(id);
        vm.stopPrank();
        emit log_named_uint("sell.tokensIn", sellAmount);
        emit log_named_uint("sell.ethOut", ethBack);
        emit log_named_uint("sell.sqrtPriceAfter", sqrt3);

        // 0.2 ETH stays inside the first band (it holds ~0.52 ETH of buying); 3 more crosses into the second.
        assertGt(sqrt1, TickMath.getSqrtPriceAtTick(bands[0].tickLower), "buy1 within band 0");
        assertLt(sqrt2, TickMath.getSqrtPriceAtTick(bands[0].tickLower), "buy2 crossed into band 1");
    }
}
