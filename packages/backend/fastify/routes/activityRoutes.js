/**
 * activityRoutes — the site-wide activity ticker's feed.
 *
 * Mounted at /api/activity. One request returns every row the ticker shows:
 *
 *   { tokens:  [buy | sell | launch …],              newest first
 *     raffles: [entry | opened | closing | won …] }   newest first
 *
 * A third row (InfoFi markets) slots in here as another key when it lands.
 * Rows are shaped by src/services/activityFeed.js; wei stays as strings.
 */

import { launchpadActivityDb } from "../../shared/services/launchpadActivityDb.js";
import { buildRaffleActivity, buildTokenActivity } from "../../src/services/activityFeed.js";

const ROW_LIMIT = 20;

export default async function activityRoutes(fastify) {
  fastify.get("/", async (request, reply) => {
    try {
      const nowSec = Math.floor(Date.now() / 1000);

      const [trades, launches, entries, recentSeasons] = await Promise.all([
        launchpadActivityDb.listRecentTrades(ROW_LIMIT),
        launchpadActivityDb.listRecentLaunches(ROW_LIMIT / 2),
        launchpadActivityDb.listRecentEntries(ROW_LIMIT),
        launchpadActivityDb.listRecentSeasons(ROW_LIMIT),
      ]);

      // Entries can belong to seasons outside the "recent" window; fetch those too.
      const known = new Set(recentSeasons.map((s) => Number(s.season_id)));
      const missing = [...new Set(entries.map((e) => Number(e.season_id)))].filter((id) => !known.has(id));
      const seasons = missing.length
        ? [...recentSeasons, ...(await launchpadActivityDb.listSeasonsById(missing))]
        : recentSeasons;

      const tokens = [
        ...trades.map((t) => t.token_address),
        ...seasons.map((s) => s.quote_token_address).filter(Boolean),
      ];
      // Hidden tokens drop out of both rows. Recent trades and launches are
      // already queried without them (so a hidden token's trades cannot use up
      // the trade limit); the set below drops the seasons priced in one, and
      // re-checks the trades.
      const [symbols, hidden] = await Promise.all([
        launchpadActivityDb.symbolsFor(tokens),
        launchpadActivityDb.hiddenTokens(tokens),
      ]);

      return {
        tokens: buildTokenActivity({ trades, launches, symbols, hidden, limit: ROW_LIMIT }),
        raffles: buildRaffleActivity({ entries, seasons, symbols, hidden, nowSec, limit: ROW_LIMIT }),
      };
    } catch (err) {
      request.log.error({ err }, "activity feed failed");
      return reply.code(500).send({ error: "failed to load activity" });
    }
  });
}
