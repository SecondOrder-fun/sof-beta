/**
 * activityFeed
 *
 * Pure shaping for the launchpad's live surfaces. No I/O: routes fetch rows
 * through launchpadActivityDb and hand them here, so every rule below is unit
 * testable against plain objects.
 *
 *   buildChart          — price points for one token over a range
 *   raffleState         — a season's lifecycle stage, as the raffle UI names it
 *   summarizeSeason     — one season, shaped for the badge and card
 *   liveSeasonCurves,
 *   withLivePrizePools  — a live season's prize pool from its curve's reserves
 *   pickRaffleForToken  — which of a token's seasons its badge should show
 *   buildTokenActivity  — the ticker's tokens row: buys, sells, launches
 *   buildRaffleActivity — the ticker's raffles row: entries, openings, closings, wins
 *
 * Amounts stay strings end to end (wei, or a launch quote token's raw units;
 * launch prices are those raw units per whole token × 1e18, `priceE18`); they
 * do not survive a JS number.
 */

export const CHART_RANGES = { "1h": 3600, "6h": 6 * 3600, "24h": 24 * 3600, all: null };

/** A season ending within this window is "closing" on the ticker. */
export const CLOSING_WINDOW_SEC = 3600;

const iso = (sec) => new Date(Number(sec) * 1000).toISOString();
const toSec = (value) => (value == null ? null : Math.floor(new Date(value).getTime() / 1000));

/**
 * @param {object} p
 * Prices are the launch's quote token's raw units per whole token × 1e18
 * (`price_e18`, `start_price_e18`), and the points carry them as `priceE18`.
 *
 * @param {{ price_e18: string, block_time: string }[]} p.trades  oldest first, within the range
 * @param {{ price_e18: string, block_time: string } | null} p.seed  the trade just before the
 *   first of `trades`: the last trade before the range or, when `truncated`, the newest one
 *   the cap left out
 * @param {{ launchedAt: string, startPriceE18: string }} p.launch
 * @param {number | null} p.rangeSec   null = all history
 * @param {number} p.nowSec
 * @param {boolean} [p.truncated=false]  `trades` holds only the newest part of the range
 * @param {number} [p.maxPoints=300]
 */
export function buildChart({ trades, seed, launch, rangeSec, nowSec, truncated = false, maxPoints = 300 }) {
  const launchSec = toSec(launch.launchedAt);
  let since = rangeSec == null ? launchSec : Math.max(launchSec, nowSec - rangeSec);

  /** @type {{ t: number, priceE18: string }[]} */
  const points = [];

  // Where the line enters: the price in force at that moment.
  //  - Complete range: at the range's start, the last trade before it — or the
  //    launch price if there was none (always so for "all").
  //  - Truncated: the trades before the first returned one are missing, so
  //    starting from the launch price (or the range's opening price) would draw
  //    a false jump. The line enters at the omitted trade just before the
  //    first returned one, at that trade's own time.
  let entryPrice = rangeSec != null && seed ? seed.price_e18 : launch.startPriceE18;
  if (truncated && seed) {
    since = Math.max(since, toSec(seed.block_time) ?? since);
    entryPrice = seed.price_e18;
  }
  points.push({ t: since, priceE18: String(entryPrice) });

  for (const tr of trades) {
    const t = toSec(tr.block_time);
    if (t == null || t < since) continue;
    points.push({ t, priceE18: String(tr.price_e18) });
  }

  return {
    launch: { t: launchSec, priceE18: String(launch.startPriceE18) },
    points: downsample(points, maxPoints),
  };
}

/**
 * Keep at most `max` points: the first, the last, and the last point in each
 * evenly sized time bucket between. Last-in-bucket rather than an average,
 * because every kept point is a price that actually traded.
 */
export function downsample(points, max) {
  if (points.length <= max || max < 3) return points;
  const first = points[0];
  const last = points[points.length - 1];
  const span = last.t - first.t || 1;
  const buckets = max - 2;
  const kept = new Map();
  for (const p of points.slice(1, -1)) {
    const b = Math.min(buckets - 1, Math.floor(((p.t - first.t) / span) * buckets));
    kept.set(b, p);
  }
  return [first, ...[...kept.keys()].sort((a, b) => a - b).map((k) => kept.get(k)), last];
}

/**
 * SeasonStatus (RaffleStorage.sol): 0 NotStarted, 1 Active, 2 EndRequested,
 * 3 VRFPending, 4 Distributing, 5 Completed, 6 Cancelled.
 * @returns {'upcoming'|'live'|'drawing'|'ended'|'cancelled'}
 */
export function raffleState(season) {
  const s = Number(season?.status ?? 0);
  if (s === 0) return "upcoming";
  if (s === 1) return "live";
  if (s >= 2 && s <= 4) return "drawing";
  if (s === 6) return "cancelled";
  return "ended";
}

/**
 * The grand prize in wei, floor(total_prize_pool * grand_prize_bps / 10000), as
 * a string — or null when either input is unknown. BigInt, because a prize
 * pool in wei does not survive a JS number.
 */
export function grandPrizeWei(season) {
  const bps = season?.grand_prize_bps;
  const pool = season?.total_prize_pool;
  if (bps == null || pool == null) return null;
  try {
    return ((BigInt(pool) * BigInt(bps)) / 10_000n).toString();
  } catch {
    return null;
  }
}

export function summarizeSeason(season) {
  return {
    seasonId: Number(season.season_id),
    name: season.name ?? null,
    state: raffleState(season),
    token: season.quote_token_address ?? null,
    startTime: season.start_time != null ? Number(season.start_time) : null,
    endTime: season.end_time != null ? Number(season.end_time) : null,
    participants: String(season.total_participants ?? "0"),
    tickets: String(season.total_tickets ?? "0"),
    prizePool: String(season.total_prize_pool ?? "0"),
    grandPrizeBps: season.grand_prize_bps != null ? Number(season.grand_prize_bps) : null,
    winner: season.winner_address ?? null,
    bondingCurve: season.bonding_curve_address ?? null,
  };
}

/**
 * The bonding curves whose reserves are a season's live prize pool: those of
 * live seasons. What a route passes to launchpadActivityDb.curveReserves.
 * @param {object[]} seasons  season_contracts rows
 * @returns {string[]}
 */
export function liveSeasonCurves(seasons) {
  return seasons
    .filter((s) => raffleState(s) === "live" && s.bonding_curve_address)
    .map((s) => s.bonding_curve_address);
}

/**
 * Seasons with a live season's `total_prize_pool` taken from its curve's
 * current reserves. season_contracts records the pool only at start, status
 * changes and completion, so a live season there reads 0 (or a stale value).
 * Other seasons, and a live one whose curve has no curve_state row, are
 * returned unchanged. `total_participants` stays as stored: no source the
 * backend keeps current per trade counts a season's holders.
 * @param {object[]} seasons  season_contracts rows
 * @param {Map<string, string>} reservesByCurve  curve (lowercase) -> wei
 */
export function withLivePrizePools(seasons, reservesByCurve) {
  return seasons.map((s) => {
    if (raffleState(s) !== "live" || !s.bonding_curve_address) return s;
    const reserves = reservesByCurve.get(String(s.bonding_curve_address).toLowerCase());
    return reserves == null ? s : { ...s, total_prize_pool: reserves };
  });
}

const PRIORITY = { live: 0, drawing: 1, upcoming: 2, ended: 3, cancelled: 4 };

/**
 * The season a token's badge and card should lead with: a live one first,
 * then one being drawn, then one about to open, then the most recent result.
 * Ties go to the newest season. Returns null when the token has none.
 */
export function pickRaffleForToken(seasons) {
  if (!seasons?.length) return null;
  const ranked = seasons
    .map(summarizeSeason)
    .sort((a, b) => PRIORITY[a.state] - PRIORITY[b.state] || b.seasonId - a.seasonId);
  return ranked[0];
}

/**
 * The ticker's tokens row, newest first.
 * @param {object} p
 * @param {object[]} p.trades    launch_trades rows
 * @param {object[]} p.launches  token_launches rows
 * @param {Record<string, string>} p.symbols  token -> symbol
 * @param {Set<string>} [p.hidden]  hidden tokens (lowercase); their items are dropped
 * @param {number} [p.limit=20]
 *
 * Every item carries `txHash` and `logIndex` (null for a launch, which is one
 * per transaction), so a client can key items uniquely — one transaction can
 * hold several trades.
 */
export function buildTokenActivity({ trades, launches, symbols, hidden = new Set(), limit = 20 }) {
  const visible = (token) => !hidden.has(String(token).toLowerCase());
  const items = [
    ...trades.filter((t) => visible(t.token_address)).map((t) => ({
      kind: t.side === "BUY" ? "buy" : "sell",
      at: t.block_time,
      who: t.trader,
      token: t.token_address,
      symbol: symbols[t.token_address] ?? null,
      quoteAmount: t.quote_amount,
      priceE18: t.price_e18,
      quoteSymbol: t.quote_symbol ?? null,
      quoteDecimals: t.quote_decimals ?? null,
      txHash: t.tx_hash,
      logIndex: t.log_index ?? null,
    })),
    ...launches.filter((l) => visible(l.token_address)).map((l) => ({
      kind: "launch",
      at: l.launched_at,
      who: l.creator_address,
      token: l.token_address,
      symbol: l.symbol ?? symbols[l.token_address] ?? null,
      fdv: l.start_fdv,
      quoteSymbol: l.quote_symbol ?? null,
      quoteDecimals: l.quote_decimals ?? null,
      txHash: l.tx_hash,
      logIndex: null,
    })),
  ];
  return newestFirst(items).slice(0, limit);
}

/**
 * The ticker's raffles row, newest first.
 * @param {object} p
 * @param {object[]} p.entries   raffle_transactions BUY rows
 * @param {object[]} p.seasons   season_contracts rows (every season the entries and events touch)
 * @param {Record<string, string>} p.symbols  token -> symbol, for seasons priced in launch tokens
 * @param {Set<string>} [p.hidden]  hidden tokens (lowercase); seasons priced in one are dropped
 * @param {number} p.nowSec
 * @param {number} [p.limit=20]
 *
 * An entry counts only if its bonding_curve_address is its season's
 * (case-insensitive). season_id restarts at 1 when the Raffle is redeployed,
 * so the id alone would label an old deployment's purchase with a live season
 * (migration 020).
 *
 * An entry has no logIndex: raffle_transactions records none, and is unique on
 * (tx_hash, season_id), so txHash + seasonId keys an entry item. A "won" item
 * carries `grandPrize` (wei string) when the season's grand_prize_bps is known.
 */
export function buildRaffleActivity({ entries, seasons: allSeasons, symbols, hidden = new Set(), nowSec, limit = 20 }) {
  const seasons = allSeasons.filter(
    (s) => !s.quote_token_address || !hidden.has(String(s.quote_token_address).toLowerCase()),
  );
  const byId = new Map(seasons.map((s) => [Number(s.season_id), s]));
  const sameCurve = (a, b) => a != null && b != null && String(a).toLowerCase() === String(b).toLowerCase();
  const label = (s) => ({
    seasonId: Number(s.season_id),
    seasonName: s.name ?? null,
    token: s.quote_token_address ?? null,
    symbol: s.quote_token_address ? symbols[s.quote_token_address] ?? null : null,
  });

  const items = [];

  for (const e of entries) {
    const s = byId.get(Number(e.season_id));
    if (!s || !sameCurve(e.bonding_curve_address, s.bonding_curve_address)) continue;
    items.push({ kind: "entry", at: e.block_timestamp, who: e.user_address, tickets: String(e.ticket_amount), txHash: e.tx_hash, ...label(s) });
  }

  for (const s of seasons) {
    const state = raffleState(s);
    const start = s.start_time != null ? Number(s.start_time) : null;
    const end = s.end_time != null ? Number(s.end_time) : null;

    if (state === "live" && start != null && start <= nowSec) {
      items.push({ kind: "opened", at: iso(start), ...label(s) });
    }
    if (state === "live" && end != null && end > nowSec && end - nowSec <= CLOSING_WINDOW_SEC) {
      // Dated "now" so it sits at the front while it is true.
      items.push({ kind: "closing", at: iso(nowSec), endsAt: end, participants: String(s.total_participants ?? "0"), ...label(s) });
    }
    // Dated by the season's end_time, which never changes. Not updated_at:
    // every listener write bumps it, replays on restart included, so old wins
    // would resurface as new.
    if (state === "ended" && s.winner_address && end != null) {
      const grandPrize = grandPrizeWei(s);
      items.push({
        kind: "won",
        at: iso(end),
        who: s.winner_address,
        prizePool: String(s.total_prize_pool ?? "0"),
        ...(grandPrize != null ? { grandPrize } : {}),
        ...label(s),
      });
    }
  }

  return newestFirst(items).slice(0, limit);
}

function newestFirst(items) {
  return items
    .filter((i) => i.at != null)
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
}
