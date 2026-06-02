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
 * and only writes to Supabase at most once per `throttleMs` (default 30s).
 * The trade-off is bounded re-scan on crash — worst case we re-process the
 * last `throttleMs` of blocks on restart, which is safe because event
 * handlers are idempotent (check-before-insert by tx_hash). At the polling
 * rates used here this cuts cursor egress ~30x: with 13 listeners ticking
 * every 3–5s the UPSERT was the single largest egress source in the
 * project (13.3M lifetime calls), now reduced to one write per listener
 * per ~30s plus a final `flush()` on shutdown.
 *
 * Usage:
 *   const cursor = await createBlockCursor("0xABC:SeasonStarted");
 *   const lastBlock = await cursor.get();     // bigint | null
 *   await cursor.set(12345n);                 // buffered + throttled
 *   await cursor.flush();                     // persist pending value now
 */

import { supabase, hasSupabase } from "../../shared/supabaseClient.js";

export const DEFAULT_CURSOR_THROTTLE_MS = 30_000;

/**
 * Create a block cursor for a given listener key.
 *
 * @param {string} listenerKey — unique key, e.g. `${address}:${eventName}`
 * @param {{ throttleMs?: number, now?: () => number }} [options]
 * @returns {Promise<{ get: () => Promise<bigint|null>, set: (block: bigint) => Promise<void>, flush: () => Promise<void> }>}
 */
export async function createBlockCursor(listenerKey, options = {}) {
  const throttleMs = options.throttleMs ?? DEFAULT_CURSOR_THROTTLE_MS;
  const now = options.now ?? Date.now;

  if (hasSupabase) {
    let pendingBlock = /** @type {bigint|null} */ (null);
    let lastPersistedAt = 0;

    const persist = async (block) => {
      try {
        await supabase.from("listener_block_cursors").upsert(
          {
            listener_key: listenerKey,
            last_block: Number(block), // Supabase bigint column accepts number
            updated_at: new Date().toISOString(),
          },
          { onConflict: "listener_key" },
        );
      } catch {
        // Best-effort — leave pendingBlock so next tick retries
        return false;
      }
      return true;
    };

    return {
      async get() {
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
        pendingBlock = block;
        if (now() - lastPersistedAt >= throttleMs) {
          const buffered = pendingBlock;
          if (await persist(buffered)) {
            lastPersistedAt = now();
            // Only clear the buffer if persist succeeded AND no newer value
            // arrived during the await (concurrent ticks are rare but possible).
            if (pendingBlock === buffered) pendingBlock = null;
          }
        }
      },
      async flush() {
        if (pendingBlock === null) return;
        const buffered = pendingBlock;
        if (await persist(buffered)) {
          lastPersistedAt = now();
          if (pendingBlock === buffered) pendingBlock = null;
        }
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
