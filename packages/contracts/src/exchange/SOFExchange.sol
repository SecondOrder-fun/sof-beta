// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {AccessControl} from "openzeppelin-contracts/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "openzeppelin-contracts/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "openzeppelin-contracts/contracts/utils/Pausable.sol";
import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "openzeppelin-contracts/contracts/token/ERC20/utils/SafeERC20.sol";
import {SOFToken} from "../token/SOFToken.sol";
import {ISOFExchange} from "./ISOFExchange.sol";

/**
 * @title SOFExchange
 * @notice Fixed-rate exchange for acquiring/selling $SOF with ETH or ERC20 tokens (e.g. USDC)
 * @dev Buy side mints SOF (requires MINTER_ROLE on SOFToken). Sell side sends reserves.
 */
contract SOFExchange is ISOFExchange, AccessControl, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    bytes32 public constant RATE_ADMIN_ROLE = keccak256("RATE_ADMIN_ROLE");

    /// @dev Sentinel address representing native ETH
    address public constant ETH_SENTINEL = address(0);

    SOFToken public immutable sofToken;

    /// @notice Rate: SOF per 1e18 of token. Use address(0) for ETH.
    mapping(address => uint256) public rates;

    /// @notice Whitelisted ERC20 tokens (auto-set when rate > 0)
    mapping(address => bool) public supportedTokens;

    /// @notice Daily sell limit in SOF wei (0 = unlimited)
    uint256 public dailySellLimit;

    /// @notice Per-user per-day sell usage tracking: _dailyUsage[user][day] = sofSold
    mapping(address => mapping(uint256 => uint256)) private _dailyUsage;

    constructor(address _sofToken, address _admin) {
        sofToken = SOFToken(_sofToken);
        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(RATE_ADMIN_ROLE, _admin);
    }

    // ========================================================================
    // Admin Functions
    // ========================================================================

    /**
     * @notice Set the exchange rate for a token
     * @param token Token address (address(0) for ETH)
     * @param rate SOF per 1e18 of token
     */
    function setRate(address token, uint256 rate) external onlyRole(RATE_ADMIN_ROLE) {
        rates[token] = rate;
        if (token != ETH_SENTINEL) {
            supportedTokens[token] = rate > 0;
        }
        emit RateUpdated(token, rate);
    }

    /**
     * @notice Set the daily sell limit per user
     * @param newLimit Daily limit in SOF wei (0 = unlimited)
     */
    function setDailySellLimit(uint256 newLimit) external onlyRole(DEFAULT_ADMIN_ROLE) {
        dailySellLimit = newLimit;
        emit DailySellLimitUpdated(newLimit);
    }

    /**
     * @notice Deposit ETH reserves for sell-side liquidity
     */
    function depositReserves() external payable onlyRole(DEFAULT_ADMIN_ROLE) {
        if (msg.value == 0) revert ZeroAmount();
        emit ReservesDeposited(ETH_SENTINEL, msg.value);
    }

    /**
     * @notice Deposit ERC20 token reserves for sell-side liquidity
     * @param token Token address
     * @param amount Amount to deposit
     */
    function depositTokenReserves(address token, uint256 amount) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (amount == 0) revert ZeroAmount();
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        emit ReservesDeposited(token, amount);
    }

    /**
     * @notice Withdraw ETH reserves
     * @param amount Amount of ETH to withdraw
     */
    function withdrawReserves(uint256 amount) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (amount == 0) revert ZeroAmount();
        if (address(this).balance < amount) revert InsufficientReserves();
        (bool success,) = payable(msg.sender).call{value: amount}("");
        if (!success) revert TransferFailed();
        emit ReservesWithdrawn(ETH_SENTINEL, amount);
    }

    /**
     * @notice Withdraw ERC20 token reserves
     * @param token Token address
     * @param amount Amount to withdraw
     */
    function withdrawTokenReserves(address token, uint256 amount) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (amount == 0) revert ZeroAmount();
        if (IERC20(token).balanceOf(address(this)) < amount) revert InsufficientReserves();
        IERC20(token).safeTransfer(msg.sender, amount);
        emit ReservesWithdrawn(token, amount);
    }

    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    // ========================================================================
    // Buy Functions (mint SOF)
    // ========================================================================

    /// @inheritdoc ISOFExchange
    function swapETHForSOF() external payable nonReentrant whenNotPaused {
        if (msg.value == 0) revert ZeroAmount();
        uint256 rate = rates[ETH_SENTINEL];
        if (rate == 0) revert RateNotSet();

        uint256 sofOut = (msg.value * rate) / 1e18;
        sofToken.mint(msg.sender, sofOut);

        emit Swapped(msg.sender, ETH_SENTINEL, address(sofToken), msg.value, sofOut);
    }

    /// @inheritdoc ISOFExchange
    function swapTokenForSOF(address token, uint256 amount) external nonReentrant whenNotPaused {
        if (amount == 0) revert ZeroAmount();
        if (!supportedTokens[token]) revert UnsupportedToken();
        uint256 rate = rates[token];
        if (rate == 0) revert RateNotSet();

        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);

        // rate is SOF per 1e18 of token, but token may have different decimals
        // The rate already accounts for the token's decimals — caller sets rate accordingly
        uint256 sofOut = (amount * rate) / 1e18;
        sofToken.mint(msg.sender, sofOut);

        emit Swapped(msg.sender, token, address(sofToken), amount, sofOut);
    }

    // ========================================================================
    // Sell Functions (burn SOF, send reserves)
    // ========================================================================

    /// @inheritdoc ISOFExchange
    function swapSOFForETH(uint256 sofAmount) external nonReentrant whenNotPaused {
        if (sofAmount == 0) revert ZeroAmount();
        uint256 rate = rates[ETH_SENTINEL];
        if (rate == 0) revert RateNotSet();

        _checkDailySellLimit(msg.sender, sofAmount);

        // ethOut = sofAmount / rate * 1e18
        uint256 ethOut = (sofAmount * 1e18) / rate;
        if (address(this).balance < ethOut) revert InsufficientReserves();

        IERC20(address(sofToken)).safeTransferFrom(msg.sender, address(this), sofAmount);

        (bool success,) = payable(msg.sender).call{value: ethOut}("");
        if (!success) revert TransferFailed();

        emit Swapped(msg.sender, address(sofToken), ETH_SENTINEL, sofAmount, ethOut);
    }

    /// @inheritdoc ISOFExchange
    function swapSOFForToken(address token, uint256 sofAmount) external nonReentrant whenNotPaused {
        if (sofAmount == 0) revert ZeroAmount();
        if (!supportedTokens[token]) revert UnsupportedToken();
        uint256 rate = rates[token];
        if (rate == 0) revert RateNotSet();

        _checkDailySellLimit(msg.sender, sofAmount);

        // tokenOut = sofAmount / rate * 1e18
        uint256 tokenOut = (sofAmount * 1e18) / rate;
        if (IERC20(token).balanceOf(address(this)) < tokenOut) revert InsufficientReserves();

        IERC20(address(sofToken)).safeTransferFrom(msg.sender, address(this), sofAmount);
        IERC20(token).safeTransfer(msg.sender, tokenOut);

        emit Swapped(msg.sender, address(sofToken), token, sofAmount, tokenOut);
    }

    // ========================================================================
    // View Functions
    // ========================================================================

    /// @inheritdoc ISOFExchange
    function getRate(address token) external view returns (uint256) {
        return rates[token];
    }

    /// @inheritdoc ISOFExchange
    function getQuote(address tokenIn, address tokenOut, uint256 amountIn) external view returns (uint256) {
        address sofAddr = address(sofToken);

        // Buying SOF: tokenIn is ETH or ERC20, tokenOut is SOF
        if (tokenOut == sofAddr) {
            uint256 rate = rates[tokenIn];
            if (rate == 0) revert RateNotSet();
            return (amountIn * rate) / 1e18;
        }

        // Selling SOF: tokenIn is SOF, tokenOut is ETH or ERC20
        if (tokenIn == sofAddr) {
            uint256 rate = rates[tokenOut];
            if (rate == 0) revert RateNotSet();
            return (amountIn * 1e18) / rate;
        }

        revert UnsupportedToken();
    }

    /// @inheritdoc ISOFExchange
    function getDailyUsage(address user) external view returns (uint256 used, uint256 remaining) {
        uint256 day = block.timestamp / 1 days;
        used = _dailyUsage[user][day];
        if (dailySellLimit == 0) {
            remaining = type(uint256).max;
        } else {
            remaining = used >= dailySellLimit ? 0 : dailySellLimit - used;
        }
    }

    // ========================================================================
    // Internal
    // ========================================================================

    function _checkDailySellLimit(address user, uint256 sofAmount) internal {
        if (dailySellLimit == 0) return; // unlimited
        uint256 day = block.timestamp / 1 days;
        uint256 used = _dailyUsage[user][day];
        uint256 remaining = dailySellLimit - used;
        if (sofAmount > remaining) revert DailySellLimitExceeded(sofAmount, remaining);
        _dailyUsage[user][day] = used + sofAmount;
    }

    /// @notice Accept ETH deposits
    receive() external payable {}
}
