/**
 * useRouteAccess Hook
 * Check if user can access a specific route/resource
 */

import { useQuery } from "@tanstack/react-query";
import { useAppIdentity } from "@/hooks/useAppIdentity";

const API_BASE = import.meta.env.VITE_API_BASE_URL + "/access";

/**
 * Check route access for user
 * @param {object} params - { fid?, wallet?, route, resourceType?, resourceId? }
 * @returns {Promise<object>}
 */
async function checkRouteAccess({
  fid,
  wallet,
  route,
  resourceType,
  resourceId,
}) {
  const params = new URLSearchParams();
  if (fid) params.append("fid", String(fid));
  if (wallet) params.append("wallet", wallet);
  params.append("route", route);
  if (resourceType) params.append("resourceType", resourceType);
  if (resourceId) params.append("resourceId", resourceId);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout

  try {
    const res = await fetch(`${API_BASE}/check-access?${params.toString()}`, {
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!res.ok) {
      throw new Error("Failed to check route access");
    }
    return res.json();
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === "AbortError") {
      // Timeout - fail closed (this hook is used for feature/page gating)
      return {
        hasAccess: false,
        reason: "Backend timeout",
        isPublicOverride: false,
        isDisabled: false,
        requiredLevel: 0,
        requiredGroups: [],
        userLevel: 0,
        userGroups: [],
        routeConfig: null,
      };
    }
    throw error;
  }
}

/**
 * Hook to check access for a specific route
 * @param {string} route - Route pattern
 * @param {object} options - { resourceType?, resourceId?, enabled? }
 * @returns {{
 *   hasAccess: boolean,
 *   reason: string|null,
 *   isPublic: boolean,
 *   isDisabled: boolean,
 *   requiredLevel: number,
 *   requiredGroups: string[],
 *   userLevel: number,
 *   userGroups: string[],
 *   isLoading: boolean,
 *   routeConfig: object|null
 * }}
 */
export function useRouteAccess(route, options = {}) {
  const identity = useAppIdentity();
  const { resourceType, resourceId, enabled = true } = options;

  const query = useQuery({
    queryKey: [
      "route-access",
      route,
      resourceType,
      resourceId,
      identity.fid,
      identity.walletAddress,
    ],
    queryFn: () =>
      checkRouteAccess({
        fid: identity.fid,
        wallet: identity.walletAddress,
        route,
        resourceType,
        resourceId,
      }),
    enabled: enabled && !!route,
    staleTime: 30000, // Cache for 30 seconds
  });

  return {
    hasAccess: query.data?.hasAccess ?? false,
    reason: query.data?.reason ?? null,
    isPublic: query.data?.isPublicOverride ?? false,
    isDisabled: query.data?.isDisabled ?? false,
    requiredLevel: query.data?.requiredLevel ?? 0,
    requiredGroups: query.data?.requiredGroups ?? [],
    userLevel: query.data?.userLevel ?? 0,
    userGroups: query.data?.userGroups ?? [],
    isLoading: query.isLoading,
    routeConfig: query.data?.routeConfig ?? null,
  };
}

/**
 * Hook to get route configuration (public info)
 * @param {string} route - Route pattern
 * @returns {{
 *   config: object|null,
 *   isLoading: boolean,
 *   isError: boolean
 * }}
 */
export function useRouteConfig(route) {
  const query = useQuery({
    queryKey: ["route-config", route],
    queryFn: async () => {
      const res = await fetch(
        `${API_BASE}/route-config?route=${encodeURIComponent(route)}`,
      );
      if (!res.ok) {
        if (res.status === 404) return null;
        throw new Error("Failed to get route config");
      }
      return res.json();
    },
    enabled: !!route,
    staleTime: 60000, // Cache for 1 minute
  });

  return {
    config: query.data,
    isLoading: query.isLoading,
    isError: query.isError,
  };
}

export default useRouteAccess;
