// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";

error NotPlacer(address sender);
error ZeroPlacer();

/**
 * @title LaunchPoolGate
 * @notice A Uniswap v4 hook whose only job is to stop anyone but the liquidity placer
 *         from initializing a launch pool.
 *
 * @dev Without it, a launch pool's key is (ETH, token, fee, tickSpacing, no hooks), and
 *      the next launch token's address is predictable from the launchpad's CREATE nonce.
 *      Anyone could initialize that pool first, `place()` would revert
 *      `PoolAlreadyInitialized`, and because a failed launch never advances the nonce the
 *      target never changes: the launchpad would be blocked for good by one cheap
 *      transaction.
 *
 *      Putting this contract in the PoolKey closes that: v4 calls `beforeInitialize` with
 *      the initializer as `sender`, and this reverts for anyone but the placer. The pool
 *      key an attacker would need includes this hook, so they cannot create it either.
 *
 *      v4 reads a hook's permissions from the low 14 bits of its address, so this must be
 *      deployed (CREATE2, salt mined by `HookMiner`) at an address whose flag bits are
 *      exactly `BEFORE_INITIALIZE_FLAG`. It implements no other hook, so v4 never calls
 *      anything else on it — swaps and liquidity changes run as in a hookless pool.
 */
contract LaunchPoolGate {
    /// @notice The only address allowed to initialize a pool keyed with this hook.
    address public immutable placer;

    constructor(address _placer) {
        if (_placer == address(0)) revert ZeroPlacer();
        placer = _placer;
    }

    /// @notice v4's before-initialize hook. `sender` is whoever called `PoolManager.initialize`.
    function beforeInitialize(address sender, PoolKey calldata, uint160) external view returns (bytes4) {
        if (sender != placer) revert NotPlacer(sender);
        return IHooks.beforeInitialize.selector;
    }
}
