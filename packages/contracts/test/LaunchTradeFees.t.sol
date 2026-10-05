// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test, Vm} from "forge-std/Test.sol";
import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {PoolManager} from "@uniswap/v4-core/src/PoolManager.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency, CurrencyLibrary} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";
import {TokenLaunchpad} from "../src/launchpad/TokenLaunchpad.sol";
import {
    UniV4LiquidityPlacer,
    NoPlacement,
    FeeTreasuryNotSet,
    NotFeeRecipient,
    NothingToClaim
} from "../src/launchpad/UniV4LiquidityPlacer.sol";
import {UniV4LaunchRouter} from "../src/launchpad/UniV4LaunchRouter.sol";
import {MockUSDC} from "../src/test-helpers/MockUSDC.sol";
import {PlacerDeployer} from "./helpers/PlacerDeployer.sol";

/// @notice The trade fee the placer takes as every launch pool's hook, against a real
///         PoolManager.
///
///         The fee is the creator's chosen rate of the GROSS quote flow, always charged in
///         the quote token: buys and sells, exact-in and exact-out, through our router or
///         straight through the PoolManager, in every pool orientation (ETH, and an ERC-20
///         quote sorted below and above the launch token). The launch token is never
///         charged, credited or held as a fee.
contract LaunchTradeFeesTest is Test, PlacerDeployer {
    using CurrencyLibrary for Currency;

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
    address internal treasury = address(0x7EA5);
    address internal trader = address(0xB0B);
    address internal stranger = address(0x5757);

    uint256 internal constant ETH_FDV = 1 ether;
    uint256 internal constant USDC_FDV = 5_000e6;
    uint24 internal constant PIPS = 1_000_000;

    function setUp() public {
        manager = new PoolManager(address(this));
        launchpad = new TokenLaunchpad(address(this), address(0), 1 ether, 1000 ether);
        placer = _deployPlacer(address(manager), address(launchpad), address(this), 200, 0);
        launchpad.setPlacer(address(placer));
        placer.setFeeTreasury(treasury);
        router = new UniV4LaunchRouter(address(manager), address(launchpad));
        launchpad.setRouter(address(router));
        swapper = new DirectSwapper(IPoolManager(address(manager)));

        deployCodeTo("MockUSDC.sol:MockUSDC", LOW);
        deployCodeTo("MockUSDC.sol:MockUSDC", HIGH);
        launchpad.setQuoteToken(LOW, 2_500e6, 10_000_000e6);
        launchpad.setQuoteToken(HIGH, 2_500e6, 10_000_000e6);

        vm.deal(trader, 1_000 ether);
        vm.deal(address(swapper), 1_000 ether);
        MockUSDC(LOW).mint(trader, 10_000_000e6);
        MockUSDC(HIGH).mint(trader, 10_000_000e6);
        MockUSDC(LOW).mint(address(swapper), 10_000_000e6);
        MockUSDC(HIGH).mint(address(swapper), 10_000_000e6);
        vm.startPrank(trader);
        IERC20(LOW).approve(address(router), type(uint256).max);
        IERC20(HIGH).approve(address(router), type(uint256).max);
        vm.stopPrank();
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    function _launch(address quote, uint24 fee) internal returns (address token) {
        vm.prank(creator);
        (, token) =
            launchpad.launch("Frog Pond", "POND", "", quote, quote == address(0) ? ETH_FDV : USDC_FDV, fee, 0, 0);
    }

    function _key(address token) internal view returns (PoolKey memory) {
        return placer.getPlacement(token).key;
    }

    function _quoteIsCurrency0(address token) internal view returns (bool) {
        return !placer.getPlacement(token).tokenIsCurrency0;
    }

    /// A swap straight through the PoolManager — not our router — from `swapper`'s balance.
    /// Returns what the swapper paid and received, from its own balances.
    function _swap(address token, bool isBuy, bool exactIn, uint256 amount)
        internal
        returns (uint256 quotePaid, uint256 quoteReceived, uint256 tokensMoved)
    {
        PoolKey memory key = _key(token);
        bool quote0 = _quoteIsCurrency0(token);
        // A buy spends the quote: zeroForOne exactly when the quote is currency0.
        bool zeroForOne = isBuy == quote0;
        if (!isBuy) {
            // Hand the swapper tokens to sell.
            uint256 need = IERC20(token).balanceOf(address(swapper));
            if (need == 0) {
                _swap(token, true, true, quote0 && Currency.unwrap(key.currency0) == address(0) ? 1 ether : 50_000e6);
            }
        }
        Currency quote = quote0 ? key.currency0 : key.currency1;
        uint256 quoteBefore = quote.balanceOf(address(swapper));
        uint256 tokensBefore = IERC20(token).balanceOf(address(swapper));
        swapper.swap(
            key,
            zeroForOne,
            exactIn ? -int256(amount) : int256(amount),
            zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
        );
        uint256 quoteAfter = quote.balanceOf(address(swapper));
        uint256 tokensAfter = IERC20(token).balanceOf(address(swapper));
        if (quoteAfter < quoteBefore) quotePaid = quoteBefore - quoteAfter;
        else quoteReceived = quoteAfter - quoteBefore;
        tokensMoved = tokensAfter > tokensBefore ? tokensAfter - tokensBefore : tokensBefore - tokensAfter;
    }

    function _quoteClaims(address token) internal view returns (uint256) {
        PoolKey memory key = _key(token);
        Currency quote = _quoteIsCurrency0(token) ? key.currency0 : key.currency1;
        return manager.balanceOf(address(placer), quote.toId());
    }

    function _tokenClaims(address token) internal view returns (uint256) {
        return manager.balanceOf(address(placer), Currency.wrap(token).toId());
    }

    // ------------------------------------------------------------------
    // The four swap shapes, in every orientation
    // ------------------------------------------------------------------

    function test_feeIsRateOfGrossQuoteFlow_eth() public {
        _checkAllFourShapes(address(0), 1 ether, 1e26);
    }

    function test_feeIsRateOfGrossQuoteFlow_usdcQuoteIsCurrency0() public {
        _checkAllFourShapes(LOW, 1_000e6, 1e26);
    }

    function test_feeIsRateOfGrossQuoteFlow_usdcTokenIsCurrency0() public {
        _checkAllFourShapes(HIGH, 1_000e6, 1e26);
    }

    function test_feeAtTheMaximumRate() public {
        address token = _launch(HIGH, placer.MAX_TRADE_FEE());
        _checkShapes(token, placer.MAX_TRADE_FEE(), 1_000e6, 1e26);
    }

    function _checkAllFourShapes(address quote, uint256 quoteAmount, uint256 tokenAmount) internal {
        uint24 fee = 25_000; // 2.5%, distinct from the 1% default so a mix-up shows
        address token = _launch(quote, fee);
        assertEq(placer.getPlacement(token).tokenIsCurrency0, quote == HIGH, "orientation under test");
        _checkShapes(token, fee, quoteAmount, tokenAmount);
    }

    function _checkShapes(address token, uint24 f, uint256 quoteAmount, uint256 tokenAmount) internal {
        // Buy, exact-in: the trader pays exactly G; fee = ceil(G * f).
        uint256 before = placer.pendingFees(token);
        (uint256 paid,,) = _swap(token, true, true, quoteAmount);
        uint256 fee = placer.pendingFees(token) - before;
        assertEq(paid, quoteAmount, "exact-in buy pays exactly the amount");
        assertEq(fee, FullMath.mulDivRoundingUp(paid, f, PIPS), "exact-in buy");

        // Buy, exact-out: the trader pays the pool's input I plus fee; fee = ceil(I * f / (1 - f)),
        // i.e. f of the gross payment.
        before = placer.pendingFees(token);
        (uint256 paid2,, uint256 got) = _swap(token, true, false, tokenAmount);
        fee = placer.pendingFees(token) - before;
        assertEq(got, tokenAmount, "exact-out buy delivers exactly the tokens");
        assertEq(fee, FullMath.mulDivRoundingUp(paid2 - fee, f, PIPS - f), "exact-out buy");
        assertApproxEqAbs(fee, (paid2 * f) / PIPS, 1, "exact-out buy: f of the gross payment");

        // Sell, exact-in: the pool pays O, the trader gets O - fee; fee = ceil(O * f).
        before = placer.pendingFees(token);
        (, uint256 received,) = _swap(token, false, true, tokenAmount / 2);
        fee = placer.pendingFees(token) - before;
        assertEq(fee, FullMath.mulDivRoundingUp(received + fee, f, PIPS), "exact-in sell");

        // Sell, exact-out: the trader gets exactly R; the pool pays R + fee; fee = ceil(R * f / (1 - f)).
        before = placer.pendingFees(token);
        (, uint256 received2,) = _swap(token, false, false, quoteAmount / 10);
        fee = placer.pendingFees(token) - before;
        assertEq(received2, quoteAmount / 10, "exact-out sell delivers exactly the quote");
        assertEq(fee, FullMath.mulDivRoundingUp(received2, f, PIPS - f), "exact-out sell");
        assertApproxEqAbs(fee, ((received2 + fee) * f) / PIPS, 1, "exact-out sell: f of the gross payout");

        // Every fee is held as quote claims, and none in the launch token.
        assertEq(_quoteClaims(token), placer.pendingFees(token), "claims back every pending fee");
        assertEq(_tokenClaims(token), 0, "never a launch-token fee");
    }

    /// Any rate, any size, either side: the fee is exactly the rounded-up rate of the gross
    /// quote flow, the trader pays or receives exactly what the shape fixes, and every fee
    /// is held as quote claims — never in the launch token.
    function testFuzz_feeMathHoldsForAnyRateAndSize(uint24 rate, uint256 buyIn, bool high) public {
        rate = uint24(bound(rate, 1, placer.MAX_TRADE_FEE()));
        buyIn = bound(buyIn, 1_000, 100_000e6);
        address token = _launch(high ? HIGH : LOW, rate);

        (uint256 paid,, uint256 bought) = _swap(token, true, true, buyIn);
        uint256 buyFee = placer.pendingFees(token);
        assertEq(paid, buyIn);
        assertEq(buyFee, FullMath.mulDivRoundingUp(buyIn, rate, PIPS));

        (, uint256 received,) = _swap(token, false, true, bought);
        uint256 sellFee = placer.pendingFees(token) - buyFee;
        assertEq(sellFee, FullMath.mulDivRoundingUp(received + sellFee, rate, PIPS));
        assertLe(received, buyIn, "a round trip never makes money");

        assertEq(_quoteClaims(token), buyFee + sellFee);
        assertEq(_tokenClaims(token), 0);
    }

    // ------------------------------------------------------------------
    // Our router pays it too, and only in the quote token
    // ------------------------------------------------------------------

    function test_routerTradesPayTheFeeInTheQuoteOnly() public {
        address token = _launch(address(0), TEST_TRADE_FEE);
        vm.prank(trader);
        uint256 bought = router.buy{value: 1 ether}(token, 1 ether, 0, trader, block.timestamp);
        assertEq(placer.pendingFees(token), 0.01 ether, "1% of the ETH paid");

        vm.startPrank(trader);
        IERC20(token).approve(address(router), bought);
        uint256 ethBack = router.sell(token, bought, 0, trader, block.timestamp);
        vm.stopPrank();
        uint256 sellFee = placer.pendingFees(token) - 0.01 ether;
        assertEq(sellFee, FullMath.mulDivRoundingUp(ethBack + sellFee, TEST_TRADE_FEE, PIPS), "1% of the ETH paid out");

        assertEq(IERC20(token).balanceOf(address(placer)) < 1e12, true, "the placer holds only placement dust");
        assertEq(_tokenClaims(token), 0);
    }

    function test_aZeroFeeLaunchTakesNothing() public {
        address token = _launch(address(0), 0);
        vm.recordLogs();
        _swap(token, true, true, 1 ether);
        _swap(token, false, true, 1e24);
        assertEq(placer.pendingFees(token), 0);
        assertEq(_quoteClaims(token), 0);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i; i < logs.length; i++) {
            assertTrue(logs[i].topics[0] != UniV4LiquidityPlacer.TradeFeeTaken.selector, "no fee event");
        }
    }

    // ------------------------------------------------------------------
    // Guards
    // ------------------------------------------------------------------

    /// A fee priced on the whole requested amount must not be charged on a fill that a
    /// price limit cut short: the hook reverts instead.
    function test_partialFillOfAQuoteSpecifiedSwapReverts() public {
        address token = _launch(address(0), TEST_TRADE_FEE);
        PoolKey memory key = _key(token);
        UniV4LiquidityPlacer.Placement memory p = placer.getPlacement(token);
        // ETH is currency0: a buy moves the tick DOWN from tickUpper. Stop it one spacing in.
        uint160 limit = TickMath.getSqrtPriceAtTick(p.tickUpper - 200);
        vm.expectRevert();
        swapper.swap(key, true, -int256(100 ether), limit);

        // The same cap on a buy small enough to fill is fine.
        swapper.swap(key, true, -int256(0.001 ether), limit);
        assertGt(placer.pendingFees(token), 0);
    }

    /// An exact-out sell for more quote than the pool holds stops at the launch price.
    function test_partialExactOutSellReverts() public {
        address token = _launch(address(0), TEST_TRADE_FEE);
        _swap(token, true, true, 0.1 ether); // the pool now holds ~0.099 ETH
        PoolKey memory key = _key(token);
        vm.expectRevert();
        swapper.swap(key, false, int256(1 ether), TickMath.MAX_SQRT_PRICE - 1);
    }

    /// One raw unit in at any fee rounds up to a whole-unit fee: all fee, no swap. Refused.
    function test_aSwapTooSmallForItsFeeReverts() public {
        address token = _launch(address(0), TEST_TRADE_FEE);
        PoolKey memory key = _key(token);
        vm.expectRevert();
        swapper.swap(key, true, -1, TickMath.MIN_SQRT_PRICE + 1);
    }

    // ------------------------------------------------------------------
    // Events for indexers
    // ------------------------------------------------------------------

    /// The PoolManager's Swap log excludes hook deltas, so the hook logs the fee right
    /// after it — after only the PoolManager's ERC-6909 mint of the fee — in the uniform
    /// TradeFeeTaken and the standard HookFee.
    function test_feeEventsFollowTheSwapLog() public {
        address token = _launch(address(0), TEST_TRADE_FEE);
        PoolId id = _key(token).toId();
        vm.recordLogs();
        _swap(token, true, true, 1 ether);
        Vm.Log[] memory logs = vm.getRecordedLogs();

        uint256 swapAt = type(uint256).max;
        for (uint256 i; i < logs.length; i++) {
            if (logs[i].emitter == address(manager) && logs[i].topics[0] == IPoolManager.Swap.selector) swapAt = i;
        }
        assertLt(swapAt, logs.length, "found the Swap log");
        assertEq(logs[swapAt + 1].emitter, address(manager), "the fee's ERC-6909 mint");
        Vm.Log memory feeLog = logs[swapAt + 2];
        assertEq(feeLog.emitter, address(placer));
        assertEq(feeLog.topics[0], UniV4LiquidityPlacer.TradeFeeTaken.selector);
        assertEq(feeLog.topics[1], PoolId.unwrap(id));
        assertEq(feeLog.topics[2], bytes32(uint256(uint160(token))));
        assertEq(abi.decode(feeLog.data, (uint256)), 0.01 ether);

        Vm.Log memory hookFee = logs[swapAt + 3];
        assertEq(hookFee.topics[0], UniV4LiquidityPlacer.HookFee.selector);
        (uint128 fee0, uint128 fee1) = abi.decode(hookFee.data, (uint128, uint128));
        assertEq(fee0, 0.01 ether, "ETH is currency0");
        assertEq(fee1, 0);
    }

    // ------------------------------------------------------------------
    // Collecting and claiming
    // ------------------------------------------------------------------

    function test_collectSplits88To12() public {
        address token = _launch(address(0), TEST_TRADE_FEE);
        _swap(token, true, true, 1 ether);
        _swap(token, false, true, 1e25);
        uint256 pending = placer.pendingFees(token);

        vm.prank(stranger); // permissionless
        uint256 fees = placer.collectFees(token);
        assertEq(fees, pending);
        assertEq(placer.pendingFees(token), 0);

        uint256 creatorShare = (fees * 8_800) / 10_000;
        assertEq(placer.claimable(address(0), creator), creatorShare);
        assertEq(placer.claimable(address(0), treasury), fees - creatorShare);
        assertEq(placer.claimable(address(0), stranger), 0, "the caller earns nothing for collecting");
        assertEq(placer.claimable(token, creator), 0, "never a launch-token credit");
    }

    function test_collectingAgainWithoutTradesCreditsNothing() public {
        address token = _launch(address(0), TEST_TRADE_FEE);
        _swap(token, true, true, 1 ether);
        placer.collectFees(token);
        uint256 creatorEth = placer.claimable(address(0), creator);
        assertEq(placer.collectFees(token), 0);
        assertEq(placer.claimable(address(0), creator), creatorEth);
    }

    function test_collectRequiresAPlacementAndATreasury() public {
        vm.expectRevert(abi.encodeWithSelector(NoPlacement.selector, address(0xF00)));
        placer.collectFees(address(0xF00));

        UniV4LiquidityPlacer bare = _deployPlacer(address(manager), address(launchpad), address(this), 200);
        launchpad.setPlacer(address(bare));
        vm.prank(creator);
        (, address other) = launchpad.launch("Other", "OTH", "", address(0), ETH_FDV, TEST_TRADE_FEE, 0, 0);
        vm.expectRevert(FeeTreasuryNotSet.selector);
        bare.collectFees(other);
    }

    /// One claim per currency pays every launch paired with it; the PoolManager pays out
    /// and the placer's claims go to zero.
    function test_claimsPayEachCurrencyAcrossLaunches() public {
        address a = _launch(address(0), TEST_TRADE_FEE);
        address b = _launch(address(0), 50_000);
        address u = _launch(HIGH, TEST_TRADE_FEE);
        _swap(a, true, true, 1 ether);
        _swap(b, true, true, 1 ether);
        _swap(u, true, true, 1_000e6);
        placer.collectFees(a);
        placer.collectFees(b);
        placer.collectFees(u);

        uint256 eth = placer.claimable(address(0), creator);
        uint256 usdc = placer.claimable(HIGH, creator);
        assertEq(eth, ((0.01 ether * 8_800) / 10_000) + ((0.05 ether * 8_800) / 10_000));
        assertEq(usdc, (10e6 * 8_800) / 10_000);

        address wallet = address(0xA11);
        vm.startPrank(creator);
        assertEq(placer.claim(address(0), wallet), eth);
        assertEq(placer.claim(HIGH, wallet), usdc);
        vm.stopPrank();
        assertEq(wallet.balance, eth);
        assertEq(IERC20(HIGH).balanceOf(wallet), usdc);

        vm.startPrank(treasury);
        placer.claim(address(0), treasury);
        placer.claim(HIGH, treasury);
        vm.stopPrank();

        assertEq(manager.balanceOf(address(placer), 0), 0, "no ETH claims left");
        assertEq(manager.balanceOf(address(placer), Currency.wrap(HIGH).toId()), 0, "no USDC claims left");
        assertEq(address(placer).balance, 0, "fees never pass through the placer");

        vm.prank(creator);
        vm.expectRevert(NothingToClaim.selector);
        placer.claim(address(0), wallet);
    }

    /// A claim to an address that rejects ETH fails without losing the credit.
    function test_aFailedEthClaimKeepsTheCredit() public {
        address token = _launch(address(0), TEST_TRADE_FEE);
        _swap(token, true, true, 1 ether);
        placer.collectFees(token);
        uint256 owed = placer.claimable(address(0), creator);

        address rejecting = address(new RejectsEth());
        vm.prank(creator);
        vm.expectRevert();
        placer.claim(address(0), rejecting);
        assertEq(placer.claimable(address(0), creator), owed);

        vm.prank(creator);
        placer.claim(address(0), creator);
        assertEq(creator.balance, owed);
    }

    function test_thePlacerAcceptsNoEth() public {
        vm.deal(stranger, 1 ether);
        vm.prank(stranger);
        (bool ok,) = address(placer).call{value: 1 ether}("");
        assertFalse(ok);
    }

    // ------------------------------------------------------------------
    // The fee recipient
    // ------------------------------------------------------------------

    function test_recipientStartsAsTheCreatorAndOnlyTheyCanHandItOn() public {
        address token = _launch(address(0), TEST_TRADE_FEE);
        assertEq(placer.feeRecipientOf(token), creator);

        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(NotFeeRecipient.selector, stranger));
        placer.setFeeRecipient(token, stranger);

        address next = address(0x2E27);
        vm.prank(creator);
        placer.setFeeRecipient(token, next);
        assertEq(placer.feeRecipientOf(token), next);

        vm.prank(creator);
        vm.expectRevert(abi.encodeWithSelector(NotFeeRecipient.selector, creator));
        placer.setFeeRecipient(token, creator);
    }

    /// Shares are fixed when collected: fees credited before a handover stay credited.
    function test_handoverAppliesToLaterCollectionsOnly() public {
        address token = _launch(address(0), TEST_TRADE_FEE);
        _swap(token, true, true, 1 ether);
        placer.collectFees(token);
        uint256 creatorBefore = placer.claimable(address(0), creator);

        address next = address(0x2E27);
        vm.prank(creator);
        placer.setFeeRecipient(token, next);

        _swap(token, true, true, 1 ether);
        placer.collectFees(token);
        assertEq(placer.claimable(address(0), creator), creatorBefore, "earlier credit unchanged");
        assertGt(placer.claimable(address(0), next), 0, "later fees go to the new recipient");
    }
}

/// @dev Swaps straight through the PoolManager, as any third-party router would, paying
///      from and receiving to its own balance.
contract DirectSwapper is IUnlockCallback {
    using CurrencyLibrary for Currency;

    IPoolManager public immutable manager;

    constructor(IPoolManager _manager) {
        manager = _manager;
    }

    receive() external payable {}

    function swap(PoolKey memory key, bool zeroForOne, int256 amountSpecified, uint160 limit)
        external
        returns (BalanceDelta)
    {
        return abi.decode(manager.unlock(abi.encode(key, zeroForOne, amountSpecified, limit)), (BalanceDelta));
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        (PoolKey memory key, bool zeroForOne, int256 amountSpecified, uint160 limit) =
            abi.decode(data, (PoolKey, bool, int256, uint160));
        BalanceDelta delta = manager.swap(
            key,
            IPoolManager.SwapParams({
                zeroForOne: zeroForOne, amountSpecified: amountSpecified, sqrtPriceLimitX96: limit
            }),
            ""
        );
        _settle(key.currency0, delta.amount0());
        _settle(key.currency1, delta.amount1());
        return abi.encode(delta);
    }

    function _settle(Currency c, int128 d) private {
        if (d < 0) {
            uint256 owed = uint256(uint128(-d));
            manager.sync(c);
            if (c.isAddressZero()) {
                manager.settle{value: owed}();
            } else {
                IERC20(Currency.unwrap(c)).transfer(address(manager), owed);
                manager.settle();
            }
        } else if (d > 0) {
            manager.take(c, address(this), uint256(uint128(d)));
        }
    }
}

contract RejectsEth {
    receive() external payable {
        revert("no");
    }
}
