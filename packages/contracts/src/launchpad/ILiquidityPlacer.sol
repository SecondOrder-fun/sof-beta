// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title ILiquidityPlacer
 * @notice Places a freshly launched token's supply as tradeable liquidity.
 *
 * @dev Kept behind an interface for two reasons.
 *
 *      First, the venue is a decision that has already moved once and may move again.
 *      The launchpad targets single-sided concentrated liquidity in a Uniswap v4 pool
 *      from block one — no bonding curve and no graduation event (see
 *      docs/05-features/launchpad/design.md §1.2). Aerodrome or a v3 pool would be a
 *      different implementation of this same call.
 *
 *      Second, it keeps `TokenLaunchpad` testable without a live PoolManager. The v4
 *      integration is the highest-risk part of this phase and it does not belong in the
 *      same contract as the registry and the launch bookkeeping.
 */
interface ILiquidityPlacer {
    /**
     * @notice Place `amount` of `token` as liquidity, quoted against `quoteToken`.
     * @dev Called by the launchpad with the tokens already transferred in, and only with
     *      a quote token on its allowlist. The implementation must consume exactly what it
     *      was given or revert; the launchpad asserts it holds nothing afterwards.
     * @param token       The launched token.
     * @param amount      Token amount to place (the whole sale supply).
     * @param quoteToken  What it trades against: address(0) for native ETH, else an ERC-20.
     * @param startFdv    Creator-chosen opening valuation of `amount`, in `quoteToken`'s
     *                    raw units: the starting price is `startFdv / amount`.
     * @param tradeFee    The creator-chosen trade fee in pips (10_000 = 1%), charged in
     *                    `quoteToken` on every swap; the implementation bounds it.
     * @param liquidityPreset Which fixed ladder spreads the supply along the price scale
     *                    (implementation-defined; the v4 placer has four).
     * @return placementId Venue-specific handle (a v4 pool id, an LP token id, …).
     */
    function place(
        address token,
        uint256 amount,
        address quoteToken,
        uint256 startFdv,
        uint24 tradeFee,
        uint8 liquidityPreset
    ) external returns (bytes32 placementId);

    /**
     * @notice Let the next buy of `token` in this transaction skip any early-buy surcharge.
     * @dev Launchpad-only, called right before the creator's buy inside the launch
     *      transaction — which happens before anyone else can trade, so it is not a snipe.
     *      Transient: it lasts until that buy or the end of the transaction.
     */
    function exemptNextBuy(address token) external;
}
