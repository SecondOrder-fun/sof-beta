import { supabase, hasSupabase } from "./supabaseClient.js";

const TAG = "[sponsorPrizeService]";

/**
 * Service for managing sponsored prizes in the database.
 */

/**
 * Record a new sponsored prize.
 * @param {Object} prize - Prize data
 * @returns {Promise<Object|null>} Inserted row or null on error
 */
export async function createSponsorPrize(prize) {
  try {
    if (!hasSupabase) return null;

    const { data, error } = await supabase
      .from("sponsor_prizes")
      .insert({
        season_id: Number(prize.seasonId),
        prize_type: prize.prizeType,
        chain_id: prize.chainId || 8453,
        token_address: prize.tokenAddress,
        token_name: prize.tokenName || null,
        token_symbol: prize.tokenSymbol || null,
        token_decimals: prize.tokenDecimals || null,
        amount: prize.amount || null,
        token_id: prize.tokenId || null,
        token_uri: prize.tokenUri || null,
        image_url: prize.imageUrl || null,
        description: prize.description || null,
        sponsor_address: prize.sponsorAddress,
        target_tier: prize.targetTier || 0,
        is_onchain: prize.isOnchain !== false,
        tx_hash: prize.txHash || null,
      })
      .select()
      .single();

    if (error) {
      console.error(`${TAG} Failed to create prize:`, error.message);
      return null;
    }
    return data;
  } catch (error) {
    console.error(`${TAG} Failed to create prize:`, error);
    return null;
  }
}

/**
 * Get all sponsored prizes for a season.
 * @param {number} seasonId
 * @returns {Promise<Array>}
 */
export async function getSponsorPrizes(seasonId) {
  try {
    if (!hasSupabase) return [];

    const { data, error } = await supabase
      .from("sponsor_prizes")
      .select("*")
      .eq("season_id", Number(seasonId))
      .order("created_at", { ascending: true });

    if (error) {
      console.error(`${TAG} Failed to get prizes:`, error.message);
      return [];
    }
    return data || [];
  } catch (error) {
    console.error(`${TAG} Failed to get prizes:`, error);
    return [];
  }
}

/**
 * Mark a prize as claimed.
 * @param {number} prizeId
 * @param {string} claimTxHash
 * @returns {Promise<boolean>}
 */
export async function markPrizeClaimed(prizeId, claimTxHash) {
  try {
    if (!hasSupabase) return false;

    const { error } = await supabase
      .from("sponsor_prizes")
      .update({
        is_claimed: true,
        claim_tx_hash: claimTxHash || null,
      })
      .eq("id", prizeId);

    if (error) {
      console.error(`${TAG} Failed to mark claimed:`, error.message);
      return false;
    }
    return true;
  } catch (error) {
    console.error(`${TAG} Failed to mark claimed:`, error);
    return false;
  }
}

/**
 * Save tier configuration for a season.
 * @param {number} seasonId
 * @param {Array<{tierIndex: number, winnerCount: number}>} tiers
 * @returns {Promise<boolean>}
 */
export async function saveTierConfigs(seasonId, tiers) {
  try {
    if (!hasSupabase) return false;

    // Delete existing tiers for this season
    await supabase
      .from("season_tier_configs")
      .delete()
      .eq("season_id", Number(seasonId));

    if (!tiers || tiers.length === 0) return true;

    const rows = tiers.map((t) => ({
      season_id: Number(seasonId),
      tier_index: t.tierIndex,
      winner_count: t.winnerCount,
    }));

    const { error } = await supabase
      .from("season_tier_configs")
      .insert(rows);

    if (error) {
      console.error(`${TAG} Failed to save tier configs:`, error.message);
      return false;
    }
    return true;
  } catch (error) {
    console.error(`${TAG} Failed to save tier configs:`, error);
    return false;
  }
}

/**
 * Get tier configuration for a season.
 * @param {number} seasonId
 * @returns {Promise<Array>}
 */
export async function getTierConfigs(seasonId) {
  try {
    if (!hasSupabase) return [];

    const { data, error } = await supabase
      .from("season_tier_configs")
      .select("*")
      .eq("season_id", Number(seasonId))
      .order("tier_index", { ascending: true });

    if (error) {
      console.error(`${TAG} Failed to get tier configs:`, error.message);
      return [];
    }
    return data || [];
  } catch (error) {
    console.error(`${TAG} Failed to get tier configs:`, error);
    return [];
  }
}
