---
trigger: always_on
---

# SecondOrder.fun InfoFi Integration: Complete Technical Specification Part 1

## Executive Summary

This specification addresses the critical integration gaps between SecondOrder.fun's raffle mechanics and InfoFi prediction markets, providing comprehensive smart contract architecture, real-time data coordination, and cross-layer arbitrage systems based on OpenZeppelin standards and Chainlink VRF best practices.

## 🚨 Critical Integration Gaps Addressed

### 1. Real-Time Position Data Feed Architecture

**Problem:** Prediction markets need live raffle position updates with direct smart contract event integration.

**Solution:** Event-driven architecture with VRF coordination and SSE streams.

### 2. Sliding Window System Compatibility

**Problem:** Dynamic win probability calculations as positions slide need real-time InfoFi market updates.

**Solution:** Automated probability recalculation with hybrid pricing model.

### 3. VRF Winner Selection → Prediction Market Settlement

**Problem:** Coordination between VRF callbacks and InfoFi market resolution within 5-30 minute window.

**Solution:** Single VRF callback triggers both raffle resolution and InfoFi settlement atomically.

## Smart Contract Architecture

### Core Integration Contracts (NEW)

#### InfoFiMarketFactory.sol

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./interfaces/IRaffleBondingCurve.sol";
import "./interfaces/IInfoFiMarket.sol";

/**
 * @title InfoFiMarketFactory
 * @dev Automatically creates prediction markets when raffle positions cross thresholds
 */
contract InfoFiMarketFactory is AccessControl, ReentrancyGuard {
    bytes32 public constant MARKET_CREATOR_ROLE = keccak256("MARKET_CREATOR_ROLE");
    bytes32 public constant ADMIN_ROLE = DEFAULT_ADMIN_ROLE;

    struct MarketParameters {
        uint256 threshold;          // Position threshold for market creation (basis points)
        bool isActive;             // Whether this market type is active
        uint256 creationFee;       // Fee for creating this market type
    }

    mapping(bytes32 => MarketParameters) public marketParameters;
    mapping(address => mapping(bytes32 => address)) public playerMarkets; // player => marketType => marketAddress
    mapping(address => uint256) public playerWinProbabilities; // Cache for real-time updates

    address public immutable raffleContract;
    address public immutable priceOracle;

    // Events following OpenZeppelin patterns
    event MarketCreated(
        bytes32 indexed marketId,
        address indexed player,
        bytes32 indexed marketType,
        uint256 probability,
        address marketContract
    );

    event MarketParametersUpdated(
        bytes32 indexed marketType,
        uint256 newThreshold,
        bool isActive
    );

    event ProbabilityUpdated(
        address indexed player,
        uint256 oldProbability,
        uint256 newProbability
    );

    constructor(
        address _raffleContract,
        address _priceOracle,
        address _initialAdmin
    ) {
        raffleContract = _raffleContract;
        priceOracle = _priceOracle;

        _grantRole(ADMIN_ROLE, _initialAdmin);
        _grantRole(MARKET_CREATOR_ROLE, address(this)); // Self-creation capability

        // Initialize default market types
        _initializeDefaultMarkets();
    }

    /**
     * @dev Receives position updates from RaffleBondingCurve and triggers market creation
     * Called via cross-contract integration when positions cross thresholds
     */
    function onPositionUpdate(
        address player,
        uint256 oldTickets,
        uint256 newTickets,
        uint256 totalTickets
    ) external onlyRole(MARKET_CREATOR_ROLE) nonReentrant {
        require(msg.sender == raffleContract, "Only raffle contract");

        uint256 newProbability = (newTickets * 10000) / totalTickets; // Basis points
        uint256 oldProbability = playerWinProbabilities[player];

        // Update cached probability
        playerWinProbabilities[player] = newProbability;
        emit ProbabilityUpdated(player, oldProbability, newProbability);

        // Check if we need to create new markets
        _checkAndCreateMarkets(player, newProbability, oldProbability);

        // Update existing market prices via oracle
        IInfoFiPriceOracle(priceOracle).updateRafflePricing(player, newProbability);
    }

    /**
     * @dev Internal market creation logic with threshold checking
     */
    function _checkAndCreateMarkets(
        address player,
        uint256 newProbability,
        uint256 oldProbability
    ) internal {
        bytes32[] memory marketTypes = _getActiveMarketTypes();

        for (uint256 i = 0; i < marketTypes.length; i++) {
            bytes32 marketType = marketTypes[i];
            MarketParameters memory params = marketParameters[marketType];

            // Create market if crossing threshold upward
            if (newProbability >= params.threshold &&
                oldProbability < params.threshold &&
                playerMarkets[player][marketType] == address(0)) {

                _createMarket(player, marketType, newProbability);
            }
        }
    }

    /**
     * @dev Creates a new InfoFi market for a player crossing threshold
     */
    function _createMarket(
        address player,
        bytes32 marketType,
        uint256 probability
    ) internal {
        // Create unique market ID
        bytes32 marketId = keccak256(abi.encodePacked(
            player,
            marketType,
            block.timestamp,
            block.number
        ));

        // Deploy market contract (implementation would depend on chosen InfoFi framework)
        address marketContract = _deployMarketContract(marketId, player, marketType, probability);

        // Store market reference
        playerMarkets[player][marketType] = marketContract;

        emit MarketCreated(marketId, player, marketType, probability, marketContract);
    }

    /**
     * @dev Deploys market contract based on type
     * Implementation depends on chosen InfoFi framework (Gnosis CTF, custom AMM, etc.)
     */
    function _deployMarketContract(
        bytes32 marketId,
        address player,
        bytes32 marketType,
        uint256 probability
    ) internal returns (address) {
        // This would deploy the actual prediction market contract
        // Implementation varies based on InfoFi framework choice
        // For now, placeholder that would be replaced with actual deployment logic
        revert("Market deployment not implemented");
    }

    /**
     * @dev Initialize default market types with OpenZeppelin AccessControl
     */
    function _initializeDefaultMarkets() internal {
        // Winner prediction markets (1% threshold)
        marketParameters[keccak256("WINNER_PREDICTION")] = MarketParameters({
            threshold: 100, // 1% in basis points
            isActive: true,
            creationFee: 0
        });

        // Position size markets (5% threshold)
        marketParameters[keccak256("POSITION_SIZE")] = MarketParameters({
            threshold: 500, // 5% in basis points
            isActive: true,
            creationFee: 0
        });

        // Behavioral markets (2% threshold)
        marketParameters[keccak256("BEHAVIORAL")] = MarketParameters({
            threshold: 200, // 2% in basis points
            isActive: true,
            creationFee: 0
        });
    }

    /**
     * @dev Admin function to update market parameters
     */
    function setMarketParameters(
        bytes32 marketType,
        uint256 threshold,
        bool isActive,
        uint256 creationFee
    ) external onlyRole(ADMIN_ROLE) {
        marketParameters[marketType] = MarketParameters({
            threshold: threshold,
            isActive: isActive,
            creationFee: creationFee
        });

        emit MarketParametersUpdated(marketType, threshold, isActive);
    }

    /**
     * @dev Emergency pause mechanism
     */
    function pauseMarketCreation(bytes32 marketType) external onlyRole(ADMIN_ROLE) {
        marketParameters[marketType].isActive = false;
        emit MarketParametersUpdated(marketType, marketParameters[marketType].threshold, false);
    }

    /**
     * @dev Get all active market types (helper function)
     */
    function _getActiveMarketTypes() internal pure returns (bytes32[] memory) {
        bytes32[] memory types = new bytes32[](3);
        types[0] = keccak256("WINNER_PREDICTION");
        types[1] = keccak256("POSITION_SIZE");
        types[2] = keccak256("BEHAVIORAL");
        return types;
    }
}
```
