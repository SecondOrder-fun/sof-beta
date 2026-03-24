// src/hooks/useInfoFiMarketsAdmin.js
import { useQuery } from "@tanstack/react-query";

const API_BASE = import.meta.env.VITE_API_BASE_URL;

/**
 * Fetch InfoFi markets admin summary from backend
 *
 * @returns {Promise<Object>} Markets grouped by season with aggregate stats
 */
const fetchMarketsAdminSummary = async () => {
  const response = await fetch(`${API_BASE}/infofi/markets/admin-summary`);

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || "Failed to fetch markets summary");
  }

  return response.json();
};

/**
 * Hook to fetch and manage InfoFi markets admin data
 * Returns data grouped by season with liquidity metrics
 *
 * @returns {Object} Query result with seasons data, loading, and error states
 */
export const useInfoFiMarketsAdmin = () => {
  return useQuery({
    queryKey: ["infofi", "admin", "markets-summary"],
    queryFn: fetchMarketsAdminSummary,
    staleTime: 30000, // 30 seconds
    refetchInterval: 30000, // Auto-refresh every 30 seconds
    retry: 2,
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
  });
};
