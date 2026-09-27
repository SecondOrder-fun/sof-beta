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
     * @notice Place `amount` of `token` as liquidity, quoted against native ETH.
     * @dev Called by the launchpad with the tokens already transferred in. The
     *      implementation must consume exactly what it was given or revert; the
     *      launchpad asserts it holds nothing afterwards.
     * @param token          The launched token.
     * @param amount         Token amount to place (the whole sale supply).
     * @param startPriceWei  Creator-chosen starting price, in wei of ETH per whole token.
     * @return placementId   Venue-specific handle (a v4 pool id, an LP token id, …).
     */
    function place(address token, uint256 amount, uint256 startPriceWei) external returns (bytes32 placementId);
}
