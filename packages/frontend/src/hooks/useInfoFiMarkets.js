// src/hooks/useInfoFiMarkets.js
// React Query hook for fetching InfoFi markets list from backend API
import React from "react";
import { useQuery } from "@tanstack/react-query";

const API_BASE = import.meta.env.VITE_API_BASE_URL;

/**
 * Fetch markets from backend API (synced from blockchain)
 * This ensures we use database IDs for routing consistency
 * @param {Array} seasons - Array of season objects with id property
 * @param {Object} filters - Optional filters { isActive, marketType }
 * @returns {Promise<Object>} markets grouped by seasonId
 */
async function fetchMarketsFromAPI(seasons, filters = {}) {
  const marketsBySeason = {};

  // If no seasons provided, fetch for default season 1
  const seasonsToFetch = seasons && seasons.length > 0 ? seasons : [{ id: 1 }];

  // Fetch markets for each season from backend API
  for (const season of seasonsToFetch) {
    const seasonId = String(season.id || season.seasonId || "1");
    try {
      // Build query params
      const params = new URLSearchParams({ seasonId });
      if (filters.isActive !== undefined) {
        params.append("isActive", String(filters.isActive));
      }
      if (filters.marketType) {
        params.append("marketType", filters.marketType);
      }

      const response = await fetch(
        `${API_BASE}/infofi/markets?${params.toString()}`
      );
      if (!response.ok) {
        continue; // Skip this season if fetch fails
      }
      const data = await response.json();

      // API returns { markets: { "1": [...], "2": [...] } }
      if (data.markets && data.markets[seasonId]) {
        marketsBySeason[seasonId] = data.markets[seasonId];
      }
    } catch (_error) {
      // Failed to fetch markets for this season, continue with others
    }
  }

  return marketsBySeason;
}

/**
 * useInfoFiMarkets
 * Wraps React Query to provide markets list with caching and refetching.
 * Fetches from backend API (synced from blockchain) to ensure database ID consistency.
 *
 * @param {Array} seasons - Optional array of seasons to fetch markets for
 * @param {Object} filters - Optional filters { isActive, marketType }
 */
export function useInfoFiMarkets(seasons = [], filters = {}) {
  const query = useQuery({
    queryKey: [
      "infofi",
      "markets",
      "api",
      seasons.map((s) => s.id).join(","),
      JSON.stringify(filters),
    ],
    queryFn: () => fetchMarketsFromAPI(seasons, filters),
    staleTime: 10_000,
    refetchInterval: 10_000,
    enabled: true, // Always enabled, will use fallback if no seasons
  });

  // Convert grouped markets object to flat array for backward compatibility
  const marketsArray = React.useMemo(() => {
    if (!query.data || typeof query.data !== "object") return [];
    return Object.values(query.data).flat();
  }, [query.data]);

  return {
    markets: query.data || {}, // Keep grouped format for components that need it
    marketsArray, // Flat array for backward compatibility
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
}
