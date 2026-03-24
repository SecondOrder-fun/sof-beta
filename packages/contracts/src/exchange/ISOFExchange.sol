// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface ISOFExchange {
    // ========== Events ==========
    event Swapped(address indexed user, address indexed tokenIn, address indexed tokenOut, uint256 amountIn, uint256 amountOut);
    event RateUpdated(address indexed token, uint256 newRate);
    event DailySellLimitUpdated(uint256 newLimit);
    event ReservesDeposited(address indexed token, uint256 amount);
    event ReservesWithdrawn(address indexed token, uint256 amount);

    // ========== Errors ==========
    error ZeroAmount();
    error InsufficientReserves();
    error DailySellLimitExceeded(uint256 requested, uint256 remaining);
    error UnsupportedToken();
    error RateNotSet();
    error TransferFailed();

    // ========== Buy Functions ==========
    function swapETHForSOF() external payable;
    function swapTokenForSOF(address token, uint256 amount) external;

    // ========== Sell Functions ==========
    function swapSOFForETH(uint256 sofAmount) external;
    function swapSOFForToken(address token, uint256 sofAmount) external;

    // ========== View Functions ==========
    function getRate(address token) external view returns (uint256);
    function getQuote(address tokenIn, address tokenOut, uint256 amountIn) external view returns (uint256);
    function getDailyUsage(address user) external view returns (uint256 used, uint256 remaining);
}
