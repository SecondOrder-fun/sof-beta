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
  "total_prize_pool, grand_prize_bps, quote_token_address, winner_address, bonding_curve_address, " +
  "created_at, updated_at";

/** Most trades the chart reads for one request. */
export const CHART_TRADE_CAP = 50_000;
/** Rows per request while paging; PostgREST's default max-rows is 1,000. */
export const CHART_PAGE_SIZE = 1_000;

function fail(fn, error) {
  throw new Error(`launchpadActivityDb.${fn}: ${error.message}`);
}

/**
 * Every trade on one token since `sinceIso`, for the chart, oldest first.
 *
 * Pages newest-first by (block_number, log_index) keyset — stable while new
 * trades land, unlike an offset — until the range is exhausted or `cap` is
 * reached. Past the cap the OLDEST trades are the ones dropped, never the
 * latest price, and `truncated` is set; `before` is then the newest trade
 * left out, i.e. the price in force just before the first returned trade, so
 * the chart can enter there instead of drawing a false jump from the launch
 * price.
 *
 * @param {string} token
 * @param {string | null} sinceIso  null = all history
 * @param {{ cap?: number, pageSize?: number }} [opts]
 * @returns {Promise<{ trades: object[], truncated: boolean, before: object | null }>}
 */
export async function listTradesSince(token, sinceIso, { cap = CHART_TRADE_CAP, pageSize = CHART_PAGE_SIZE } = {}) {
  if (!hasSupabase) return { trades: [], truncated: false, before: null };
  const want = cap + 1; // one past the cap tells a full range from a truncated one
  const rows = [];
  while (rows.length < want) {
    const take = Math.min(pageSize, want - rows.length);
    let q = supabase
      .from("launch_trades")
      .select("price_wei, block_time, block_number, log_index")
      .eq("token_address", lc(token));
    if (sinceIso) q = q.gte("block_time", sinceIso);
    const last = rows.at(-1);
    if (last) {
      q = q.or(
        `block_number.lt.${last.block_number},and(block_number.eq.${last.block_number},log_index.lt.${last.log_index})`,
      );
    }
    const { data, error } = await q
      .order("block_number", { ascending: false })
      .order("log_index", { ascending: false })
      .limit(take);
    if (error) fail("listTradesSince", error);
    rows.push(...(data || []));
    if (!data || data.length < take) break;
  }
  const truncated = rows.length > cap;
  const before = truncated ? rows[cap] : null;
  return { trades: rows.slice(0, cap).reverse(), truncated, before };
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
    .order("log_index", { ascending: false })
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

/**
 * Recent seasons of any status, for "opened" / "closing" / "won" items.
 * Ordered by the season's own schedule (end_time, then start_time, then id),
 * never updated_at: every listener write bumps that, replays on restart
 * included, which would reshuffle old seasons to the front.
 */
export async function listRecentSeasons(limit = 20) {
  if (!hasSupabase) return [];
  const { data, error } = await supabase
    .from("season_contracts")
    .select(SEASON_COLUMNS)
    .order("end_time", { ascending: false, nullsFirst: false })
    .order("start_time", { ascending: false, nullsFirst: false })
    .order("season_id", { ascending: false })
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

/**
 * Recent launch-pool trades across every visible token, newest first.
 *
 * Hidden tokens are filtered IN the query — an inner join to token_launches
 * (launch_trades.token_address's foreign key) on is_hidden = false — so the
 * limit counts visible trades only. Filtering after the limit would let a
 * hidden token that trades heavily push every visible trade out of the page
 * and empty the ticker's tokens row.
 */
export async function listRecentTrades(limit = 20) {
  if (!hasSupabase) return [];
  const { data, error } = await supabase
    .from("launch_trades")
    .select(
      "tx_hash, log_index, token_address, trader, side, eth_amount, price_wei, block_time, block_number, " +
        "token_launches!inner(is_hidden)",
    )
    .eq("token_launches.is_hidden", false)
    .order("block_number", { ascending: false })
    .order("log_index", { ascending: false })
    .limit(limit);
  if (error) fail("listRecentTrades", error);
  // The join is only a filter; drop its column from the rows.
  return (data || []).map(({ token_launches: _join, ...trade }) => trade);
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

/**
 * Current quote-token reserves of each bonding curve, from curve_state
 * (migration 018; the column is still named sof_reserves), which
 * positionUpdateListener refreshes on every trade. A live season's prize pool
 * is its curve's reserves — Raffle copies curve.getReserves() into
 * totalPrizePool when the season ends — while season_contracts only records
 * it at a status change. One query for any number of curves.
 * @param {string[]} curves
 * @returns {Promise<Map<string, string>>} curve (lowercase) -> reserves in wei
 */
export async function curveReserves(curves) {
  if (!hasSupabase || !curves?.length) return new Map();
  const { data, error } = await supabase
    .from("curve_state")
    .select("bonding_curve_address, sof_reserves")
    .in("bonding_curve_address", [...new Set(curves.map(lc))]);
  if (error) fail("curveReserves", error);
  return new Map(
    (data || [])
      .filter((r) => r.sof_reserves != null)
      .map((r) => [lc(r.bonding_curve_address), String(r.sof_reserves)]),
  );
}

export const launchpadActivityDb = {
  curveReserves,
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
