// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "openzeppelin-contracts/contracts/access/AccessControl.sol";

/**
 * @title InfoFiPriceOracle
 * @notice Minimal MVP oracle storing hybrid pricing data per FPMM market address
 * @dev Uses FPMM contract address as market identifier (not abstract uint256 marketId)
 * @dev Exposes roles for admin and price updater. Does not integrate Chainlink in MVP.
 */
contract InfoFiPriceOracle is AccessControl {
    bytes32 public constant ADMIN_ROLE = DEFAULT_ADMIN_ROLE;
    bytes32 public constant PRICE_UPDATER_ROLE = keccak256("PRICE_UPDATER_ROLE");

    struct PriceData {
        uint256 raffleProbabilityBps; // 0-10000
        uint256 marketSentimentBps; // 0-10000
        uint256 hybridPriceBps; // 0-10000
        uint256 lastUpdate;
        bool active;
    }

    struct Weights {
        uint256 raffleWeightBps; // must sum to 10000 with marketWeightBps
        uint256 marketWeightBps;
    }

    // fpmmAddress => price data (FPMM contract address is the market ID)
    mapping(address => PriceData) public prices;

    Weights public weights;

    event PriceUpdated(
        address indexed fpmmAddress, uint256 raffleBps, uint256 marketBps, uint256 hybridBps, uint256 timestamp
    );
    event WeightsUpdated(uint256 raffleWeightBps, uint256 marketWeightBps);

    constructor(address _admin, uint256 raffleWeightBps, uint256 marketWeightBps) {
        _grantRole(ADMIN_ROLE, _admin == address(0) ? msg.sender : _admin);
        _grantRole(PRICE_UPDATER_ROLE, _admin == address(0) ? msg.sender : _admin);
        _setWeights(raffleWeightBps, marketWeightBps);
    }

    function setWeights(uint256 raffleWeightBps, uint256 marketWeightBps) external onlyRole(ADMIN_ROLE) {
        _setWeights(raffleWeightBps, marketWeightBps);
    }

    function _setWeights(uint256 raffleWeightBps, uint256 marketWeightBps) internal {
        require(raffleWeightBps + marketWeightBps == 10000, "Oracle: weights must sum 10000");
        weights = Weights({raffleWeightBps: raffleWeightBps, marketWeightBps: marketWeightBps});
        emit WeightsUpdated(raffleWeightBps, marketWeightBps);
    }

    function updateRaffleProbability(address fpmmAddress, uint256 raffleProbabilityBps)
        external
        onlyRole(PRICE_UPDATER_ROLE)
    {
        require(fpmmAddress != address(0), "Oracle: invalid FPMM address");
        PriceData storage p = prices[fpmmAddress];
        p.raffleProbabilityBps = raffleProbabilityBps;
        p.hybridPriceBps = _hybrid(p.raffleProbabilityBps, p.marketSentimentBps);
        p.lastUpdate = block.timestamp;
        p.active = true;
        emit PriceUpdated(fpmmAddress, p.raffleProbabilityBps, p.marketSentimentBps, p.hybridPriceBps, p.lastUpdate);
    }

    function updateMarketSentiment(address fpmmAddress, uint256 marketSentimentBps)
        external
        onlyRole(PRICE_UPDATER_ROLE)
    {
        require(fpmmAddress != address(0), "Oracle: invalid FPMM address");
        PriceData storage p = prices[fpmmAddress];
        p.marketSentimentBps = marketSentimentBps;
        p.hybridPriceBps = _hybrid(p.raffleProbabilityBps, p.marketSentimentBps);
        p.lastUpdate = block.timestamp;
        p.active = true;
        emit PriceUpdated(fpmmAddress, p.raffleProbabilityBps, p.marketSentimentBps, p.hybridPriceBps, p.lastUpdate);
    }

    /**
     * @notice Calculate hybrid price from raffle and market components
     * @dev Formula: (70% × raffleBps + 30% × marketBps) / 100
     * @param raffleBps Raffle probability in basis points (0-10000)
     * @param marketBps Market sentiment in basis points (0-10000)
     * @return Hybrid price in basis points (0-10000)
     */
    function _hybrid(uint256 raffleBps, uint256 marketBps) internal view returns (uint256) {
        return (weights.raffleWeightBps * raffleBps + weights.marketWeightBps * marketBps) / 10000;
    }

    function getPrice(address fpmmAddress) external view returns (PriceData memory) {
        return prices[fpmmAddress];
    }
}
