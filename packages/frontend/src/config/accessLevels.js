/**
 * Access Level Constants
 * Defines access tiers and helper functions
 */

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

export const ACCESS_LEVEL_DISPLAY_NAMES = {
  0: "Public",
  1: "Connected",
  2: "Allowlist",
  3: "Beta",
  4: "Admin",
};

export const ACCESS_LEVEL_DESCRIPTIONS = {
  0: "Anyone can access (no wallet required)",
  1: "Must have wallet connected",
  2: "Must be on allowlist",
  3: "Beta testers with elevated access",
  4: "Full admin access",
};

/**
 * Get display name for access level
 * @param {number} level - Access level (0-4)
 * @returns {string}
 */
export function getAccessLevelDisplayName(level) {
  return ACCESS_LEVEL_DISPLAY_NAMES[level] || "Unknown";
}

/**
 * Get description for access level
 * @param {number} level - Access level (0-4)
 * @returns {string}
 */
export function getAccessLevelDescription(level) {
  return ACCESS_LEVEL_DESCRIPTIONS[level] || "";
}

/**
 * Check if level meets minimum requirement
 * @param {number} userLevel - User's access level
 * @param {number} requiredLevel - Required access level
 * @returns {boolean}
 */
export function meetsAccessLevel(userLevel, requiredLevel) {
  return userLevel >= requiredLevel;
}

/**
 * Get all access levels as array
 * @returns {Array<{value: number, name: string, displayName: string, description: string}>}
 */
export function getAllAccessLevels() {
  return Object.entries(ACCESS_LEVELS).map(([key, value]) => ({
    value,
    name: key.toLowerCase(),
    displayName: ACCESS_LEVEL_DISPLAY_NAMES[value],
    description: ACCESS_LEVEL_DESCRIPTIONS[value],
  }));
}
