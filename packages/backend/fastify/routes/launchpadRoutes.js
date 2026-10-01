/**
 * launchpadRoutes — the read side of the launch indexer.
 *
 * Mounted at /api/launchpad. Serves what tokenLaunchedListener indexed, so the
 * frontend's discovery feed stops doing its own multicall fan-out.
 *
 * Rows are returned in the shape the frontend already uses on-chain (camelCase,
 * bigints as strings) rather than raw snake_case columns. That is deliberate:
 * the feed can then switch data source without the components changing, and the
 * on-chain path stays a working fallback rather than a parallel format.
 */

import { tokenLaunchesDb } from "../../shared/services/tokenLaunchesDb.js";

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 24;
const MAX_TRADE_LIMIT = 500;
const DEFAULT_TRADE_LIMIT = 100;

/**
 * Clamp a query-string integer into range, falling back on anything unusable.
 * @param {unknown} raw
 * @param {number} fallback
 * @param {number} max
 */
function clampInt(raw, fallback, max) {
  const n = Number.parseInt(String(raw ?? ""), 10);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.min(n, max);
}

/** DB row -> API shape. */
function toLaunchResponse(row) {
  return {
    launchId: row.launch_id,
    token: row.token_address,
    creator: row.creator_address,
    name: row.name,
    symbol: row.symbol,
    metadataURI: row.metadata_uri,
    // Strings, not numbers: these are wei and do not survive a JS number.
    startPriceWei: row.start_price_wei,
    impliedFdvWei: row.implied_fdv_wei,
    totalSupply: row.total_supply,
    poolId: row.pool_id,
    launchedAt: row.launched_at,
    blockNumber: row.block_number,
    txHash: row.tx_hash,
    isVerified: row.is_verified,
  };
}

function toTradeResponse(row) {
  return {
    txHash: row.tx_hash,
    logIndex: row.log_index,
    token: row.token_address,
    trader: row.trader,
    side: row.side,
    ethAmount: row.eth_amount,
    tokenAmount: row.token_amount,
    priceWei: row.price_wei,
    tick: row.tick,
    blockNumber: row.block_number,
    blockTime: row.block_time,
  };
}

export default async function launchpadRoutes(fastify) {
  /**
   * GET /api/launchpad/tokens — the discovery feed, newest first.
   *
   * Query: limit, offset, creator.
   * Sorting beyond newest-first waits on the trade indexer; there is nothing to
   * sort by until volume is recorded.
   */
  fastify.get("/tokens", async (request, reply) => {
    const limit = clampInt(request.query?.limit, DEFAULT_LIMIT, MAX_LIMIT);
    const offset = clampInt(request.query?.offset, 0, Number.MAX_SAFE_INTEGER);
    const creator = request.query?.creator;

    if (creator && !ADDRESS_RE.test(creator)) {
      return reply.code(400).send({ error: "invalid creator address" });
    }

    try {
      const [rows, total] = await Promise.all([
        tokenLaunchesDb.listTokenLaunches({ limit, offset, creator }),
        tokenLaunchesDb.countTokenLaunches(),
      ]);
      return { launches: rows.map(toLaunchResponse), total, limit, offset };
    } catch (err) {
      request.log.error({ err }, "launchpad token feed failed");
      return reply.code(500).send({ error: "failed to load launches" });
    }
  });

  /**
   * GET /api/launchpad/tokens/:address — one launch.
   *
   * 404 for an address that is not a launchpad token. A token that exists
   * on-chain but is not yet indexed also 404s here, which is why the frontend
   * keeps its on-chain read as a fallback.
   */
  fastify.get("/tokens/:address", async (request, reply) => {
    const { address } = request.params;
    if (!ADDRESS_RE.test(address || "")) {
      return reply.code(400).send({ error: "invalid token address" });
    }

    try {
      const row = await tokenLaunchesDb.getTokenLaunch(address);
      if (!row || row.is_hidden) {
        return reply.code(404).send({ error: "token not found" });
      }
      return { launch: toLaunchResponse(row) };
    } catch (err) {
      request.log.error({ err, address }, "launchpad token lookup failed");
      return reply.code(500).send({ error: "failed to load token" });
    }
  });

  /**
   * GET /api/launchpad/tokens/:address/trades — trade history, newest first.
   *
   * Empty until launchTradeListener indexes pool swaps. An empty array is the
   * honest answer for a token with no trades, so this does not distinguish the
   * two cases — the token's own 404 above does.
   */
  fastify.get("/tokens/:address/trades", async (request, reply) => {
    const { address } = request.params;
    if (!ADDRESS_RE.test(address || "")) {
      return reply.code(400).send({ error: "invalid token address" });
    }

    const limit = clampInt(
      request.query?.limit,
      DEFAULT_TRADE_LIMIT,
      MAX_TRADE_LIMIT,
    );
    const offset = clampInt(request.query?.offset, 0, Number.MAX_SAFE_INTEGER);

    try {
      const rows = await tokenLaunchesDb.listLaunchTrades(address, {
        limit,
        offset,
      });
      return { trades: rows.map(toTradeResponse), limit, offset };
    } catch (err) {
      request.log.error({ err, address }, "launchpad trades lookup failed");
      return reply.code(500).send({ error: "failed to load trades" });
    }
  });
}
