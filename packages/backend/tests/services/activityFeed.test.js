// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  buildChart,
  downsample,
  raffleState,
  pickRaffleForToken,
  summarizeSeason,
  buildTokenActivity,
  buildRaffleActivity,
  CLOSING_WINDOW_SEC,
  liveSeasonCurves,
  withLivePrizePools,
} from "../../src/services/activityFeed.js";

const NOW = 1_700_000_000;
const at = (sec) => new Date(sec * 1000).toISOString();
const launch = { launchedAt: at(NOW - 5 * 86400), startPriceWei: "1000000000" };

describe("buildChart", () => {
  it("enters the range at the price in force when it opened — the last earlier trade", () => {
    const c = buildChart({
      trades: [{ price_wei: "3000", block_time: at(NOW - 100) }],
      seed: { price_wei: "2000", block_time: at(NOW - 7200) },
      launch, rangeSec: 3600, nowSec: NOW,
    });
    expect(c.points[0]).toEqual({ t: NOW - 3600, priceWei: "2000" });
    expect(c.points.at(-1)).toEqual({ t: NOW - 100, priceWei: "3000" });
  });

  // A quiet hour must still draw a line, not an empty chart.
  it("draws the entry point even when nothing traded in range", () => {
    const c = buildChart({ trades: [], seed: { price_wei: "2000", block_time: at(NOW - 7200) }, launch, rangeSec: 3600, nowSec: NOW });
    expect(c.points).toEqual([{ t: NOW - 3600, priceWei: "2000" }]);
  });

  it("starts 'all' at the launch price and time", () => {
    const c = buildChart({ trades: [], seed: null, launch, rangeSec: null, nowSec: NOW });
    expect(c.points[0]).toEqual({ t: NOW - 5 * 86400, priceWei: "1000000000" });
    expect(c.launch.priceWei).toBe("1000000000");
  });

  it("never starts before launch, even for a range longer than the token has existed", () => {
    const young = { launchedAt: at(NOW - 600), startPriceWei: "5" };
    const c = buildChart({ trades: [], seed: null, launch: young, rangeSec: 86400, nowSec: NOW });
    expect(c.points[0]).toEqual({ t: NOW - 600, priceWei: "5" });
  });

  // Truncated: only the newest trades came back. The launch price (or the
  // range's opening price) is not the price before the first of them.
  it("enters a truncated 'all' chart at the newest omitted trade, at its own time", () => {
    const c = buildChart({
      trades: [{ price_wei: "900", block_time: at(NOW - 50) }, { price_wei: "950", block_time: at(NOW - 10) }],
      seed: { price_wei: "880", block_time: at(NOW - 60) },
      truncated: true,
      launch, rangeSec: null, nowSec: NOW,
    });
    expect(c.points.map((p) => [p.t, p.priceWei])).toEqual([[NOW - 60, "880"], [NOW - 50, "900"], [NOW - 10, "950"]]);
    expect(c.launch.priceWei).toBe("1000000000");
  });

  it("enters a truncated ranged chart at the omitted trade, not the range's start", () => {
    const c = buildChart({
      trades: [{ price_wei: "900", block_time: at(NOW - 50) }],
      seed: { price_wei: "880", block_time: at(NOW - 60) },
      truncated: true,
      launch, rangeSec: 3600, nowSec: NOW,
    });
    expect(c.points[0]).toEqual({ t: NOW - 60, priceWei: "880" });
  });
});

describe("summarizeSeason", () => {
  it("carries grandPrizeBps as a number, or null", () => {
    expect(summarizeSeason({ season_id: 1, grand_prize_bps: 6500 }).grandPrizeBps).toBe(6500);
    expect(summarizeSeason({ season_id: 1, grand_prize_bps: null }).grandPrizeBps).toBeNull();
    expect(summarizeSeason({ season_id: 1 }).grandPrizeBps).toBeNull();
  });
});

describe("downsample", () => {
  const pts = Array.from({ length: 1000 }, (_, i) => ({ t: i, priceWei: String(i) }));

  it("caps the point count and keeps the first and last", () => {
    const d = downsample(pts, 50);
    expect(d.length).toBeLessThanOrEqual(50);
    expect(d[0]).toEqual(pts[0]);
    expect(d.at(-1)).toEqual(pts.at(-1));
  });

  it("keeps only prices that actually traded — no averaging", () => {
    const originals = new Set(pts.map((p) => p.priceWei));
    for (const p of downsample(pts, 50)) expect(originals.has(p.priceWei)).toBe(true);
  });

  it("leaves short series alone", () => {
    expect(downsample(pts.slice(0, 10), 50)).toHaveLength(10);
  });
});

describe("raffleState", () => {
  it("maps every SeasonStatus", () => {
    expect([0, 1, 2, 3, 4, 5, 6].map((status) => raffleState({ status }))).toEqual([
      "upcoming", "live", "drawing", "drawing", "drawing", "ended", "cancelled",
    ]);
  });
});

describe("pickRaffleForToken", () => {
  const season = (season_id, status) => ({ season_id, status });

  it("leads with a live season over newer ones in other states", () => {
    expect(pickRaffleForToken([season(9, 5), season(7, 1), season(8, 0)]).seasonId).toBe(7);
  });

  it("prefers drawing, then upcoming, then the latest result", () => {
    expect(pickRaffleForToken([season(3, 5), season(4, 3)]).state).toBe("drawing");
    expect(pickRaffleForToken([season(3, 5), season(4, 0)]).state).toBe("upcoming");
    expect(pickRaffleForToken([season(3, 5), season(4, 5)]).seasonId).toBe(4);
  });

  it("returns null for a token with no seasons", () => {
    expect(pickRaffleForToken([])).toBeNull();
  });
});

describe("buildTokenActivity", () => {
  it("merges trades and launches newest first, labelled with symbols", () => {
    const items = buildTokenActivity({
      trades: [
        { side: "BUY", block_time: at(NOW - 10), trader: "0xa", token_address: "0xt", eth_amount: "1", price_wei: "5", tx_hash: "0x1" },
        { side: "SELL", block_time: at(NOW - 30), trader: "0xb", token_address: "0xt", eth_amount: "2", price_wei: "4", tx_hash: "0x2" },
      ],
      launches: [{ launched_at: at(NOW - 20), creator_address: "0xc", token_address: "0xu", symbol: "NEW", implied_fdv_wei: "9", tx_hash: "0x3" }],
      symbols: { "0xt": "POND" },
    });
    expect(items.map((i) => i.kind)).toEqual(["buy", "launch", "sell"]);
    expect(items[0].symbol).toBe("POND");
    expect(items[1].symbol).toBe("NEW");
  });

  // One transaction can hold several trades, so txHash alone is not a key.
  it("carries each trade's logIndex, and null for a launch", () => {
    const items = buildTokenActivity({
      trades: [
        { side: "BUY", block_time: at(NOW - 10), token_address: "0xt", tx_hash: "0x1", log_index: 4 },
        { side: "SELL", block_time: at(NOW - 11), token_address: "0xt", tx_hash: "0x1", log_index: 7 },
      ],
      launches: [{ launched_at: at(NOW - 20), token_address: "0xu", tx_hash: "0x3" }],
      symbols: {},
    });
    expect(items.map((i) => [i.txHash, i.logIndex])).toEqual([["0x1", 4], ["0x1", 7], ["0x3", null]]);
  });

  it("drops trades and launches of hidden tokens", () => {
    const items = buildTokenActivity({
      trades: [
        { side: "BUY", block_time: at(NOW - 10), token_address: "0xHID" },
        { side: "BUY", block_time: at(NOW - 11), token_address: "0xok" },
      ],
      launches: [{ launched_at: at(NOW - 20), token_address: "0xhid" }],
      symbols: {},
      hidden: new Set(["0xhid"]),
    });
    expect(items.map((i) => i.token)).toEqual(["0xok"]);
  });

  it("respects the limit", () => {
    const trades = Array.from({ length: 30 }, (_, i) => ({ side: "BUY", block_time: at(NOW - i), token_address: "0xt" }));
    expect(buildTokenActivity({ trades, launches: [], symbols: {}, limit: 5 })).toHaveLength(5);
  });
});

describe("buildRaffleActivity", () => {
  const CURVE = "0xCurveLive";
  const live = { season_id: 3, name: "S3", status: 1, start_time: NOW - 3600, end_time: NOW + 86400, quote_token_address: "0xt", total_participants: "12", bonding_curve_address: CURVE.toLowerCase() };
  const entry = (over = {}) => ({ season_id: 3, user_address: "0xa", ticket_amount: "40", block_timestamp: at(NOW - 5), tx_hash: "0x1", bonding_curve_address: CURVE, ...over });

  it("labels entries with their season and its token symbol", () => {
    const items = buildRaffleActivity({ entries: [entry()], seasons: [live], symbols: { "0xt": "POND" }, nowSec: NOW });
    const e = items.find((i) => i.kind === "entry");
    expect(e).toMatchObject({ who: "0xa", tickets: "40", seasonId: 3, symbol: "POND" });
  });

  // season_id restarts at 1 on a Raffle redeploy (migration 020): an old
  // deployment's season 3 purchase must not show up as the live season 3's.
  it("drops entries made on another deployment's curve, matching case-insensitively", () => {
    const items = buildRaffleActivity({
      entries: [
        entry({ tx_hash: "0xold", bonding_curve_address: "0xCurveOld" }),
        entry({ tx_hash: "0xnull", bonding_curve_address: null }),
        entry({ tx_hash: "0xlive", bonding_curve_address: CURVE.toUpperCase().replace("0X", "0x") }),
      ],
      seasons: [live], symbols: {}, nowSec: NOW,
    });
    expect(items.filter((i) => i.kind === "entry").map((i) => i.txHash)).toEqual(["0xlive"]);
  });

  it("drops seasons priced in a hidden token, and their entries", () => {
    const items = buildRaffleActivity({
      entries: [entry()], seasons: [{ ...live, quote_token_address: "0xT" }], symbols: {},
      hidden: new Set(["0xt"]), nowSec: NOW,
    });
    expect(items).toEqual([]);
  });

  it("announces a live season as opened", () => {
    const items = buildRaffleActivity({ entries: [], seasons: [live], symbols: {}, nowSec: NOW });
    expect(items.map((i) => i.kind)).toContain("opened");
  });

  it("flags a season as closing only inside the closing window", () => {
    const soon = { ...live, season_id: 4, end_time: NOW + CLOSING_WINDOW_SEC - 60 };
    const later = { ...live, season_id: 5, end_time: NOW + CLOSING_WINDOW_SEC + 60 };
    const items = buildRaffleActivity({ entries: [], seasons: [soon, later], symbols: {}, nowSec: NOW });
    const closing = items.filter((i) => i.kind === "closing").map((i) => i.seasonId);
    expect(closing).toEqual([4]);
  });

  it("reports a completed season's winner, with the grand prize", () => {
    const done = {
      season_id: 2, status: 5, winner_address: "0xw", total_prize_pool: "1000000000000000000001",
      grand_prize_bps: 6500, end_time: NOW - 60, updated_at: at(NOW - 60), quote_token_address: "0xt",
    };
    const items = buildRaffleActivity({ entries: [], seasons: [done], symbols: { "0xt": "POND" }, nowSec: NOW });
    expect(items[0]).toMatchObject({
      kind: "won", who: "0xw", prizePool: "1000000000000000000001", symbol: "POND",
      // floor(pool * 6500 / 10000), in BigInt — a JS number would lose the last digits
      grandPrize: "650000000000000000000",
    });
  });

  it("omits grandPrize when the season's grand_prize_bps is unknown", () => {
    const done = { season_id: 2, status: 5, winner_address: "0xw", total_prize_pool: "1000", grand_prize_bps: null, end_time: NOW - 60 };
    const [won] = buildRaffleActivity({ entries: [], seasons: [done], symbols: {}, nowSec: NOW });
    expect(won.prizePool).toBe("1000");
    expect(won).not.toHaveProperty("grandPrize");
  });

  // updated_at moves on every listener write, replays on restart included; a
  // win dated by it would resurface at the front of the ticker after a restart.
  it("dates a win by the season's end_time, not updated_at", () => {
    const done = { season_id: 2, status: 5, winner_address: "0xw", end_time: NOW - 86400, updated_at: at(NOW) };
    const items = buildRaffleActivity({
      entries: [entry({ block_timestamp: at(NOW - 3600) })],
      seasons: [done, live],
      symbols: {}, nowSec: NOW,
    });
    const won = items.find((i) => i.kind === "won");
    expect(won.at).toBe(at(NOW - 86400));
    expect(items.map((i) => i.kind).indexOf("won")).toBeGreaterThan(items.map((i) => i.kind).indexOf("entry"));
  });

  it("does not report a completed season with no recorded winner", () => {
    const done = { season_id: 2, status: 5, winner_address: null, end_time: NOW - 60, updated_at: at(NOW - 60) };
    expect(buildRaffleActivity({ entries: [], seasons: [done], symbols: {}, nowSec: NOW })).toEqual([]);
  });

  it("drops entries for seasons it knows nothing about", () => {
    const items = buildRaffleActivity({
      entries: [{ season_id: 99, user_address: "0xa", ticket_amount: "1", block_timestamp: at(NOW) }],
      seasons: [], symbols: {}, nowSec: NOW,
    });
    expect(items).toEqual([]);
  });
});

// season_contracts records the prize pool only at start, status changes and
// completion, so a live season read 0 there. Its curve's reserves are the pool.
describe("withLivePrizePools", () => {
  const seasons = [
    { season_id: 3, status: 1, total_prize_pool: "0", bonding_curve_address: "0xCurveA" },
    { season_id: 2, status: 1, total_prize_pool: "5", bonding_curve_address: "0xcurveb" },
    { season_id: 1, status: 5, total_prize_pool: "900", bonding_curve_address: "0xcurvec" },
    { season_id: 0, status: 1, total_prize_pool: "0", bonding_curve_address: null },
  ];
  const reserves = new Map([["0xcurvea", "12345"], ["0xcurvec", "1"]]);

  it("replaces a live season's pool with its curve's reserves (case-insensitive)", () => {
    const out = withLivePrizePools(seasons, reserves);
    expect(out.map((s) => s.total_prize_pool)).toEqual(["12345", "5", "900", "0"]);
    expect(summarizeSeason(out[0]).prizePool).toBe("12345");
  });

  it("leaves ended seasons, and live ones with no curve_state row, as stored", () => {
    const out = withLivePrizePools(seasons, reserves);
    expect(out[1]).toBe(seasons[1]);
    expect(out[2]).toBe(seasons[2]);
  });

  it("asks only for live seasons' curves", () => {
    expect(liveSeasonCurves(seasons)).toEqual(["0xCurveA", "0xcurveb"]);
  });
});
