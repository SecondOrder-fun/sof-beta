// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ReentrancyGuard} from "openzeppelin-contracts/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "openzeppelin-contracts/contracts/token/ERC20/utils/SafeERC20.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {ILaunchRouter} from "./ILaunchRouter.sol";
import {UniV4LiquidityPlacer} from "./UniV4LiquidityPlacer.sol";

interface ILaunchRegistry {
    function isLaunchToken(address token) external view returns (bool);
    function placerOf(address token) external view returns (address);
}

error RouterZeroAddress();
error RouterZeroAmount();
error Expired(uint256 deadline);
error NotALaunchToken(address token);
error NoPool(address token);
error InsufficientOutput(uint256 received, uint256 minimum);
error OnlyPoolManager();
error RefundFailed();
error EthAmountMismatch(uint256 sent, uint256 quoteIn);

/**
 * @title UniV4LaunchRouter
 * @notice The launchpad's own ILaunchRouter: exact-input swaps between a launched token
 *         and its quote token (native ETH or an allowlisted ERC-20) on the Uniswap v4
 *         pools UniV4LiquidityPlacer created, with minimum-out and deadline.
 *
 * @dev Deliberately narrow. It routes only launchpad tokens, only through the one pool
 *      the placer made for each, and only exact-input — the shape the buy panel quotes.
 *      Callers pass a token address, never a PoolKey: the key is looked up from the
 *      placer that placed that launch (`launchpad.placerOf`), so a client cannot steer a
 *      trade into a pool of its choosing, and replacing the launchpad's placer does not
 *      strand earlier launches. A launch whose placer is not a v4 placer reverts NoPool.
 *
 *      Direction follows the placement's orientation (`Placement.tokenIsCurrency0`, see
 *      UniV4LiquidityPlacer): with the quote as currency0 a buy is zeroForOne and walks
 *      the price down to the range floor; with the token as currency0 a buy is oneForZero
 *      and walks it up to the range ceiling. Sells mirror both.
 *
 *      Partial fills are real. Each pool is a single concentrated range; a buy large
 *      enough to exhaust it (or a sell pushing back past launch) fills only in part.
 *      The router then refunds unspent ETH, or pulls only the ERC-20 quote and launch
 *      tokens actually spent, and `minOut` decides whether the partial result is
 *      acceptable.
 *
 *      It holds nothing between calls. ETH arrives with `buy` and leaves in the same
 *      transaction; ERC-20s move payer -> PoolManager -> recipient without resting here.
 *      There is no `receive`, so stray ETH sent to it reverts.
 */
contract UniV4LaunchRouter is ILaunchRouter, IUnlockCallback, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IPoolManager public immutable poolManager;
    ILaunchRegistry public immutable launchpad;

    uint8 private constant BUY = 1;
    uint8 private constant SELL = 2;

    event Bought(
        address indexed token, address indexed payer, address indexed recipient, uint256 quoteIn, uint256 tokensOut
    );
    event Sold(
        address indexed token, address indexed payer, address indexed recipient, uint256 tokensIn, uint256 quoteOut
    );

    struct Swap {
        uint8 action;
        PoolKey key;
        bool tokenIsCurrency0;
        uint256 amountIn;
        address payer;
        address recipient;
        /// @dev The edge of the launch position the swap may not cross: where the range
        ///      runs out of tokens for a buy, back at the launch price for a sell. Outside
        ///      the range the pool has no liquidity, so a swap allowed past it would strand
        ///      the price at MIN/MAX_SQRT_PRICE — where quoting reads zero liquidity and the
        ///      token shows an absurd price — for no extra fill.
        uint160 priceLimit;
    }

    constructor(address _poolManager, address _launchpad) {
        if (_poolManager == address(0) || _launchpad == address(0)) revert RouterZeroAddress();
        poolManager = IPoolManager(_poolManager);
        launchpad = ILaunchRegistry(_launchpad);
    }

    // ------------------------------------------------------------------
    // ILaunchRouter
    // ------------------------------------------------------------------

    /// @inheritdoc ILaunchRouter
    function buy(address token, uint256 quoteIn, uint256 minTokensOut, address recipient, uint256 deadline)
        external
        payable
        nonReentrant
        returns (uint256 tokensOut)
    {
        if (quoteIn == 0) revert RouterZeroAmount();
        (UniV4LiquidityPlacer.Placement memory p, address quote) = _checkedPlacement(token, recipient, deadline);
        // ETH-paired: the ETH is the amount. ERC-20-paired: no ETH at all, so none can be
        // stranded here.
        uint256 expectedValue = quote == address(0) ? quoteIn : 0;
        if (msg.value != expectedValue) revert EthAmountMismatch(msg.value, quoteIn);

        uint160 limit = TickMath.getSqrtPriceAtTick(p.tokenIsCurrency0 ? p.tickUpper : p.tickLower);
        (uint256 out, uint256 quoteSpent) = abi.decode(
            poolManager.unlock(abi.encode(Swap(BUY, p.key, p.tokenIsCurrency0, quoteIn, msg.sender, recipient, limit))),
            (uint256, uint256)
        );
        if (out < minTokensOut) revert InsufficientOutput(out, minTokensOut);

        // A buy that exhausts the range spends less than it was sent. Return unspent ETH;
        // an ERC-20 quote was only ever pulled for what the pool took.
        if (quote == address(0)) {
            uint256 refund = msg.value - quoteSpent;
            if (refund != 0) {
                (bool ok,) = msg.sender.call{value: refund}("");
                if (!ok) revert RefundFailed();
            }
        }

        emit Bought(token, msg.sender, recipient, quoteSpent, out);
        return out;
    }

    /// @inheritdoc ILaunchRouter
    function sell(address token, uint256 tokensIn, uint256 minQuoteOut, address recipient, uint256 deadline)
        external
        nonReentrant
        returns (uint256 quoteOut)
    {
        if (tokensIn == 0) revert RouterZeroAmount();
        (UniV4LiquidityPlacer.Placement memory p,) = _checkedPlacement(token, recipient, deadline);

        uint160 limit = TickMath.getSqrtPriceAtTick(p.tokenIsCurrency0 ? p.tickLower : p.tickUpper);
        (uint256 out, uint256 tokensSpent) = abi.decode(
            poolManager.unlock(
                abi.encode(Swap(SELL, p.key, p.tokenIsCurrency0, tokensIn, msg.sender, recipient, limit))
            ),
            (uint256, uint256)
        );
        if (out < minQuoteOut) revert InsufficientOutput(out, minQuoteOut);

        emit Sold(token, msg.sender, recipient, tokensSpent, out);
        return out;
    }

    // ------------------------------------------------------------------
    // v4 flash accounting
    // ------------------------------------------------------------------

    /// @inheritdoc IUnlockCallback
    function unlockCallback(bytes calldata data) external override returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert OnlyPoolManager();
        Swap memory s = abi.decode(data, (Swap));

        // Buying spends the quote side; selling spends the token side. The quote is
        // currency0 exactly when the token is not.
        bool spendCurrency0 = (s.action == BUY) != s.tokenIsCurrency0;
        BalanceDelta delta = poolManager.swap(
            s.key,
            IPoolManager.SwapParams({
                zeroForOne: spendCurrency0,
                amountSpecified: -int256(s.amountIn),
                sqrtPriceLimitX96: s.priceLimit
            }),
            ""
        );

        (Currency inCurrency, int128 inDelta, Currency outCurrency, int128 outDelta) = spendCurrency0
            ? (s.key.currency0, delta.amount0(), s.key.currency1, delta.amount1())
            : (s.key.currency1, delta.amount1(), s.key.currency0, delta.amount0());

        // What the pool actually took — less than amountIn on a partial fill.
        uint256 spent = uint256(uint128(-inDelta));
        poolManager.sync(inCurrency);
        if (inCurrency.isAddressZero()) {
            poolManager.settle{value: spent}();
        } else {
            // Pull only what the pool filled, straight from the payer into the PoolManager.
            IERC20(Currency.unwrap(inCurrency)).safeTransferFrom(s.payer, address(poolManager), spent);
            poolManager.settle();
        }

        uint256 received = uint256(uint128(outDelta));
        poolManager.take(outCurrency, s.recipient, received);
        return abi.encode(received, spent);
    }

    // ------------------------------------------------------------------
    // Internals
    // ------------------------------------------------------------------

    /// @return p     The launch's placement: pool key, range and orientation.
    /// @return quote What it trades against (`address(0)` = ETH).
    function _checkedPlacement(address token, address recipient, uint256 deadline)
        private
        view
        returns (UniV4LiquidityPlacer.Placement memory p, address quote)
    {
        if (block.timestamp > deadline) revert Expired(deadline);
        if (recipient == address(0)) revert RouterZeroAddress();
        if (!launchpad.isLaunchToken(token)) revert NotALaunchToken(token);

        try UniV4LiquidityPlacer(payable(launchpad.placerOf(token))).getPlacement(token) returns (
            UniV4LiquidityPlacer.Placement memory found
        ) {
            p = found;
        } catch {
            revert NoPool(token);
        }
        (address tokenSide, address quoteSide) = p.tokenIsCurrency0
            ? (Currency.unwrap(p.key.currency0), Currency.unwrap(p.key.currency1))
            : (Currency.unwrap(p.key.currency1), Currency.unwrap(p.key.currency0));
        if (p.liquidity == 0 || tokenSide != token) revert NoPool(token);
        quote = quoteSide;
    }
}
