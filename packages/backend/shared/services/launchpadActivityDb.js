/**
 * launchpadActivityDb
 *
 * Reads for the launchpad's live surfaces: the price chart, the raffle badge
 * and card, and the two rows of the activity ticker. Plain rows out; shaping
 * lives in src/services/activityFeed.js.
 *
 * Seasons are linked to launch tokens by season_contracts.quote_token_address
 * (migration 024). Addresses are stored lowercased and every argument here is
 * lowercased to match.
 */

import { supabase, hasSupabase } from "../supabaseClient.js";

const lc = (v) => String(v).toLowerCase();

const SEASON_COLUMNS =
  "season_id, name, status, start_time, end_time, total_participants, total_tickets, " +
  "total_prize_pool, quote_token_address, winner_address, bonding_curve_address, created_at, updated_at";

function fail(fn, error) {
  throw new Error(`launchpadActivityDb.${fn}: ${error.message}`);
}

/**
 * Trades on one token since `sinceIso`, for the chart. Returned oldest first,
 * but it is the NEWEST `limit` trades: a busy token past the limit loses its
 * oldest points in range, never the latest price.
 * @param {string} token
 * @param {string | null} sinceIso  null = all history
 * @param {number} [limit=2000]
 */
export async function listTradesSince(token, sinceIso, limit = 2000) {
  if (!hasSupabase) return [];
  let q = supabase
    .from("launch_trades")
    .select("price_wei, block_time, block_number, log_index")
    .eq("token_address", lc(token))
    .order("block_number", { ascending: false })
    .order("log_index", { ascending: false })
    .limit(limit);
  if (sinceIso) q = q.gte("block_time", sinceIso);
  const { data, error } = await q;
  if (error) fail("listTradesSince", error);
  return (data || []).reverse();
}

/**
 * The last trade before `sinceIso` — where the chart line enters the range,
 * so a quiet hour still draws a line instead of starting mid-air.
 */
export async function lastTradeBefore(token, sinceIso) {
  if (!hasSupabase || !sinceIso) return null;
  const { data, error } = await supabase
    .from("launch_trades")
    .select("price_wei, block_time")
    .eq("token_address", lc(token))
    .lt("block_time", sinceIso)
    .order("block_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error && error.code !== "PGRST116") fail("lastTradeBefore", error);
  return data || null;
}

/** Every season priced in `token`, newest first. */
export async function listSeasonsForToken(token) {
  if (!hasSupabase) return [];
  const { data, error } = await supabase
    .from("season_contracts")
    .select(SEASON_COLUMNS)
    .eq("quote_token_address", lc(token))
    .order("season_id", { ascending: false });
  if (error) fail("listSeasonsForToken", error);
  return data || [];
}

/** Seasons priced in any of `tokens`, newest first — the badge lookup for a page of cards. */
export async function listSeasonsForTokens(tokens) {
  if (!hasSupabase || !tokens?.length) return [];
  const { data, error } = await supabase
    .from("season_contracts")
    .select(SEASON_COLUMNS)
    .in("quote_token_address", tokens.map(lc))
    .order("season_id", { ascending: false });
  if (error) fail("listSeasonsForTokens", error);
  return data || [];
}

/** Seasons by id, for labelling raffle entries. */
export async function listSeasonsById(seasonIds) {
  if (!hasSupabase || !seasonIds?.length) return [];
  const { data, error } = await supabase
    .from("season_contracts")
    .select(SEASON_COLUMNS)
    .in("season_id", seasonIds);
  if (error) fail("listSeasonsById", error);
  return data || [];
}

/** Recent seasons of any status, for "opened" / "closing" / "won" items. */
export async function listRecentSeasons(limit = 20) {
  if (!hasSupabase) return [];
  const { data, error } = await supabase
    .from("season_contracts")
    .select(SEASON_COLUMNS)
    .order("updated_at", { ascending: false })
    .limit(limit);
  if (error) fail("listRecentSeasons", error);
  return data || [];
}

/**
 * Recent ticket purchases across every season, with the bonding curve each
 * was made on. season_id restarts at 1 on a Raffle redeploy, so a row is only
 * the season's if its curve matches (migration 020); buildRaffleActivity
 * checks that. Rows with no curve predate the live deployment and are skipped
 * here so they do not use up the limit.
 */
export async function listRecentEntries(limit = 20) {
  if (!hasSupabase) return [];
  const { data, error } = await supabase
    .from("raffle_transactions")
    .select("season_id, user_address, ticket_amount, tx_hash, block_timestamp, bonding_curve_address")
    .eq("transaction_type", "BUY")
    .not("bonding_curve_address", "is", null)
    .order("block_timestamp", { ascending: false })
    .limit(limit);
  if (error) fail("listRecentEntries", error);
  return data || [];
}

/** Recent launch-pool trades across every token. */
export async function listRecentTrades(limit = 20) {
  if (!hasSupabase) return [];
  const { data, error } = await supabase
    .from("launch_trades")
    .select("tx_hash, log_index, token_address, trader, side, eth_amount, price_wei, block_time, block_number")
    .order("block_number", { ascending: false })
    .limit(limit);
  if (error) fail("listRecentTrades", error);
  return data || [];
}

/** Recent launches. */
export async function listRecentLaunches(limit = 10) {
  if (!hasSupabase) return [];
  const { data, error } = await supabase
    .from("token_launches")
    .select("token_address, creator_address, symbol, implied_fdv_wei, launched_at, tx_hash")
    .eq("is_hidden", false)
    .order("launched_at", { ascending: false })
    .limit(limit);
  if (error) fail("listRecentLaunches", error);
  return data || [];
}

/** token address -> symbol, for labelling rows that only carry an address. */
export async function symbolsFor(tokens) {
  if (!hasSupabase || !tokens?.length) return {};
  const { data, error } = await supabase
    .from("token_launches")
    .select("token_address, symbol")
    .in("token_address", [...new Set(tokens.map(lc))]);
  if (error) fail("symbolsFor", error);
  return Object.fromEntries((data || []).map((r) => [r.token_address, r.symbol]));
}

/**
 * Which of `tokens` are hidden (token_launches.is_hidden), lowercase. Hiding is
 * moderation: the public surfaces behave as though the token is not there, so
 * its trades and the seasons priced in it are filtered out by the callers.
 * @param {string[]} tokens
 * @returns {Promise<Set<string>>}
 */
export async function hiddenTokens(tokens) {
  if (!hasSupabase || !tokens?.length) return new Set();
  const { data, error } = await supabase
    .from("token_launches")
    .select("token_address")
    .eq("is_hidden", true)
    .in("token_address", [...new Set(tokens.map(lc))]);
  if (error) fail("hiddenTokens", error);
  return new Set((data || []).map((r) => lc(r.token_address)));
}

export const launchpadActivityDb = {
  listTradesSince,
  lastTradeBefore,
  listSeasonsForToken,
  listSeasonsForTokens,
  listSeasonsById,
  listRecentSeasons,
  listRecentEntries,
  listRecentTrades,
  listRecentLaunches,
  symbolsFor,
  hiddenTokens,
};
