// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test, Vm} from "forge-std/Test.sol";
import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {PoolManager} from "@uniswap/v4-core/src/PoolManager.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {TokenLaunchpad} from "../src/launchpad/TokenLaunchpad.sol";
import {UniV4LiquidityPlacer} from "../src/launchpad/UniV4LiquidityPlacer.sol";
import {ILaunchRouter} from "../src/launchpad/ILaunchRouter.sol";
import {
    UniV4LaunchRouter,
    Expired,
    NotALaunchToken,
    InsufficientOutput,
    OnlyPoolManager,
    RouterZeroAmount,
    RouterZeroAddress
} from "../src/launchpad/UniV4LaunchRouter.sol";
import {MockERC20} from "../src/test-helpers/MockERC20.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {LaunchPoolGateDeployer} from "./helpers/LaunchPoolGateDeployer.sol";

/// @notice The launch router against a REAL PoolManager.
///
///         The anchor is `test_buyDeliversExactlyWhatTheFrontendQuotes`: the buy panel's
///         quote math (frontend lib/v4PoolMath.js) is pinned to 90,544,562.424768864432372374
///         tokens for 0.1 ETH at a fresh 1 ETH-FDV launch. The router must deliver that
///         to the wei, or the quote a user sees is not the trade they get.
contract UniV4LaunchRouterTest is Test, LaunchPoolGateDeployer {
    using StateLibrary for IPoolManager;
    using PoolIdLibrary for PoolKey;

    PoolManager internal manager;
    TokenLaunchpad internal launchpad;
    UniV4LiquidityPlacer internal placer;
    UniV4LaunchRouter internal router;

    address internal buyer = address(0xB0B);
    address internal other = address(0xCAFE);

    uint256 internal constant PRICE = 1_000_000_000; // 1 gwei/token = 1 ETH FDV

    // From test_fixture_quoteMathForFrontend (UniV4LiquidityPlacer.t.sol), and the frontend.
    uint256 internal constant FIXTURE_BUY1_OUT = 90544562424768864432372374;
    uint256 internal constant FIXTURE_BUY2_OUT = 458314310870065520885587454;
    uint256 internal constant FIXTURE_SELL_OUT = 633721166099902280;

    address internal token;

    function setUp() public {
        manager = new PoolManager(address(this));
        launchpad = new TokenLaunchpad(address(this), address(0), 1e9, 1e27);
        placer = new UniV4LiquidityPlacer(address(manager), address(launchpad), address(this), 10_000, 200, 46_000);
        launchpad.setPlacer(address(placer));
        placer.setGate(_deployGate(address(placer)));
        router = new UniV4LaunchRouter(address(manager), address(launchpad));
        launchpad.setRouter(address(router));

        (, token) = launchpad.launch("Frog Pond", "POND", "", address(0), PRICE * 1e9);
        vm.deal(buyer, 100 ether);
    }

    function _buy(uint256 ethIn, uint256 minOut) internal returns (uint256) {
        vm.prank(buyer);
        return router.buy{value: ethIn}(token, ethIn, minOut, buyer, block.timestamp);
    }

    function _sell(uint256 tokensIn, uint256 minOut) internal returns (uint256) {
        vm.startPrank(buyer);
        IERC20(token).approve(address(router), tokensIn);
        uint256 out = router.sell(token, tokensIn, minOut, buyer, block.timestamp);
        vm.stopPrank();
        return out;
    }

    // ------------------------------------------------------------------
    // The quote is the trade
    // ------------------------------------------------------------------

    function test_buyDeliversExactlyWhatTheFrontendQuotes() public {
        uint256 out = _buy(0.1 ether, 0);
        assertEq(out, FIXTURE_BUY1_OUT, "router must match the pinned v4 fill to the wei");
        assertEq(IERC20(token).balanceOf(buyer), out);
    }

    function test_buyThenSellMatchTheFixtureSequence() public {
        _buy(0.1 ether, 0);
        assertEq(_buy(1 ether, 0), FIXTURE_BUY2_OUT);
        assertEq(_sell(FIXTURE_BUY2_OUT / 2, 0), FIXTURE_SELL_OUT);
    }

    // ------------------------------------------------------------------
    // Protection the caller asked for
    // ------------------------------------------------------------------

    function test_buyRevertsBelowMinimumOut() public {
        vm.prank(buyer);
        vm.expectRevert(abi.encodeWithSelector(InsufficientOutput.selector, FIXTURE_BUY1_OUT, FIXTURE_BUY1_OUT + 1));
        router.buy{value: 0.1 ether}(token, 0.1 ether, FIXTURE_BUY1_OUT + 1, buyer, block.timestamp);
    }

    function test_sellRevertsBelowMinimumOut() public {
        uint256 held = _buy(1 ether, 0);
        vm.startPrank(buyer);
        IERC20(token).approve(address(router), held);
        vm.expectRevert();
        router.sell(token, held, 100 ether, buyer, block.timestamp);
        vm.stopPrank();
    }

    function test_revertsAfterDeadline() public {
        // Literal timestamps: under via_ir a `block.timestamp` local can be re-read after
        // vm.warp, which would silently move the deadline forward with the clock.
        uint256 deadline = 1_000_000;
        vm.warp(1_000_001);
        vm.prank(buyer);
        vm.expectRevert(abi.encodeWithSelector(Expired.selector, deadline));
        router.buy{value: 0.1 ether}(token, 0.1 ether, 0, buyer, deadline);
    }

    // ------------------------------------------------------------------
    // Partial fills: nothing may stay in the router
    // ------------------------------------------------------------------

    /// A single 1 ETH-FDV range sells out for roughly 10 ETH, so 50 ETH cannot all be
    /// spent. The unspent ETH must come back, and the router must end holding nothing.
    function test_oversizedBuyRefundsUnspentEth() public {
        uint256 before = buyer.balance;
        uint256 out = _buy(50 ether, 0);
        uint256 spent = before - buyer.balance;

        assertLt(spent, 50 ether, "the range could not absorb it all");
        assertGt(out, (launchpad.TOKEN_SUPPLY() * 999) / 1000, "essentially the whole supply");
        assertEq(address(router).balance, 0, "router keeps no ETH");
        assertEq(address(manager).balance, spent, "the pool holds exactly what was spent");
    }

    /// A buy that exhausts the range stops at the position's floor, not at v4's global
    /// MIN_SQRT_PRICE: past the floor there is no liquidity to fill, and a price stranded
    /// at the minimum reads as zero liquidity (so nothing can be quoted to sell back into)
    /// and an absurd token price.
    function test_exhaustingBuyLeavesThePriceAtTheRangeFloor() public {
        _buy(50 ether, 0);
        UniV4LiquidityPlacer.Placement memory p = placer.getPlacement(token);
        (uint160 sqrtPriceX96,,,) = IPoolManager(address(manager)).getSlot0(p.key.toId());
        assertEq(sqrtPriceX96, TickMath.getSqrtPriceAtTick(p.tickLower), "price parked at the floor");
        assertGt(_sell(IERC20(token).balanceOf(buyer), 0), 0, "the whole position can be sold back into");
    }

    /// Unlike a buy, a sell cannot realistically fill partially: taking the price back
    /// to launch needs MORE tokens than ever left the pool (the 1% fee is paid in), so the
    /// pool can always absorb any one holder's balance. Selling more than you hold is
    /// therefore simply a transfer failure — and must leave nothing behind.
    function test_sellingMoreThanYouHoldReverts() public {
        uint256 held = _buy(1 ether, 0);
        vm.startPrank(buyer);
        IERC20(token).approve(address(router), type(uint256).max);
        vm.expectRevert();
        router.sell(token, held + 1, 0, buyer, block.timestamp);
        vm.stopPrank();

        assertEq(IERC20(token).balanceOf(buyer), held, "nothing moved");
        assertEq(IERC20(token).balanceOf(address(router)), 0);
    }

    /// Selling an entire balance works and returns the pool to near its launch price.
    function test_sellingEverythingSucceeds() public {
        uint256 held = _buy(1 ether, 0);
        uint256 ethOut = _sell(held, 0);
        assertGt(ethOut, 0);
        assertLt(ethOut, 1 ether, "fees both ways mean a round trip returns less");
        assertEq(IERC20(token).balanceOf(buyer), 0);
        assertEq(address(router).balance, 0);
    }

    function test_routerHoldsNothingAfterNormalTrades() public {
        uint256 held = _buy(0.5 ether, 0);
        _sell(held / 3, 0);
        assertEq(address(router).balance, 0);
        assertEq(IERC20(token).balanceOf(address(router)), 0);
    }

    // ------------------------------------------------------------------
    // Where it will and will not route
    // ------------------------------------------------------------------

    function test_refusesTokensTheLaunchpadDidNotLaunch() public {
        MockERC20 foreign = new MockERC20("Foreign", "FRN", 1e24);
        vm.prank(buyer);
        vm.expectRevert(abi.encodeWithSelector(NotALaunchToken.selector, address(foreign)));
        router.buy{value: 0.1 ether}(address(foreign), 0.1 ether, 0, buyer, block.timestamp);
    }

    function test_sendsTokensToTheRecipientNotTheCaller() public {
        vm.prank(buyer);
        uint256 out = router.buy{value: 0.1 ether}(token, 0.1 ether, 0, other, block.timestamp);
        assertEq(IERC20(token).balanceOf(other), out);
        assertEq(IERC20(token).balanceOf(buyer), 0);
    }

    function test_sellNeedsApproval() public {
        uint256 held = _buy(0.1 ether, 0);
        vm.prank(buyer);
        vm.expectRevert();
        router.sell(token, held, 0, buyer, block.timestamp);
    }

    function test_rejectsZeroAmountsAndZeroRecipient() public {
        vm.startPrank(buyer);
        vm.expectRevert(RouterZeroAmount.selector);
        router.buy{value: 0}(token, 0, 0, buyer, block.timestamp);

        vm.expectRevert(RouterZeroAmount.selector);
        router.sell(token, 0, 0, buyer, block.timestamp);

        vm.expectRevert(RouterZeroAddress.selector);
        router.buy{value: 0.1 ether}(token, 0.1 ether, 0, address(0), block.timestamp);
        vm.stopPrank();
    }

    function test_onlyThePoolManagerCanCallBack() public {
        vm.expectRevert(OnlyPoolManager.selector);
        router.unlockCallback("");
    }

    function test_rejectsStrayEth() public {
        vm.prank(buyer);
        (bool ok,) = address(router).call{value: 1 ether}("");
        assertFalse(ok, "no receive(): ETH only enters through buy()");
    }

    // ------------------------------------------------------------------
    // What the trade indexer assumes about PoolManager's Swap event
    // ------------------------------------------------------------------

    /// The backend classifies every launch trade from the PoolManager's Swap event:
    /// amount0 < 0 means BUY. IPoolManager's own doc comment calls amount0 "the delta of
    /// the currency0 balance of the pool", which reads as the OPPOSITE sign. This pins
    /// what the event actually carries on a real swap, so the indexer rests on
    /// behaviour rather than on a comment.
    function test_swapEventSignConvention_forTheIndexer() public {
        vm.recordLogs();
        uint256 before = buyer.balance;
        uint256 tokensOut = _buy(0.1 ether, 0);
        uint256 ethSpent = before - buyer.balance;

        bytes32 swapSig = keccak256("Swap(bytes32,address,int128,int128,uint160,uint128,int24,uint24)");
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bool found;
        for (uint256 i; i < logs.length; i++) {
            if (logs[i].emitter != address(manager) || logs[i].topics[0] != swapSig) continue;
            (int128 amount0, int128 amount1,,,,) = abi.decode(logs[i].data, (int128, int128, uint160, uint128, int24, uint24));
            assertLt(amount0, 0, "a BUY emits NEGATIVE amount0 (ETH the caller paid in)");
            assertGt(amount1, 0, "and POSITIVE amount1 (tokens the caller received)");
            assertEq(uint256(uint128(-amount0)), ethSpent, "|amount0| is the ETH spent");
            assertEq(uint256(uint128(amount1)), tokensOut, "amount1 is the tokens out");
            assertEq(address(uint160(uint256(logs[i].topics[2]))), address(router), "sender is the router, not the trader");
            found = true;
        }
        assertTrue(found, "PoolManager emitted a Swap");
    }

    // ------------------------------------------------------------------
    // The switch
    // ------------------------------------------------------------------

    function test_launchpadAdvertisesTheActiveRouter() public view {
        assertEq(address(launchpad.router()), address(router));
    }

    /// Switching implementations is one setter; zero turns in-app trading off.
    function test_routerCanBeSwitchedAndCleared() public {
        UniV4LaunchRouter next = new UniV4LaunchRouter(address(manager), address(launchpad));
        launchpad.setRouter(address(next));
        assertEq(address(launchpad.router()), address(next));

        // The replacement routes identically — the interface is the contract clients rely on.
        vm.prank(buyer);
        assertEq(ILaunchRouter(address(launchpad.router())).buy{value: 0.1 ether}(token, 0.1 ether, 0, buyer, block.timestamp), FIXTURE_BUY1_OUT);

        launchpad.setRouter(address(0));
        assertEq(address(launchpad.router()), address(0));
    }

    // ------------------------------------------------------------------
    // Replacing the placer
    // ------------------------------------------------------------------

    /// Swapping the launchpad's placer changes where NEW launches go. A token launched
    /// under the old one keeps its pool, and the router must still find it there.
    function test_launchesUnderAReplacedPlacerStayTradeable() public {
        UniV4LiquidityPlacer next =
            new UniV4LiquidityPlacer(address(manager), address(launchpad), address(this), 10_000, 200, 46_000);
        next.setGate(_deployGate(address(next)));
        launchpad.setPlacer(address(next));

        assertEq(launchpad.placerOf(token), address(placer), "the old launch keeps its placer");
        assertEq(_buy(0.1 ether, 0), FIXTURE_BUY1_OUT, "and still routes through it");

        (, address newer) = launchpad.launch("Newer", "NEW", "", address(0), PRICE * 1e9);
        assertEq(launchpad.placerOf(newer), address(next));
        vm.prank(buyer);
        assertEq(router.buy{value: 0.1 ether}(newer, 0.1 ether, 0, buyer, block.timestamp), FIXTURE_BUY1_OUT);
    }

    function test_placerOfIsZeroForForeignTokens() public view {
        assertEq(launchpad.placerOf(address(0xF00)), address(0));
    }

    function test_onlyConfigRoleCanSwitchRouter() public {
        vm.prank(other);
        vm.expectRevert();
        launchpad.setRouter(address(0x1234));
    }
}
