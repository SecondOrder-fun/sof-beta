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
}

error RouterZeroAddress();
error RouterZeroAmount();
error Expired(uint256 deadline);
error NotALaunchToken(address token);
error NoPool(address token);
error InsufficientOutput(uint256 received, uint256 minimum);
error OnlyPoolManager();
error RefundFailed();

/**
 * @title UniV4LaunchRouter
 * @notice The launchpad's own ILaunchRouter: exact-input ETH <-> token swaps on the
 *         Uniswap v4 pools UniV4LiquidityPlacer created, with minimum-out and deadline.
 *
 * @dev Deliberately narrow. It routes only launchpad tokens, only through the one pool
 *      the placer made for each, and only exact-input — the shape the buy panel quotes.
 *      Callers pass a token address, never a PoolKey: the key is looked up from the
 *      placer, so a client cannot steer a trade into a pool of its choosing.
 *
 *      Partial fills are real. Each pool is a single concentrated range; a buy large
 *      enough to exhaust it (or a sell pushing back past launch) fills only in part.
 *      The router then refunds unspent ETH and pulls only the tokens actually sold, and
 *      `minOut` decides whether the partial result is acceptable.
 *
 *      It holds nothing between calls. ETH arrives with `buy` and leaves in the same
 *      transaction; tokens move payer -> PoolManager -> recipient without resting here.
 *      There is no `receive`, so stray ETH sent to it reverts.
 */
contract UniV4LaunchRouter is ILaunchRouter, IUnlockCallback, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IPoolManager public immutable poolManager;
    UniV4LiquidityPlacer public immutable placer;
    ILaunchRegistry public immutable launchpad;

    uint8 private constant BUY = 1;
    uint8 private constant SELL = 2;

    event Bought(address indexed token, address indexed payer, address indexed recipient, uint256 ethIn, uint256 tokensOut);
    event Sold(address indexed token, address indexed payer, address indexed recipient, uint256 tokensIn, uint256 ethOut);

    struct Swap {
        uint8 action;
        PoolKey key;
        uint256 amountIn;
        address payer;
        address recipient;
    }

    constructor(address _poolManager, address _placer, address _launchpad) {
        if (_poolManager == address(0) || _placer == address(0) || _launchpad == address(0)) {
            revert RouterZeroAddress();
        }
        poolManager = IPoolManager(_poolManager);
        placer = UniV4LiquidityPlacer(_placer);
        launchpad = ILaunchRegistry(_launchpad);
    }

    // ------------------------------------------------------------------
    // ILaunchRouter
    // ------------------------------------------------------------------

    /// @inheritdoc ILaunchRouter
    function buy(address token, uint256 minTokensOut, address recipient, uint256 deadline)
        external
        payable
        nonReentrant
        returns (uint256 tokensOut)
    {
        if (msg.value == 0) revert RouterZeroAmount();
        PoolKey memory key = _checkedKey(token, recipient, deadline);

        (uint256 out, uint256 ethSpent) = abi.decode(
            poolManager.unlock(abi.encode(Swap(BUY, key, msg.value, msg.sender, recipient))), (uint256, uint256)
        );
        if (out < minTokensOut) revert InsufficientOutput(out, minTokensOut);

        // A buy that exhausts the range spends less than it was sent. Return the rest.
        uint256 refund = msg.value - ethSpent;
        if (refund != 0) {
            (bool ok,) = msg.sender.call{value: refund}("");
            if (!ok) revert RefundFailed();
        }

        emit Bought(token, msg.sender, recipient, ethSpent, out);
        return out;
    }

    /// @inheritdoc ILaunchRouter
    function sell(address token, uint256 tokensIn, uint256 minEthOut, address recipient, uint256 deadline)
        external
        nonReentrant
        returns (uint256 ethOut)
    {
        if (tokensIn == 0) revert RouterZeroAmount();
        PoolKey memory key = _checkedKey(token, recipient, deadline);

        (uint256 out, uint256 tokensSpent) = abi.decode(
            poolManager.unlock(abi.encode(Swap(SELL, key, tokensIn, msg.sender, recipient))), (uint256, uint256)
        );
        if (out < minEthOut) revert InsufficientOutput(out, minEthOut);

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
        return s.action == BUY ? _buy(s) : _sell(s);
    }

    /// ETH (currency0) in, token (currency1) out: zeroForOne, exact input.
    function _buy(Swap memory s) private returns (bytes memory) {
        BalanceDelta delta = poolManager.swap(
            s.key,
            IPoolManager.SwapParams({
                zeroForOne: true,
                amountSpecified: -int256(s.amountIn),
                sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
            }),
            ""
        );

        // What the pool actually took — less than amountIn on a partial fill.
        uint256 ethSpent = uint256(uint128(-delta.amount0()));
        poolManager.sync(s.key.currency0);
        poolManager.settle{value: ethSpent}();

        uint256 tokensOut = uint256(uint128(delta.amount1()));
        poolManager.take(s.key.currency1, s.recipient, tokensOut);
        return abi.encode(tokensOut, ethSpent);
    }

    /// Token (currency1) in, ETH (currency0) out: oneForZero, exact input.
    function _sell(Swap memory s) private returns (bytes memory) {
        BalanceDelta delta = poolManager.swap(
            s.key,
            IPoolManager.SwapParams({
                zeroForOne: false,
                amountSpecified: -int256(s.amountIn),
                sqrtPriceLimitX96: TickMath.MAX_SQRT_PRICE - 1
            }),
            ""
        );

        // Pull only what the pool filled, straight from the payer into the PoolManager.
        uint256 tokensSpent = uint256(uint128(-delta.amount1()));
        poolManager.sync(s.key.currency1);
        IERC20(Currency.unwrap(s.key.currency1)).safeTransferFrom(s.payer, address(poolManager), tokensSpent);
        poolManager.settle();

        uint256 ethOut = uint256(uint128(delta.amount0()));
        poolManager.take(s.key.currency0, s.recipient, ethOut);
        return abi.encode(ethOut, tokensSpent);
    }

    // ------------------------------------------------------------------
    // Internals
    // ------------------------------------------------------------------

    function _checkedKey(address token, address recipient, uint256 deadline) private view returns (PoolKey memory key) {
        if (block.timestamp > deadline) revert Expired(deadline);
        if (recipient == address(0)) revert RouterZeroAddress();
        if (!launchpad.isLaunchToken(token)) revert NotALaunchToken(token);

        key = placer.getPlacement(token).key;
        if (Currency.unwrap(key.currency1) != token) revert NoPool(token);
    }
}
