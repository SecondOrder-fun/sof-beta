/**
 * useNftDrops Hook
 * Fetches NFT drops from the database API
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "/api";

/**
 * Fetch all NFT drops
 */
async function fetchDrops({ type, featured, includeInactive } = {}) {
  const params = new URLSearchParams();
  if (type) params.set("type", type);
  if (featured) params.set("featured", "true");
  if (includeInactive) params.set("includeInactive", "true");

  const url = `${API_BASE_URL}/nft-drops${
    params.toString() ? `?${params}` : ""
  }`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error("Failed to fetch NFT drops");
  }

  const data = await response.json();
  return data.drops || [];
}

/**
 * Fetch a single NFT drop by ID
 */
async function fetchDropById(id) {
  const response = await fetch(`${API_BASE_URL}/nft-drops/${id}`);

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error("NFT drop not found");
    }
    throw new Error("Failed to fetch NFT drop");
  }

  const data = await response.json();
  return data.drop;
}

/**
 * Fetch currently active drops
 */
async function fetchActiveDrops() {
  const response = await fetch(`${API_BASE_URL}/nft-drops/active/current`);

  if (!response.ok) {
    throw new Error("Failed to fetch active NFT drops");
  }

  const data = await response.json();
  return data.drops || [];
}

/**
 * Create a new NFT drop
 */
async function createDrop(dropData, authHeaders = {}) {
  const response = await fetch(`${API_BASE_URL}/nft-drops/admin/create`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders },
    body: JSON.stringify(dropData),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to create NFT drop");
  }

  const data = await response.json();
  return data.drop;
}

/**
 * Update an NFT drop
 */
async function updateDrop({ id, authHeaders = {}, ...updates }) {
  const response = await fetch(`${API_BASE_URL}/nft-drops/admin/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...authHeaders },
    body: JSON.stringify(updates),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to update NFT drop");
  }

  const data = await response.json();
  return data.drop;
}

/**
 * Delete an NFT drop
 */
async function deleteDrop({ id, hard = false, authHeaders = {} }) {
  const url = `${API_BASE_URL}/nft-drops/admin/${id}${
    hard ? "?hard=true" : ""
  }`;
  const response = await fetch(url, { method: "DELETE", headers: authHeaders });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to delete NFT drop");
  }

  return { success: true };
}

/**
 * Toggle active status
 */
async function toggleActive({ id, authHeaders = {} }) {
  const response = await fetch(
    `${API_BASE_URL}/nft-drops/admin/${id}/toggle-active`,
    {
      method: "POST",
      headers: authHeaders,
    }
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to toggle active status");
  }

  const data = await response.json();
  return data.drop;
}

/**
 * Toggle featured status
 */
async function toggleFeatured({ id, authHeaders = {} }) {
  const response = await fetch(
    `${API_BASE_URL}/nft-drops/admin/${id}/toggle-featured`,
    {
      method: "POST",
      headers: authHeaders,
    }
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to toggle featured status");
  }

  const data = await response.json();
  return data.drop;
}

/**
 * Hook to fetch all NFT drops
 * @param {object} options - Query options
 * @param {string} options.type - Filter by type: 'mint' or 'airdrop'
 * @param {boolean} options.featured - Filter by featured status
 * @param {boolean} options.includeInactive - Include inactive drops
 */
export function useNftDrops({ type, featured, includeInactive } = {}) {
  return useQuery({
    queryKey: ["nft-drops", { type, featured, includeInactive }],
    queryFn: () => fetchDrops({ type, featured, includeInactive }),
    staleTime: 30000, // 30 seconds
  });
}

/**
 * Hook to fetch a single NFT drop by ID
 */
export function useNftDrop(id) {
  return useQuery({
    queryKey: ["nft-drop", id],
    queryFn: () => fetchDropById(id),
    enabled: !!id,
    staleTime: 30000,
  });
}

/**
 * Hook to fetch currently active drops
 */
export function useActiveNftDrops() {
  return useQuery({
    queryKey: ["nft-drops", "active"],
    queryFn: fetchActiveDrops,
    staleTime: 30000,
  });
}

/**
 * Hook for NFT drop mutations (create, update, delete)
 */
export function useNftDropMutations({ getAuthHeaders } = {}) {
  const queryClient = useQueryClient();

  const invalidateDrops = () => {
    queryClient.invalidateQueries({ queryKey: ["nft-drops"] });
  };

  const createMutation = useMutation({
    mutationFn: (data) => createDrop(data, getAuthHeaders?.() ?? {}),
    onSuccess: invalidateDrops,
  });

  const updateMutation = useMutation({
    mutationFn: (data) => updateDrop({ ...data, authHeaders: getAuthHeaders?.() ?? {} }),
    onSuccess: invalidateDrops,
  });

  const deleteMutation = useMutation({
    mutationFn: (data) => deleteDrop({ ...data, authHeaders: getAuthHeaders?.() ?? {} }),
    onSuccess: invalidateDrops,
  });

  const toggleActiveMutation = useMutation({
    mutationFn: (id) => toggleActive({ id, authHeaders: getAuthHeaders?.() ?? {} }),
    onSuccess: invalidateDrops,
  });

  const toggleFeaturedMutation = useMutation({
    mutationFn: (id) => toggleFeatured({ id, authHeaders: getAuthHeaders?.() ?? {} }),
    onSuccess: invalidateDrops,
  });

  return {
    createDrop: createMutation,
    updateDrop: updateMutation,
    deleteDrop: deleteMutation,
    toggleActive: toggleActiveMutation,
    toggleFeatured: toggleFeaturedMutation,
  };
}

export default useNftDrops;
