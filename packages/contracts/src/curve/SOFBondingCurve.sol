// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {AccessControl} from "openzeppelin-contracts/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "openzeppelin-contracts/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "openzeppelin-contracts/contracts/token/ERC20/utils/SafeERC20.sol";
import {Pausable} from "openzeppelin-contracts/contracts/utils/Pausable.sol";
import {IERC20Permit} from "openzeppelin-contracts/contracts/token/ERC20/extensions/IERC20Permit.sol";
import {IRaffleToken} from "./IRaffleToken.sol";
import {IRaffle} from "../lib/IRaffle.sol";
import {RaffleTypes} from "../lib/RaffleTypes.sol";

// ============================================================================
// CUSTOM ERRORS - Clear, gas-efficient error reporting
// ============================================================================

error CurveNotInitialized();
error CurveAlreadyInitialized();
error TradingLocked();
error TradingNotLocked();
error InsufficientBalance(uint256 required, uint256 available);
error SlippageExceeded(uint256 cost, uint256 maxAllowed);
error ExceedsMaxSupply(uint256 requested, uint256 max);
error InsufficientReserves(uint256 required, uint256 available);
error InsufficientSupply(uint256 requested, uint256 available);
error InvalidBondSteps();
error InvalidBondStepRange();
error InvalidBondStepPrice();
error InvalidBondStepOrder();
error BondStepOverflow();
error RaffleAlreadySet();
error RaffleNotSet();
error AmountZero();
error AmountTooLarge(uint256 amount);
error InvalidAddress();
error FeeTooHigh(uint256 fee);
error TradingSellOnly();

/**
 * @title SOF Bonding Curve
 * @notice Mint.club-inspired DBC bonding curve that only accepts $SOF as payment
 * @dev Discrete Bonding Curve with step-based pricing and season locking capability
 */
contract SOFBondingCurve is AccessControl, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    bytes32 public constant RAFFLE_MANAGER_ROLE = keccak256("RAFFLE_MANAGER_ROLE");
    bytes32 public constant EMERGENCY_ROLE = keccak256("EMERGENCY_ROLE");

    // Core contracts
    IERC20 public immutable sofToken;
    IRaffleToken public raffleToken;
    // Raffle callback wiring
    address public raffle;
    uint256 public raffleSeasonId;

    // Curve configuration
    struct CurveConfig {
        uint256 totalSupply; // Current total supply of raffle tokens
        uint256 sofReserves; // Current $SOF reserves in the curve (excluding accumulated fees)
        uint256 currentStep; // Current step index in the bond steps
        uint16 buyFee; // Buy fee in basis points (e.g., 10 = 0.1%)
        uint16 sellFee; // Sell fee in basis points (e.g., 70 = 0.7%)
        bool tradingLocked; // Whether trading is locked (season ended)
        bool initialized; // Whether curve has been initialized
        bool sellOnly; // Whether only sells are allowed (season cancelled, users exiting)
    }

    CurveConfig public curveConfig;
    RaffleTypes.BondStep[] public bondSteps;

    // Player ticket tracking (mirrors mint/burn actions for fast reads)
    mapping(address => uint256) public playerTickets;

    // Treasury fee tracking
    uint256 public accumulatedFees;
    address public treasuryAddress; // Where accumulated fees are sent

    // Events
    event TokensPurchased( // total paid including fee
    address indexed buyer, uint256 sofAmount, uint256 tokensReceived, uint256 feeAmount);

    event TokensSold( // amount sent to seller after fee
    address indexed seller, uint256 tokenAmount, uint256 sofReceived, uint256 feeAmount);

    // Emitted on every buy/sell reflecting the new position and probability basis points
    event PositionUpdate(
        uint256 indexed seasonId,
        address indexed player,
        uint256 oldTickets,
        uint256 newTickets,
        uint256 totalTickets,
        uint256 probabilityBps
    );

    event TradingLockedEvent(uint256 timestamp);
    event SofExtracted(address indexed to, uint256 amount);
    event CurveInitialized(address raffleToken, uint256 stepCount);
    event FeesExtracted(address indexed to, uint256 amount);

    constructor(address _sofToken, address _admin) {
        if (_sofToken == address(0)) revert InvalidAddress();
        if (_admin == address(0)) revert InvalidAddress();
        sofToken = IERC20(_sofToken);
        // Grant admin roles to both the deployer and the factory (msg.sender)
        // Factory needs DEFAULT_ADMIN_ROLE to grant other roles during initialization
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender); // SeasonFactory
        _grantRole(DEFAULT_ADMIN_ROLE, _admin); // Deployer EOA
        _grantRole(EMERGENCY_ROLE, _admin);
        _grantRole(RAFFLE_MANAGER_ROLE, _admin);
    }

    /**
     * @notice Initialize the bonding curve for a new season
     * @param _raffleToken Address of the raffle token for this season
     * @param _bondSteps Array of BondStep defining the pricing curve
     * @param _buyFee Buy fee in basis points
     * @param _sellFee Sell fee in basis points
     * @param _treasuryAddress Where accumulated fees are sent
     */
    function initializeCurve(
        address _raffleToken,
        RaffleTypes.BondStep[] calldata _bondSteps,
        uint16 _buyFee,
        uint16 _sellFee,
        address _treasuryAddress
    ) external onlyRole(RAFFLE_MANAGER_ROLE) {
        if (curveConfig.initialized) revert CurveAlreadyInitialized();
        if (_raffleToken == address(0)) revert InvalidAddress();
        if (_treasuryAddress == address(0)) revert InvalidAddress();
        if (_bondSteps.length == 0) revert InvalidBondSteps();
        if (_buyFee > 1000) revert FeeTooHigh(_buyFee);
        if (_sellFee > 1000) revert FeeTooHigh(_sellFee);

        raffleToken = IRaffleToken(_raffleToken);

        // Replace steps
        delete bondSteps;
        for (uint256 i = 0; i < _bondSteps.length; i++) {
            if (_bondSteps[i].rangeTo == 0) revert InvalidBondStepRange();
            if (_bondSteps[i].price == 0) revert InvalidBondStepPrice();
            if (i > 0) {
                if (_bondSteps[i].rangeTo <= _bondSteps[i - 1].rangeTo) revert InvalidBondStepOrder();
            }
            // Guardrails: ensure step bounds fit within uint128 and multiplication safety expectations
            // Since rangeTo and price are uint128, tokensInStep * price fits into uint256 without overflow.
            // Additionally, cap the final range to avoid unrealistic supplies.
            if (_bondSteps[i].rangeTo > type(uint128).max) revert BondStepOverflow();
            if (_bondSteps[i].price > type(uint128).max) revert BondStepOverflow();
            bondSteps.push(_bondSteps[i]);
        }

        curveConfig = CurveConfig({
            totalSupply: 0,
            sofReserves: 0,
            currentStep: 0,
            buyFee: _buyFee,
            sellFee: _sellFee,
            tradingLocked: false,
            initialized: true,
            sellOnly: false
        });

        treasuryAddress = _treasuryAddress;

        emit CurveInitialized(_raffleToken, _bondSteps.length);
    }

    /**
     * @notice Set the raffle contract and season id for participant callbacks
     * @param _raffle Raffle contract address
     * @param _seasonId Season identifier
     */
    function setRaffleInfo(address _raffle, uint256 _seasonId) external onlyRole(RAFFLE_MANAGER_ROLE) {
        if (_raffle == address(0)) revert InvalidAddress();
        if (raffle != address(0)) revert RaffleAlreadySet();
        raffle = _raffle;
        raffleSeasonId = _seasonId;
    }

    /**
     * @notice Buy raffle tokens with $SOF
     * @param tokenAmount Amount of raffle tokens to buy
     * @param maxSofAmount Maximum $SOF willing to spend (slippage protection)
     */
    function buyTokens(uint256 tokenAmount, uint256 maxSofAmount) external nonReentrant whenNotPaused {
        _buyTokens(msg.sender, tokenAmount, maxSofAmount);
    }

    function buyTokensWithPermit(
        uint256 tokenAmount,
        uint256 maxSofAmount,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external nonReentrant whenNotPaused {
        try IERC20Permit(address(sofToken)).permit(
            msg.sender, address(this), maxSofAmount, deadline, v, r, s
        ) {} catch {}
        _buyTokens(msg.sender, tokenAmount, maxSofAmount);
    }

    function _buyTokens(address buyer, uint256 tokenAmount, uint256 maxSofAmount) internal {
        if (!curveConfig.initialized) revert CurveNotInitialized();
        if (curveConfig.tradingLocked) revert TradingLocked();
        if (curveConfig.sellOnly) revert TradingSellOnly();
        if (tokenAmount == 0) revert AmountZero();

        // Guardrail: prevent addition overflow when computing target supply inside price calc
        if (tokenAmount > type(uint256).max - curveConfig.totalSupply) revert AmountTooLarge(tokenAmount);
        uint256 baseCost = calculateBuyPrice(tokenAmount);
        uint256 fee = (baseCost * curveConfig.buyFee) / 10000; // fee accrues to accumulatedFees
        uint256 totalCost = baseCost + fee; // fee on top to keep reserves consistent with pricing
        if (totalCost > maxSofAmount) revert SlippageExceeded(totalCost, maxSofAmount);
        // Track old values prior to state mutation
        uint256 preTotal = curveConfig.totalSupply;
        uint256 oldTickets = playerTickets[buyer];

        // Do not allow supply to exceed the final bond step's cap
        if (bondSteps.length > 0) {
            uint256 lastCap = uint256(bondSteps[bondSteps.length - 1].rangeTo);
            if (preTotal + tokenAmount > lastCap) revert ExceedsMaxSupply(preTotal + tokenAmount, lastCap);
        }

        // Transfer $SOF from buyer (base + fee)
        sofToken.safeTransferFrom(buyer, address(this), totalCost);

        // Mint raffle tokens to buyer (assumes raffleToken has mint(address,uint256))
        _mintRaffleTokens(buyer, tokenAmount);

        // Update curve state (reserves track only base cost; fees accumulate separately)
        curveConfig.totalSupply += tokenAmount;
        curveConfig.sofReserves += baseCost;
        accumulatedFees += fee;

        // Update player position
        uint256 newTickets = oldTickets + tokenAmount;
        playerTickets[buyer] = newTickets;

        _updateCurrentStep();

        emit TokensPurchased(buyer, totalCost, tokenAmount, fee);

        // Emit position update
        uint256 totalTickets = curveConfig.totalSupply;
        uint256 newBps = (newTickets * 10000) / (totalTickets == 0 ? 1 : totalTickets);

        emit PositionUpdate(raffleSeasonId, buyer, oldTickets, newTickets, totalTickets, newBps);

        // Callback to raffle for participant tracking
        if (raffle != address(0)) {
            IRaffle(raffle).recordParticipant(raffleSeasonId, buyer, tokenAmount);
        }
    }

    /**
     * @notice Sell raffle tokens for $SOF
     * @param tokenAmount Amount of raffle tokens to sell
     * @param minSofAmount Minimum $SOF expected to receive (slippage protection)
     */
    function sellTokens(uint256 tokenAmount, uint256 minSofAmount) external nonReentrant whenNotPaused {
        if (!curveConfig.initialized) revert CurveNotInitialized();
        if (curveConfig.tradingLocked) revert TradingLocked();
        if (tokenAmount == 0) revert AmountZero();
        if (tokenAmount > curveConfig.totalSupply) revert InsufficientSupply(tokenAmount, curveConfig.totalSupply);

        // Guardrail: ensure tokenAmount does not exceed current supply for pricing calc
        uint256 baseReturn = calculateSellPrice(tokenAmount);

        // Edge case: if selling all tokens, cap baseReturn to available reserves
        // This handles rounding errors in the discrete bonding curve calculation
        if (tokenAmount == curveConfig.totalSupply && baseReturn > curveConfig.sofReserves) {
            baseReturn = curveConfig.sofReserves;
        }

        uint256 fee = (baseReturn * curveConfig.sellFee) / 10000; // fee accrues to accumulatedFees
        uint256 payout = baseReturn - fee;

        if (payout < minSofAmount) revert SlippageExceeded(payout, minSofAmount);
        if (curveConfig.sofReserves < baseReturn) revert InsufficientReserves(baseReturn, curveConfig.sofReserves);

        // Track old values before mutation
        uint256 oldTickets = playerTickets[msg.sender];
        // Burn raffle tokens from seller (assumes burnFrom)
        _burnRaffleTokens(msg.sender, tokenAmount);

        // Transfer $SOF to seller (after fee)
        sofToken.safeTransfer(msg.sender, payout);

        // Update curve state (reserves decrease by base return; fees accumulate separately)
        curveConfig.totalSupply -= tokenAmount;
        curveConfig.sofReserves -= baseReturn;
        accumulatedFees += fee;

        // Update player position
        uint256 newTickets = oldTickets - tokenAmount;
        playerTickets[msg.sender] = newTickets;

        _updateCurrentStep();

        emit TokensSold(msg.sender, tokenAmount, payout, fee);

        // Callback to raffle for participant tracking on position reduction
        if (raffle != address(0)) {
            IRaffle(raffle).removeParticipant(raffleSeasonId, msg.sender, tokenAmount);
        }

        // Emit position update
        uint256 totalTickets = curveConfig.totalSupply;
        uint256 newBps = (newTickets * 10000) / (totalTickets == 0 ? 1 : totalTickets);
        emit PositionUpdate(raffleSeasonId, msg.sender, oldTickets, newTickets, totalTickets, newBps);
    }

    /**
     * @notice Lock trading at season end (called by Raffle contract)
     */
    function lockTrading() external onlyRole(RAFFLE_MANAGER_ROLE) {
        if (!curveConfig.initialized) revert CurveNotInitialized();
        if (curveConfig.tradingLocked) revert TradingLocked();
        curveConfig.tradingLocked = true;
        emit TradingLockedEvent(block.timestamp);
    }

    /**
     * @notice Unlock trading in sell-only mode (for cancelled season recovery)
     * @dev Users can sell their tokens to exit, but cannot buy new ones
     */
    function unlockTradingSellOnly() external onlyRole(RAFFLE_MANAGER_ROLE) {
        if (!curveConfig.initialized) revert CurveNotInitialized();
        if (!curveConfig.tradingLocked) revert TradingNotLocked();
        curveConfig.tradingLocked = false;
        curveConfig.sellOnly = true;
        emit TradingUnlockedSellOnly(block.timestamp);
    }

    event TradingUnlockedSellOnly(uint256 timestamp);

    /**
     * @notice Extract $SOF reserves for prize distribution
     * @param to Address to send the $SOF to (usually prize distributor)
     * @param amount Amount of $SOF to extract
     */
    function extractSof(address to, uint256 amount) external onlyRole(RAFFLE_MANAGER_ROLE) {
        if (!curveConfig.tradingLocked) revert TradingNotLocked();
        if (amount > curveConfig.sofReserves) revert InsufficientReserves(amount, curveConfig.sofReserves);
        if (to == address(0)) revert InvalidAddress();

        sofToken.safeTransfer(to, amount);
        curveConfig.sofReserves -= amount;

        emit SofExtracted(to, amount);
    }

    /**
     * @notice Calculate the $SOF cost to buy a certain amount of tokens (base cost, excl. fee)
     * @param tokenAmount Amount of tokens to buy
     * @return Total $SOF base cost
     */
    function calculateBuyPrice(uint256 tokenAmount) public view returns (uint256) {
        if (tokenAmount == 0) return 0;

        uint256 currentSupply = curveConfig.totalSupply;
        // Guardrail: avoid overflow
        if (tokenAmount > type(uint256).max - currentSupply) {
            revert("Curve: supply overflow");
        }
        uint256 targetSupply = currentSupply + tokenAmount;
        uint256 totalCost = 0;

        for (uint256 i = 0; i < bondSteps.length; i++) {
            uint256 stepStart = i == 0 ? 0 : bondSteps[i - 1].rangeTo;
            uint256 stepEnd = bondSteps[i].rangeTo;

            if (currentSupply >= stepEnd) continue;
            if (targetSupply <= stepStart) break;

            uint256 buyStart = currentSupply > stepStart ? currentSupply : stepStart;
            uint256 buyEnd = targetSupply < stepEnd ? targetSupply : stepEnd;
            uint256 tokensInStep = buyEnd - buyStart;

            // tokensInStep <= 2^128, price <= 2^128 -> product fits in uint256
            totalCost += tokensInStep * uint256(bondSteps[i].price);
        }

        return totalCost;
    }

    /**
     * @notice Calculate the $SOF received from selling a certain amount of tokens (base return, excl. fee)
     * @param tokenAmount Amount of tokens to sell
     * @return $SOF base amount to be returned
     */
    function calculateSellPrice(uint256 tokenAmount) public view returns (uint256) {
        if (tokenAmount == 0) return 0;

        uint256 currentSupply = curveConfig.totalSupply;
        // Guardrail: if tokenAmount exceeds currentSupply, return 0 to avoid underflow in view
        if (tokenAmount > currentSupply) return 0;
        uint256 targetSupply = currentSupply - tokenAmount;
        uint256 totalReturn = 0;

        for (int256 i = int256(bondSteps.length) - 1; i >= 0; i--) {
            // forge-lint: disable-next-line(unsafe-typecast) Safe: i is int256 loop var, always >= 0 here
            uint256 stepStart = i == 0 ? 0 : bondSteps[uint256(i - 1)].rangeTo;
            // forge-lint: disable-next-line(unsafe-typecast) Safe: i is int256 loop var, always >= 0 here
            uint256 stepEnd = bondSteps[uint256(i)].rangeTo;
            if (targetSupply >= stepEnd) continue;
            // If currentSupply is below this step, keep iterating to lower steps instead of breaking
            if (currentSupply <= stepStart) continue;
            uint256 sellStart = targetSupply > stepStart ? targetSupply : stepStart;
            uint256 sellEnd = currentSupply < stepEnd ? currentSupply : stepEnd;
            uint256 tokensInStep = sellEnd - sellStart;
            // forge-lint: disable-next-line(unsafe-typecast) Safe: i is int256 loop var >= 0; price cast widens
            totalReturn += tokensInStep * uint256(bondSteps[uint256(i)].price);
        }

        return totalReturn;
    }

    /**
     * @notice Get current step information
     */
    function getCurrentStep() external view returns (uint256 step, uint256 price, uint256 rangeTo) {
        if (bondSteps.length == 0) return (0, 0, 0);
        uint256 stepIndex = curveConfig.currentStep;
        if (stepIndex >= bondSteps.length) stepIndex = bondSteps.length - 1;
        return (stepIndex, uint256(bondSteps[stepIndex].price), uint256(bondSteps[stepIndex].rangeTo));
    }

    /**
     * @notice Get all bond steps
     */
    function getBondSteps() external view returns (RaffleTypes.BondStep[] memory) {
        return bondSteps;
    }

    /**
     * @notice Getter for current $SOF reserves tracked by the curve
     */
    function getSofReserves() external view returns (uint256) {
        return curveConfig.sofReserves;
    }

    /**
     * @notice Extract accumulated fees directly to treasury address
     * @dev Can be called manually by admin or automatically at season end
     */
    function extractFeesToTreasury() external onlyRole(RAFFLE_MANAGER_ROLE) nonReentrant {
        if (accumulatedFees == 0) revert AmountZero();

        uint256 feesToExtract = accumulatedFees;
        accumulatedFees = 0;

        // Transfer fees directly to treasury address (no SOFToken intermediary)
        sofToken.safeTransfer(treasuryAddress, feesToExtract);

        emit FeesExtracted(treasuryAddress, feesToExtract);
    }

    /**
     * @notice Emergency pause function
     */
    function pause() external onlyRole(EMERGENCY_ROLE) {
        _pause();
    }

    /**
     * @notice Emergency unpause function
     */
    function unpause() external onlyRole(EMERGENCY_ROLE) {
        _unpause();
    }

    // Internal functions
    function _updateCurrentStep() internal {
        uint256 supply = curveConfig.totalSupply;
        uint256 lastIndex = bondSteps.length > 0 ? bondSteps.length - 1 : 0;

        bool set;
        for (uint256 i = 0; i < bondSteps.length; i++) {
            if (supply <= bondSteps[i].rangeTo) {
                curveConfig.currentStep = i;
                set = true;
                break;
            }
        }
        // If supply is beyond the last step range, pin to last step
        if (!set && bondSteps.length > 0) {
            curveConfig.currentStep = lastIndex;
        }
    }

    function _mintRaffleTokens(address to, uint256 amount) internal {
        raffleToken.mint(to, amount);
    }

    function _burnRaffleTokens(address from, uint256 amount) internal {
        raffleToken.burnFrom(from, amount);
    }
}
