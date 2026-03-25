---
trigger: always_on
---

# SecondOrder.fun InfoFi Integration: Complete Technical Specification Part 2

#### InfoFiPriceOracle.sol
```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";

/**
 * @title InfoFiPriceOracle
 * @dev Hybrid pricing: 70% raffle probability + 30% market sentiment
 * Implements Chainlink AggregatorV3Interface for compatibility
 */
contract InfoFiPriceOracle is AccessControl, AggregatorV3Interface {
    bytes32 public constant PRICE_UPDATER_ROLE = keccak256("PRICE_UPDATER_ROLE");
    bytes32 public constant ADMIN_ROLE = DEFAULT_ADMIN_ROLE;
    
    struct PriceData {
        uint256 raffleProbability;    // From raffle contract (basis points)
        uint256 marketSentiment;      // From AMM trading (basis points) 
        uint256 hybridPrice;          // Calculated hybrid price
        uint256 lastUpdate;           // Timestamp of last update
        bool isActive;                // Whether this market is active
    }
    
    struct WeightingConfig {
        uint256 raffleWeight;         // Weight for raffle probability (basis points)
        uint256 marketWeight;         // Weight for market sentiment (basis points)
        uint256 lastUpdate;           // When weighting was last changed
    }
    
    mapping(bytes32 => PriceData) public marketPrices;     // marketId => price data
    mapping(address => uint256) public playerProbabilities; // player => current win probability
    
    WeightingConfig public weightingConfig;
    
    // Chainlink AggregatorV3Interface compliance
    uint8 public constant decimals = 18;
    string public description = "InfoFi Hybrid Price Oracle";
    uint256 public constant version = 1;
    
    // Events following OpenZeppelin event patterns
    event PriceUpdated(
        bytes32 indexed marketId,
        uint256 raffleProbability,
        uint256 marketSentiment,
        uint256 hybridPrice,
        uint256 timestamp
    );
    
    event WeightingChanged(
        uint256 oldRaffleWeight,
        uint256 oldMarketWeight,
        uint256 newRaffleWeight,
        uint256 newMarketWeight
    );
    
    event RaffleProbabilityUpdated(
        address indexed player,
        uint256 oldProbability,
        uint256 newProbability
    );

    constructor(address _initialAdmin) {
        _grantRole(ADMIN_ROLE, _initialAdmin);
        _grantRole(PRICE_UPDATER_ROLE, _initialAdmin);
        
        // Initialize hybrid weighting: 70% raffle, 30% market
        weightingConfig = WeightingConfig({
            raffleWeight: 7000,  // 70% in basis points
            marketWeight: 3000,  // 30% in basis points
            lastUpdate: block.timestamp
        });
    }
    
    /**
     * @dev Updates raffle probability from RaffleBondingCurve events
     * Called by InfoFiMarketFactory when position changes occur
     */
    function updateRafflePricing(
        address player,
        uint256 newProbability
    ) external onlyRole(PRICE_UPDATER_ROLE) {
        uint256 oldProbability = playerProbabilities[player];
        playerProbabilities[player] = newProbability;
        
        // Update all markets for this player
        _updatePlayerMarkets(player, oldProbability, newProbability);
        
        emit RaffleProbabilityUpdated(player, oldProbability, newProbability);
    }
    
    /**
     * @dev Updates market sentiment from AMM trading activity
     * Called by InfoFi market contracts when trading occurs
     */
    function updateMarketSentiment(
        bytes32 marketId,
        uint256 newSentiment
    ) external onlyRole(PRICE_UPDATER_ROLE) {
        PriceData storage priceData = marketPrices[marketId];
        require(priceData.isActive, "Market not active");
        
        priceData.marketSentiment = newSentiment;
        priceData.hybridPrice = _calculateHybridPrice(
            priceData.raffleProbability,
            newSentiment
        );
        priceData.lastUpdate = block.timestamp;
        
        emit PriceUpdated(
            marketId,
            priceData.raffleProbability,
            newSentiment,
            priceData.hybridPrice,
            block.timestamp
        );
    }
    
    /**
     * @dev Calculate hybrid price using weighted formula
     * Price = (raffleWeight * raffleProbability + marketWeight * marketSentiment) / 10000
     */
    function _calculateHybridPrice(
        uint256 raffleProbability,
        uint256 marketSentiment
    ) internal view returns (uint256) {
        return (
            weightingConfig.raffleWeight * raffleProbability + 
            weightingConfig.marketWeight * marketSentiment
        ) / 10000;
    }
    
    /**
     * @dev Update all markets associated with a player when their probability changes
     */
    function _updatePlayerMarkets(
        address player,
        uint256 oldProbability,
        uint256 newProbability
    ) internal {
        // In a complete implementation, this would iterate through all markets
        // for this player and update their raffle probability component
        // For now, this is a placeholder for the update logic
        
        // This would query InfoFiMarketFactory for active markets for this player
        // and update each market's price data accordingly
    }
    
    /**
     * @dev Get current hybrid price for a market
     */
    function getMarketPrice(bytes32 marketId) external view returns (uint256) {
        return marketPrices[marketId].hybridPrice;
    }
    
    /**
     * @dev Admin function to update weighting configuration
     */
    function setWeighting(
        uint256 raffleWeight,
        uint256 marketWeight
    ) external onlyRole(ADMIN_ROLE) {
        require(raffleWeight + marketWeight == 10000, "Weights must sum to 10000");
        
        uint256 oldRaffleWeight = weightingConfig.raffleWeight;
        uint256 oldMarketWeight = weightingConfig.marketWeight;
        
        weightingConfig.raffleWeight = raffleWeight;
        weightingConfig.marketWeight = marketWeight;
        weightingConfig.lastUpdate = block.timestamp;
        
        emit WeightingChanged(oldRaffleWeight, oldMarketWeight, raffleWeight, marketWeight);
    }
    
    // Chainlink AggregatorV3Interface implementation
    function latestRoundData() external view override returns (
        uint80 roundId,
        int256 answer,
        uint256 startedAt,
        uint256 updatedAt,
        uint80 answeredInRound
    ) {
        // For demonstration - in practice, this would return price for a specific market
        // This maintains compatibility with Chainlink price feed interfaces
        return (
            1,              // roundId
            0,              // answer (placeholder)
            block.timestamp, // startedAt
            block.timestamp, // updatedAt
            1               // answeredInRound
        );
    }
    
    function getRoundData(uint80) external pure override returns (
        uint80 roundId,
        int256 answer,
        uint256 startedAt,
        uint256 updatedAt,
        uint80 answeredInRound
    ) {
        revert("Historical data not supported");
    }
}
```