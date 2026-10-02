import { supabase } from "./supabaseClient.js";
import { cacheRead, ROUTE_CONFIG_KEY_PREFIX } from "./redisCache.js";

// route_access_config rarely mutates (admin-only); cache lookups for 5 min.
// Mutations in routeConfigService invalidate the whole namespace via
// cacheInvalidatePattern("route_config:*").
const ROUTE_CONFIG_CACHE_TTL_SECONDS = 300;

// Columns the cached value must carry. Includes everything the public
// /api/access/route-config response surfaces (name, description) plus the
// fields checkRouteAccess consults. Keep this in sync with the public
// endpoint shape — silently dropping a column here silently empties the
// JSON response there.
const ROUTE_CONFIG_COLUMNS =
  "route_pattern, resource_type, resource_id, required_level, required_groups, " +
  "require_all_groups, is_public, is_disabled, priority, name, description";

function buildRouteConfigKey(route, resourceType, resourceId) {
  // Use literal "_" as the no-value sentinel so the key namespace stays
  // unambiguous (a real resourceType/Id of `undefined` would otherwise
  // collide with the absent-filter form). encodeURIComponent prevents
  // `:` characters in any segment (e.g., Fastify route patterns like
  // `/api/users/:userId`) from colliding with the key delimiter.
  const r = encodeURIComponent(route ?? "");
  const rt = resourceType == null ? "_" : encodeURIComponent(resourceType);
  const ri = resourceId == null ? "_" : encodeURIComponent(resourceId);
  return `${ROUTE_CONFIG_KEY_PREFIX}${r}:${rt}:${ri}`;
}

// Access level constants
export const ACCESS_LEVELS = {
  PUBLIC: 0,
  CONNECTED: 1,
  ALLOWLIST: 2,
  BETA: 3,
  ADMIN: 4,
};

export const ACCESS_LEVEL_NAMES = {
  0: "public",
  1: "connected",
  2: "allowlist",
  3: "beta",
  4: "admin",
};

// Columns read from allowlist_entries for an access lookup.
const ACCESS_ENTRY_COLUMNS =
  "id, wallet_address, access_level, is_active, username, source, added_at";

/**
 * Get user's access info by wallet address
 * @param {object} params - { wallet? }
 * @returns {Promise<{level: number, levelName: string, groups: string[], entry: object|null}>}
 */
export async function getUserAccess({ wallet } = {}) {
  const publicAccess = {
    level: ACCESS_LEVELS.PUBLIC,
    levelName: ACCESS_LEVEL_NAMES[ACCESS_LEVELS.PUBLIC],
    groups: [],
    entry: null,
  };

  try {
    if (!wallet) return publicAccess;

    const { data: entry, error } = await supabase
      .from("allowlist_entries")
      .select(ACCESS_ENTRY_COLUMNS)
      .eq("wallet_address", wallet.toLowerCase())
      .eq("is_active", true)
      .single();
    if (error && error.code !== "PGRST116") {
      throw error;
    }

    // No active row → public default
    if (!entry) return publicAccess;

    const groups = await getUserGroups({ wallet: entry.wallet_address });

    return {
      level: entry.access_level ?? ACCESS_LEVELS.ALLOWLIST,
      levelName:
        ACCESS_LEVEL_NAMES[entry.access_level ?? ACCESS_LEVELS.ALLOWLIST],
      groups,
      entry,
    };
  } catch (error) {
    if (error.code === "PGRST116") {
      return publicAccess;
    }
    console.error("Error getting user access:", error);
    throw error;
  }
}

/**
 * Check if user can access a route/resource
 * @param {object} params - { wallet?, route, resourceType?, resourceId? }
 * @returns {Promise<{hasAccess: boolean, reason: string, userLevel: number, requiredLevel: number, requiredGroups: string[], userGroups: string[], isPublicOverride: boolean, isDisabled: boolean, routeConfig: object|null}>}
 */
export async function checkRouteAccess({
  wallet,
  route,
  resourceType,
  resourceId,
}) {
  try {
    // Get user's access info
    const userAccess = await getUserAccess({ wallet });

    // Get route configuration
    const routeConfig = await getRouteConfig(route, resourceType, resourceId);

    // If no route config found, default to allowlist level (2)
    const requiredLevel =
      routeConfig?.required_level ?? ACCESS_LEVELS.ALLOWLIST;
    const requiredGroups = routeConfig?.required_groups ?? [];
    const requireAllGroups = routeConfig?.require_all_groups ?? false;
    const isPublicOverride = routeConfig?.is_public ?? false;
    const isDisabled = routeConfig?.is_disabled ?? false;

    // Check if route is disabled (maintenance mode)
    if (isDisabled) {
      return {
        hasAccess: false,
        reason: "disabled",
        userLevel: userAccess.level,
        requiredLevel,
        requiredGroups,
        userGroups: userAccess.groups,
        isPublicOverride,
        isDisabled,
        routeConfig,
      };
    }

    // Check if route has public override
    if (isPublicOverride) {
      return {
        hasAccess: true,
        reason: "public_override",
        userLevel: userAccess.level,
        requiredLevel,
        requiredGroups,
        userGroups: userAccess.groups,
        isPublicOverride,
        isDisabled,
        routeConfig,
      };
    }

    // Check access level
    if (userAccess.level < requiredLevel) {
      return {
        hasAccess: false,
        reason: "insufficient_level",
        userLevel: userAccess.level,
        requiredLevel,
        requiredGroups,
        userGroups: userAccess.groups,
        isPublicOverride,
        isDisabled,
        routeConfig,
      };
    }

    // Check group requirements if any
    if (requiredGroups.length > 0) {
      const hasRequiredGroups = requireAllGroups
        ? requiredGroups.every((group) => userAccess.groups.includes(group))
        : requiredGroups.some((group) => userAccess.groups.includes(group));

      if (!hasRequiredGroups) {
        return {
          hasAccess: false,
          reason: "missing_groups",
          userLevel: userAccess.level,
          requiredLevel,
          requiredGroups,
          userGroups: userAccess.groups,
          isPublicOverride,
          isDisabled,
          routeConfig,
        };
      }
    }

    // Access granted
    return {
      hasAccess: true,
      reason: "level_met",
      userLevel: userAccess.level,
      requiredLevel,
      requiredGroups,
      userGroups: userAccess.groups,
      isPublicOverride,
      isDisabled,
      routeConfig,
    };
  } catch (error) {
    console.error("Error checking route access:", error);
    return {
      hasAccess: false,
      reason: "error",
      userLevel: ACCESS_LEVELS.PUBLIC,
      requiredLevel: ACCESS_LEVELS.ALLOWLIST,
      requiredGroups: [],
      userGroups: [],
      isPublicOverride: false,
      isDisabled: false,
      routeConfig: null,
    };
  }
}

/**
 * Get route configuration. Read-through Redis cache (5 min TTL); mutations
 * in routeConfigService.js explicitly invalidate the route_config:*
 * namespace. Returns null when no config is found — that null is also
 * cached so the cold-path lookup doesn't re-fire on every request to a
 * route with no explicit ACL.
 *
 * @param {string} route - Route pattern
 * @param {string} resourceType - Optional resource type
 * @param {string} resourceId - Optional resource ID
 * @returns {Promise<object|null>}
 */
export async function getRouteConfig(route, resourceType, resourceId) {
  const key = buildRouteConfigKey(route, resourceType, resourceId);
  return cacheRead(
    key,
    async () => {
      // Try exact match first with resource specificity. `.single()`
      // resolves with `{ data: null, error: { code: 'PGRST116' } }` when
      // no row matches — that's a legitimate "no config for this slot"
      // outcome and we just fall through to the route-pattern match.
      // ANY OTHER error means Supabase actually failed (auth, network,
      // schema). We THROW out of the loader so cacheRead does NOT cache
      // the failure — otherwise a transient blip would poison the cache
      // for the 5-min TTL with `null`, which checkRouteAccess interprets
      // as "no config" and falls back to requiredLevel=ALLOWLIST.
      if (resourceType && resourceId) {
        const { data, error } = await supabase
          .from("route_access_config")
          .select(ROUTE_CONFIG_COLUMNS)
          .eq("route_pattern", route)
          .eq("resource_type", resourceType)
          .eq("resource_id", resourceId)
          .order("priority", { ascending: false })
          .limit(1)
          .single();

        if (error && error.code !== "PGRST116") {
          throw error;
        }
        if (data) return data;
      }

      // Fallback: route pattern only
      const { data, error } = await supabase
        .from("route_access_config")
        .select(ROUTE_CONFIG_COLUMNS)
        .eq("route_pattern", route)
        .order("priority", { ascending: false })
        .limit(1)
        .single();

      if (error && error.code !== "PGRST116") {
        throw error;
      }
      return data || null;
    },
    { ttlSeconds: ROUTE_CONFIG_CACHE_TTL_SECONDS },
  );
}

/**
 * Set user's access level
 * @param {object} identifier - { wallet }
 * @param {number} level - New access level (0-4)
 * @returns {Promise<{success: boolean, entry?: object}>}
 */
export async function setUserAccessLevel(identifier, level) {
  try {
    if (level < 0 || level > 4) {
      throw new Error("Invalid access level. Must be 0-4.");
    }

    const wallet = identifier?.wallet;
    if (!wallet) {
      throw new Error("wallet is required");
    }

    const { data, error } = await supabase
      .from("allowlist_entries")
      .update({ access_level: level, updated_at: new Date().toISOString() })
      .eq("wallet_address", wallet.toLowerCase())
      .select()
      .single();

    if (error) throw error;

    return { success: true, entry: data };
  } catch (error) {
    console.error("Error setting user access level:", error);
    return { success: false, error: error.message };
  }
}

/**
 * Get default access level for new entries
 * @returns {Promise<number>}
 */
export async function getDefaultAccessLevel() {
  try {
    const { data, error } = await supabase
      .from("access_settings")
      .select("value")
      .eq("key", "default_access_level")
      .single();

    if (error) throw error;

    return parseInt(data.value, 10);
  } catch (error) {
    console.error("Error getting default access level:", error);
    return ACCESS_LEVELS.ALLOWLIST; // Default fallback
  }
}

/**
 * Set default access level for new entries
 * @param {number} level - Default level (0-4)
 * @returns {Promise<{success: boolean}>}
 */
export async function setDefaultAccessLevel(level) {
  try {
    if (level < 0 || level > 4) {
      throw new Error("Invalid access level. Must be 0-4.");
    }

    const { error } = await supabase.from("access_settings").upsert({
      key: "default_access_level",
      value: level.toString(),
      updated_at: new Date().toISOString(),
    });

    if (error) throw error;

    return { success: true };
  } catch (error) {
    console.error("Error setting default access level:", error);
    return { success: false, error: error.message };
  }
}

/**
 * Get user's groups
 * @param {object} identifier - { wallet }
 * @returns {Promise<string[]>}
 */
export async function getUserGroups(identifier) {
  try {
    const wallet = identifier?.wallet;
    if (!wallet) return [];

    const { data, error } = await supabase
      .from("user_access_groups")
      .select("access_groups(slug)")
      .eq("is_active", true)
      .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
      .eq("wallet_address", wallet.toLowerCase());

    if (error) throw error;

    return data.map((item) => item.access_groups.slug);
  } catch (error) {
    console.error("Error getting user groups:", error);
    return [];
  }
}
