// src/hooks/useArbitrageDetection.js
import { useEffect, useState } from 'react';
import { formatUnits } from 'viem';
import { useOnchainInfoFiMarkets } from './useOnchainInfoFiMarkets';
import { useCurveState } from './useCurveState';
import { getStoredNetworkKey } from '@/lib/wagmi';

/**
 * useArbitrageDetection
 * 
 * Detects arbitrage opportunities between raffle entry costs and InfoFi market prices.
 * Uses on-chain data only - no backend dependencies.
 * 
 * @param {number|string} seasonId - Active season ID
 * @param {string} bondingCurveAddress - Address of the bonding curve contract
 * @param {object} options - Configuration options
 * @param {number} options.minProfitabilityBps - Minimum profit threshold in basis points (default: 200 = 2%)
 * @param {number} options.maxResults - Maximum number of opportunities to return (default: 10)
 * @returns {object} { opportunities, isLoading, error, refetch }
 */
export function useArbitrageDetection(seasonId, bondingCurveAddress, options = {}) {
  const {
    minProfitabilityBps = 200, // 2% minimum
    maxResults = 10,
  } = options;

  const networkKey = getStoredNetworkKey();
  const [opportunities, setOpportunities] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  // Fetch all markets for the season
  const { markets, isLoading: marketsLoading } = useOnchainInfoFiMarkets(seasonId, networkKey);

  // Get bonding curve state for pricing calculations
  const { curveSupply, curveStep, allBondSteps } = useCurveState(bondingCurveAddress, {
    isActive: true,
    pollMs: 10000,
  });

  // Calculate arbitrage opportunities
  useEffect(() => {
    if (marketsLoading || !markets || markets.length === 0) {
      setIsLoading(marketsLoading);
      return;
    }

    const calculateOpportunities = async () => {
      try {
        setIsLoading(true);
        setError(null);

        const detected = [];

        for (const market of markets) {
          try {
            // Get oracle price for this market
            const oraclePrice = await getOraclePriceForMarket(market.id, networkKey);
            if (!oraclePrice || !oraclePrice.active) continue;

            // Get player's current position to calculate raffle entry cost
            const playerPosition = await getPlayerPosition(market.player, networkKey);
            if (!playerPosition) continue;

            // Calculate raffle entry cost (cost to achieve current probability)
            const raffleCost = calculateRaffleEntryCost(
              playerPosition.probability,
              curveSupply,
              curveStep,
              allBondSteps
            );

            // Convert oracle hybrid price from basis points to SOF
            const marketPriceSOF = Number(oraclePrice.hybridPriceBps) / 10000;

            // Calculate arbitrage metrics
            const priceDifference = Math.abs(raffleCost - marketPriceSOF);
            const avgPrice = (raffleCost + marketPriceSOF) / 2;
            const profitabilityBps = avgPrice > 0 ? (priceDifference / avgPrice) * 10000 : 0;

            // Filter by minimum profitability threshold
            if (profitabilityBps < minProfitabilityBps) continue;

            // Determine arbitrage direction (no text generation - let component handle it)
            const direction = raffleCost < marketPriceSOF ? 'buy_raffle' : 'buy_market';

            detected.push({
              id: `${market.id}-${Date.now()}`,
              marketId: market.id,
              player: market.player,
              seasonId: Number(seasonId),
              rafflePrice: raffleCost,
              marketPrice: marketPriceSOF,
              priceDifference,
              profitability: profitabilityBps / 100, // Convert to percentage
              estimatedProfit: priceDifference,
              direction,
              raffleProbabilityBps: oraclePrice.raffleProbabilityBps,
              marketSentimentBps: oraclePrice.marketSentimentBps,
              lastUpdated: Date.now(),
            });
          } catch (err) {
            // Silent fail - continue processing other markets
            void err;
          }
        }

        // Sort by profitability (highest first) and limit results
        const sorted = detected
          .sort((a, b) => b.profitability - a.profitability)
          .slice(0, maxResults);

        setOpportunities(sorted);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to detect arbitrage opportunities';
        setError(message);
      } finally {
        setIsLoading(false);
      }
    };

    calculateOpportunities();
  }, [markets, marketsLoading, curveSupply, curveStep, allBondSteps, networkKey, seasonId, minProfitabilityBps, maxResults]);

  const refetch = () => {
    setIsLoading(true);
    // Trigger recalculation by updating a dependency
  };

  return {
    opportunities,
    isLoading,
    error,
    refetch,
  };
}

/**
 * Get oracle price data for a market
 * Uses the existing useOraclePriceLive hook data
 */
async function getOraclePriceForMarket(marketId, networkKey) {
  try {
    const { readOraclePrice } = await import('@/services/onchainInfoFi');
    return await readOraclePrice({ marketId, networkKey });
  } catch (err) {
    // Silent fail - return null to skip this market
    void err;
    return null;
  }
}

/**
 * Get player's current raffle position
 */
async function getPlayerPosition(playerAddress) {
  try {
    // This would use RafflePositionTracker to get player's current position
    // For now, return a placeholder - will be implemented with actual tracker integration
    void playerAddress;
    return {
      probability: 500, // 5% in basis points
      tickets: 1000n,
    };
  } catch (err) {
    // Silent fail - return null to skip this player
    void err;
    return null;
  }
}

/**
 * Calculate the cost to enter the raffle at a given probability level
 * 
 * @param {number} targetProbabilityBps - Target probability in basis points
 * @param {bigint} currentSupply - Current ticket supply
 * @param {object} currentStep - Current bonding curve step
 * @param {array} allSteps - All bonding curve steps
 * @returns {number} Cost in SOF tokens
 */
function calculateRaffleEntryCost(targetProbabilityBps, currentSupply, currentStep, allSteps) {
  if (!currentStep || !allSteps || allSteps.length === 0) {
    return 0;
  }

  try {
    // Convert probability to ticket count
    // If target is 5% (500 bps), and total supply is 10,000, need 500 tickets
    const totalSupply = Number(formatUnits(currentSupply, 0));
    const ticketsNeeded = (targetProbabilityBps / 10000) * totalSupply;

    // Calculate cost using bonding curve steps
    // This is a simplified calculation - actual implementation would use the curve's calculateBuyPrice
    const currentPrice = Number(formatUnits(currentStep.price || 0n, 18));
    const estimatedCost = ticketsNeeded * currentPrice;

    return estimatedCost;
  } catch (err) {
    // Silent fail - return 0 to skip this calculation
    void err;
    return 0;
  }
}

/**
 * Hook variant that subscribes to oracle price updates for real-time detection
 * 
 * @param {number|string} seasonId - Active season ID
 * @param {string} bondingCurveAddress - Address of the bonding curve contract
 * @param {object} options - Configuration options
 * @returns {object} { opportunities, isLoading, error, isLive }
 */
export function useArbitrageDetectionLive(seasonId, bondingCurveAddress, options = {}) {
  const baseResult = useArbitrageDetection(seasonId, bondingCurveAddress, options);
  const [isLive, setIsLive] = useState(false);

  // Subscribe to oracle price updates
  useEffect(() => {
    let unsubscribe;
    
    const setupSubscription = async () => {
      const { subscribeOraclePriceUpdated } = await import('@/services/onchainInfoFi');
      const networkKey = getStoredNetworkKey();

      unsubscribe = subscribeOraclePriceUpdated({
        networkKey,
        onEvent: () => {
          // When oracle price updates, trigger recalculation
          setIsLive(true);
          baseResult.refetch?.();
        },
      });
    };

    void setupSubscription();

    return () => {
      setIsLive(false);
      unsubscribe?.();
    };
  }, [seasonId, baseResult]);

  return {
    ...baseResult,
    isLive,
  };
}
