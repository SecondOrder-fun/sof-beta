// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IFixedProductMarketMaker
 * @notice Interface for Gnosis FPMM
 * @dev Wrapper interface for 0.5.x FixedProductMarketMaker contract
 */
interface IFixedProductMarketMaker {
    function addFunding(uint256 addedFunds, uint256[] calldata distributionHint) external returns (uint256);

    function removeFunding(uint256 sharesToBurn) external returns (uint256);

    function buy(uint256 investmentAmount, uint256 outcomeIndex, uint256 minOutcomeTokensToBuy)
        external
        returns (uint256);

    function sell(uint256 returnAmount, uint256 outcomeIndex, uint256 maxOutcomeTokensToSell)
        external
        returns (uint256);

    function calcBuyAmount(uint256 investmentAmount, uint256 outcomeIndex) external view returns (uint256);

    function calcSellAmount(uint256 returnAmount, uint256 outcomeIndex) external view returns (uint256);

    function getPoolBalances() external view returns (uint256[] memory);

    function totalSupply() external view returns (uint256);

    function balanceOf(address account) external view returns (uint256);

    function transfer(address to, uint256 amount) external returns (bool);

    function transferFrom(address from, address to, uint256 amount) external returns (bool);

    function approve(address spender, uint256 amount) external returns (bool);
}
