// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title ILaunchRouter
 * @notice Buy and sell launched tokens against their quote token: native ETH, or the
 *         allowlisted ERC-20 the launch was paired with (`TokenLaunchpad.quoteTokenOf`).
 *
 * @dev The one interface the app trades through. Clients encode calls against THIS ABI
 *      and read the active implementation from `TokenLaunchpad.router()`, so switching
 *      routers — ours for another, or an adapter over Uniswap's Universal Router — is a
 *      single `setRouter` transaction with no client release. That is the whole point of
 *      the interface: nothing outside an implementation may depend on how it swaps.
 *
 *      Every implementation must:
 *      - trade only tokens the launchpad launched (`isLaunchToken`), so the app can never
 *        be pointed at an arbitrary pool, and only against that launch's quote token;
 *      - enforce `minOut` and `deadline` itself, reverting rather than filling worse;
 *      - never keep what a partial fill did not use: return unspent ETH, and pull only
 *        the ERC-20 quote or launch tokens a swap actually spends — a pool that runs out
 *        of range fills partially, and the difference must never stay in the router;
 *      - take no fee of its own. The trade fee is the pool hook's (the placer), in the quote token.
 */
interface ILaunchRouter {
    /// @notice Spend up to `quoteIn` of `token`'s quote token buying `token`.
    /// @dev ETH-paired: send `quoteIn` as `msg.value`; unspent ETH goes back to
    ///      `msg.sender`. ERC-20-paired: send no ETH and approve the router for `quoteIn`;
    ///      only what the pool fills is pulled.
    /// @param token        A token launched by the launchpad.
    /// @param quoteIn      Most quote token to spend, in its raw units.
    /// @param minTokensOut Revert if fewer tokens would be received.
    /// @param recipient    Receives the tokens.
    /// @param deadline     Revert after this timestamp.
    /// @return tokensOut   Tokens delivered to `recipient`.
    function buy(address token, uint256 quoteIn, uint256 minTokensOut, address recipient, uint256 deadline)
        external
        payable
        returns (uint256 tokensOut);

    /// @notice Sell up to `tokensIn` of `token` for its quote token. The caller must have
    ///         approved the router.
    /// @param token        A token launched by the launchpad.
    /// @param tokensIn     Maximum tokens to sell; only what the pool fills is pulled.
    /// @param minQuoteOut  Revert if less quote token would be received.
    /// @param recipient    Receives the quote token (ETH for an ETH-paired launch).
    /// @param deadline     Revert after this timestamp.
    /// @return quoteOut    Quote token delivered to `recipient`, in its raw units.
    function sell(address token, uint256 tokensIn, uint256 minQuoteOut, address recipient, uint256 deadline)
        external
        returns (uint256 quoteOut);
}
