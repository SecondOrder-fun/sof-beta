// src/hooks/useOraclePriceSync.js
// Syncs oracle prices when player positions change

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';

/**
 * useOraclePriceSync
 * Invalidates oracle price queries to ensure market odds update
 * 
 * @param {string|number} seasonId - The season to monitor
 * @param {string} playerAddress - The player address to monitor (optional)
 */
export function useOraclePriceSync(seasonId, playerAddress = null) {
  const queryClient = useQueryClient();
  
  useEffect(() => {
    // When position changes occur, invalidate all oracle price queries
    // This forces a refetch of the hybrid pricing data
    const invalidateOraclePrices = () => {
      queryClient.invalidateQueries({ queryKey: ['oraclePrice'] });
      queryClient.invalidateQueries({ queryKey: ['infofiMarketInfo'] });
    };
    
    // Create a small interval to check for stale data and refresh
    const interval = setInterval(() => {
      invalidateOraclePrices();
    }, 10000); // Every 10 seconds
    
    return () => clearInterval(interval);
  }, [queryClient, seasonId, playerAddress]);
}
