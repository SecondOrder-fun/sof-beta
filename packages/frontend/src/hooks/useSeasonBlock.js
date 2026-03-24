// src/hooks/useSeasonBlock.js
import { useQuery } from "@tanstack/react-query";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "";

/**
 * Fetch season's created_block from backend API
 * @param {number} seasonId - Season ID
 * @returns {object} Query result with createdBlock
 */
export function useSeasonBlock(seasonId) {
  const query = useQuery({
    queryKey: ["seasonBlock", seasonId],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/seasons/${seasonId}`);
      if (!res.ok) return null;
      const data = await res.json();
      return data?.created_block || null;
    },
    enabled: !!seasonId,
    staleTime: 5 * 60 * 1000, // 5 min - block doesn't change
    retry: 1,
  });

  return {
    createdBlock: query.data,
    isLoading: query.isLoading,
    error: query.error,
  };
}
