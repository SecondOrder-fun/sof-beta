// Shared chain-head tracker.
//
// Every contractEventPolling tick previously issued its own getBlockNumber +
// getBlock pair to learn the chain head and refresh the chain-time cache. With
// ~10 fixed listeners plus per-season pollers (5 season-status events, 3
// sponsor-prize watchers, 1 trade listener per FPMM market), that pair fired
// dozens of times every few seconds — the dominant source of Tenderly RPC
// volume, and it climbed with each new raffle. The Tenderly gateway answered
// with LimitExceededRpcError storms.
//
// This module collapses those redundant calls: one refresher loop per client
// fetches the head once per interval, and every poller on that client reads the
// cached value. Since all listeners share the single `publicClient` singleton
// (see viemClient.js), the whole backend makes ~2 head RPC calls per interval
// regardless of how many listeners are running.

import { updateChainTimeCache } from "./chainTimeCache.js";

/** @type {Map<object, ReturnType<typeof createTracker>>} */
const trackers = new Map();

/**
 * @typedef {Object} BlockHead
 * @property {bigint} blockNumber
 * @property {bigint|null} timestamp
 */

function createTracker(client, intervalMs) {
  /** @type {BlockHead|null} */
  let head = null;
  /** @type {Promise<BlockHead>|null} */
  let inFlight = null;
  let intervalId = null;

  async function refresh() {
    // Single-flight: concurrent callers share one RPC round-trip.
    if (inFlight) return inFlight;
    inFlight = (async () => {
      const blockNumber = await client.getBlockNumber();
      let timestamp = null;
      try {
        const block = await client.getBlock({ blockNumber });
        if (block?.timestamp != null) {
          timestamp = block.timestamp;
          updateChainTimeCache(Number(blockNumber), Number(timestamp));
        }
      } catch {
        // Non-fatal — chain-time cache stays stale, head still usable.
      }
      head = { blockNumber, timestamp };
      return head;
    })();
    try {
      return await inFlight;
    } finally {
      inFlight = null;
    }
  }

  return {
    /**
     * Returns the cached head, fetching once if it has never been populated
     * so the very first consumer doesn't get null.
     * @returns {Promise<BlockHead>}
     */
    async getHead() {
      if (head === null) return refresh();
      return head;
    },
    start() {
      if (intervalId !== null) return;
      intervalId = setInterval(() => {
        void refresh().catch(() => {
          // Transient RPC errors (incl. rate limits) leave the head stale;
          // the next interval retries. Swallow so the timer never dies.
        });
      }, intervalMs);
      // Don't let the refresher keep the process alive on its own.
      if (typeof intervalId?.unref === "function") intervalId.unref();
      void refresh().catch(() => {});
    },
    stop() {
      if (intervalId !== null) {
        clearInterval(intervalId);
        intervalId = null;
      }
    },
  };
}

/**
 * Register (or fetch) the shared head tracker for a client. Idempotent.
 * @param {object} client viem PublicClient
 * @param {{ intervalMs?: number }} [opts]
 */
export function registerSharedHead(client, { intervalMs = 4_000 } = {}) {
  let tracker = trackers.get(client);
  if (tracker) return tracker;
  tracker = createTracker(client, intervalMs);
  trackers.set(client, tracker);
  return tracker;
}

/**
 * Returns the registered tracker for a client, or null if none.
 * @param {object} client
 */
export function getSharedHead(client) {
  return trackers.get(client) ?? null;
}

/** Test helper — stop and clear all trackers. */
export function __resetSharedHeads() {
  for (const tracker of trackers.values()) tracker.stop();
  trackers.clear();
}
