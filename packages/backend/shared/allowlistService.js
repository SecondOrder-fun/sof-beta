/**
 * Allowlist Service
 * Manages wallet-based allowlist with time-gated additions
 */

import { db, hasSupabase } from "./supabaseClient.js";
import { getDefaultAccessLevel } from "./accessService.js";
import {
  getAllowlistCount,
  invalidateAllowlistCount,
} from "./allowlistCounter.js";

/**
 * Check if the allowlist window is currently open
 * @returns {Promise<{isOpen: boolean, config: object|null, reason?: string}>}
 */
export async function isAllowlistWindowOpen() {
  if (!hasSupabase) {
    return { isOpen: false, config: null, reason: "Database not configured" };
  }

  try {
    const { data, error } = await db.client
      .from("allowlist_config")
      // select * — the full row is returned as `config`/`windowConfig` to the
      // API (/window-status, /stats) and rendered by AllowlistPanel.jsx;
      // columns the UI reads vary, so narrowing here risks dropping one.
      .select("*")
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (error || !data) {
      return { isOpen: false, config: null, reason: "No active config found" };
    }

    const now = new Date();
    const windowStart = new Date(data.window_start);
    const windowEnd = data.window_end ? new Date(data.window_end) : null;

    // Check if we're before the window starts
    if (now < windowStart) {
      return {
        isOpen: false,
        config: data,
        reason: `Window opens at ${windowStart.toISOString()}`,
      };
    }

    // Check if we're after the window ends (if there's an end date)
    if (windowEnd && now > windowEnd) {
      return {
        isOpen: false,
        config: data,
        reason: `Window closed at ${windowEnd.toISOString()}`,
      };
    }

    // Check max entries if configured
    if (data.max_entries) {
      const count = await getAllowlistCount("active");

      if (count >= data.max_entries) {
        return {
          isOpen: false,
          config: data,
          reason: `Max entries (${data.max_entries}) reached`,
        };
      }
    }

    return { isOpen: true, config: data };
  } catch (error) {
    console.error("[Allowlist] Error checking window:", error);
    return { isOpen: false, config: null, reason: error.message };
  }
}

/**
 * Add a wallet to the allowlist
 * @param {object} identifier - { wallet }
 * @param {string} source - How they were added: 'manual', 'import'
 * @param {boolean} bypassTimeGate - Skip time gate check (for manual adds)
 * @returns {Promise<{success: boolean, entry?: object, error?: string}>}
 */
export async function addToAllowlist(
  identifier,
  source = "manual",
  bypassTimeGate = false
) {
  if (!hasSupabase) {
    return { success: false, error: "Database not configured" };
  }

  const wallet = identifier?.wallet;
  if (!wallet) {
    return { success: false, error: "wallet is required" };
  }

  const walletLc = wallet.toLowerCase();
  const label = `wallet ${walletLc}`;

  try {
    // Check time gate unless bypassed
    if (!bypassTimeGate) {
      const windowCheck = await isAllowlistWindowOpen();
      if (!windowCheck.isOpen) {
        console.log(
          `[Allowlist] Window closed for ${label}: ${windowCheck.reason}`
        );
        return {
          success: false,
          error: `Allowlist window closed: ${windowCheck.reason}`,
        };
      }
    }

    // Check if already exists
    const { data: existing } = await db.client
      .from("allowlist_entries")
      .select("id, wallet_address, is_active")
      .eq("wallet_address", walletLc)
      .single();

    if (existing) {
      // If exists but inactive, reactivate
      if (!existing.is_active) {
        const { data: updated, error: updateError } = await db.client
          .from("allowlist_entries")
          .update({
            is_active: true,
            updated_at: new Date().toISOString(),
          })
          .eq("id", existing.id)
          .select()
          .single();

        if (updateError) {
          return { success: false, error: updateError.message };
        }

        // Reactivation flips is_active false→true, changing the active count.
        await invalidateAllowlistCount();

        console.log(`[Allowlist] Reactivated ${label}`);
        return { success: true, entry: updated, reactivated: true };
      }

      // Already active
      console.log(`[Allowlist] ${label} already in allowlist`);
      return { success: true, entry: existing, alreadyExists: true };
    }

    // Get default access level
    const defaultLevel = await getDefaultAccessLevel();

    // Insert new entry
    const { data: entry, error: insertError } = await db.client
      .from("allowlist_entries")
      .insert({
        wallet_address: walletLc,
        source,
        is_active: true,
        access_level: defaultLevel,
        added_at: new Date().toISOString(),
        metadata: {},
      })
      .select()
      .single();

    if (insertError) {
      return { success: false, error: insertError.message };
    }

    // New active row — bust the total/active/withWallet counts.
    await invalidateAllowlistCount();

    console.log(`[Allowlist] Added ${label}`);
    return { success: true, entry };
  } catch (error) {
    console.error(`[Allowlist] Error adding ${label}:`, error);
    return { success: false, error: error.message };
  }
}

/**
 * Remove a wallet from the allowlist (soft delete)
 * @param {object} identifier - { wallet }
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function removeFromAllowlist(identifier) {
  if (!hasSupabase) {
    return { success: false, error: "Database not configured" };
  }

  const wallet = identifier?.wallet;
  if (!wallet) {
    return { success: false, error: "wallet is required" };
  }

  const label = `wallet ${wallet.toLowerCase()}`;

  try {
    const { error } = await db.client
      .from("allowlist_entries")
      .update({
        is_active: false,
        updated_at: new Date().toISOString(),
      })
      .eq("wallet_address", wallet.toLowerCase());

    if (error) {
      return { success: false, error: error.message };
    }

    // Soft-delete flips is_active true→false, changing the active count.
    await invalidateAllowlistCount();

    console.log(`[Allowlist] Removed ${label}`);
    return { success: true };
  } catch (error) {
    console.error(`[Allowlist] Error removing ${label}:`, error);
    return { success: false, error: error.message };
  }
}

/**
 * Check if a wallet address is in the allowlist
 * @param {string} walletAddress - Ethereum address
 * @returns {Promise<{isAllowlisted: boolean, entry?: object}>}
 */
export async function isWalletAllowlisted(walletAddress) {
  if (!hasSupabase || !walletAddress) {
    return { isAllowlisted: false };
  }

  try {
    const { data, error } = await db.client
      .from("allowlist_entries")
      // select * — the full entry row is returned to the API
      // (/api/allowlist/check → useAllowlist exposes `entry`); columns the
      // frontend may read vary, so we don't narrow this single-row read.
      .select("*")
      .eq("wallet_address", walletAddress.toLowerCase())
      .eq("is_active", true)
      .single();

    if (error || !data) {
      return { isAllowlisted: false };
    }

    return { isAllowlisted: true, entry: data };
  } catch (error) {
    console.error("[Allowlist] Error checking wallet:", error);
    return { isAllowlisted: false };
  }
}

/**
 * Get all allowlist entries
 * @param {object} options - Query options
 * @param {boolean} options.activeOnly - Only return active entries
 * @param {number} options.limit - Max entries to return
 * @returns {Promise<{entries: object[], count: number}>}
 */
export async function getAllowlistEntries({
  activeOnly = true,
  limit = 500,
} = {}) {
  if (!hasSupabase) {
    return { entries: [], count: 0 };
  }

  try {
    let query = db.client
      .from("allowlist_entries")
      .select("*", { count: "exact" })
      .order("added_at", { ascending: false })
      .limit(limit);

    if (activeOnly) {
      query = query.eq("is_active", true);
    }

    const { data, error, count } = await query;

    if (error) {
      throw error;
    }

    return { entries: data || [], count: count || 0 };
  } catch (error) {
    console.error("[Allowlist] Error fetching entries:", error);
    return { entries: [], count: 0 };
  }
}

/**
 * Get allowlist statistics
 * @returns {Promise<object>}
 */
export async function getAllowlistStats() {
  if (!hasSupabase) {
    return { total: 0, active: 0, withWallet: 0 };
  }

  try {
    // All three counts are served read-through from Redis (see
    // allowlistCounter.js); mutations bust the namespace so these stay
    // fresh without a COUNT(*) per stats call.
    const [total, active, withWallet] = await Promise.all([
      getAllowlistCount("total"),
      getAllowlistCount("active"),
      getAllowlistCount("active:withWallet"),
    ]);

    // Get window status
    const windowStatus = await isAllowlistWindowOpen();

    return {
      total: total || 0,
      active: active || 0,
      withWallet: withWallet || 0,
      windowOpen: windowStatus.isOpen,
      windowConfig: windowStatus.config,
    };
  } catch (error) {
    console.error("[Allowlist] Error fetching stats:", error);
    return { total: 0, active: 0, withWallet: 0 };
  }
}

/**
 * Update allowlist window configuration
 * @param {object} config - New configuration
 * @param {Date} config.windowStart - When window opens
 * @param {Date|null} config.windowEnd - When window closes (null = indefinite)
 * @param {number|null} config.maxEntries - Max entries allowed
 * @returns {Promise<{success: boolean, config?: object, error?: string}>}
 */
export async function updateAllowlistConfig({
  windowStart,
  windowEnd,
  maxEntries,
}) {
  if (!hasSupabase) {
    return { success: false, error: "Database not configured" };
  }

  try {
    // Deactivate current config
    await db.client
      .from("allowlist_config")
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq("is_active", true);

    // Insert new config
    const { data, error } = await db.client
      .from("allowlist_config")
      .insert({
        name: "default",
        window_start: windowStart || new Date().toISOString(),
        window_end: windowEnd || null,
        max_entries: maxEntries || null,
        is_active: true,
      })
      .select()
      .single();

    if (error) {
      return { success: false, error: error.message };
    }

    console.log("[Allowlist] Config updated:", data);
    return { success: true, config: data };
  } catch (error) {
    console.error("[Allowlist] Error updating config:", error);
    return { success: false, error: error.message };
  }
}

export default {
  isAllowlistWindowOpen,
  addToAllowlist,
  removeFromAllowlist,
  isWalletAllowlisted,
  getAllowlistEntries,
  getAllowlistStats,
  updateAllowlistConfig,
};
