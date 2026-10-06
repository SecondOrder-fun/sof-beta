// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "openzeppelin-contracts/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "openzeppelin-contracts/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "openzeppelin-contracts/contracts/token/ERC20/utils/SafeERC20.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency, CurrencyLibrary} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {
    BeforeSwapDelta,
    BeforeSwapDeltaLibrary,
    toBeforeSwapDelta
} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";
import {SafeCast} from "@uniswap/v4-core/src/libraries/SafeCast.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {ILiquidityPlacer} from "./ILiquidityPlacer.sol";

/// @dev The launchpad view the placer reads to find a launch's creator.
interface ILaunchCreators {
    function creatorOf(address token) external view returns (address);
}

error OnlyLaunchpad();
error NotPoolManager();
error ZeroAddress();
error ZeroAmount();
error StartFdvUnreachable(uint256 startFdv);
error TickSpacingOutOfRange(int24 tickSpacing);
error TradeFeeOutOfRange(uint24 tradeFee, uint24 min, uint24 max);
error PlacementWouldCostQuote(int128 quoteDelta);
error LiquidityIsZero();
error NotThisPlacer(address initializer);
error NoPlacement(address token);
error FeeTreasuryNotSet();
error NotFeeRecipient(address caller);
error NothingToClaim();
error QuoteIsLaunchToken(address token);
error LiquidityOverflow(uint256 liquidity);
error UnknownPool(PoolId poolId);

/// @dev UniV4LiquidityPlacer's hook permission bits, at file level so a deploy script can
///      mine an address for them before the contract exists.
uint160 constant PLACER_HOOK_FLAGS = Hooks.BEFORE_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG
    | Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG | Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG;
error SwapTooSmallForFee(uint256 amount);
error PartialFillWithFee(uint256 filled, uint256 expected);
error SnipeTaxOutOfRange(uint16 startBps, uint16 duration);
error UnknownLiquidityPreset(uint8 preset);

/**
 * @title UniV4LiquidityPlacer
 * @notice Places a launched token's whole supply as single-sided liquidity in a Uniswap
 *         v4 pool, paired against its quote token (native ETH or an ERC-20 on the
 *         launchpad's allowlist), and is that pool's hook: it lets only itself initialize
 *         the pool, and takes the launch's trade fee on every swap, in the quote token.
 *
 * @dev There is no bonding curve and no graduation event: the pool is the token's market
 *      from block one (design.md §1.2). Buyers walk the token up through the position's
 *      range exactly as they would walk a curve, so the trading experience is the same
 *      while the protocol carries none of the migration machinery.
 *
 *      ## Orientation (the part that is easy to get backwards)
 *
 *      v4 sorts a pool's two currencies by address and prices it as `currency1/currency0`
 *      in raw units. Which side the launch token lands on depends on its quote token:
 *
 *      **Quote is currency0** — always for ETH (`address(0)` sorts below every token), and
 *      for an ERC-20 whose address is below the launch token's. Price is *token per
 *      quote*, so a HIGH tick means a CHEAP token, and buying (quote in, token out) moves
 *      the tick DOWN. A position holds only `currency1` (the token) when the current tick
 *      is at or above its upper tick, so the position is `[minUsableTick, tickUpper]` and
 *      the pool starts AT `tickUpper`. Buyers walk the tick down from there.
 *
 *      **Token is currency0** — an ERC-20 quote whose address is above the launch token's.
 *      Price is *quote per token*, so a HIGH tick means an EXPENSIVE token and buying
 *      moves the tick UP. A position holds only `currency0` (the token) when the current
 *      tick is at or below its lower tick, so the position is `[tickLower, maxUsableTick]`
 *      and the pool starts AT `tickLower`. Buyers walk the tick up from there.
 *
 *      Either way the pool starts exactly at the edge where it owes no quote token.
 *      `Placement.tokenIsCurrency0` records the case; the router reads it to pick the
 *      swap direction and the edge a swap may not cross.
 *
 *      ## Liquidity presets: how the supply is spread along the price scale
 *
 *      The creator picks one of four fixed ladders (`liquidityPreset`). Each is one to
 *      three single-sided positions laid end to end from the starting price, with a share
 *      of the supply in each; the LAST always runs to v4's last usable tick, so a token
 *      never sells out under any preset and no route can strand the pool in an empty range.
 *
 *        0 Classic       100% from 1x to the end of the scale.
 *        1 Steady start  30% 1x-3x, 55% 3x-30x, 15% 30x onward: a light front so the opening
 *                        is not jumpy, then a deep middle where a project settles.
 *        2 Thick middle  15% 1x-3x, 55% 3x-30x, 30% 30x onward: the calmest from 3x up, a
 *                        fast first climb.
 *        3 Wide open     40% 1x-2x, 60% 2x onward: deep at the launch price, thinner later.
 *
 *      Multiples are of the starting price, written as tick offsets (2x = 6,932 ticks,
 *      3x = 10,987, 30x = 34,013 — ln(m)/ln(1.0001)) and snapped to the tick spacing, so a
 *      boundary lands within half a spacing (~1%) of its multiple. The supply is a fixed
 *      budget: a preset deeper than Classic somewhere is thinner somewhere else
 *      (docs/05-features/launchpad/design.md §5.9). Custom ladders are not supported.
 *
 *      `Placement.tickLower/tickUpper` span the whole ladder (the router's price limits)
 *      and `Placement.liquidity` is the launch-price position's; `bandsOf(token)` lists
 *      every position for quoting.
 *
 *      ## This contract is the pool's hook
 *
 *      Every launch pool is keyed with `hooks = this`. v4 reads a hook's permissions from
 *      the low 14 bits of its address, so this contract is deployed (CREATE2, salt mined by
 *      `HookMiner`) at an address whose flag bits are exactly `HOOK_FLAGS`; the constructor
 *      checks it.
 *
 *      - `beforeInitialize` lets only this contract initialize a pool keyed with it. The
 *        next launch token's address is predictable from the launchpad's CREATE nonce, so
 *        without the check anyone could initialize that pool first and block every later
 *        launch for good (a failed launch never advances the nonce).
 *      - `beforeSwap` / `afterSwap` take the trade fee (below).
 *
 *      ## Trade fee: in the quote token only, on every swap
 *
 *      Launch pools have a ZERO LP fee. The fee is the hook's instead, at a rate the
 *      creator chose at launch (`Placement.tradeFee`, pips: 10_000 = 1%, at most
 *      `MAX_TRADE_FEE` = 10%, fixed for the pool's life) and always charged in the QUOTE
 *      token — on buys and sells alike, through any router, since v4 calls the hook for
 *      every swap. Nobody is paid in launch tokens: the creator is never handed their own
 *      token to sell, and the treasury never accumulates one coin per launch.
 *
 *      The fee is `tradeFee` of the GROSS quote flow: what a buyer pays in, or what the
 *      pool pays out to a seller before the fee. Where it is taken depends on which side
 *      of the swap the caller fixed (v4: `amountSpecified < 0` is exact input):
 *
 *        quote specified (exact-in buy, exact-out sell) — `beforeSwap` returns the fee as
 *          a specified-currency delta, which v4 applies to the amount actually swapped:
 *          an exact-in buy of X swaps `X - fee`; an exact-out sell of Y has the pool pay
 *          out `Y + fee`. fee = X * rate (in), or Y * rate / (1 - rate) (out).
 *        quote unspecified (exact-in sell, exact-out buy) — `afterSwap` returns the fee as
 *          an unspecified-currency delta once the pool's quote amount is known: the seller
 *          receives `out - fee`, the buyer pays `in + fee`. fee = out * rate (in), or
 *          in * rate / (1 - rate) (out).
 *
 *      Every fee rounds UP, so a swap can never pay less than its rate. Either way v4
 *      credits the hook the fee; `afterSwap` turns that credit into ERC-6909 claims on the
 *      PoolManager (`mint`, no token transfer per swap), adds it to the launch's
 *      `pendingFees`, and emits `TradeFeeTaken` and the standard `HookFee` right after the
 *      PoolManager's `Swap` log (whose amounts exclude hook deltas) and that mint's ERC-6909
 *      `Transfer`. `claim` burns the claims and has the
 *      PoolManager pay the claimant directly.
 *
 *      `collectFees(token)` is permissionless: it moves a launch's pending fees into the
 *      claimable balances, `CREATOR_FEE_BPS` (88%) to the launch's fee recipient and the
 *      rest to `feeTreasury`. Balances are per currency (`claimable[currency][account]`,
 *      `address(0)` = ETH), so one claim pays a recipient's fees from every launch paired
 *      with that currency. The fee recipient starts as the launch's creator and only the
 *      current recipient can hand it on (`setFeeRecipient`); shares are fixed when fees
 *      are collected, so changing the recipient or the treasury later does not move fees
 *      already credited.
 *
 *      ## Snipe tax: a decaying surcharge on early buys
 *
 *      Bots buy in the first block of every launch. For `snipeDuration` seconds after a
 *      launch, a BUY pays a higher rate that falls in a straight line from `snipeStartBps`
 *      to the launch's own trade fee; after the window it is the trade fee alone. Sells
 *      never pay it, so nobody is trapped. The schedule is CONFIG_ROLE's (`setSnipeTax`,
 *      start at most 99%, window at most an hour) and is copied into each pool when it is
 *      placed, so a later change never touches a live launch.
 *
 *      The part above the trade fee — the surcharge — goes entirely to the treasury
 *      (`pendingSurcharge`). Split 88/12 like the fee, a creator could snipe their own
 *      launch and get most of the tax back. The creator's first buy inside the launch
 *      transaction is exempt (`exemptNextBuy`, launchpad-only, a transient flag the next
 *      buy in the same transaction consumes): it happens before anyone else can trade, so
 *      it is not a snipe.
 *
 *      A swap made by this contract itself would skip the hook (v4 never calls a hook for
 *      its own swaps); it makes none.
 *
 *      ## Dust
 *
 *      Liquidity is an integer, so flooring it leaves a token remainder of a few raw units
 *      — around 1e-12 whole tokens at realistic prices — in this contract. It is never
 *      swept: launch tokens belong to their launches, not to the platform.
 */
contract UniV4LiquidityPlacer is ILiquidityPlacer, IUnlockCallback, AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using CurrencyLibrary for Currency;

    bytes32 public constant CONFIG_ROLE = keccak256("CONFIG_ROLE");

    /// @notice The hook permissions this contract's address must carry, and no others.
    uint160 public constant HOOK_FLAGS = PLACER_HOOK_FLAGS;

    uint256 private constant Q96 = 0x1000000000000000000000000;
    /// @dev The currency address v4 uses for native ETH.
    address private constant NATIVE = address(0);
    /// @dev Fee rates are in pips: 1_000_000 = 100%.
    uint24 private constant PIPS = 1_000_000;

    IPoolManager public immutable poolManager;
    address public immutable launchpad;

    /// @notice The highest trade fee a launch may choose: 10%. Compiled in, so no
    ///         configuration can allow a punitive market.
    uint24 public constant MAX_TRADE_FEE = 100_000;
    /// @notice The widest tick spacing CONFIG_ROLE may set (v4's own maximum).
    int24 public constant MAX_TICK_SPACING = TickMath.MAX_TICK_SPACING;

    /// @notice The lowest trade fee a new launch may choose, in pips. CONFIG_ROLE.
    uint24 public minTradeFee;
    /// @notice Tick spacing for new launch pools. Must divide the position's ticks.
    int24 public tickSpacing;

    struct Placement {
        PoolKey key;
        int24 tickLower;
        int24 tickUpper;
        uint128 liquidity;
        /// @dev True when the launch token sorts below its quote token. See "Orientation".
        bool tokenIsCurrency0;
        /// @dev The pool's trade fee in pips, charged in the quote token. See "Trade fee".
        uint24 tradeFee;
        /// @dev Which ladder the supply was placed with. See "Liquidity presets".
        uint8 liquidityPreset;
    }

    /// @notice One position of a launch's ladder.
    struct Band {
        int24 tickLower;
        int24 tickUpper;
        uint128 liquidity;
    }

    mapping(address token => Band[]) private _bands;

    uint8 public constant PRESET_CLASSIC = 0;
    uint8 public constant PRESET_STEADY_START = 1;
    uint8 public constant PRESET_THICK_MIDDLE = 2;
    uint8 public constant PRESET_WIDE_OPEN = 3;
    uint8 public constant PRESET_COUNT = 4;

    /// @dev Ticks from the starting price to 2x, 3x and 30x (ln(m) / ln(1.0001), rounded).
    uint24 private constant TICKS_2X = 6_932;
    uint24 private constant TICKS_3X = 10_987;
    uint24 private constant TICKS_30X = 34_013;

    mapping(address token => Placement) private _placements;

    /// @dev What the swap hooks need, in one slot, keyed by the pool they are called for.
    struct PoolFee {
        address token;
        uint24 tradeFee;
        bool quoteIsCurrency0;
        /// @dev When the pool was placed, for the snipe window.
        uint32 launchedAt;
        /// @dev The snipe surcharge's starting rate in basis points, and its window in
        ///      seconds — copied from the config at placement. Zero window: none.
        uint16 snipeStartBps;
        uint16 snipeDuration;
    }

    mapping(PoolId poolId => PoolFee) private _poolFees;

    /// @notice The fee recipient's share of every collection, in basis points (88%).
    uint256 public constant CREATOR_FEE_BPS = 8_800;
    uint256 private constant BPS = 10_000;

    /// @notice Receives the platform's share (12%) of collected fees.
    address public feeTreasury;

    /// @dev token => fee recipient; zero means the launch's creator.
    mapping(address token => address) private _feeRecipients;

    /// @notice Trade fees taken in a launch's pool and not yet collected, in its quote
    ///         token's raw units.
    mapping(address token => uint256) public pendingFees;

    /// @notice Snipe surcharges taken in a launch's pool and not yet collected, in its quote
    ///         token's raw units. All of it goes to the treasury.
    mapping(address token => uint256) public pendingSurcharge;

    /// @notice The highest snipe-tax starting rate CONFIG_ROLE may set: 99%, so an exact-in
    ///         buy always swaps something.
    uint16 public constant MAX_SNIPE_START_BPS = 9_900;
    /// @notice The longest snipe window CONFIG_ROLE may set: one hour.
    uint16 public constant MAX_SNIPE_DURATION = 3_600;
    /// @notice The snipe surcharge's starting rate (bps) for future launches.
    uint16 public snipeStartBps;
    /// @notice The snipe window (seconds) for future launches; zero disables the tax.
    uint16 public snipeDuration;

    /// @dev Transient-storage seed for the creator's exempt launch buy, per token.
    bytes32 private constant EXEMPT_BUY_SEED = keccak256("UniV4LiquidityPlacer.exemptNextBuy");

    /// @notice Collected fees not yet claimed, per quote currency (`address(0)` = ETH) and
    ///         account. Each currency's balance pools every launch paired with it.
    mapping(address currency => mapping(address account => uint256)) public claimable;

    event LiquidityPlaced(
        address indexed token,
        PoolId indexed poolId,
        address indexed quoteToken,
        uint256 amount,
        uint256 requestedStartFdv,
        int24 tickLower,
        int24 tickUpper,
        uint128 liquidity,
        bool tokenIsCurrency0,
        uint24 tradeFee,
        uint8 liquidityPreset
    );
    /// @notice One per fee-paying swap, emitted after the PoolManager's `Swap` log for it
    ///         (and the fee's ERC-6909 mint). `fee` is in the quote token; the trader paid `Swap`'s quote
    ///         amount plus `fee` on a buy and received it minus `fee` on a sell.
    ///         `snipeSurcharge` is the part of `fee` above the launch's trade fee (an early
    ///         buy's snipe tax), which goes to the treasury alone.
    event TradeFeeTaken(PoolId indexed poolId, address indexed token, uint256 fee, uint256 snipeSurcharge);
    /// @notice The Uniswap Foundation's standard hook-fee event (as in OpenZeppelin's
    ///         uniswap-hooks), for explorers and hook indexers. `sender` is the router.
    event HookFee(bytes32 indexed poolId, address indexed sender, uint128 feeAmount0, uint128 feeAmount1);
    event TickSpacingUpdated(int24 tickSpacing);
    event MinTradeFeeUpdated(uint24 minTradeFee);
    event SnipeTaxUpdated(uint16 startBps, uint16 duration);
    /// @dev `fees` includes `snipeSurcharge`; the treasury got `fees - recipientShare`.
    event FeesCollected(
        address indexed token,
        address indexed recipient,
        address indexed quoteToken,
        uint256 fees,
        uint256 recipientShare,
        uint256 snipeSurcharge
    );
    event FeeRecipientUpdated(address indexed token, address indexed previous, address indexed current);
    event FeeTreasuryUpdated(address indexed treasury);
    event FeesClaimed(address indexed account, address indexed currency, address to, uint256 amount);

    uint8 private constant ACTION_PLACE = 0;
    uint8 private constant ACTION_CLAIM = 1;

    /// @dev Encoded through `unlock` for a placement.
    struct PlaceData {
        PoolKey key;
        Band[] bands;
        address token;
        bool tokenIsCurrency0;
    }

    /// @dev Encoded through `unlock` for a claim.
    struct ClaimData {
        Currency currency;
        address to;
        uint256 amount;
    }

    constructor(address _poolManager, address _launchpad, address admin, int24 _tickSpacing, uint24 _minTradeFee) {
        if (_poolManager == address(0) || _launchpad == address(0) || admin == address(0)) revert ZeroAddress();
        _checkTickSpacing(_tickSpacing);
        _checkMinTradeFee(_minTradeFee);
        // Reverts unless this address carries exactly HOOK_FLAGS.
        Hooks.validateHookPermissions(IHooks(address(this)), _hookPermissions());

        poolManager = IPoolManager(_poolManager);
        launchpad = _launchpad;
        tickSpacing = _tickSpacing;
        minTradeFee = _minTradeFee;

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(CONFIG_ROLE, admin);
    }

    /// @notice The permissions `HOOK_FLAGS` encodes, in v4's struct form.
    function getHookPermissions() external pure returns (Hooks.Permissions memory) {
        return _hookPermissions();
    }

    // ------------------------------------------------------------------
    // Placement
    // ------------------------------------------------------------------

    /// @inheritdoc ILiquidityPlacer
    function place(
        address token,
        uint256 amount,
        address quoteToken,
        uint256 startFdv,
        uint24 tradeFee,
        uint8 liquidityPreset
    ) external override returns (bytes32 placementId) {
        if (msg.sender != launchpad) revert OnlyLaunchpad();
        if (token == address(0)) revert ZeroAddress();
        if (quoteToken == token) revert QuoteIsLaunchToken(token);
        if (amount == 0) revert ZeroAmount();
        if (tradeFee < minTradeFee || tradeFee > MAX_TRADE_FEE) {
            revert TradeFeeOutOfRange(tradeFee, minTradeFee, MAX_TRADE_FEE);
        }
        if (liquidityPreset >= PRESET_COUNT) revert UnknownLiquidityPreset(liquidityPreset);

        int24 spacing = tickSpacing;
        bool tokenIsCurrency0 = token < quoteToken;

        // Ticks are discrete, so the effective start price is the creator's valuation
        // snapped to a usable tick, rounding toward the dearer side: the token opens at or
        // slightly above the requested valuation (within one tick spacing, ~2%), never
        // cheaper than its creator chose. `LiquidityPlaced` carries the requested
        // valuation so the difference is visible off-chain rather than silent.
        // The starting tick, and the edge of the price scale the ladder runs out to.
        int24 startTick;
        int24 edgeTick;
        if (tokenIsCurrency0) {
            // Price is quote per token here, so dearer is a HIGHER tick: round up.
            uint256 sqrtStart = _sqrtPriceQuotePerToken(startFdv, amount);
            int24 tick = _tickForSqrtPrice(sqrtStart, startFdv);
            if (TickMath.getSqrtPriceAtTick(tick) < sqrtStart) tick += 1;
            startTick = _alignUpTick(tick, spacing);
            edgeTick = TickMath.maxUsableTick(spacing);
        } else {
            // Price is token per quote here, so dearer is a LOWER tick. getTickAtSqrtPrice
            // already floors; aligning down keeps rounding that way.
            startTick = _alignDown(_tickForSqrtPrice(_sqrtPriceTokenPerQuote(startFdv, amount), startFdv), spacing);
            edgeTick = TickMath.minUsableTick(spacing);
        }
        Band[] memory bands = _ladder(liquidityPreset, startTick, edgeTick, spacing, tokenIsCurrency0, amount, startFdv);
        // The whole ladder's span, for the router's price limits.
        int24 tickLower = tokenIsCurrency0 ? startTick : edgeTick;
        int24 tickUpper = tokenIsCurrency0 ? edgeTick : startTick;
        // The pool starts exactly at the ladder's token-only edge, so it owes no quote token.
        uint160 startSqrtPrice = TickMath.getSqrtPriceAtTick(startTick);

        // LP fee zero: the trade fee is this hook's, in the quote token only.
        PoolKey memory key = tokenIsCurrency0
            ? PoolKey({
                currency0: Currency.wrap(token),
                currency1: Currency.wrap(quoteToken),
                fee: 0,
                tickSpacing: spacing,
                hooks: IHooks(address(this))
            })
            : PoolKey({
                currency0: Currency.wrap(quoteToken),
                currency1: Currency.wrap(token),
                fee: 0,
                tickSpacing: spacing,
                hooks: IHooks(address(this))
            });
        PoolId poolId = key.toId();

        // Registered before initialize, so a swap can never find the pool unpriced.
        _poolFees[poolId] = PoolFee({
            token: token,
            tradeFee: tradeFee,
            quoteIsCurrency0: !tokenIsCurrency0,
            launchedAt: uint32(block.timestamp),
            snipeStartBps: snipeStartBps,
            snipeDuration: snipeDuration
        });

        // Starting exactly at the token-only edge of the range is what makes the position
        // single-sided, so the pool owes us no quote token.
        poolManager.initialize(key, startSqrtPrice);

        poolManager.unlock(
            abi.encode(
                ACTION_PLACE,
                abi.encode(PlaceData({key: key, bands: bands, token: token, tokenIsCurrency0: tokenIsCurrency0}))
            )
        );

        _placements[token] = Placement({
            key: key,
            tickLower: tickLower,
            tickUpper: tickUpper,
            liquidity: bands[0].liquidity,
            tokenIsCurrency0: tokenIsCurrency0,
            tradeFee: tradeFee,
            liquidityPreset: liquidityPreset
        });
        Band[] storage stored = _bands[token];
        for (uint256 i; i < bands.length; ++i) {
            stored.push(bands[i]);
        }

        emit LiquidityPlaced(
            token,
            poolId,
            quoteToken,
            amount,
            startFdv,
            tickLower,
            tickUpper,
            bands[0].liquidity,
            tokenIsCurrency0,
            tradeFee,
            liquidityPreset
        );

        return PoolId.unwrap(poolId);
    }

    /// @inheritdoc IUnlockCallback
    function unlockCallback(bytes calldata data) external override returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert NotPoolManager();

        (uint8 action, bytes memory payload) = abi.decode(data, (uint8, bytes));
        if (action == ACTION_CLAIM) {
            ClaimData memory c = abi.decode(payload, (ClaimData));
            // Burning claims credits this contract; the take pays it out. Net zero.
            poolManager.burn(address(this), c.currency.toId(), c.amount);
            poolManager.take(c.currency, c.to, c.amount);
            return "";
        }

        PlaceData memory cb = abi.decode(payload, (PlaceData));
        uint256 owed;
        for (uint256 i; i < cb.bands.length; ++i) {
            (BalanceDelta delta,) = poolManager.modifyLiquidity(
                cb.key,
                IPoolManager.ModifyLiquidityParams({
                    tickLower: cb.bands[i].tickLower,
                    tickUpper: cb.bands[i].tickUpper,
                    liquidityDelta: int256(uint256(cb.bands[i].liquidity)),
                    salt: bytes32(0)
                }),
                ""
            );

            // The whole point of single-sided placement: we must owe no quote token. If we
            // do, the orientation or a band's ticks are wrong, and paying it would silently
            // drain this contract, so fail loudly instead.
            (int128 tokenDelta, int128 quoteDelta) =
                cb.tokenIsCurrency0 ? (delta.amount0(), delta.amount1()) : (delta.amount1(), delta.amount0());
            if (quoteDelta != 0) revert PlacementWouldCostQuote(quoteDelta);
            // Negative delta means we owe the pool.
            if (tokenDelta < 0) owed += uint256(uint128(-tokenDelta));
        }

        // Settle what the whole ladder owes in the token, once.
        if (owed != 0) {
            poolManager.sync(Currency.wrap(cb.token));
            IERC20(cb.token).safeTransfer(address(poolManager), owed);
            poolManager.settle();
        }

        return "";
    }

    // ------------------------------------------------------------------
    // Hook
    // ------------------------------------------------------------------

    /// @notice v4's before-initialize hook: only this contract may initialize a pool
    ///         keyed with it. `sender` is whoever called `PoolManager.initialize`.
    function beforeInitialize(address sender, PoolKey calldata, uint160) external view returns (bytes4) {
        if (msg.sender != address(poolManager)) revert NotPoolManager();
        if (sender != address(this)) revert NotThisPlacer(sender);
        return IHooks.beforeInitialize.selector;
    }

    /// @notice v4's before-swap hook: takes the fee when the caller fixed the QUOTE side
    ///         (exact-in buy, exact-out sell), as a delta on the specified amount.
    function beforeSwap(address, PoolKey calldata key, IPoolManager.SwapParams calldata params, bytes calldata)
        external
        view
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        if (msg.sender != address(poolManager)) revert NotPoolManager();
        PoolFee memory pf = _poolFee(key);
        uint24 rate = _swapRate(pf, params);
        if (rate == 0 || !_quoteIsSpecified(pf, params)) {
            return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
        }
        uint256 fee = _feeOnSpecified(rate, params.amountSpecified);
        // The fee rounds up, so an exact-in payment of a raw unit or so could be all fee
        // and swap nothing. Refuse it rather than charge for no trade.
        if (params.amountSpecified < 0 && fee >= uint256(-params.amountSpecified)) {
            revert SwapTooSmallForFee(uint256(-params.amountSpecified));
        }
        return (IHooks.beforeSwap.selector, toBeforeSwapDelta(SafeCast.toInt128(fee), 0), 0);
    }

    /// @notice v4's after-swap hook: takes the fee when the caller fixed the TOKEN side
    ///         (exact-in sell, exact-out buy), as a delta on the quote amount, and realizes
    ///         and records the fee in every case.
    function afterSwap(
        address sender,
        PoolKey calldata key,
        IPoolManager.SwapParams calldata params,
        BalanceDelta delta,
        bytes calldata
    ) external returns (bytes4, int128) {
        if (msg.sender != address(poolManager)) revert NotPoolManager();
        PoolFee memory pf = _poolFee(key);
        uint24 rate = _swapRate(pf, params);
        // The exemption covers one buy: this one, whichever it was.
        if (_isBuy(pf, params)) _clearExemptBuy(pf.token);
        if (rate == 0) return (IHooks.afterSwap.selector, 0);

        uint256 fee;
        uint256 baseFee;
        int128 unspecifiedDelta;
        // The pool's own quote amount, before any hook delta.
        int128 quoteDelta = pf.quoteIsCurrency0 ? delta.amount0() : delta.amount1();
        uint256 quoteAmount = uint256(uint128(quoteDelta < 0 ? -quoteDelta : quoteDelta));
        if (_quoteIsSpecified(pf, params)) {
            // Taken in beforeSwap; the same inputs give the same amount here. That fee was
            // priced on the whole requested amount, so a fill that stopped short (a price
            // limit) would overcharge: require the pool to have swapped exactly the
            // adjusted amount — `X - fee` in, or `Y + fee` out.
            fee = _feeOnSpecified(rate, params.amountSpecified);
            baseFee = _feeOnSpecified(pf.tradeFee, params.amountSpecified);
            uint256 expected = params.amountSpecified < 0
                ? uint256(-params.amountSpecified) - fee
                : uint256(params.amountSpecified) + fee;
            if (quoteAmount != expected) revert PartialFillWithFee(quoteAmount, expected);
        } else {
            // What the pool paid a seller (exact-in) or charged a buyer (exact-out).
            fee = _feeOnUnspecified(rate, params.amountSpecified, quoteAmount);
            baseFee = _feeOnUnspecified(pf.tradeFee, params.amountSpecified, quoteAmount);
            unspecifiedDelta = SafeCast.toInt128(fee);
        }
        if (fee == 0) return (IHooks.afterSwap.selector, unspecifiedDelta);

        // v4 credits this contract `fee` for the returned delta; settle that credit as
        // ERC-6909 claims rather than moving tokens on every swap.
        Currency quote = pf.quoteIsCurrency0 ? key.currency0 : key.currency1;
        poolManager.mint(address(this), quote.toId(), fee);
        // A higher rate on the same amount never rounds to a smaller fee, so this is >= 0.
        uint256 surcharge = fee - baseFee;
        pendingFees[pf.token] += baseFee;
        if (surcharge != 0) pendingSurcharge[pf.token] += surcharge;
        PoolId poolId = key.toId();
        emit TradeFeeTaken(poolId, pf.token, fee, surcharge);
        (uint128 fee0, uint128 fee1) = pf.quoteIsCurrency0 ? (uint128(fee), uint128(0)) : (uint128(0), uint128(fee));
        emit HookFee(PoolId.unwrap(poolId), sender, fee0, fee1);

        return (IHooks.afterSwap.selector, unspecifiedDelta);
    }

    // ------------------------------------------------------------------
    // Trade fees
    // ------------------------------------------------------------------

    /**
     * @notice Move a launch's pending trade fees into the claimable balances, 88% to its
     *         fee recipient and 12% to the treasury, plus any snipe surcharge to the
     *         treasury alone.
     * @dev Permissionless: anyone may trigger it, and it only ever moves fees into those
     *      two balances. Collecting when nothing is pending credits zero.
     * @return fees the quote-token amount collected, surcharge included, in its raw units
     *         (wei for ETH)
     */
    function collectFees(address token) external nonReentrant returns (uint256 fees) {
        Placement storage p = _placements[token];
        if (p.liquidity == 0) revert NoPlacement(token);
        address treasury = feeTreasury;
        if (treasury == address(0)) revert FeeTreasuryNotSet();
        address recipient = feeRecipientOf(token);
        address quote = _quoteOf(p);

        uint256 tradeFees = pendingFees[token];
        uint256 surcharge = pendingSurcharge[token];
        pendingFees[token] = 0;
        pendingSurcharge[token] = 0;
        uint256 recipientShare = (tradeFees * CREATOR_FEE_BPS) / BPS;
        fees = tradeFees + surcharge;
        claimable[quote][recipient] += recipientShare;
        claimable[quote][treasury] += fees - recipientShare;

        emit FeesCollected(token, recipient, quote, fees, recipientShare, surcharge);
    }

    /// @notice Withdraw the caller's collected fees in `currency` (`address(0)` = ETH) to
    ///         `to` — every launch paired with that currency at once. The PoolManager pays
    ///         `to` directly.
    function claim(address currency, address to) external nonReentrant returns (uint256 amount) {
        if (to == address(0)) revert ZeroAddress();
        amount = claimable[currency][msg.sender];
        if (amount == 0) revert NothingToClaim();
        claimable[currency][msg.sender] = 0;
        poolManager.unlock(
            abi.encode(ACTION_CLAIM, abi.encode(ClaimData({currency: Currency.wrap(currency), to: to, amount: amount})))
        );
        emit FeesClaimed(msg.sender, currency, to, amount);
    }

    /// @notice Who receives a launch's 88% share: set by `setFeeRecipient`, else its creator.
    function feeRecipientOf(address token) public view returns (address) {
        address recipient = _feeRecipients[token];
        return recipient != address(0) ? recipient : ILaunchCreators(launchpad).creatorOf(token);
    }

    /// @notice Hand a launch's fee share to another address. Only the current recipient
    ///         may; fees already collected stay with whoever they were credited to.
    function setFeeRecipient(address token, address newRecipient) external {
        if (newRecipient == address(0)) revert ZeroAddress();
        if (_placements[token].liquidity == 0) revert NoPlacement(token);
        address current = feeRecipientOf(token);
        if (msg.sender != current) revert NotFeeRecipient(msg.sender);
        _feeRecipients[token] = newRecipient;
        emit FeeRecipientUpdated(token, current, newRecipient);
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
        if (p.liquidity == 0) return bytes32(0);
        return PoolId.unwrap(p.key.toId());
    }

    /// @notice What a placed token trades against (`address(0)` = ETH). Zero for a token
    ///         this placer never placed, so check `poolIdOf` first.
    function quoteTokenOf(address token) external view returns (address) {
        Placement storage p = _placements[token];
        return p.liquidity == 0 ? address(0) : _quoteOf(p);
    }

    /// @notice Every position of a launch's ladder, starting at the launch price. Empty for
    ///         a token never placed.
    function bandsOf(address token) external view returns (Band[] memory) {
        return _bands[token];
    }

    /// @notice A preset's ladder: where each band ends, in ticks from the starting price
    ///         (`type(uint24).max` = the edge of the price scale), and its share of the
    ///         supply in basis points.
    function presetBands(uint8 preset) public pure returns (uint24[] memory ends, uint16[] memory sharesBps) {
        uint24 edge = type(uint24).max;
        if (preset == PRESET_CLASSIC) {
            ends = new uint24[](1);
            sharesBps = new uint16[](1);
            (ends[0], sharesBps[0]) = (edge, 10_000);
        } else if (preset == PRESET_STEADY_START || preset == PRESET_THICK_MIDDLE) {
            ends = new uint24[](3);
            sharesBps = new uint16[](3);
            (ends[0], ends[1], ends[2]) = (TICKS_3X, TICKS_30X, edge);
            (sharesBps[0], sharesBps[1], sharesBps[2]) =
                preset == PRESET_STEADY_START ? (3_000, 5_500, 1_500) : (1_500, 5_500, 3_000);
        } else if (preset == PRESET_WIDE_OPEN) {
            ends = new uint24[](2);
            sharesBps = new uint16[](2);
            (ends[0], ends[1]) = (TICKS_2X, edge);
            (sharesBps[0], sharesBps[1]) = (4_000, 6_000);
        } else {
            revert UnknownLiquidityPreset(preset);
        }
    }

    /// @notice A launch's trade fee in pips (10_000 = 1%); zero for a token never placed.
    function tradeFeeOf(address token) external view returns (uint24) {
        return _placements[token].tradeFee;
    }

    /// @notice What a buy in `token`'s pool pays right now, in pips: the trade fee, or more
    ///         inside the snipe window. Sells always pay `tradeFeeOf`.
    function currentBuyFeeOf(address token) external view returns (uint24) {
        Placement storage p = _placements[token];
        if (p.liquidity == 0) return 0;
        return _buyRate(_poolFees[p.key.toId()]);
    }

    /// @notice A launch's snipe-tax schedule: starting rate (bps), window (seconds) and the
    ///         time it started. A zero window means it has none.
    function snipeTaxOf(address token) external view returns (uint16 startBps, uint16 duration, uint32 launchedAt) {
        Placement storage p = _placements[token];
        if (p.liquidity == 0) return (0, 0, 0);
        PoolFee memory pf = _poolFees[p.key.toId()];
        return (pf.snipeStartBps, pf.snipeDuration, pf.launchedAt);
    }

    // ------------------------------------------------------------------
    // The creator's launch buy
    // ------------------------------------------------------------------

    /// @inheritdoc ILiquidityPlacer
    function exemptNextBuy(address token) external override {
        if (msg.sender != launchpad) revert OnlyLaunchpad();
        bytes32 slot = _exemptSlot(token);
        assembly ("memory-safe") {
            tstore(slot, 1)
        }
    }

    // ------------------------------------------------------------------
    // Internals
    // ------------------------------------------------------------------

    /// @dev The preset's bands as ticks and liquidity. Boundaries are snapped to the spacing
    ///      (nearest multiple, at least one spacing past the previous); each band gets its
    ///      share of `amount` and the last gets the remainder. Every band lies on the
    ///      token-only side of the starting tick, so placing it costs no quote token.
    function _ladder(
        uint8 preset,
        int24 startTick,
        int24 edgeTick,
        int24 spacing,
        bool tokenIsCurrency0,
        uint256 amount,
        uint256 startFdv
    ) private pure returns (Band[] memory bands) {
        (uint24[] memory ends, uint16[] memory sharesBps) = presetBands(preset);
        bands = new Band[](ends.length);
        int256 from; // ticks from the start where this band begins
        uint256 placed;
        for (uint256 i; i < ends.length; ++i) {
            bool last = i == ends.length - 1;
            int256 to;
            if (!last) {
                int256 s = int256(spacing);
                to = ((int256(uint256(ends[i])) + s / 2) / s) * s;
                if (to <= from) to = from + s;
            }
            int24 lo;
            int24 hi;
            if (tokenIsCurrency0) {
                // Buys move the tick UP: bands climb from the start.
                lo = int24(int256(startTick) + from);
                hi = last ? edgeTick : int24(int256(startTick) + to);
            } else {
                // Buys move the tick DOWN: bands descend from the start.
                hi = int24(int256(startTick) - from);
                lo = last ? edgeTick : int24(int256(startTick) - to);
            }
            if (lo >= hi || lo < TickMath.minUsableTick(spacing) || hi > TickMath.maxUsableTick(spacing)) {
                revert StartFdvUnreachable(startFdv);
            }
            uint256 share = last ? amount - placed : (amount * sharesBps[i]) / 10_000;
            placed += share;
            bands[i] = Band({tickLower: lo, tickUpper: hi, liquidity: _bandLiquidity(share, lo, hi, tokenIsCurrency0)});
            from = to;
        }
    }

    /// @dev Liquidity for a token-only position holding `amount` of the token.
    function _bandLiquidity(uint256 amount, int24 lo, int24 hi, bool tokenIsCurrency0) private pure returns (uint128) {
        uint160 sqrtLower = TickMath.getSqrtPriceAtTick(lo);
        uint160 sqrtUpper = TickMath.getSqrtPriceAtTick(hi);
        if (tokenIsCurrency0) {
            // amount0 = L * Q96 * (sqrtB - sqrtA) / (sqrtA * sqrtB), so
            // L = (amount0 * sqrtA / Q96) * sqrtB / (sqrtB - sqrtA). Both steps floor, so L
            // never asks for more than `amount`; scaling `amount` first keeps the dust to a
            // few raw units rather than flooring the small `sqrtA * sqrtB / Q96` factor.
            return _toLiquidity(
                FullMath.mulDiv(FullMath.mulDiv(amount, sqrtLower, Q96), sqrtUpper, uint256(sqrtUpper - sqrtLower))
            );
        }
        // amount1 = L * (sqrtB - sqrtA) / Q96, so L = amount1 * Q96 / (sqrtB - sqrtA).
        // Floors, leaving dust — see the contract docs.
        return _toLiquidity(FullMath.mulDiv(amount, Q96, uint256(sqrtUpper - sqrtLower)));
    }

    function _hookPermissions() private pure returns (Hooks.Permissions memory perms) {
        perms.beforeInitialize = true;
        perms.beforeSwap = true;
        perms.afterSwap = true;
        perms.beforeSwapReturnDelta = true;
        perms.afterSwapReturnDelta = true;
    }

    /// @dev The fee terms of a pool keyed with this hook. Only this contract can
    ///      initialize such a pool and it registers each first, so an unknown one is a bug.
    function _poolFee(PoolKey calldata key) private view returns (PoolFee memory pf) {
        PoolId poolId = key.toId();
        pf = _poolFees[poolId];
        if (pf.token == address(0)) revert UnknownPool(poolId);
    }

    /// @dev Whether the swap's specified (fixed) amount is in the quote token: the input
    ///      on exact-in, the output on exact-out.
    function _quoteIsSpecified(PoolFee memory pf, IPoolManager.SwapParams calldata params) private pure returns (bool) {
        bool specifiedIsCurrency0 = params.zeroForOne == (params.amountSpecified < 0);
        return specifiedIsCurrency0 == pf.quoteIsCurrency0;
    }

    /// @dev The fee on a quote-specified swap: `rate` of an exact-in payment, or the fee
    ///      that is `rate` of the gross payout behind an exact-out amount.
    function _feeOnSpecified(uint24 rate, int256 amountSpecified) private pure returns (uint256) {
        return amountSpecified < 0
            ? _mulDivUp(uint256(-amountSpecified), rate, PIPS)
            : _mulDivUp(uint256(amountSpecified), rate, PIPS - rate);
    }

    /// @dev The fee on a quote-unspecified swap from the pool's own quote amount: `rate` of
    ///      what it paid a seller (exact-in), or the fee that is `rate` of a buyer's gross
    ///      payment behind what the pool charged (exact-out).
    function _feeOnUnspecified(uint24 rate, int256 amountSpecified, uint256 quoteAmount)
        private
        pure
        returns (uint256)
    {
        return amountSpecified < 0 ? _mulDivUp(quoteAmount, rate, PIPS) : _mulDivUp(quoteAmount, rate, PIPS - rate);
    }

    /// @dev Whether the swap spends the quote (a buy).
    function _isBuy(PoolFee memory pf, IPoolManager.SwapParams calldata params) private pure returns (bool) {
        return params.zeroForOne == pf.quoteIsCurrency0;
    }

    /// @dev The rate this swap pays: the trade fee, or for a buy the snipe-window rate —
    ///      unless it is the creator's exempt launch buy.
    function _swapRate(PoolFee memory pf, IPoolManager.SwapParams calldata params) private view returns (uint24) {
        if (!_isBuy(pf, params) || _isExemptBuy(pf.token)) return pf.tradeFee;
        return _buyRate(pf);
    }

    /// @dev Linear from `snipeStartBps` at launch to the trade fee at the window's end; the
    ///      trade fee alone after it (or if the creator's fee is already higher).
    function _buyRate(PoolFee memory pf) private view returns (uint24) {
        uint256 base = pf.tradeFee;
        uint256 elapsed = block.timestamp - pf.launchedAt;
        if (elapsed >= pf.snipeDuration) return uint24(base);
        uint256 start = uint256(pf.snipeStartBps) * 100; // bps -> pips
        if (start <= base) return uint24(base);
        return uint24(start - ((start - base) * elapsed) / pf.snipeDuration);
    }

    function _exemptSlot(address token) private pure returns (bytes32) {
        return keccak256(abi.encode(token, EXEMPT_BUY_SEED));
    }

    function _isExemptBuy(address token) private view returns (bool exempt) {
        bytes32 slot = _exemptSlot(token);
        assembly ("memory-safe") {
            exempt := tload(slot)
        }
    }

    function _clearExemptBuy(address token) private {
        bytes32 slot = _exemptSlot(token);
        assembly ("memory-safe") {
            tstore(slot, 0)
        }
    }

    function _mulDivUp(uint256 a, uint256 b, uint256 denominator) private pure returns (uint256) {
        return FullMath.mulDivRoundingUp(a, b, denominator);
    }

    function _checkTickSpacing(int24 _tickSpacing) private pure {
        if (_tickSpacing < TickMath.MIN_TICK_SPACING || _tickSpacing > MAX_TICK_SPACING) {
            revert TickSpacingOutOfRange(_tickSpacing);
        }
    }

    function _checkMinTradeFee(uint24 _minTradeFee) private pure {
        if (_minTradeFee > MAX_TRADE_FEE) revert TradeFeeOutOfRange(_minTradeFee, 0, MAX_TRADE_FEE);
    }

    function _quoteOf(Placement storage p) private view returns (address) {
        return Currency.unwrap(p.tokenIsCurrency0 ? p.key.currency1 : p.key.currency0);
    }

    /**
     * @dev sqrtPriceX96 when the QUOTE is currency0: v4's price is token-raw per
     *      quote-raw, `amount / startFdv`, and sqrtPriceX96 = sqrt(price << 192). mulDiv
     *      keeps the 512-bit product exact; the quotient fits a uint256 only while
     *      `startFdv > amount >> 64` (for a 1e27 supply, above ~5.4e7 raw units — far
     *      below any sane valuation), so smaller valuations revert here by name.
     */
    function _sqrtPriceTokenPerQuote(uint256 startFdv, uint256 amount) internal pure returns (uint256) {
        if (startFdv <= amount >> 64) revert StartFdvUnreachable(startFdv);
        return _sqrt(FullMath.mulDiv(amount, 1 << 192, startFdv));
    }

    /**
     * @dev sqrtPriceX96 when the TOKEN is currency0: v4's price is quote-raw per
     *      token-raw, `startFdv / amount`. The quotient fits while `startFdv / amount <
     *      2**64`, i.e. below ~1.8e19 raw quote units per raw token — no real price.
     */
    function _sqrtPriceQuotePerToken(uint256 startFdv, uint256 amount) internal pure returns (uint256) {
        if (startFdv == 0 || startFdv / amount >= 1 << 64) revert StartFdvUnreachable(startFdv);
        return _sqrt(FullMath.mulDiv(startFdv, 1 << 192, amount));
    }

    /// @dev The tick at `sqrtPrice`, reverting if it lies outside v4's price range.
    function _tickForSqrtPrice(uint256 sqrtPrice, uint256 startFdv) internal pure returns (int24) {
        if (sqrtPrice < TickMath.MIN_SQRT_PRICE || sqrtPrice >= TickMath.MAX_SQRT_PRICE) {
            revert StartFdvUnreachable(startFdv);
        }
        return TickMath.getTickAtSqrtPrice(uint160(sqrtPrice));
    }

    function _toLiquidity(uint256 l) internal pure returns (uint128) {
        if (l == 0) revert LiquidityIsZero();
        if (l > type(uint128).max) revert LiquidityOverflow(l);
        return uint128(l);
    }

    /// @dev Floors toward negative infinity so the result is always a usable tick.
    function _alignDown(int24 tick, int24 spacing) internal pure returns (int24) {
        int24 aligned = (tick / spacing) * spacing;
        if (tick < 0 && aligned != tick) aligned -= spacing;
        return aligned;
    }

    /// @dev Rounds toward positive infinity to a multiple of `spacing`.
    function _alignUpTick(int24 tick, int24 spacing) internal pure returns (int24) {
        int24 down = _alignDown(tick, spacing);
        return down == tick ? tick : down + spacing;
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

    /// @notice Tick spacing for future launch pools.
    function setTickSpacing(int24 _tickSpacing) external onlyRole(CONFIG_ROLE) {
        _checkTickSpacing(_tickSpacing);
        tickSpacing = _tickSpacing;
        emit TickSpacingUpdated(_tickSpacing);
    }

    /// @notice The lowest trade fee a future launch may choose (at most MAX_TRADE_FEE).
    function setMinTradeFee(uint24 _minTradeFee) external onlyRole(CONFIG_ROLE) {
        _checkMinTradeFee(_minTradeFee);
        minTradeFee = _minTradeFee;
        emit MinTradeFeeUpdated(_minTradeFee);
    }

    /// @notice The snipe tax for future launches: a buy surcharge starting at `startBps`
    ///         that decays linearly to the launch's trade fee over `duration` seconds.
    ///         `duration` 0 turns it off. Live launches keep the schedule they were placed with.
    function setSnipeTax(uint16 startBps, uint16 duration) external onlyRole(CONFIG_ROLE) {
        if (startBps > MAX_SNIPE_START_BPS || duration > MAX_SNIPE_DURATION) {
            revert SnipeTaxOutOfRange(startBps, duration);
        }
        snipeStartBps = startBps;
        snipeDuration = duration;
        emit SnipeTaxUpdated(startBps, duration);
    }

    /// @notice Set who receives the platform's share of collected fees. Applies to fees
    ///         collected from now on.
    function setFeeTreasury(address treasury) external onlyRole(CONFIG_ROLE) {
        if (treasury == address(0)) revert ZeroAddress();
        feeTreasury = treasury;
        emit FeeTreasuryUpdated(treasury);
    }
}
