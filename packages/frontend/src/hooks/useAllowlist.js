/**
 * useAllowlist Hook
 * Check if the connected wallet is on the allowlist with access levels and groups
 */

import { useQuery } from "@tanstack/react-query";
import { useAppIdentity } from "@/hooks/useAppIdentity";
import { ACCESS_LEVELS } from "@/config/accessLevels";

const API_BASE = import.meta.env.VITE_API_BASE_URL + "/access";

/**
 * Check user access by FID (priority) or wallet
 * @param {object} params - { fid?, wallet? }
 * @returns {Promise<{isAllowlisted: boolean, accessLevel: number, levelName: string, groups: string[], entry: object|null}>}
 */
async function checkUserAccess({ fid, wallet }) {
  if (!fid && !wallet) {
    return {
      isAllowlisted: false,
      accessLevel: ACCESS_LEVELS.PUBLIC,
      levelName: "public",
      groups: [],
      entry: null,
    };
  }

  const params = new URLSearchParams();
  if (fid) params.append("fid", String(fid));
  if (wallet) params.append("wallet", wallet);

  const res = await fetch(`${API_BASE}/check?${params.toString()}`);
  if (!res.ok) {
    throw new Error("Failed to check access");
  }
  return res.json();
}

/**
 * Hook to check if the connected wallet is allowlisted with access levels and groups
 * @returns {{
 *   isAllowlisted: boolean,
 *   accessLevel: number,
 *   levelName: string,
 *   groups: string[],
 *   isLoading: boolean,
 *   isError: boolean,
 *   entry: object|null,
 *   refetch: function,
 *   hasLevel: (level: number) => boolean,
 *   hasGroup: (group: string) => boolean,
 *   hasAnyGroup: (groups: string[]) => boolean,
 *   hasAllGroups: (groups: string[]) => boolean,
 *   isBeta: () => boolean,
 *   isAdmin: () => boolean
 * }}
 */
export function useAllowlist() {
  const identity = useAppIdentity();

  const query = useQuery({
    queryKey: ["allowlist-check", identity.fid, identity.walletAddress],
    queryFn: () =>
      checkUserAccess({ fid: identity.fid, wallet: identity.walletAddress }),
    enabled: !!identity.fid || !!identity.walletAddress,
    staleTime: 60000, // Cache for 1 minute
    refetchOnWindowFocus: false,
  });

  const accessLevel = query.data?.accessLevel ?? ACCESS_LEVELS.PUBLIC;
  const groups = query.data?.groups ?? [];

  return {
    isAllowlisted: query.data?.isAllowlisted ?? false,
    accessLevel,
    levelName: query.data?.levelName ?? "public",
    groups,
    isLoading: query.isLoading,
    isError: query.isError,
    entry: query.data?.entry ?? null,
    refetch: query.refetch,

    // Helper methods
    hasLevel: (level) => accessLevel >= level,
    hasGroup: (group) => groups.includes(group),
    hasAnyGroup: (groupList) => groupList.some((g) => groups.includes(g)),
    hasAllGroups: (groupList) => groupList.every((g) => groups.includes(g)),
    isBeta: () => accessLevel >= ACCESS_LEVELS.BETA,
    isAdmin: () => accessLevel >= ACCESS_LEVELS.ADMIN,
  };
}

/**
 * Hook to check allowlist window status
 * @returns {{
 *   isOpen: boolean,
 *   config: object|null,
 *   reason: string|null,
 *   isLoading: boolean
 * }}
 */
export function useAllowlistWindow() {
  const query = useQuery({
    queryKey: ["allowlist-window"],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/window-status`);
      if (!res.ok) throw new Error("Failed to check window status");
      return res.json();
    },
    staleTime: 30000, // Cache for 30 seconds
  });

  return {
    isOpen: query.data?.isOpen ?? false,
    config: query.data?.config ?? null,
    reason: query.data?.reason ?? null,
    isLoading: query.isLoading,
  };
}

export default useAllowlist;
