/**
 * @file blockCursor.js
 * @description Persistent block cursor for event listeners.
 *
 * Stores lastProcessedBlock per listener key so that on restart the poller
 * resumes from where it left off instead of re-scanning from "now".
 *
 * Backend: Supabase `listener_block_cursors` table.
 *
 * Persistence is throttled: `set(block)` buffers the latest value in memory
 * and only writes to Supabase at most once per `throttleMs` (default 30s,
 * overridable via the `LISTENER_CURSOR_THROTTLE_MS` env var). The trade-off
 * is bounded re-scan on crash — worst case we re-process the last
 * `throttleMs` of blocks on restart. Event handlers in this project are
 * designed to be idempotent (typically check-before-insert by tx_hash or
 * onConflict upserts), so re-processing is safe in the steady-state paths;
 * see individual listeners for the specifics of their dedupe logic.
 *
 * At the polling rates used here this cuts cursor egress ~30x: with 13
 * listeners ticking every 3–5s the UPSERT was the single largest egress
 * source in the project (13.3M lifetime calls), now reduced to one write
 * per listener per ~30s plus a final `flush()` on graceful shutdown.
 *
 * Concurrency: a single in-flight persist is enforced via a promise
 * latch — overlapping ticks update the buffer and return without issuing
 * another write, so we never produce out-of-order UPSERTs against
 * Supabase. The throttle elapsed-time check uses a monotonic clock
 * (`performance.now()`) so NTP backward steps cannot freeze the window.
 *
 * Usage:
 *   const cursor = await createBlockCursor("0xABC:SeasonStarted");
 *   const lastBlock = await cursor.get();     // bigint | null
 *   await cursor.set(12345n);                 // buffered + throttled
 *   await cursor.flush();                     // persist pending value now
 */

import { performance } from "node:perf_hooks";
import { supabase, hasSupabase } from "../../shared/supabaseClient.js";

/**
 * Parse and validate the `LISTENER_CURSOR_THROTTLE_MS` env var. Falls back
 * to 30s when unset, invalid, or explicitly zero — `0` would collapse the
 * throttle and reproduce the per-tick egress problem this module was
 * written to solve, so we reject it loudly rather than honor the literal.
 *
 * @returns {number}
 */
function envThrottleMs() {
  const raw = process.env.LISTENER_CURSOR_THROTTLE_MS;
  if (!raw) return 30_000;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 30_000;
}

export const DEFAULT_CURSOR_THROTTLE_MS = envThrottleMs();

/**
 * Create a block cursor for a given listener key.
 *
 * @param {string} listenerKey — unique key, e.g. `${address}:${eventName}`
 * @param {{ throttleMs?: number, monotonicNow?: () => number, wallClockNow?: () => number }} [options]
 *   - `monotonicNow` controls the elapsed-time clock used by the throttle
 *     gate. Defaults to `performance.now()` (monotonic, immune to wall-
 *     clock jumps). Tests inject a fake.
 *   - `wallClockNow` returns the wall-clock millis written to `updated_at`.
 *     Defaults to `Date.now`.
 * @returns {Promise<{ get: () => Promise<bigint|null>, set: (block: bigint) => Promise<void>, flush: () => Promise<void> }>}
 */
export async function createBlockCursor(listenerKey, options = {}) {
  const throttleMs = options.throttleMs ?? DEFAULT_CURSOR_THROTTLE_MS;
  const monotonicNow = options.monotonicNow ?? (() => performance.now());
  const wallClockNow = options.wallClockNow ?? Date.now;

  if (hasSupabase) {
    let pendingBlock = /** @type {bigint|null} */ (null);
    // Initialize to -Infinity so the very first set() always crosses the
    // throttle gate regardless of how soon after process start it fires.
    // `performance.now()` returns ms since process start, so starting at 0
    // would force the first 30s of every process to buffer in memory with
    // no Supabase write — an ungraceful crash inside that window would
    // lose all cursor progress from the new boot (no row to read back).
    let lastPersistedAt = Number.NEGATIVE_INFINITY;
    let inflight = /** @type {Promise<boolean>|null} */ (null);

    /**
     * Issue a single UPSERT. Returns true on success, false on any failure
     * — supabase-js v2 returns errors inside the resolved value (it does
     * NOT throw on RLS / auth / schema errors), so we destructure `error`
     * explicitly rather than relying on try/catch alone.
     */
    const persist = async (block) => {
      try {
        const { error } = await supabase
          .from("listener_block_cursors")
          .upsert(
            {
              listener_key: listenerKey,
              // Postgres bigint is 64-bit; JS Number is safe to 2^53-1
              // (~9e15). Base block height is ~4e7 so this won't bite for
              // hundreds of millions of years, but if the caller ever
              // passes a bigint exceeding MAX_SAFE_INTEGER the round-trip
              // would silently truncate.
              last_block: Number(block),
              updated_at: new Date(wallClockNow()).toISOString(),
            },
            { onConflict: "listener_key" },
          );
        if (error) return false;
        return true;
      } catch {
        // Network-level / unexpected throw
        return false;
      }
    };

    /**
     * Persist `buffered`, then reconcile in-memory state. Always advances
     * `lastPersistedAt` on completion (success OR failure) so a failing
     * Supabase doesn't trigger a retry-storm on every subsequent tick —
     * we keep the throttle cadence regardless of outcome.
     */
    const runPersist = async (buffered) => {
      const ok = await persist(buffered);
      lastPersistedAt = monotonicNow();
      // Only clear the buffer when the write landed AND no different
      // value arrived during the await. Block numbers are *usually*
      // monotonic in the steady-state caller, but the chain-rewind
      // branch in contractEventPolling.js can set a lower value, so
      // equality (not <= or >=) is the only safe check for "buffer is
      // still what we tried to persist". A concurrent set() with the
      // same bigint value is a no-op either way.
      if (ok && pendingBlock === buffered) {
        pendingBlock = null;
      }
      return ok;
    };

    return {
      async get() {
        // Read-your-own-writes: return the buffered value if any, otherwise
        // fall through to the persisted row. Without this the wrapper
        // would silently violate get-after-set semantics inside the
        // throttle window.
        if (pendingBlock !== null) return pendingBlock;
        try {
          const { data, error } = await supabase
            .from("listener_block_cursors")
            .select("last_block")
            .eq("listener_key", listenerKey)
            .maybeSingle();

          if (error || !data) return null;
          return BigInt(data.last_block);
        } catch {
          return null;
        }
      },
      async set(block) {
        // Reject non-bigint inputs at the boundary. Number(null) silently
        // becomes 0 and Number(undefined) becomes NaN, either of which
        // would corrupt the persisted cursor and cause the next process
        // to either re-scan from genesis or fail at BigInt(NaN). Callers
        // that hand us garbage almost certainly have a bug — drop the
        // write rather than poison the buffer.
        if (typeof block !== "bigint") return;
        pendingBlock = block;
        // Single-flight: if a persist is in progress, the latest
        // pendingBlock will be picked up by the next set() after the
        // throttle window OR by flush() — never run two persists in
        // parallel (avoids out-of-order writes to Supabase).
        if (inflight) return;
        if (monotonicNow() - lastPersistedAt < throttleMs) return;
        const buffered = pendingBlock;
        inflight = runPersist(buffered).finally(() => {
          inflight = null;
        });
        await inflight;
      },
      async flush() {
        // Wait for any in-flight persist to settle so we don't race it.
        // runPersist itself catches all errors via persist's try/catch,
        // so this await cannot throw; .catch is belt-and-braces for
        // injected `monotonicNow` doubles that may throw in tests.
        if (inflight) {
          await inflight.catch(() => {});
        }
        if (pendingBlock === null) return;
        const buffered = pendingBlock;
        inflight = runPersist(buffered).finally(() => {
          inflight = null;
        });
        await inflight;
      },
    };
  }

  // ------- No persistence available — in-memory only -------
  let memBlock = null;
  return {
    async get() {
      return memBlock;
    },
    async set(block) {
      memBlock = block;
    },
    async flush() {
      // No-op for in-memory; nothing to persist.
    },
  };
}
