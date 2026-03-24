// src/hooks/useBatchUsernames.js
import { useQuery } from "@tanstack/react-query";
import axios from "axios";

const API_BASE = import.meta.env.VITE_API_BASE_URL;

/**
 * Get usernames for multiple wallet addresses
 * @param {string[]} addresses - Array of wallet addresses
 * @returns {Object} Map of address -> username
 */
export const useBatchUsernames = (addresses) => {
  return useQuery({
    queryKey: [
      "usernames",
      "batch",
      addresses
        ?.map((a) => a?.toLowerCase())
        .sort()
        .join(","),
    ],
    queryFn: async () => {
      if (!addresses || addresses.length === 0) {
        return {};
      }

      // Filter out invalid addresses
      const validAddresses = addresses.filter(
        (addr) => addr && /^0x[a-fA-F0-9]{40}$/.test(addr)
      );

      if (validAddresses.length === 0) {
        return {};
      }

      const response = await axios.get(`${API_BASE}/usernames/batch`, {
        params: {
          addresses: validAddresses.join(","),
        },
      });

      return response.data;
    },
    enabled: !!addresses && addresses.length > 0,
    staleTime: 5 * 60 * 1000, // 5 minutes
    retry: 1,
  });
};
