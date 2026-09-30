// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "openzeppelin-contracts/contracts/access/AccessControl.sol";
import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "openzeppelin-contracts/contracts/token/ERC20/utils/SafeERC20.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {LaunchPoolGate} from "./LaunchPoolGate.sol";
import {ILiquidityPlacer} from "./ILiquidityPlacer.sol";

error OnlyLaunchpad();
error NotPoolManager();
error ZeroAddress();
error ZeroAmount();
error StartPriceUnreachable(uint256 startPriceWei);
error RangeWidthNotPositive();
error PlacementWouldCostEth(int128 ethDelta);
error LiquidityIsZero();
error GateNotSet();
error InvalidGate(address gate);

/**
 * @title UniV4LiquidityPlacer
 * @notice Places a launched token's whole supply as single-sided concentrated liquidity
 *         in a Uniswap v4 pool, paired against native ETH.
 *
 * @dev There is no bonding curve and no graduation event: the pool is the token's market
 *      from block one (design.md §1.2). Buyers walk the token up through the position's
 *      range exactly as they would walk a curve, so the trading experience is the same
 *      while the protocol carries none of the migration machinery.
 *
 *      ## Orientation (the part that is easy to get backwards)
 *
 *      ETH is `address(0)`, which is numerically smaller than every token address, so
 *      **ETH is always `currency0` and the launch token is always `currency1`.** v4 prices
 *      are `currency1/currency0`, i.e. *token per ETH*. Therefore:
 *
 *      - A HIGH tick means many tokens per ETH — the token is CHEAP.
 *      - Buying the token (ETH in, token out) raises `currency0` and lowers `currency1`,
 *        so it moves the price DOWN and the tick DOWN.
 *      - "Token price goes up" is therefore a FALLING tick.
 *
 *      A position holds only `currency1` when the current tick is at or above its upper
 *      tick. So the position occupies `[tickUpper - width, tickUpper]` and the pool is
 *      initialised exactly AT `tickUpper`. Buyers then walk the tick down through the
 *      range, paying progressively more ETH per token, until at `tickLower` the position
 *      is entirely ETH and every token has been sold.
 *
 *      ## Why one range rather than a staircase of bands
 *
 *      Clanker and Pons both spread liquidity across several bands. A band ladder is a
 *      way to *shape* the curve; it is not needed to have one. A single wide range gives a
 *      continuous, monotonic price curve with less gas, fewer `modifyLiquidity` calls and
 *      no per-band rounding to reason about. Bands remain a straightforward extension —
 *      the range parameters already live in config — and should be added only if there is
 *      a shape we actually want that one range cannot express.
 *
 *      ## Who may initialize the pool
 *
 *      Every launch pool is keyed with `gate`, a `LaunchPoolGate` hook that lets only this
 *      contract initialize it. Without it the pool key is predictable before the token
 *      exists, and one pre-emptive `PoolManager.initialize` would make every later
 *      `place()` revert `PoolAlreadyInitialized` — see `LaunchPoolGate`. `place()` refuses
 *      to run until a gate is set.
 *
 *      ## Dust
 *
 *      Liquidity is an integer, so flooring it leaves a token remainder of at most
 *      `(sqrtB - sqrtA) / 2**96` raw units — around 1e-12 whole tokens at realistic
 *      prices. That remainder stays in this contract. It is genuinely dust, and
 *      `sweepDust` exists so it is recoverable rather than silently stuck.
 */
contract UniV4LiquidityPlacer is ILiquidityPlacer, IUnlockCallback, AccessControl {
    using SafeERC20 for IERC20;

    bytes32 public constant CONFIG_ROLE = keccak256("CONFIG_ROLE");

    uint256 private constant Q96 = 0x1000000000000000000000000;
    /// @dev A whole token, in raw units. Launch tokens are always 18 decimals.
    uint256 private constant WAD = 1e18;

    IPoolManager public immutable poolManager;
    address public immutable launchpad;

    /// @notice Pool fee in hundredths of a bip (10_000 = 1%).
    uint24 public fee;
    /// @notice Tick spacing. Must divide the position's ticks.
    int24 public tickSpacing;
    /// @notice How far below the start price the position extends, in ticks. Sets how far
    ///         the token price can climb before the position is fully sold out.
    ///         ~46_050 ticks is roughly a 100x climb (1.0001**46050).
    int24 public rangeWidthTicks;
    /// @notice The hook every launch pool is keyed with; only it lets this contract
    ///         initialize a pool. Changing it affects future launches only.
    IHooks public gate;

    struct Placement {
        PoolKey key;
        int24 tickLower;
        int24 tickUpper;
        uint128 liquidity;
    }

    mapping(address token => Placement) private _placements;

    event LiquidityPlaced(
        address indexed token,
        PoolId indexed poolId,
        uint256 amount,
        uint256 requestedStartPriceWei,
        int24 tickLower,
        int24 tickUpper,
        uint128 liquidity
    );
    event PoolParamsUpdated(uint24 fee, int24 tickSpacing, int24 rangeWidthTicks);
    event GateUpdated(address indexed gate);
    event DustSwept(address indexed token, address indexed to, uint256 amount);

    /// @dev Encoded through `unlock` so the callback knows what to do.
    struct CallbackData {
        PoolKey key;
        int24 tickLower;
        int24 tickUpper;
        uint128 liquidity;
        address token;
    }

    constructor(
        address _poolManager,
        address _launchpad,
        address admin,
        uint24 _fee,
        int24 _tickSpacing,
        int24 _rangeWidthTicks
    ) {
        if (_poolManager == address(0) || _launchpad == address(0) || admin == address(0)) revert ZeroAddress();
        if (_rangeWidthTicks <= 0) revert RangeWidthNotPositive();

        poolManager = IPoolManager(_poolManager);
        launchpad = _launchpad;
        fee = _fee;
        tickSpacing = _tickSpacing;
        rangeWidthTicks = _rangeWidthTicks;

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(CONFIG_ROLE, admin);
    }

    // ------------------------------------------------------------------
    // Placement
    // ------------------------------------------------------------------

    /// @inheritdoc ILiquidityPlacer
    function place(address token, uint256 amount, uint256 startPriceWei)
        external
        override
        returns (bytes32 placementId)
    {
        if (msg.sender != launchpad) revert OnlyLaunchpad();
        if (token == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        IHooks hooks = gate;
        if (address(hooks) == address(0)) revert GateNotSet();

        int24 spacing = tickSpacing;

        // Ticks are discrete, so the effective start price is the creator's price snapped
        // to the nearest usable tick. `LiquidityPlaced` carries the requested price so the
        // difference is visible off-chain rather than silent.
        int24 tickUpper = _alignedTickForStartPrice(startPriceWei, spacing);
        int24 tickLower = tickUpper - _alignUp(rangeWidthTicks, spacing);

        int24 minTick = TickMath.minUsableTick(spacing);
        if (tickLower < minTick) tickLower = minTick;

        uint160 sqrtLower = TickMath.getSqrtPriceAtTick(tickLower);
        uint160 sqrtUpper = TickMath.getSqrtPriceAtTick(tickUpper);

        // amount1 = L * (sqrtB - sqrtA) / Q96, so L = amount1 * Q96 / (sqrtB - sqrtA).
        // Floors, leaving dust — see the contract docs.
        uint128 liquidity = uint128(FullMath.mulDiv(amount, Q96, uint256(sqrtUpper - sqrtLower)));
        if (liquidity == 0) revert LiquidityIsZero();

        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(address(0)), // native ETH, always currency0
            currency1: Currency.wrap(token),
            fee: fee,
            tickSpacing: spacing,
            hooks: hooks
        });

        // Initialising exactly AT tickUpper is what makes the position single-sided: a
        // position is entirely currency1 when the current tick is at or above its upper
        // tick, so the pool owes us no ETH.
        poolManager.initialize(key, sqrtUpper);

        poolManager.unlock(
            abi.encode(
                CallbackData({key: key, tickLower: tickLower, tickUpper: tickUpper, liquidity: liquidity, token: token})
            )
        );

        _placements[token] =
            Placement({key: key, tickLower: tickLower, tickUpper: tickUpper, liquidity: liquidity});

        PoolId poolId = key.toId();
        emit LiquidityPlaced(token, poolId, amount, startPriceWei, tickLower, tickUpper, liquidity);

        return PoolId.unwrap(poolId);
    }

    /// @inheritdoc IUnlockCallback
    function unlockCallback(bytes calldata data) external override returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert NotPoolManager();

        CallbackData memory cb = abi.decode(data, (CallbackData));

        (BalanceDelta delta,) = poolManager.modifyLiquidity(
            cb.key,
            IPoolManager.ModifyLiquidityParams({
                tickLower: cb.tickLower,
                tickUpper: cb.tickUpper,
                liquidityDelta: int256(uint256(cb.liquidity)),
                salt: bytes32(0)
            }),
            ""
        );

        // The whole point of single-sided placement: we must owe no ETH. If we do, the
        // orientation or the starting tick is wrong, and paying it would silently drain
        // this contract, so fail loudly instead.
        int128 ethDelta = delta.amount0();
        if (ethDelta != 0) revert PlacementWouldCostEth(ethDelta);

        // Settle what we owe in the token. Negative delta means we owe the pool.
        int128 tokenDelta = delta.amount1();
        if (tokenDelta < 0) {
            uint256 owed = uint256(uint128(-tokenDelta));
            poolManager.sync(cb.key.currency1);
            IERC20(cb.token).safeTransfer(address(poolManager), owed);
            poolManager.settle();
        }

        return "";
    }

    // ------------------------------------------------------------------
    // Views
    // ------------------------------------------------------------------

    function getPlacement(address token) external view returns (Placement memory) {
        return _placements[token];
    }

    /// @notice The pool a launched token trades in, for indexers and the UI.
    function poolIdOf(address token) external view returns (bytes32) {
        Placement memory p = _placements[token];
        if (Currency.unwrap(p.key.currency1) == address(0)) return bytes32(0);
        return PoolId.unwrap(p.key.toId());
    }

    // ------------------------------------------------------------------
    // Internals
    // ------------------------------------------------------------------

    /**
     * @dev The tick whose price corresponds to `startPriceWei` wei of ETH per whole token,
     *      floored to a multiple of `spacing`.
     *
     *      v4's price is currency1/currency0 in RAW units, i.e. token-raw per wei:
     *          price = 1e18 / startPriceWei
     *      and sqrtPriceX96 = sqrt(price) * 2**96 = sqrt(price << 192).
     *
     *      `1e18 << 192` is about 2**252, so it fits in a uint256 without any scaling
     *      tricks even at the minimum price of 1 wei per token.
     */
    function _alignedTickForStartPrice(uint256 startPriceWei, int24 spacing) internal pure returns (int24) {
        if (startPriceWei == 0) revert StartPriceUnreachable(0);

        uint256 ratioX192 = FullMath.mulDiv(WAD, 1 << 192, startPriceWei);
        uint256 sqrtPrice = _sqrt(ratioX192);

        if (sqrtPrice < TickMath.MIN_SQRT_PRICE || sqrtPrice >= TickMath.MAX_SQRT_PRICE) {
            revert StartPriceUnreachable(startPriceWei);
        }

        int24 tick = TickMath.getTickAtSqrtPrice(uint160(sqrtPrice));
        return _alignDown(tick, spacing);
    }

    /// @dev Floors toward negative infinity so the result is always a usable tick.
    function _alignDown(int24 tick, int24 spacing) internal pure returns (int24) {
        int24 aligned = (tick / spacing) * spacing;
        if (tick < 0 && aligned != tick) aligned -= spacing;
        return aligned;
    }

    /// @dev Rounds a positive width up to a whole number of spacings, so the range is
    ///      never narrower than configured.
    function _alignUp(int24 width, int24 spacing) internal pure returns (int24) {
        int24 aligned = (width / spacing) * spacing;
        if (aligned != width) aligned += spacing;
        return aligned;
    }

    /// @dev Babylonian integer square root.
    function _sqrt(uint256 x) internal pure returns (uint256 y) {
        if (x == 0) return 0;
        uint256 z = (x + 1) / 2;
        y = x;
        while (z < y) {
            y = z;
            z = (x / z + z) / 2;
        }
    }

    // ------------------------------------------------------------------
    // Config
    // ------------------------------------------------------------------

    function setPoolParams(uint24 _fee, int24 _tickSpacing, int24 _rangeWidthTicks) external onlyRole(CONFIG_ROLE) {
        if (_rangeWidthTicks <= 0) revert RangeWidthNotPositive();
        fee = _fee;
        tickSpacing = _tickSpacing;
        rangeWidthTicks = _rangeWidthTicks;
        emit PoolParamsUpdated(_fee, _tickSpacing, _rangeWidthTicks);
    }

    /// @notice Set the pool-initialization gate. It must be a `LaunchPoolGate` for this
    ///         placer, deployed at an address whose hook bits are exactly before-initialize.
    function setGate(address _gate) external onlyRole(CONFIG_ROLE) {
        if (_gate == address(0)) revert ZeroAddress();
        if (uint160(_gate) & Hooks.ALL_HOOK_MASK != Hooks.BEFORE_INITIALIZE_FLAG) revert InvalidGate(_gate);
        if (LaunchPoolGate(_gate).placer() != address(this)) revert InvalidGate(_gate);
        gate = IHooks(_gate);
        emit GateUpdated(_gate);
    }

    /// @notice Recover the rounding remainder described in the contract docs.
    /// @dev Only reachable for tokens this contract still holds a balance of, which after
    ///      a successful placement is dust by construction.
    function sweepDust(address token, address to) external onlyRole(CONFIG_ROLE) {
        if (to == address(0)) revert ZeroAddress();
        uint256 balance = IERC20(token).balanceOf(address(this));
        if (balance == 0) revert ZeroAmount();
        IERC20(token).safeTransfer(to, balance);
        emit DustSwept(token, to, balance);
    }
}
