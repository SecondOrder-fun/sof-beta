/**
 * tokenLaunchesDb
 *
 * Thin Supabase wrapper for `token_launches` and `launch_trades`
 * (migration 023). Returns plain rows; callers are responsible for shaping
 * them for the API.
 *
 * Addresses are lowercased on the way in and stored lowercased. Every read
 * lowercases its argument too, so a checksummed address from a URL matches a
 * row written from an event log.
 */

import { supabase, hasSupabase } from "../supabaseClient.js";

const LAUNCHES = "token_launches";
const TRADES = "launch_trades";

const LAUNCH_COLUMNS =
  "token_address, launch_id, creator_address, name, symbol, metadata_uri, " +
  "start_price_wei, implied_fdv_wei, total_supply, pool_id, launched_at, " +
  "block_number, tx_hash, is_hidden, is_verified, created_at, updated_at";

const TRADE_COLUMNS =
  "tx_hash, log_index, token_address, pool_id, trader, side, eth_amount, " +
  "token_amount, price_wei, tick, block_number, block_time";

const lc = (v) => (v == null ? v : String(v).toLowerCase());

/**
 * Insert a launch, ignoring one that is already indexed.
 *
 * Idempotent by design: the block cursor can rewind up to its throttle window
 * on a crash, so the same TokenLaunched log is expected to arrive twice. The
 * launch record is immutable once written — everything in it comes from a
 * single event — so "already there" is success, not a conflict to merge.
 *
 * @param {object} launch
 * @returns {Promise<boolean>} true if this call inserted the row
 */
export async function insertTokenLaunch(launch) {
  if (!hasSupabase) return false;

  const existing = await getTokenLaunch(launch.token_address);
  if (existing) return false;

  const { error } = await supabase.from(LAUNCHES).insert({
    ...launch,
    token_address: lc(launch.token_address),
    creator_address: lc(launch.creator_address),
    pool_id: lc(launch.pool_id),
    tx_hash: lc(launch.tx_hash),
  });

  if (error) {
    // A concurrent insert of the same token is the check-then-insert race, and
    // it means the row exists — which is the outcome we wanted.
    if (error.code === "23505") return false;
    throw new Error(`tokenLaunchesDb.insertTokenLaunch: ${error.message}`);
  }
  return true;
}

/**
 * One launch by token address, or null.
 * @param {string} tokenAddress
 */
export async function getTokenLaunch(tokenAddress) {
  if (!hasSupabase) return null;
  const { data, error } = await supabase
    .from(LAUNCHES)
    .select(LAUNCH_COLUMNS)
    .eq("token_address", lc(tokenAddress))
    .maybeSingle();
  if (error && error.code !== "PGRST116") {
    throw new Error(`tokenLaunchesDb.getTokenLaunch: ${error.message}`);
  }
  return data || null;
}

/**
 * One launch by v4 pool id, or null. The trade indexer's lookup.
 * @param {string} poolId
 */
export async function getTokenLaunchByPoolId(poolId) {
  if (!hasSupabase) return null;
  const { data, error } = await supabase
    .from(LAUNCHES)
    .select(LAUNCH_COLUMNS)
    .eq("pool_id", lc(poolId))
    .maybeSingle();
  if (error && error.code !== "PGRST116") {
    throw new Error(`tokenLaunchesDb.getTokenLaunchByPoolId: ${error.message}`);
  }
  return data || null;
}

/**
 * The discovery feed. Newest first; hidden rows excluded unless asked for.
 *
 * @param {object} [options]
 * @param {number} [options.limit=50]
 * @param {number} [options.offset=0]
 * @param {string} [options.creator] — filter to one creator
 * @param {boolean} [options.includeHidden=false]
 */
export async function listTokenLaunches({
  limit = 50,
  offset = 0,
  creator,
  includeHidden = false,
} = {}) {
  if (!hasSupabase) return [];

  let query = supabase
    .from(LAUNCHES)
    .select(LAUNCH_COLUMNS)
    .order("launched_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (!includeHidden) query = query.eq("is_hidden", false);
  if (creator) query = query.eq("creator_address", lc(creator));

  const { data, error } = await query;
  if (error) {
    throw new Error(`tokenLaunchesDb.listTokenLaunches: ${error.message}`);
  }
  return data || [];
}

/**
 * How many launches are indexed. Separate from the list so a page of 24 does
 * not have to fetch every row to show a total.
 * @param {object} [options]
 * @param {boolean} [options.includeHidden=false]
 */
export async function countTokenLaunches({ includeHidden = false } = {}) {
  if (!hasSupabase) return 0;
  let query = supabase.from(LAUNCHES).select("token_address", {
    count: "exact",
    head: true,
  });
  if (!includeHidden) query = query.eq("is_hidden", false);
  const { count, error } = await query;
  if (error) {
    throw new Error(`tokenLaunchesDb.countTokenLaunches: ${error.message}`);
  }
  return count ?? 0;
}

/**
 * Insert trades, ignoring ones already indexed.
 *
 * Idempotent on (tx_hash, log_index), which is the table's primary key — the
 * same reason insertTokenLaunch tolerates a repeat. Uses ignoreDuplicates
 * rather than a merge: a swap log never changes.
 *
 * @param {object[]} trades
 * @returns {Promise<number>} rows sent (not necessarily inserted)
 */
export async function insertLaunchTrades(trades) {
  if (!hasSupabase || !trades?.length) return 0;

  const rows = trades.map((t) => ({
    ...t,
    tx_hash: lc(t.tx_hash),
    token_address: lc(t.token_address),
    pool_id: lc(t.pool_id),
    trader: lc(t.trader),
  }));

  const { error } = await supabase
    .from(TRADES)
    .upsert(rows, { onConflict: "tx_hash,log_index", ignoreDuplicates: true });

  if (error) {
    throw new Error(`tokenLaunchesDb.insertLaunchTrades: ${error.message}`);
  }
  return rows.length;
}

/**
 * Trade history for one token, newest first.
 * @param {string} tokenAddress
 * @param {object} [options]
 * @param {number} [options.limit=100]
 * @param {number} [options.offset=0]
 */
export async function listLaunchTrades(
  tokenAddress,
  { limit = 100, offset = 0 } = {},
) {
  if (!hasSupabase) return [];
  const { data, error } = await supabase
    .from(TRADES)
    .select(TRADE_COLUMNS)
    .eq("token_address", lc(tokenAddress))
    .order("block_number", { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) {
    throw new Error(`tokenLaunchesDb.listLaunchTrades: ${error.message}`);
  }
  return data || [];
}


/**
 * Every launch pool the index knows about: pool id -> token and symbol. The
 * trade listener's starting map; it adds pools it discovers on-chain itself.
 * @returns {Promise<{ pool_id: string, token_address: string, symbol: string|null }[]>}
 */
export async function listPoolIndex() {
  if (!hasSupabase) return [];
  const { data, error } = await supabase
    .from(LAUNCHES)
    .select("pool_id, token_address, symbol")
    .not("pool_id", "is", null);
  if (error) {
    throw new Error(`tokenLaunchesDb.listPoolIndex: ${error.message}`);
  }
  return data || [];
}

export const tokenLaunchesDb = {
  insertTokenLaunch,
  getTokenLaunch,
  getTokenLaunchByPoolId,
  listTokenLaunches,
  countTokenLaunches,
  insertLaunchTrades,
  listLaunchTrades,
  listPoolIndex,
};
