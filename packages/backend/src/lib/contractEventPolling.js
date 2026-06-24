import { updateChainTimeCache } from "./chainTimeCache.js";
import { getSharedHead } from "./blockHead.js";

// Rate-limit backoff tuning. On a transient RPC error (notably Tenderly's
// LimitExceededRpcError) the poller enters a cooldown so it stops re-firing
// every interval and adding to the storm. Cooldown grows exponentially with
// consecutive failures, capped, with a little jitter so listeners that failed
// together don't all resume on the same tick.
const BACKOFF_BASE_MS = 5_000;
const BACKOFF_MAX_MS = 60_000;

/**
 * @param {number} failures consecutive failure count (>= 1)
 * @returns {number} cooldown in ms
 */
function getPollBackoffMs(failures) {
  const exp = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** (failures - 1));
  // Jitter up to +20% to de-synchronize listeners that failed together.
  return exp + Math.random() * exp * 0.2;
}

/**
 * @typedef {Object} ContractEventPollingParams
 * @property {import('viem').PublicClient} client
 * @property {`0x${string}`} address
 * @property {import('viem').Abi} abi
 * @property {string} eventName
 * @property {bigint} [startBlock]
 * @property {number} [pollingIntervalMs]
 * @property {bigint} [maxBlockRange]
 * @property {(logs: any[]) => Promise<void> | void} onLogs
 * @property {(error: unknown) => void} [onError]
 * @property {{ get: () => Promise<bigint|null>, set: (block: bigint) => Promise<void>, flush?: () => Promise<void> }} [blockCursor]
 */

/**
 * Returns an async stop function. Awaiting it ensures the cursor's
 * pending buffered value is flushed to persistence before the caller
 * proceeds — the graceful shutdown path in fastify/server.js relies on
 * this so deploys don't drop up to throttleMs of cursor progress.
 *
 * @param {ContractEventPollingParams} params
 * @returns {Promise<() => Promise<void>>}
 */
export async function startContractEventPolling(params) {
  const {
    client,
    address,
    abi,
    eventName,
    startBlock,
    pollingIntervalMs = 4_000,
    maxBlockRange = 2_000n,
    onLogs,
    onError,
    blockCursor,
  } = params;

  if (!client) {
    throw new Error("client is required");
  }

  if (!address) {
    throw new Error("address is required");
  }

  if (!abi) {
    throw new Error("abi is required");
  }

  if (!eventName) {
    throw new Error("eventName is required");
  }

  if (typeof onLogs !== "function") {
    throw new Error("onLogs is required");
  }

  let stopped = false;
  let lastProcessedBlock;

  // Consecutive transient-failure count and the timestamp until which ticks
  // are skipped while backing off. See getPollBackoffMs / the tick catch block.
  let failureCount = 0;
  let cooldownUntil = 0;

  // Resolve the chain head, preferring the shared head tracker (one RPC pair
  // per interval shared across all listeners) over a per-listener
  // getBlockNumber/getBlock pair. Falls back to direct RPC when no tracker is
  // registered for this client (e.g. unit tests with a bare mock client).
  const sharedHead = getSharedHead(client);
  const getCurrentBlock = async () => {
    if (sharedHead) {
      const head = await sharedHead.getHead();
      return head.blockNumber;
    }
    const currentBlock = await client.getBlockNumber();
    // Update chain time cache with the latest block (non-fatal if it fails).
    // The shared tracker does this centrally when present.
    try {
      const block = await client.getBlock({ blockNumber: currentBlock });
      if (block?.timestamp != null) {
        updateChainTimeCache(Number(currentBlock), Number(block.timestamp));
      }
    } catch {
      // non-fatal — cache stays stale, endpoint will return what it has
    }
    return currentBlock;
  };

  // Determine start block: explicit param > persisted cursor > current block
  if (typeof startBlock === "bigint") {
    lastProcessedBlock = startBlock;
  } else if (blockCursor) {
    const persisted = await blockCursor.get();
    if (persisted !== null && persisted !== undefined) {
      // Resume from the block AFTER the last fully processed one
      lastProcessedBlock = persisted + 1n;
    } else {
      const currentBlock = await getCurrentBlock();
      lastProcessedBlock = currentBlock + 1n;
    }
  } else {
    const currentBlock = await getCurrentBlock();
    lastProcessedBlock = currentBlock + 1n;
  }

  const tick = async () => {
    if (stopped) return;

    // Skip ticks while backing off from a recent transient/rate-limit error.
    if (Date.now() < cooldownUntil) return;

    try {
      const currentBlock = await getCurrentBlock();

      if (currentBlock < lastProcessedBlock) {
        // Chain rewound below our cursor — almost always a local-dev Anvil
        // restart while the backend kept running. Without this guard the poll
        // is silently stuck forever (cursor never advances, new events at
        // lower block numbers never get indexed). Reset to the current head
        // so subsequent ticks resume normally.
        //
        // Note: blockCursor.set() is throttled, so the lower value may sit
        // buffered for up to throttleMs before persisting. A backend crash
        // within that window leaves the OLD higher block in the table and
        // triggers this same rewind branch again on next start — which is
        // self-healing.
        lastProcessedBlock = currentBlock + 1n;
        if (blockCursor) {
          await blockCursor.set(currentBlock);
        }
        return;
      }

      let fromBlock = lastProcessedBlock;
      const toBlock = currentBlock;

      while (!stopped && fromBlock <= toBlock) {
        const remaining = toBlock - fromBlock;
        const chunkSize = remaining > maxBlockRange ? maxBlockRange : remaining;
        const chunkToBlock = fromBlock + chunkSize;

        const logs = await client.getContractEvents({
          address,
          abi,
          eventName,
          fromBlock,
          toBlock: chunkToBlock,
        });

        if (logs.length > 0) {
          await onLogs(logs);
        }

        fromBlock = chunkToBlock + 1n;
      }

      // Advance the cursor to reflect ACTUAL progress, not the chain head.
      // If `stopped` flipped true between chunks of a multi-chunk catchup,
      // the while loop exits early with `fromBlock` pointing at the next
      // un-processed block. Persisting `currentBlock` here would lie about
      // having processed the unfinished chunks — and with the new awaited
      // shutdown flush, that lie now reliably commits to Supabase, silently
      // dropping every event in the skipped block range on restart.
      // `fromBlock - 1n` is the last block we actually processed (or
      // `lastProcessedBlock - 1n` if the loop never iterated, which can't
      // happen after the `currentBlock < lastProcessedBlock` rewind guard
      // above).
      const lastActuallyProcessed = fromBlock - 1n;
      lastProcessedBlock = fromBlock;

      if (blockCursor) {
        await blockCursor.set(lastActuallyProcessed);
      }

      // Successful tick — clear any active backoff.
      failureCount = 0;
      cooldownUntil = 0;
    } catch (error) {
      // Transient errors (rate limits, gateway hiccups) trigger an
      // exponential backoff so the poller stops hammering a throttled RPC.
      // Non-transient errors are still surfaced but don't extend the cooldown.
      if (isTransientRpcError(error)) {
        failureCount += 1;
        cooldownUntil = Date.now() + getPollBackoffMs(failureCount);
      }
      if (typeof onError === "function") {
        onError(error);
      }
    }
  };

  // Track the in-flight tick so the stop callback can await it before
  // flushing. Without this an in-flight tick's trailing `await
  // blockCursor.set(currentBlock)` would land AFTER flush() returns,
  // buffering a value that never reaches Supabase.
  let activeTick = /** @type {Promise<void>|null} */ (null);
  const runTickIfIdle = () => {
    if (stopped) return;
    // Skip overlapping ticks. The previous "void tick()" pattern allowed
    // ticks to overlap on slow RPC, which produced concurrent set()
    // calls; the blockCursor's single-flight latch handles that safely
    // but it's cleaner to prevent overlap upstream.
    if (activeTick) return;
    activeTick = tick().finally(() => {
      activeTick = null;
    });
  };

  const intervalId = setInterval(runTickIfIdle, pollingIntervalMs);

  runTickIfIdle();

  return async () => {
    stopped = true;
    clearInterval(intervalId);
    // Drain the in-flight tick first so any final set() it queues lands
    // in the cursor buffer BEFORE we flush. Skipping this step lets a
    // tick that began just before stop() lose its trailing block write.
    if (activeTick) {
      await activeTick.catch(() => {
        // tick has its own try/catch around the body; defensive only.
      });
    }
    // Persist any buffered cursor value on shutdown so the next process
    // doesn't re-scan from a stale snapshot. Awaitable so server.js can
    // include this in its `app.close()`-ordered drain — otherwise the
    // HTTP UPSERT races process.exit and the throttled cursor design's
    // bounded-rescan guarantee silently regresses on every deploy.
    //
    // The typeof guard preserves back-compat with cursor doubles used
    // in older tests that predate the flush() addition.
    if (blockCursor && typeof blockCursor.flush === "function") {
      await blockCursor.flush().catch(() => {
        // Best-effort; the cursor implementation swallows errors itself.
      });
    }
  };
}

/**
 * @param {unknown} error
 * @returns {boolean}
 */
function isTransientRpcError(error) {
  const message =
    error && typeof error === "object" && "message" in error
      ? String(error.message)
      : String(error);
  const name =
    error && typeof error === "object" && "name" in error
      ? String(error.name)
      : "";

  return (
    // Tenderly (and other gateways) signal throttling via viem's
    // LimitExceededRpcError / a "rate limit exceeded" message. Earlier this
    // wasn't matched, so the live poller fell straight through to onError and
    // re-fired on the next interval, amplifying the storm.
    name === "LimitExceededRpcError" ||
    message.includes("rate limit exceeded") ||
    message.includes("Request exceeds defined limit") ||
    message.includes("responded with 503") ||
    message.includes("responded with 429") ||
    message.includes("ETIMEDOUT") ||
    message.includes("ECONNRESET")
  );
}

/**
 * @param {number} attempt
 * @returns {number}
 */
function getBackoffMs(attempt) {
  const base = 500;
  const max = 10_000;
  const ms = base * Math.pow(2, Math.max(0, attempt - 1));
  return Math.min(ms, max);
}

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * @param {ContractEventPollingParams & { fromBlock: bigint, toBlock: bigint, maxRetries?: number }} params
 * @returns {Promise<any[]>}
 */
export async function getContractEventsInChunks(params) {
  const {
    client,
    address,
    abi,
    eventName,
    fromBlock,
    toBlock,
    maxBlockRange = 2_000n,
    maxRetries = 5,
  } = params;

  if (fromBlock > toBlock) return [];

  /** @type {any[]} */
  const allLogs = [];

  let currentFrom = fromBlock;
  while (currentFrom <= toBlock) {
    const remaining = toBlock - currentFrom;
    const chunkSize = remaining > maxBlockRange ? maxBlockRange : remaining;
    const currentTo = currentFrom + chunkSize;

    let attempt = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      try {
        const logs = await client.getContractEvents({
          address,
          abi,
          eventName,
          fromBlock: currentFrom,
          toBlock: currentTo,
        });
        allLogs.push(...logs);
        break;
      } catch (error) {
        attempt += 1;
        if (!isTransientRpcError(error) || attempt > maxRetries) {
          throw error;
        }

        await sleep(getBackoffMs(attempt));
      }
    }

    currentFrom = currentTo + 1n;
  }

  return allLogs;
}
