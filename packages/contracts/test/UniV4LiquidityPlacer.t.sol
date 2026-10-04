// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {PoolManager} from "@uniswap/v4-core/src/PoolManager.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Position} from "@uniswap/v4-core/src/libraries/Position.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {
    UniV4LiquidityPlacer, OnlyLaunchpad, NotPoolManager, ZeroAmount, GateNotSet, InvalidGate
} from "../src/launchpad/UniV4LiquidityPlacer.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {LaunchPoolGate} from "../src/launchpad/LaunchPoolGate.sol";
import {TokenLaunchpad} from "../src/launchpad/TokenLaunchpad.sol";
import {LaunchToken} from "../src/launchpad/LaunchToken.sol";
import {LaunchPoolGateDeployer} from "./helpers/LaunchPoolGateDeployer.sol";

/// @notice The v4 placement path against a REAL PoolManager, not a mock.
///
///         A mock would prove nothing here: every property worth checking — that the
///         pool initialises, that the position is genuinely single-sided, that we owe no
///         ETH, that the tokens actually land in the pool — is a property of v4's own
///         accounting. So this deploys PoolManager itself.
contract UniV4LiquidityPlacerTest is Test, LaunchPoolGateDeployer {
    using StateLibrary for IPoolManager;

    PoolManager internal manager;
    TokenLaunchpad internal launchpad;
    UniV4LiquidityPlacer internal placer;

    address internal admin = address(this);
    address internal creator = address(0xC0FFEE);

    uint24 internal constant FEE = 10_000; // 1%
    int24 internal constant SPACING = 200;
    int24 internal constant RANGE_WIDTH = 46_000; // ~100x climb

    uint256 internal constant MIN_PRICE = 1;
    uint256 internal constant MAX_PRICE = 1 ether;
    uint256 internal constant MIN_SANE_PRICE = 1_000_000_000; // FDV 1 ETH
    /// @dev 1e9 wei per whole token against a 1e9 supply is an implied FDV of 1 ETH.
    ///      Worth stating in these terms: price alone is meaningless without the supply,
    ///      and an earlier version of this test used 1e6 — an FDV of 0.001 ETH, where a
    ///      single 0.1 ETH buy consumed the entire position and pushed the tick to
    ///      MIN_TICK. See the note on start-price bounds in TokenLaunchpad.
    uint256 internal constant PRICE = 1_000_000_000;

    function setUp() public {
        manager = new PoolManager(admin);

        launchpad = new TokenLaunchpad(admin, address(0), MIN_PRICE * 1e9, MAX_PRICE * 1e9);
        placer = new UniV4LiquidityPlacer(
            address(manager), address(launchpad), admin, FEE, SPACING, RANGE_WIDTH
        );
        launchpad.setPlacer(address(placer));
        placer.setGate(_deployGate(address(placer)));
    }

    function _launch(uint256 startPriceWei) internal returns (address token) {
        vm.prank(creator);
        (, token) = launchpad.launch("Launched", "LNCH", "ipfs://m", address(0), startPriceWei * 1e9);
    }

    // ------------------------------------------------------------------
    // The defining property: single-sided, costs no ETH
    // ------------------------------------------------------------------

    /// The placer holds no ETH and is never funded, so if placement required any ETH the
    /// launch would revert. That it succeeds is the proof the position is single-sided.
    function test_placementCostsNoEthAndPlacerHoldsNone() public {
        assertEq(address(placer).balance, 0, "placer starts with no ETH");

        address token = _launch(PRICE);

        assertEq(address(placer).balance, 0, "placer still holds no ETH");
        assertEq(address(manager).balance, 0, "no ETH entered the pool");
        assertGt(IERC20(token).balanceOf(address(manager)), 0, "tokens did enter the pool");
    }

    /// Essentially the whole supply reaches the PoolManager; what stays behind is the
    /// integer-liquidity remainder, which must be true dust rather than a real slice.
    function test_essentiallyAllSupplyReachesThePool() public {
        address token = _launch(PRICE);

        uint256 supply = launchpad.TOKEN_SUPPLY();
        uint256 inPool = IERC20(token).balanceOf(address(manager));
        uint256 dust = IERC20(token).balanceOf(address(placer));

        assertEq(inPool + dust, supply, "supply is conserved");
        // Under 1e-6 of a whole token. See the dust note in the contract docs.
        assertLt(dust, 1e12, "remainder must be dust");
    }

    function test_poolIsInitialisedAtTheTopOfTheRange() public {
        address token = _launch(PRICE);

        UniV4LiquidityPlacer.Placement memory p = placer.getPlacement(token);
        PoolKey memory key = p.key;

        // ETH is address(0), so it must have sorted into currency0.
        assertEq(Currency.unwrap(key.currency0), address(0), "ETH is currency0");
        assertEq(Currency.unwrap(key.currency1), token, "token is currency1");

        (uint160 sqrtPriceX96, int24 tick,,) = IPoolManager(address(manager)).getSlot0(key.toId());
        assertTrue(sqrtPriceX96 != 0, "pool is initialised");

        // Initialised exactly at tickUpper — that is what makes the position single-sided.
        assertEq(tick, p.tickUpper, "pool starts at the top of the position");
        assertLt(p.tickLower, p.tickUpper, "range extends below the start price");
    }

    function test_poolRecordsThePositionLiquidity() public {
        address token = _launch(PRICE);
        UniV4LiquidityPlacer.Placement memory p = placer.getPlacement(token);

        assertGt(p.liquidity, 0, "placer recorded liquidity");

        // The pool's own accounting must agree, not just our bookkeeping.
        bytes32 positionId = Position.calculatePositionKey(address(placer), p.tickLower, p.tickUpper, bytes32(0));
        assertEq(
            IPoolManager(address(manager)).getPositionLiquidity(p.key.toId(), positionId),
            p.liquidity,
            "pool records the position"
        );

        // ACTIVE liquidity at the starting tick is legitimately zero: a range is
        // [lower, upper) so the position is not in range while the tick sits exactly at
        // tickUpper. The first buy crosses tickUpper downward, which activates it — see
        // test_launchedTokenIsImmediatelyTradeable.
        assertEq(IPoolManager(address(manager)).getLiquidity(p.key.toId()), 0, "not yet in range");
    }

    /// Ticks are discrete, so a cheaper start price must land at a HIGHER tick:
    /// price is token-per-ETH, so a cheap token means many tokens per ETH.
    function test_cheaperStartPriceGivesHigherTick() public {
        address cheap = _launch(1_000_000_000); // FDV 1 ETH
        vm.prank(creator);
        (, address dear) = launchpad.launch("Dear", "DEAR", "", address(0), 100_000_000_000 * 1e9); // FDV 100 ETH

        int24 cheapTick = placer.getPlacement(cheap).tickUpper;
        int24 dearTick = placer.getPlacement(dear).tickUpper;

        assertGt(cheapTick, dearTick, "cheaper token sits at a higher tick (more token per ETH)");
    }

    function test_positionTicksAreAlignedToSpacing() public {
        address token = _launch(PRICE);
        UniV4LiquidityPlacer.Placement memory p = placer.getPlacement(token);

        assertEq(p.tickUpper % SPACING, 0, "upper aligned");
        assertEq(p.tickLower % SPACING, 0, "lower aligned");
        assertGe(p.tickLower, TickMath.minUsableTick(SPACING), "lower within usable range");
    }

    function test_poolIdIsQueryableForIndexers() public {
        address token = _launch(PRICE);
        bytes32 poolId = placer.poolIdOf(token);

        assertTrue(poolId != bytes32(0));
        assertEq(poolId, PoolId.unwrap(placer.getPlacement(token).key.toId()));
        assertEq(placer.poolIdOf(address(0xDEAD)), bytes32(0), "unknown token has no pool");
    }


    /// The property that makes a launch a launch: a stranger can buy the token with ETH
    /// immediately, with no graduation step and nothing else to wait for.
    ///
    /// This also exercises the tick orientation end to end. Buying pushes the tick DOWN
    /// (price is token-per-ETH, so the token getting dearer is a falling tick) and crosses
    /// tickUpper, which is what activates the position.
    /// Emits the numbers frontend/tests/lib/v4PoolMath.test.js reproduces. The frontend
    /// quotes buys and sells from pool state with no quoter contract, so this pins its math
    /// to what v4 ACTUALLY does rather than to a re-derivation that could share a mistake.
    /// Run with -vv to print them; the asserts only prove the swaps happened.
    function test_fixture_quoteMathForFrontend() public {
        address token = _launch(PRICE);
        UniV4LiquidityPlacer.Placement memory p = placer.getPlacement(token);
        PoolId id = p.key.toId();
        IPoolManager pm = IPoolManager(address(manager));
        TestSwapRouter router = new TestSwapRouter(pm);
        address buyer = address(0xB0B);
        vm.deal(buyer, 10 ether);

        (uint160 sqrtAtLaunch, int24 tickAtLaunch,, uint24 lpFee) = pm.getSlot0(id);
        emit log_named_uint("placement.liquidity", p.liquidity);
        emit log_named_int("placement.tickLower", p.tickLower);
        emit log_named_int("placement.tickUpper", p.tickUpper);
        emit log_named_uint("launch.sqrtPriceX96", sqrtAtLaunch);
        emit log_named_int("launch.tick", tickAtLaunch);
        emit log_named_uint("launch.activeLiquidity", pm.getLiquidity(id));
        emit log_named_uint("lpFee", lpFee);
        // The frontend reads slot0 raw via extsload and unpacks it itself; pin the slot and word.
        bytes32 stateSlot = keccak256(abi.encodePacked(PoolId.unwrap(id), StateLibrary.POOLS_SLOT));
        emit log_named_bytes32("poolId", PoolId.unwrap(id));
        emit log_named_bytes32("poolStateSlot", stateSlot);
        emit log_named_bytes32("slot0Word", pm.extsload(stateSlot));

        vm.prank(buyer);
        uint256 out1 = router.buyWithEth{value: 0.1 ether}(p.key);
        (uint160 sqrt1,,,) = pm.getSlot0(id);
        emit log_named_uint("buy1.ethIn", 0.1 ether);
        emit log_named_uint("buy1.tokensOut", out1);
        emit log_named_uint("buy1.sqrtPriceAfter", sqrt1);
        emit log_named_uint("buy1.activeLiquidityAfter", pm.getLiquidity(id));

        vm.prank(buyer);
        uint256 out2 = router.buyWithEth{value: 1 ether}(p.key);
        (uint160 sqrt2,,,) = pm.getSlot0(id);
        emit log_named_uint("buy2.ethIn", 1 ether);
        emit log_named_uint("buy2.tokensOut", out2);
        emit log_named_uint("buy2.sqrtPriceAfter", sqrt2);

        uint256 sellAmount = out2 / 2;
        vm.prank(buyer);
        IERC20(token).transfer(address(router), sellAmount);
        vm.prank(buyer);
        uint256 ethBack = router.sellForEth(p.key, sellAmount);
        (uint160 sqrt3,,,) = pm.getSlot0(id);
        emit log_named_uint("sell.tokensIn", sellAmount);
        emit log_named_uint("sell.ethOut", ethBack);
        emit log_named_uint("sell.sqrtPriceAfter", sqrt3);

        assertGt(out1, 0);
        assertGt(out2, 0);
        assertGt(ethBack, 0);
    }

    function test_launchedTokenIsImmediatelyTradeable() public {
        address token = _launch(PRICE);
        UniV4LiquidityPlacer.Placement memory p = placer.getPlacement(token);

        TestSwapRouter router = new TestSwapRouter(IPoolManager(address(manager)));
        address buyer = address(0xB0B);
        vm.deal(buyer, 1 ether);

        (, int24 tickBefore,,) = IPoolManager(address(manager)).getSlot0(p.key.toId());

        vm.prank(buyer);
        uint256 tokensOut = router.buyWithEth{value: 0.1 ether}(p.key);

        assertGt(tokensOut, 0, "buyer received tokens");
        assertEq(IERC20(token).balanceOf(buyer), tokensOut, "tokens landed with the buyer");

        (, int24 tickAfter,,) = IPoolManager(address(manager)).getSlot0(p.key.toId());
        assertLt(tickAfter, tickBefore, "buying moves the tick DOWN (token gets dearer)");
        assertGe(tickAfter, p.tickLower, "still inside the position range");

        // The position is now in range, so active liquidity is non-zero.
        assertGt(IPoolManager(address(manager)).getLiquidity(p.key.toId()), 0, "position is active");
        assertEq(address(manager).balance, 0.1 ether, "ETH is now in the pool");
    }

    /// Two buys in a row must cost more the second time — the price climbs as supply is
    /// consumed, which is the bonding-curve behaviour the design wants without a curve.
    function test_pricePerTokenRisesAcrossSuccessiveBuys() public {
        address token = _launch(PRICE);
        UniV4LiquidityPlacer.Placement memory p = placer.getPlacement(token);

        TestSwapRouter router = new TestSwapRouter(IPoolManager(address(manager)));
        address buyer = address(0xB0B);
        vm.deal(buyer, 10 ether);

        vm.prank(buyer);
        uint256 firstOut = router.buyWithEth{value: 1 ether}(p.key);
        vm.prank(buyer);
        uint256 secondOut = router.buyWithEth{value: 1 ether}(p.key);

        assertGt(firstOut, 0);
        assertLt(secondOut, firstOut, "the same ETH buys fewer tokens the second time");
    }

    // ------------------------------------------------------------------
    // Access and guards
    // ------------------------------------------------------------------

    /// Only the launchpad may place. Otherwise anyone could drive this contract with
    /// arbitrary tokens and arbitrary prices.
    function test_onlyLaunchpadCanPlace() public {
        vm.prank(address(0xBAD));
        vm.expectRevert(OnlyLaunchpad.selector);
        placer.place(address(0x1234), 1e18, address(0), PRICE * 1e9);
    }

    function test_unlockCallbackRejectsNonPoolManager() public {
        vm.prank(address(0xBAD));
        vm.expectRevert(NotPoolManager.selector);
        placer.unlockCallback("");
    }

    function test_twoLaunchesGetSeparatePools() public {
        address a = _launch(PRICE);
        vm.prank(creator);
        (, address b) = launchpad.launch("Second", "SEC", "", address(0), PRICE * 1e9);

        assertTrue(placer.poolIdOf(a) != placer.poolIdOf(b), "distinct pools");
        assertGt(IERC20(a).balanceOf(address(manager)), 0);
        assertGt(IERC20(b).balanceOf(address(manager)), 0);
    }

    // ------------------------------------------------------------------
    // Pool-initialization gate (anti-DoS)
    // ------------------------------------------------------------------

    /// The attack the gate exists for: the next token's address is predictable, so an
    /// attacker initializes its pool first. With the gate in the key they cannot.
    function test_attackerCannotPreinitializeTheNextLaunchPool() public {
        address nextToken = vm.computeCreateAddress(address(launchpad), vm.getNonce(address(launchpad)));
        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(address(0)),
            currency1: Currency.wrap(nextToken),
            fee: FEE,
            tickSpacing: SPACING,
            hooks: placer.gate()
        });
        vm.prank(address(0xBAD));
        vm.expectRevert();
        manager.initialize(key, TickMath.getSqrtPriceAtTick(0));

        address token = _launch(PRICE);
        assertEq(token, nextToken, "the launch lands on the predicted address and succeeds");
    }

    /// Initializing the hookless key an older placer would have used no longer blocks anything.
    function test_preinitializingTheHooklessPoolDoesNotBlockLaunches() public {
        address nextToken = vm.computeCreateAddress(address(launchpad), vm.getNonce(address(launchpad)));
        PoolKey memory hookless = PoolKey({
            currency0: Currency.wrap(address(0)),
            currency1: Currency.wrap(nextToken),
            fee: FEE,
            tickSpacing: SPACING,
            hooks: IHooks(address(0))
        });
        vm.prank(address(0xBAD));
        manager.initialize(hookless, TickMath.getSqrtPriceAtTick(0));

        assertEq(_launch(PRICE), nextToken);
    }

    function test_launchPoolsAreKeyedWithTheGate() public {
        address token = _launch(PRICE);
        assertEq(address(placer.getPlacement(token).key.hooks), address(placer.gate()));
    }

    function test_placeRevertsUntilAGateIsSet() public {
        UniV4LiquidityPlacer fresh = new UniV4LiquidityPlacer(
            address(manager), address(launchpad), admin, FEE, SPACING, RANGE_WIDTH
        );
        launchpad.setPlacer(address(fresh));
        vm.prank(creator);
        vm.expectRevert(GateNotSet.selector);
        launchpad.launch("Launched", "LNCH", "ipfs://m", address(0), PRICE * 1e9);
    }

    function test_setGateRejectsAnAddressWithoutExactlyTheInitializeBit() public {
        // A gate for this placer, but at an ordinary CREATE address: its low bits are
        // arbitrary, so v4 would not call it (or would call the wrong hooks).
        LaunchPoolGate plain = new LaunchPoolGate(address(placer));
        if (uint160(address(plain)) & uint160((1 << 14) - 1) == uint160(1 << 13)) return; // 1-in-16384 fluke
        vm.expectRevert(abi.encodeWithSelector(InvalidGate.selector, address(plain)));
        placer.setGate(address(plain));
    }

    function test_setGateRejectsAGateForAnotherPlacer() public {
        address foreign = _deployGate(address(0xF00D));
        vm.expectRevert(abi.encodeWithSelector(InvalidGate.selector, foreign));
        placer.setGate(foreign);
    }

    function test_onlyConfigRoleCanSetTheGate() public {
        address gate = _deployGate(address(placer));
        vm.prank(address(0xBAD));
        vm.expectRevert();
        placer.setGate(gate);
    }

    function test_onlyConfigRoleCanSetPoolParams() public {
        vm.prank(address(0xBAD));
        vm.expectRevert();
        placer.setPoolParams(500, 10, 1000);
    }

    function test_configChangeAffectsSubsequentLaunches() public {
        placer.setPoolParams(3000, 60, 12_000);

        address token = _launch(PRICE);
        UniV4LiquidityPlacer.Placement memory p = placer.getPlacement(token);

        assertEq(p.key.fee, 3000);
        assertEq(p.key.tickSpacing, 60);
        assertEq(p.tickUpper % 60, 0, "aligned to the new spacing");
    }

    function test_sweepDustRecoversTheRemainder() public {
        address token = _launch(PRICE);
        uint256 dust = IERC20(token).balanceOf(address(placer));
        vm.assume(dust > 0);

        placer.sweepDust(token, admin);
        assertEq(IERC20(token).balanceOf(address(placer)), 0);
        assertEq(IERC20(token).balanceOf(admin), dust);
    }

    function test_sweepDustRevertsWhenNothingToSweep() public {
        // A real token the placer holds none of. An EOA address would revert inside
        // balanceOf's abi.decode instead, which would pass for the wrong reason.
        LaunchToken unrelated = new LaunchToken("Unrelated", "UNR", 1e18, admin);
        vm.expectRevert(ZeroAmount.selector);
        placer.sweepDust(address(unrelated), admin);
    }
}

/// @dev Minimal ETH->token swapper. Needed because v4 requires all currency movement to
///      happen inside an `unlock` callback, so a buyer cannot call `swap` directly.
contract TestSwapRouter is IUnlockCallback {
    IPoolManager public immutable manager;

    constructor(IPoolManager _manager) {
        manager = _manager;
    }

    /// @notice Spend exactly `msg.value` of ETH buying `key.currency1`.
    function buyWithEth(PoolKey memory key) external payable returns (uint256 tokensOut) {
        bytes memory result = manager.unlock(abi.encode(key, msg.value, msg.sender));
        tokensOut = abi.decode(result, (uint256));
    }

    /// @notice Sell exactly `amount` of `key.currency1` (already transferred to this router) for ETH.
    function sellForEth(PoolKey memory key, uint256 amount) external returns (uint256 ethOut) {
        bytes memory result = manager.unlock(abi.encode(key, amount, msg.sender, true));
        ethOut = abi.decode(result, (uint256));
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        require(msg.sender == address(manager), "not manager");
        if (data.length == 32 * 8) return _sell(data);
        (PoolKey memory key, uint256 ethIn, address recipient) = abi.decode(data, (PoolKey, uint256, address));

        // zeroForOne: ETH (currency0) in, token (currency1) out. Negative amount = exactIn.
        BalanceDelta delta = manager.swap(
            key,
            IPoolManager.SwapParams({
                zeroForOne: true,
                amountSpecified: -int256(ethIn),
                sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
            }),
            ""
        );

        // Pay the ETH we owe.
        uint256 ethOwed = uint256(uint128(-delta.amount0()));
        manager.sync(key.currency0);
        manager.settle{value: ethOwed}();

        // Collect the tokens.
        uint256 tokensOut = uint256(uint128(delta.amount1()));
        manager.take(key.currency1, recipient, tokensOut);

        return abi.encode(tokensOut);
    }

    function _sell(bytes calldata data) private returns (bytes memory) {
        (PoolKey memory key, uint256 tokensIn, address recipient,) = abi.decode(data, (PoolKey, uint256, address, bool));

        // oneForZero: token (currency1) in, ETH (currency0) out. Negative amount = exactIn.
        BalanceDelta delta = manager.swap(
            key,
            IPoolManager.SwapParams({
                zeroForOne: false,
                amountSpecified: -int256(tokensIn),
                sqrtPriceLimitX96: TickMath.MAX_SQRT_PRICE - 1
            }),
            ""
        );

        uint256 tokensOwed = uint256(uint128(-delta.amount1()));
        manager.sync(key.currency1);
        IERC20(Currency.unwrap(key.currency1)).transfer(address(manager), tokensOwed);
        manager.settle();

        uint256 ethOut = uint256(uint128(delta.amount0()));
        manager.take(key.currency0, recipient, ethOut);
        return abi.encode(ethOut);
    }

    receive() external payable {}
}
