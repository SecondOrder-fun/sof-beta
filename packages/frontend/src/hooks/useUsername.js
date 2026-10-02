// src/hooks/useUsername.js
import { useContext } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import { AppAuthContext } from "@/context/AppAuthContext";

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
 * Set the signed-in wallet's username.
 *
 * The backend takes the wallet from the sign-in JWT and only accepts `address`
 * if it is that same wallet, so the request carries the Authorization header;
 * without a sign-in it is rejected with 401.
 */
export const useSetUsername = () => {
  const queryClient = useQueryClient();
  // Read the context directly: outside AppAuthProvider there are no headers.
  const auth = useContext(AppAuthContext);

  return useMutation({
    mutationFn: async ({ address, username }) => {
      const headers = auth?.getAuthHeaders?.() ?? {};
      const response = await axios.post(
        `${API_BASE}/usernames`,
        { address, username },
        { headers },
      );
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
