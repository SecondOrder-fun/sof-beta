// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency, CurrencyLibrary} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";

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

