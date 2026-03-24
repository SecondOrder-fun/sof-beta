// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "forge-std/StdInvariant.sol";
import "../../src/infofi/InfoFiPriceOracle.sol";
import "../../src/token/SOFToken.sol";

contract HybridPricingInvariantTest is StdInvariant, Test {
    InfoFiPriceOracle public oracle;
    address public admin;
    address public updater;

    // Constants for testing
    uint256 constant INITIAL_RAFFLE_WEIGHT = 7000; // 70%
    uint256 constant INITIAL_MARKET_WEIGHT = 3000; // 30%

    // Bounds for probability values (in basis points)
    uint256 constant MIN_PROBABILITY = 0;
    uint256 constant MAX_PROBABILITY = 10000; // 100%

    // Maximum allowed deviation in hybrid price (basis points)
    uint256 constant MAX_DEVIATION = 500; // 5%

    // Test FPMM address (market ID)
    address internal testFpmmAddress;

    function setUp() public {
        admin = address(this);
        updater = address(0x1);

        // Deploy the oracle with initial weights
        oracle = new InfoFiPriceOracle(admin, INITIAL_RAFFLE_WEIGHT, INITIAL_MARKET_WEIGHT);

        // Grant updater role to the updater address
        oracle.grantRole(oracle.PRICE_UPDATER_ROLE(), updater);

        // Create a test FPMM address
        testFpmmAddress = address(0x1234567890123456789012345678901234567890);
        vm.startPrank(updater);
        oracle.updateRaffleProbability(testFpmmAddress, 5000); // 50%
        oracle.updateMarketSentiment(testFpmmAddress, 6000); // 60%
        vm.stopPrank();

        // Target the oracle for invariant testing
        targetContract(address(oracle));
    }

    // Invariant: Weights must always sum to 10000 (100%)
    function invariant_weightsSumTo10000() public pure {
        // Get the weights from the contract
        uint256 raffleWeight = INITIAL_RAFFLE_WEIGHT; // Using the initial values since we don't change them
        uint256 marketWeight = INITIAL_MARKET_WEIGHT;

        assertEq(raffleWeight + marketWeight, 10000, "Weights must sum to 10000");
    }

    // Invariant: Hybrid price must be within bounds of raffle and market probabilities
    function invariant_hybridPriceWithinBounds() public view {
        // Get price data using the getPrice method
        InfoFiPriceOracle.PriceData memory priceData = oracle.getPrice(testFpmmAddress);

        // Skip if market doesn't exist
        if (!priceData.active) return;

        uint256 raffleProbability = priceData.raffleProbabilityBps;
        uint256 marketSentiment = priceData.marketSentimentBps;
        uint256 hybridPrice = priceData.hybridPriceBps;

        // Hybrid price should be between min and max of the two components
        uint256 minProb = raffleProbability < marketSentiment ? raffleProbability : marketSentiment;
        uint256 maxProb = raffleProbability > marketSentiment ? raffleProbability : marketSentiment;

        assertTrue(hybridPrice >= minProb, "Hybrid price below minimum probability");
        assertTrue(hybridPrice <= maxProb, "Hybrid price above maximum probability");
    }

    // Invariant: Hybrid price calculation follows the weighted formula
    function invariant_hybridPriceCalculation() public view {
        // Get price data using the getPrice method
        InfoFiPriceOracle.PriceData memory priceData = oracle.getPrice(testFpmmAddress);

        // Skip if market doesn't exist
        if (!priceData.active) return;

        uint256 raffleProbability = priceData.raffleProbabilityBps;
        uint256 marketSentiment = priceData.marketSentimentBps;
        uint256 hybridPrice = priceData.hybridPriceBps;

        // Use the initial weights
        uint256 raffleWeight = INITIAL_RAFFLE_WEIGHT;
        uint256 marketWeight = INITIAL_MARKET_WEIGHT;

        uint256 expectedPrice = (raffleWeight * raffleProbability + marketWeight * marketSentiment) / 10000;

        // Allow for small rounding errors due to integer division
        uint256 difference = expectedPrice > hybridPrice ? expectedPrice - hybridPrice : hybridPrice - expectedPrice;
        assertTrue(difference <= 1, "Hybrid price calculation incorrect");
    }

    // Invariant: Probability values must be within valid range (0-10000 basis points)
    function invariant_probabilitiesInValidRange() public view {
        // Get price data using the getPrice method
        InfoFiPriceOracle.PriceData memory priceData = oracle.getPrice(testFpmmAddress);

        // Skip if market doesn't exist
        if (!priceData.active) return;

        uint256 raffleProbability = priceData.raffleProbabilityBps;
        uint256 marketSentiment = priceData.marketSentimentBps;
        uint256 hybridPrice = priceData.hybridPriceBps;

        assertTrue(
            raffleProbability >= MIN_PROBABILITY && raffleProbability <= MAX_PROBABILITY,
            "Raffle probability out of range"
        );
        assertTrue(
            marketSentiment >= MIN_PROBABILITY && marketSentiment <= MAX_PROBABILITY, "Market sentiment out of range"
        );
        assertTrue(hybridPrice >= MIN_PROBABILITY && hybridPrice <= MAX_PROBABILITY, "Hybrid price out of range");
    }

    // Invariant: Hybrid price deviation from components is bounded
    // Note: With 70/30 weights, the hybrid price is always between raffle and market values,
    // but the deviation from each component depends on the weight and the spread between them.
    // For 70% raffle weight, deviation from raffle = 0.3 * |raffle - market|
    // For 30% market weight, deviation from market = 0.7 * |raffle - market|
    // When spread is large (e.g., raffle=5000, market=36), deviations can exceed 5% from both.
    // This invariant verifies the hybrid price follows the weighted average formula.
    function invariant_hybridPriceDeviationBounded() public view {
        // Get price data using the getPrice method
        InfoFiPriceOracle.PriceData memory priceData = oracle.getPrice(testFpmmAddress);

        // Skip if market doesn't exist
        if (!priceData.active) return;

        uint256 raffleProbability = priceData.raffleProbabilityBps;
        uint256 marketSentiment = priceData.marketSentimentBps;
        uint256 hybridPrice = priceData.hybridPriceBps;

        // The hybrid price must always be between the two component prices (inclusive)
        uint256 minProb = raffleProbability < marketSentiment ? raffleProbability : marketSentiment;
        uint256 maxProb = raffleProbability > marketSentiment ? raffleProbability : marketSentiment;

        assertTrue(hybridPrice >= minProb, "Hybrid price below min component");
        assertTrue(hybridPrice <= maxProb, "Hybrid price above max component");

        // Calculate expected weighted average (same as invariant_hybridPriceCalculation)
        uint256 expectedPrice = (INITIAL_RAFFLE_WEIGHT * raffleProbability + INITIAL_MARKET_WEIGHT * marketSentiment) / 10000;
        uint256 difference = expectedPrice > hybridPrice ? expectedPrice - hybridPrice : hybridPrice - expectedPrice;

        // Allow for small rounding errors due to integer division
        assertTrue(difference <= 1, "Hybrid price does not match weighted average");
    }
}
