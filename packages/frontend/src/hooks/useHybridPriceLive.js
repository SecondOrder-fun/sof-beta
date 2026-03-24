// src/hooks/useHybridPriceLive.js
// Queries InfoFi price oracle directly from blockchain for real-time hybrid pricing
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { readOraclePrice } from '@/services/onchainInfoFi';
import { getStoredNetworkKey } from '@/lib/wagmi';

/**
 * useHybridPriceLive
 * Queries the InfoFi price oracle directly from the blockchain to get hybrid pricing data.
 * Polls every 10 seconds for updates.
 * 
 * @param {string|number} marketId - The market ID to query
 * @returns {Object} { data, isLive, source }
 */
export function useHybridPriceLive(marketId) {
  const networkKey = getStoredNetworkKey();
  
  const { data, isLoading, error } = useQuery({
    queryKey: ['oraclePrice', marketId, networkKey],
    queryFn: () => readOraclePrice({ marketId, networkKey }),
    enabled: !!marketId,
    staleTime: 5_000,
    refetchInterval: 10_000, // Poll every 10 seconds for updates
  });

  // Memoize the return object to prevent unnecessary re-renders
  const priceData = useMemo(() => {
    if (!data) return null;
    // Return null if oracle data is invalid (not active or never updated)
    // This prevents using default zero values from uninitialized oracle entries
    if (!data.active && data.lastUpdate === 0) return null;
    return {
      marketId,
      hybridPriceBps: data.hybridPriceBps,
      raffleProbabilityBps: data.raffleProbabilityBps,
      marketSentimentBps: data.marketSentimentBps,
      lastUpdated: data.lastUpdate,
    };
  }, [data, marketId]);

  return {
    data: priceData,
    isLive: !isLoading && !error,
    source: 'blockchain'
  };
}
