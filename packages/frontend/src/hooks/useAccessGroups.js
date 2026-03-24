/**
 * useAccessGroups Hook
 * Admin hook for managing access groups
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

const API_BASE = import.meta.env.VITE_API_BASE_URL + "/access";

/**
 * Hook to get all access groups
 * @param {boolean} activeOnly - Only return active groups
 * @returns {{
 *   groups: object[],
 *   isLoading: boolean,
 *   isError: boolean,
 *   refetch: function
 * }}
 */
export function useAccessGroups(activeOnly = true) {
  const query = useQuery({
    queryKey: ["access-groups", activeOnly],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/groups?activeOnly=${activeOnly}`);
      if (!res.ok) throw new Error("Failed to fetch groups");
      const data = await res.json();
      return data.groups;
    },
    staleTime: 60000,
  });

  return {
    groups: query.data ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
  };
}

/**
 * Hook to get a specific group by slug
 * @param {string} slug - Group slug
 * @returns {{
 *   group: object|null,
 *   isLoading: boolean,
 *   isError: boolean
 * }}
 */
export function useAccessGroup(slug) {
  const query = useQuery({
    queryKey: ["access-group", slug],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/groups/${slug}`);
      if (!res.ok) {
        if (res.status === 404) return null;
        throw new Error("Failed to fetch group");
      }
      return res.json();
    },
    enabled: !!slug,
    staleTime: 60000,
  });

  return {
    group: query.data,
    isLoading: query.isLoading,
    isError: query.isError,
  };
}

/**
 * Hook to create a new group
 * @returns {{
 *   createGroup: function,
 *   isCreating: boolean
 * }}
 */
export function useCreateGroup({ getAuthHeaders } = {}) {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async ({ slug, name, description }) => {
      const authHeaders = getAuthHeaders?.() ?? {};
      const res = await fetch(`${API_BASE}/groups`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({ slug, name, description }),
      });
      if (!res.ok) throw new Error("Failed to create group");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["access-groups"] });
    },
  });

  return {
    createGroup: mutation.mutate,
    isCreating: mutation.isPending,
  };
}

/**
 * Hook to update a group
 * @returns {{
 *   updateGroup: function,
 *   isUpdating: boolean
 * }}
 */
export function useUpdateGroup({ getAuthHeaders } = {}) {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async ({ slug, updates }) => {
      const authHeaders = getAuthHeaders?.() ?? {};
      const res = await fetch(`${API_BASE}/groups/${slug}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify(updates),
      });
      if (!res.ok) throw new Error("Failed to update group");
      return res.json();
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["access-groups"] });
      queryClient.invalidateQueries({
        queryKey: ["access-group", variables.slug],
      });
    },
  });

  return {
    updateGroup: mutation.mutate,
    isUpdating: mutation.isPending,
  };
}

/**
 * Hook to delete a group
 * @returns {{
 *   deleteGroup: function,
 *   isDeleting: boolean
 * }}
 */
export function useDeleteGroup({ getAuthHeaders } = {}) {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async (slug) => {
      const authHeaders = getAuthHeaders?.() ?? {};
      const res = await fetch(`${API_BASE}/groups/${slug}`, {
        method: "DELETE",
        headers: authHeaders,
      });
      if (!res.ok) throw new Error("Failed to delete group");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["access-groups"] });
    },
  });

  return {
    deleteGroup: mutation.mutate,
    isDeleting: mutation.isPending,
  };
}

/**
 * Hook to add user to group
 * @returns {{
 *   addUserToGroup: function,
 *   isAdding: boolean
 * }}
 */
export function useAddUserToGroup({ getAuthHeaders } = {}) {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async ({ fid, wallet, groupSlug, expiresAt, grantedBy }) => {
      const authHeaders = getAuthHeaders?.() ?? {};
      const res = await fetch(`${API_BASE}/groups/assign`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({ fid, wallet, groupSlug, expiresAt, grantedBy }),
      });
      if (!res.ok) throw new Error("Failed to add user to group");
      return res.json();
    },
    onSuccess: (_, variables) => {
      if (variables.fid) {
        queryClient.invalidateQueries({
          queryKey: ["user-groups", variables.fid],
        });
      }
      queryClient.invalidateQueries({
        queryKey: ["group-members", variables.groupSlug],
      });
    },
  });

  return {
    addUserToGroup: mutation.mutate,
    isAdding: mutation.isPending,
  };
}

/**
 * Hook to remove user from group
 * @returns {{
 *   removeUserFromGroup: function,
 *   isRemoving: boolean
 * }}
 */
export function useRemoveUserFromGroup({ getAuthHeaders } = {}) {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async ({ fid, wallet, groupSlug }) => {
      const authHeaders = getAuthHeaders?.() ?? {};
      const res = await fetch(`${API_BASE}/groups/remove`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({ fid, wallet, groupSlug }),
      });
      if (!res.ok) throw new Error("Failed to remove user from group");
      return res.json();
    },
    onSuccess: (_, variables) => {
      if (variables.fid) {
        queryClient.invalidateQueries({
          queryKey: ["user-groups", variables.fid],
        });
      }
      queryClient.invalidateQueries({
        queryKey: ["group-members", variables.groupSlug],
      });
    },
  });

  return {
    removeUserFromGroup: mutation.mutate,
    isRemoving: mutation.isPending,
  };
}

/**
 * Hook to get group members
 * @param {string} slug - Group slug
 * @returns {{
 *   members: object[],
 *   isLoading: boolean,
 *   isError: boolean
 * }}
 */
export function useGroupMembers(slug) {
  const query = useQuery({
    queryKey: ["group-members", slug],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/groups/${slug}/members`);
      if (!res.ok) throw new Error("Failed to fetch group members");
      const data = await res.json();
      return data.members;
    },
    enabled: !!slug,
    staleTime: 30000,
  });

  return {
    members: query.data ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
  };
}

/**
 * Hook to get user's groups
 * @param {number} fid - Farcaster ID
 * @returns {{
 *   groups: object[],
 *   isLoading: boolean,
 *   isError: boolean
 * }}
 */
export function useUserGroups(fid) {
  const query = useQuery({
    queryKey: ["user-groups", fid],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/user-groups/${fid}`);
      if (!res.ok) throw new Error("Failed to fetch user groups");
      const data = await res.json();
      return data.groups;
    },
    enabled: !!fid,
    staleTime: 30000,
  });

  return {
    groups: query.data ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
  };
}

export default useAccessGroups;
