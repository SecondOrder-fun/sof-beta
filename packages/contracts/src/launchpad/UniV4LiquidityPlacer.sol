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
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {LaunchPoolGate} from "./LaunchPoolGate.sol";
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
error PoolParamsOutOfRange(uint24 fee, int24 tickSpacing);
error PlacementWouldCostQuote(int128 quoteDelta);
error LiquidityIsZero();
error GateNotSet();
error InvalidGate(address gate);
error NoPlacement(address token);
error FeeTreasuryNotSet();
error NotFeeRecipient(address caller);
error NothingToClaim();
error EthTransferFailed();
error QuoteIsLaunchToken(address token);
error LiquidityOverflow(uint256 liquidity);

/**
 * @title UniV4LiquidityPlacer
 * @notice Places a launched token's whole supply as single-sided concentrated liquidity
 *         in a Uniswap v4 pool, paired against its quote token: native ETH or an ERC-20
 *         on the launchpad's allowlist.
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
 *      ## One range, to the end of the price scale
 *
 *      The position runs from the starting price all the way to v4's last usable tick, so
 *      the token never sells out: at any price there is still liquidity, and no route —
 *      ours or a third party's — can push it into an empty range where quoting breaks. A
 *      range that ended ~100x above launch would have sold out at a 100 ETH valuation for a
 *      1 ETH launch. The cost is small: liquidity scales with `1 / (sqrtB - sqrtA)`, and
 *      with the far edge effectively at zero (or infinity) the depth near the launch price
 *      is within ~10% of a 100x range's.
 *
 *      A single range rather than a staircase of bands: a band ladder is a way to *shape*
 *      the curve, not a requirement for having one. One range gives a continuous,
 *      monotonic price curve with less gas and no per-band rounding to reason about.
 *
 *      ## Who may initialize the pool
 *
 *      Every launch pool is keyed with `gate`, a `LaunchPoolGate` hook that lets only this
 *      contract initialize it. Without it the pool key is predictable before the token
 *      exists, and one pre-emptive `PoolManager.initialize` would make every later
 *      `place()` revert `PoolAlreadyInitialized` — see `LaunchPoolGate`. `place()` refuses
 *      to run until a gate is set.
 *
 *      ## LP fees
 *
 *      This contract owns every launch position, so the pool's swap fees accrue to it, in
 *      both the quote token and the launch token. `collectFees(token)` is permissionless:
 *      it pulls a position's accrued fees out of the pool (a zero-liquidity
 *      `modifyLiquidity`, which v4 pays out as the fees owed) and credits them
 *      `CREATOR_FEE_BPS` (88%) to the launch's fee recipient and the rest to `feeTreasury`,
 *      on both sides alike. Credits are kept per currency (`claimable[currency][account]`,
 *      `address(0)` = ETH), so a recipient's ETH from every ETH-paired launch claims in one
 *      call, as does each ERC-20 quote token, while each launch token claims on its own.
 *      `claim` is a pull the claimant makes to an address they choose, so no payout can
 *      block a collection and a failed transfer simply reverts that claim for a retry. The
 *      fee recipient starts as the launch's creator and only the current recipient can
 *      hand it on (`setFeeRecipient`). Shares are fixed when fees are collected: changing
 *      the recipient or the treasury later does not move fees already credited.
 *
 *      ## Dust
 *
 *      Liquidity is an integer, so flooring it leaves a token remainder of a few raw units
 *      — around 1e-12 whole tokens at realistic prices. That remainder stays in this
 *      contract. It is genuinely dust, and `sweepDust` exists so it is recoverable rather
 *      than silently stuck. It never touches collected fees that are still unclaimed.
 */
contract UniV4LiquidityPlacer is ILiquidityPlacer, IUnlockCallback, AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant CONFIG_ROLE = keccak256("CONFIG_ROLE");

    uint256 private constant Q96 = 0x1000000000000000000000000;
    /// @dev The currency address v4 uses for native ETH.
    address private constant NATIVE = address(0);

    IPoolManager public immutable poolManager;
    address public immutable launchpad;

    /// @notice The highest pool fee CONFIG_ROLE may set: 3%. Compiled in, so no
    ///         configuration change can make new launches' markets punitive.
    uint24 public constant MAX_FEE = 30_000;
    /// @notice The widest tick spacing CONFIG_ROLE may set (v4's own maximum).
    int24 public constant MAX_TICK_SPACING = TickMath.MAX_TICK_SPACING;

    /// @notice Pool fee in hundredths of a bip (10_000 = 1%).
    uint24 public fee;
    /// @notice Tick spacing. Must divide the position's ticks.
    int24 public tickSpacing;
    /// @notice The hook every launch pool is keyed with; only it lets this contract
    ///         initialize a pool. Changing it affects future launches only.
    IHooks public gate;

    struct Placement {
        PoolKey key;
        int24 tickLower;
        int24 tickUpper;
        uint128 liquidity;
        /// @dev True when the launch token sorts below its quote token. See "Orientation".
        bool tokenIsCurrency0;
    }

    mapping(address token => Placement) private _placements;

    /// @notice The fee recipient's share of every collection, in basis points (88%).
    uint256 public constant CREATOR_FEE_BPS = 8_800;
    uint256 private constant BPS = 10_000;

    /// @notice Receives the platform's share (12%) of collected fees.
    address public feeTreasury;

    /// @dev token => fee recipient; zero means the launch's creator.
    mapping(address token => address) private _feeRecipients;

    /// @notice Collected fees not yet claimed, per currency (`address(0)` = ETH) and account.
    ///         Quote-token fees pool across every launch paired with that currency; launch
    ///         token fees are per launch token, since each is its own currency.
    mapping(address currency => mapping(address account => uint256)) public claimable;
    /// @notice Unclaimed fees held here in each ERC-20 currency — what `sweepDust` must
    ///         leave alone.
    mapping(address currency => uint256) public totalClaimable;

    event LiquidityPlaced(
        address indexed token,
        PoolId indexed poolId,
        address indexed quoteToken,
        uint256 amount,
        uint256 requestedStartFdv,
        int24 tickLower,
        int24 tickUpper,
        uint128 liquidity,
        bool tokenIsCurrency0
    );
    event PoolParamsUpdated(uint24 fee, int24 tickSpacing);
    event GateUpdated(address indexed gate);
    event DustSwept(address indexed currency, address indexed to, uint256 amount);
    event FeesCollected(
        address indexed token,
        address indexed recipient,
        address indexed quoteToken,
        uint256 quoteFees,
        uint256 tokenFees,
        uint256 recipientQuote,
        uint256 recipientTokens
    );
    event FeeRecipientUpdated(address indexed token, address indexed previous, address indexed current);
    event FeeTreasuryUpdated(address indexed treasury);
    event FeesClaimed(address indexed account, address indexed currency, address to, uint256 amount);

    uint8 private constant ACTION_PLACE = 0;
    uint8 private constant ACTION_COLLECT = 1;

    /// @dev Encoded through `unlock` so the callback knows what to do.
    struct CallbackData {
        uint8 action;
        PoolKey key;
        int24 tickLower;
        int24 tickUpper;
        uint128 liquidity;
        address token;
        bool tokenIsCurrency0;
    }

    constructor(
        address _poolManager,
        address _launchpad,
        address admin,
        uint24 _fee,
        int24 _tickSpacing
    ) {
        if (_poolManager == address(0) || _launchpad == address(0) || admin == address(0)) revert ZeroAddress();
        _checkPoolParams(_fee, _tickSpacing);

        poolManager = IPoolManager(_poolManager);
        launchpad = _launchpad;
        fee = _fee;
        tickSpacing = _tickSpacing;

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(CONFIG_ROLE, admin);
    }

    // ------------------------------------------------------------------
    // Placement
    // ------------------------------------------------------------------

    /// @inheritdoc ILiquidityPlacer
    function place(address token, uint256 amount, address quoteToken, uint256 startFdv)
        external
        override
        returns (bytes32 placementId)
    {
        if (msg.sender != launchpad) revert OnlyLaunchpad();
        if (token == address(0)) revert ZeroAddress();
        if (quoteToken == token) revert QuoteIsLaunchToken(token);
        if (amount == 0) revert ZeroAmount();
        IHooks hooks = gate;
        if (address(hooks) == address(0)) revert GateNotSet();

        int24 spacing = tickSpacing;
        bool tokenIsCurrency0 = token < quoteToken;

        // Ticks are discrete, so the effective start price is the creator's valuation
        // snapped to a usable tick, rounding toward the dearer side: the token opens at or
        // slightly above the requested valuation (within one tick spacing, ~2%), never
        // cheaper than its creator chose. `LiquidityPlaced` carries the requested
        // valuation so the difference is visible off-chain rather than silent.
        int24 tickLower;
        int24 tickUpper;
        uint160 startSqrtPrice;
        uint128 liquidity;
        if (tokenIsCurrency0) {
            // Price is quote per token here, so dearer is a HIGHER tick: round up.
            uint256 sqrtStart = _sqrtPriceQuotePerToken(startFdv, amount);
            int24 tick = _tickForSqrtPrice(sqrtStart, startFdv);
            if (TickMath.getSqrtPriceAtTick(tick) < sqrtStart) tick += 1;
            tickLower = _alignUpTick(tick, spacing);
            tickUpper = TickMath.maxUsableTick(spacing);
            uint160 sqrtLower = TickMath.getSqrtPriceAtTick(tickLower);
            uint160 sqrtUpper = TickMath.getSqrtPriceAtTick(tickUpper);
            // amount0 = L * Q96 * (sqrtB - sqrtA) / (sqrtA * sqrtB), so
            // L = (amount0 * sqrtA / Q96) * sqrtB / (sqrtB - sqrtA). Both steps floor, so L
            // never asks for more than `amount`; scaling `amount` first keeps the dust to a
            // few raw units rather than flooring the small `sqrtA * sqrtB / Q96` factor.
            liquidity = _toLiquidity(
                FullMath.mulDiv(FullMath.mulDiv(amount, sqrtLower, Q96), sqrtUpper, uint256(sqrtUpper - sqrtLower))
            );
            startSqrtPrice = sqrtLower;
        } else {
            // Price is token per quote here, so dearer is a LOWER tick. getTickAtSqrtPrice
            // already floors; aligning down keeps rounding that way.
            tickUpper = _alignDown(_tickForSqrtPrice(_sqrtPriceTokenPerQuote(startFdv, amount), startFdv), spacing);
            tickLower = TickMath.minUsableTick(spacing);
            uint160 sqrtLower = TickMath.getSqrtPriceAtTick(tickLower);
            uint160 sqrtUpper = TickMath.getSqrtPriceAtTick(tickUpper);
            // amount1 = L * (sqrtB - sqrtA) / Q96, so L = amount1 * Q96 / (sqrtB - sqrtA).
            // Floors, leaving dust — see the contract docs.
            liquidity = _toLiquidity(FullMath.mulDiv(amount, Q96, uint256(sqrtUpper - sqrtLower)));
            startSqrtPrice = sqrtUpper;
        }
        if (tickLower >= tickUpper) revert StartFdvUnreachable(startFdv);

        PoolKey memory key = tokenIsCurrency0
            ? PoolKey({
                currency0: Currency.wrap(token),
                currency1: Currency.wrap(quoteToken),
                fee: fee,
                tickSpacing: spacing,
                hooks: hooks
            })
            : PoolKey({
                currency0: Currency.wrap(quoteToken),
                currency1: Currency.wrap(token),
                fee: fee,
                tickSpacing: spacing,
                hooks: hooks
            });

        // Starting exactly at the token-only edge of the range is what makes the position
        // single-sided, so the pool owes us no quote token.
        poolManager.initialize(key, startSqrtPrice);

        poolManager.unlock(
            abi.encode(
                CallbackData({
                    action: ACTION_PLACE,
                    key: key,
                    tickLower: tickLower,
                    tickUpper: tickUpper,
                    liquidity: liquidity,
                    token: token,
                    tokenIsCurrency0: tokenIsCurrency0
                })
            )
        );

        _placements[token] = Placement({
            key: key,
            tickLower: tickLower,
            tickUpper: tickUpper,
            liquidity: liquidity,
            tokenIsCurrency0: tokenIsCurrency0
        });

        PoolId poolId = key.toId();
        emit LiquidityPlaced(
            token, poolId, quoteToken, amount, startFdv, tickLower, tickUpper, liquidity, tokenIsCurrency0
        );

        return PoolId.unwrap(poolId);
    }

    /// @inheritdoc IUnlockCallback
    function unlockCallback(bytes calldata data) external override returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert NotPoolManager();

        CallbackData memory cb = abi.decode(data, (CallbackData));
        if (cb.action == ACTION_COLLECT) return _collectInCallback(cb);

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

        // The whole point of single-sided placement: we must owe no quote token. If we do,
        // the orientation or the starting tick is wrong, and paying it would silently drain
        // this contract, so fail loudly instead.
        (int128 tokenDelta, int128 quoteDelta) =
            cb.tokenIsCurrency0 ? (delta.amount0(), delta.amount1()) : (delta.amount1(), delta.amount0());
        if (quoteDelta != 0) revert PlacementWouldCostQuote(quoteDelta);

        // Settle what we owe in the token. Negative delta means we owe the pool.
        if (tokenDelta < 0) {
            uint256 owed = uint256(uint128(-tokenDelta));
            poolManager.sync(Currency.wrap(cb.token));
            IERC20(cb.token).safeTransfer(address(poolManager), owed);
            poolManager.settle();
        }

        return "";
    }

    // ------------------------------------------------------------------
    // LP fees
    // ------------------------------------------------------------------

    /**
     * @notice Collect a launch position's accrued swap fees and credit the split.
     * @dev Permissionless: anyone may trigger it, and it only ever moves fees into the
     *      claimable balances of the fee recipient and the treasury. Collecting when
     *      nothing has accrued is a no-op that credits zero.
     * @return quoteFees quote-token fees collected, in its raw units (wei for ETH)
     * @return tokenFees launch-token fees collected, in raw units
     */
    function collectFees(address token) external nonReentrant returns (uint256 quoteFees, uint256 tokenFees) {
        Placement memory p = _placements[token];
        if (p.liquidity == 0) revert NoPlacement(token);
        address treasury = feeTreasury;
        if (treasury == address(0)) revert FeeTreasuryNotSet();
        address recipient = feeRecipientOf(token);

        bytes memory result = poolManager.unlock(
            abi.encode(
                CallbackData({
                    action: ACTION_COLLECT,
                    key: p.key,
                    tickLower: p.tickLower,
                    tickUpper: p.tickUpper,
                    liquidity: 0,
                    token: token,
                    tokenIsCurrency0: p.tokenIsCurrency0
                })
            )
        );
        (quoteFees, tokenFees) = abi.decode(result, (uint256, uint256));

        address quote = _quoteOf(p);
        uint256 recipientQuote = (quoteFees * CREATOR_FEE_BPS) / BPS;
        uint256 recipientTokens = (tokenFees * CREATOR_FEE_BPS) / BPS;
        claimable[quote][recipient] += recipientQuote;
        claimable[quote][treasury] += quoteFees - recipientQuote;
        claimable[token][recipient] += recipientTokens;
        claimable[token][treasury] += tokenFees - recipientTokens;
        if (quote != NATIVE) totalClaimable[quote] += quoteFees;
        totalClaimable[token] += tokenFees;

        emit FeesCollected(token, recipient, quote, quoteFees, tokenFees, recipientQuote, recipientTokens);
    }

    /// @notice Withdraw the caller's collected fees in `currency` (`address(0)` = ETH) to
    ///         `to`. For a quote currency that is every launch paired with it at once.
    function claim(address currency, address to) external nonReentrant returns (uint256 amount) {
        if (to == address(0)) revert ZeroAddress();
        amount = claimable[currency][msg.sender];
        if (amount == 0) revert NothingToClaim();
        claimable[currency][msg.sender] = 0;
        if (currency == NATIVE) {
            (bool ok,) = to.call{value: amount}("");
            if (!ok) revert EthTransferFailed();
        } else {
            totalClaimable[currency] -= amount;
            IERC20(currency).safeTransfer(to, amount);
        }
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

    /// @dev Inside `unlock`: a zero-liquidity modify pays out the position's accrued fees
    ///      as a positive delta, which is then taken to this contract.
    function _collectInCallback(CallbackData memory cb) private returns (bytes memory) {
        (BalanceDelta delta,) = poolManager.modifyLiquidity(
            cb.key,
            IPoolManager.ModifyLiquidityParams({
                tickLower: cb.tickLower,
                tickUpper: cb.tickUpper,
                liquidityDelta: 0,
                salt: bytes32(0)
            }),
            ""
        );
        uint256 fees0 = uint256(uint128(delta.amount0()));
        uint256 fees1 = uint256(uint128(delta.amount1()));
        if (fees0 != 0) poolManager.take(cb.key.currency0, address(this), fees0);
        if (fees1 != 0) poolManager.take(cb.key.currency1, address(this), fees1);
        return cb.tokenIsCurrency0 ? abi.encode(fees1, fees0) : abi.encode(fees0, fees1);
    }

    /// @dev ETH arrives only as collected fees, taken from the PoolManager.
    receive() external payable {
        if (msg.sender != address(poolManager)) revert NotPoolManager();
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
        Placement memory p = _placements[token];
        return p.liquidity == 0 ? address(0) : _quoteOf(p);
    }

    // ------------------------------------------------------------------
    // Internals
    // ------------------------------------------------------------------

    function _quoteOf(Placement memory p) private pure returns (address) {
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

    /// @dev A static fee no higher than MAX_FEE (so never v4's dynamic-fee flag) and a
    ///      tick spacing v4 accepts.
    function _checkPoolParams(uint24 _fee, int24 _tickSpacing) private pure {
        if (_fee > MAX_FEE || _tickSpacing < TickMath.MIN_TICK_SPACING || _tickSpacing > MAX_TICK_SPACING) {
            revert PoolParamsOutOfRange(_fee, _tickSpacing);
        }
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

    function setPoolParams(uint24 _fee, int24 _tickSpacing) external onlyRole(CONFIG_ROLE) {
        _checkPoolParams(_fee, _tickSpacing);
        fee = _fee;
        tickSpacing = _tickSpacing;
        emit PoolParamsUpdated(_fee, _tickSpacing);
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

    /// @notice Set who receives the platform's share of collected fees. Applies to fees
    ///         collected from now on.
    function setFeeTreasury(address treasury) external onlyRole(CONFIG_ROLE) {
        if (treasury == address(0)) revert ZeroAddress();
        feeTreasury = treasury;
        emit FeeTreasuryUpdated(treasury);
    }

    /// @notice Recover the rounding remainder described in the contract docs, in any
    ///         ERC-20 this contract holds.
    /// @dev Sweeps only what exceeds the unclaimed fees held in `currency`: for a launch
    ///      token that is placement dust by construction, and an ERC-20 quote token holds
    ///      nothing beyond its unclaimed fees except what was sent here by mistake.
    function sweepDust(address currency, address to) external onlyRole(CONFIG_ROLE) {
        if (to == address(0)) revert ZeroAddress();
        uint256 dust = IERC20(currency).balanceOf(address(this)) - totalClaimable[currency];
        if (dust == 0) revert ZeroAmount();
        IERC20(currency).safeTransfer(to, dust);
        emit DustSwept(currency, to, dust);
    }
}
