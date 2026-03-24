// src/hooks/useUsername.js
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import axios from "axios";

const API_BASE = import.meta.env.VITE_API_BASE_URL;

/**
 * Get username for a wallet address
 */
export const useUsername = (address) => {
  return useQuery({
    queryKey: ["username", address?.toLowerCase()],
    queryFn: async () => {
      if (!address) return null;

      const response = await axios.get(`${API_BASE}/usernames/${address}`);
      return response.data.username;
    },
    enabled: !!address,
    staleTime: 5 * 60 * 1000, // 5 minutes
    retry: 1,
  });
};

/**
 * Set username for a wallet address
 */
export const useSetUsername = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ address, username }) => {
      const response = await axios.post(`${API_BASE}/usernames`, {
        address,
        username,
      });
      return response.data;
    },
    onSuccess: (data, variables) => {
      // Invalidate and refetch username query
      queryClient.invalidateQueries({
        queryKey: ["username", variables.address?.toLowerCase()],
      });

      // Also invalidate batch queries that might include this address
      queryClient.invalidateQueries({
        queryKey: ["usernames", "batch"],
      });
    },
  });
};

/**
 * Check if username is available
 */
export const useCheckUsername = (username) => {
  return useQuery({
    queryKey: ["username", "check", username?.toLowerCase()],
    queryFn: async () => {
      if (!username || username.length < 3) {
        return { available: false, error: "USERNAME_TOO_SHORT" };
      }

      const response = await axios.get(
        `${API_BASE}/usernames/check/${username}`
      );
      return response.data;
    },
    enabled: !!username && username.length >= 3,
    staleTime: 10 * 1000, // 10 seconds
    retry: false,
  });
};
