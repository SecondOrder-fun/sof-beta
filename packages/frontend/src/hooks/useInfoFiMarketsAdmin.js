// src/hooks/useInfoFiMarketsAdmin.js
import { useWarmRead } from "@/hooks/chain/useWarmRead";

/**
 * Hook to fetch and manage InfoFi markets admin data
 * Returns data grouped by season with liquidity metrics
 *
 * @returns {Object} Query result with seasons data, loading, and error states
 */
export const useInfoFiMarketsAdmin = () => {
  const query = useWarmRead({
    path: "/infofi/markets/admin-summary",
    staleTime: 30_000,
  });

  // Expose the same shape as the previous useQuery result for backward compat.
  return {
    data: query.data,
    isLoading: query.isLoading,
    error: query.error,
    isError: !!query.error,
  };
};
