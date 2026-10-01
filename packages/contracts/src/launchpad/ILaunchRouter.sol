// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title ILaunchRouter
 * @notice Buy and sell launched tokens against native ETH.
 *
 * @dev The one interface the app trades through. Clients encode calls against THIS ABI
 *      and read the active implementation from `TokenLaunchpad.router()`, so switching
 *      routers — ours for another, or an adapter over Uniswap's Universal Router — is a
 *      single `setRouter` transaction with no client release. That is the whole point of
 *      the interface: nothing outside an implementation may depend on how it swaps.
 *
 *      Every implementation must:
 *      - trade only tokens the launchpad launched (`isLaunchToken`), so the app can never
 *        be pointed at an arbitrary pool;
 *      - enforce `minOut` and `deadline` itself, reverting rather than filling worse;
 *      - return any ETH a buy did not spend, and pull only the tokens a sell actually
 *        spends — a pool that runs out of range fills partially, and the difference must
 *        never stay in the router;
 *      - take no fee of its own. Trading fees are the pool's.
 */
interface ILaunchRouter {
    /// @notice Spend all of `msg.value` (or as much as the pool can fill) buying `token`.
    /// @param token        A token launched by the launchpad.
    /// @param minTokensOut Revert if fewer tokens would be received.
    /// @param recipient    Receives the tokens. Unspent ETH goes back to `msg.sender`.
    /// @param deadline     Revert after this timestamp.
    /// @return tokensOut   Tokens delivered to `recipient`.
    function buy(address token, uint256 minTokensOut, address recipient, uint256 deadline)
        external
        payable
        returns (uint256 tokensOut);

    /// @notice Sell up to `tokensIn` of `token` for ETH. The caller must have approved the router.
    /// @param token      A token launched by the launchpad.
    /// @param tokensIn   Maximum tokens to sell; only what the pool fills is pulled.
    /// @param minEthOut  Revert if less ETH would be received.
    /// @param recipient  Receives the ETH.
    /// @param deadline   Revert after this timestamp.
    /// @return ethOut    ETH delivered to `recipient`.
    function sell(address token, uint256 tokensIn, uint256 minEthOut, address recipient, uint256 deadline)
        external
        returns (uint256 ethOut);
}
