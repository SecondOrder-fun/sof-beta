import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock Redis and Supabase before importing blockCursor. Tests that exercise
// the throttled-persist path use vi.doMock per-test below so `hasSupabase`
// can be flipped to true without colliding with the in-memory fallback test.
// `vi.doMock` survives `vi.resetModules()` (it clears the module cache, not
// the mock registry), so the throttle describe explicitly doUnmocks the
// supabase module in afterEach to keep tests order-independent.
vi.mock("../../shared/redisClient.js", () => ({
  redisClient: {
    client: null,
    isConnected: false,
    connect: vi.fn(),
  },
}));

vi.mock("../../shared/supabaseClient.js", () => ({
  supabase: {
    from: vi.fn(),
  },
  hasSupabase: false,
}));

describe("blockCursor", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("falls back to in-memory when no Redis or Supabase available", async () => {
    const { createBlockCursor } = await import("../../src/lib/blockCursor.js");

    const cursor = await createBlockCursor("test:event");

    // Initially null
    const initial = await cursor.get();
    expect(initial).toBeNull();

    // Set and get
    await cursor.set(12345n);
    const stored = await cursor.get();
    expect(stored).toBe(12345n);

    // Overwrite
    await cursor.set(99999n);
    const updated = await cursor.get();
    expect(updated).toBe(99999n);
  });

  describe("throttled persistence (Supabase path)", () => {
    afterEach(() => {
      // Remove the per-test doMock so a subsequent test in this file
      // (or a re-run of test #1) sees the top-level `hasSupabase: false`
      // mock rather than the throttle suite's `true` override.
      vi.doUnmock("../../shared/supabaseClient.js");
    });

    /**
     * Build a fake Supabase client that records every upsert and lets us
     * substitute `hasSupabase: true` for the throttle path. `monotonicNow`
     * drives the throttle elapsed-time gate; `wallClockNow` drives the
     * timestamp written into `updated_at`.
     */
    async function loadCursor({
      throttleMs,
      monotonicNow,
      wallClockNow,
      upsertResult = { data: null, error: null },
    } = {}) {
      const upsert = vi.fn().mockResolvedValue(upsertResult);
      const maybeSingle = vi
        .fn()
        .mockResolvedValue({ data: null, error: null });
      const eq = vi.fn(() => ({ maybeSingle }));
      const select = vi.fn(() => ({ eq }));
      const from = vi.fn(() => ({ select, upsert }));

      vi.doMock("../../shared/supabaseClient.js", () => ({
        supabase: { from },
        hasSupabase: true,
      }));

      const { createBlockCursor } = await import(
        "../../src/lib/blockCursor.js"
      );
      const cursor = await createBlockCursor("test:event", {
        throttleMs,
        monotonicNow,
        wallClockNow,
      });
      return { cursor, upsert };
    }

    it("writes on the first set() and skips subsequent writes within throttle window", async () => {
      let t = 1_000_000;
      const { cursor, upsert } = await loadCursor({
        throttleMs: 30_000,
        monotonicNow: () => t,
      });

      await cursor.set(100n);
      expect(upsert).toHaveBeenCalledTimes(1);
      expect(upsert).toHaveBeenLastCalledWith(
        expect.objectContaining({
          listener_key: "test:event",
          last_block: 100,
        }),
        expect.objectContaining({ onConflict: "listener_key" }),
      );

      // Tick forward less than throttle window — should buffer, not write.
      t += 5_000;
      await cursor.set(101n);
      t += 5_000;
      await cursor.set(102n);
      expect(upsert).toHaveBeenCalledTimes(1);

      // Cross the throttle boundary — next set() persists the latest buffered block.
      t += 25_000; // total 35s since first write
      await cursor.set(103n);
      expect(upsert).toHaveBeenCalledTimes(2);
      expect(upsert).toHaveBeenLastCalledWith(
        expect.objectContaining({ last_block: 103 }),
        expect.anything(),
      );
    });

    it("flush() persists the most recent buffered block immediately", async () => {
      let t = 2_000_000;
      const { cursor, upsert } = await loadCursor({
        throttleMs: 30_000,
        monotonicNow: () => t,
      });

      // First set persists.
      await cursor.set(200n);
      expect(upsert).toHaveBeenCalledTimes(1);

      // Two more sets within the throttle window — buffered only.
      t += 1_000;
      await cursor.set(201n);
      t += 1_000;
      await cursor.set(202n);
      expect(upsert).toHaveBeenCalledTimes(1);

      // flush forces the buffered value through regardless of the window.
      await cursor.flush();
      expect(upsert).toHaveBeenCalledTimes(2);
      expect(upsert).toHaveBeenLastCalledWith(
        expect.objectContaining({ last_block: 202 }),
        expect.anything(),
      );

      // flush with no pending value is a no-op.
      await cursor.flush();
      expect(upsert).toHaveBeenCalledTimes(2);
    });

    it("treats supabase-js resolved-with-error as failure (no false success)", async () => {
      // supabase-js v2 returns `{ error }` in the resolved value for
      // RLS/auth/schema errors — it does NOT throw. The cursor must
      // detect this and leave the buffer intact for the next attempt
      // rather than clearing it and silently falling behind.
      let t = 3_000_000;
      const { cursor, upsert } = await loadCursor({
        throttleMs: 30_000,
        monotonicNow: () => t,
        upsertResult: {
          data: null,
          error: { code: "PGRST301", message: "JWT expired" },
        },
      });

      await cursor.set(300n);
      expect(upsert).toHaveBeenCalledTimes(1);

      // Buffer should NOT be cleared — flush must re-attempt.
      await cursor.flush();
      // Exactly two upserts: the initial set(300n) (returns false; the
      // buffer survives, lastPersistedAt advances to suppress retry-
      // storm) plus the flush() (forces a re-attempt regardless of the
      // throttle). A third upsert here would indicate an unintended
      // retry loop and is a regression.
      expect(upsert).toHaveBeenCalledTimes(2);
      expect(upsert).toHaveBeenLastCalledWith(
        expect.objectContaining({ last_block: 300 }),
        expect.anything(),
      );
    });

    it("read-your-own-writes: get() returns buffered value during throttle window", async () => {
      let t = 4_000_000;
      const { cursor } = await loadCursor({
        throttleMs: 30_000,
        monotonicNow: () => t,
      });

      // First set persists immediately (throttle not yet elapsed since 0).
      await cursor.set(400n);

      // Second set within window — buffered, not persisted.
      t += 1_000;
      await cursor.set(401n);

      // get() must surface the in-memory buffered value, not the stale
      // persisted one (which would be 400 here).
      const v = await cursor.get();
      expect(v).toBe(401n);
    });

    it("rejects non-bigint inputs at the boundary", async () => {
      // Number(null)=0 and Number(undefined)=NaN would silently corrupt
      // the cursor row — guard at the wrapper boundary so caller bugs
      // can't poison the buffer or the persisted value.
      let t = 6_000_000;
      const { cursor, upsert } = await loadCursor({
        throttleMs: 30_000,
        monotonicNow: () => t,
      });

      // @ts-expect-error — deliberately bad input
      await cursor.set(null);
      // @ts-expect-error — deliberately bad input
      await cursor.set(undefined);
      // @ts-expect-error — deliberately bad input
      await cursor.set(100); // plain Number, not bigint

      expect(upsert).not.toHaveBeenCalled();
      // get() should fall through to Supabase (which returns null in
      // this mock) because no valid set() ever populated the buffer.
      await expect(cursor.get()).resolves.toBeNull();
    });

    it("single-flight: concurrent set() calls produce one persist, not two", async () => {
      let t = 5_000_000;
      // Each upsert returns a fresh promise so call-site shared state
      // doesn't mask sequencing bugs. Using a single promise instance
      // for all invocations would couple their resolution and hide
      // subsequent-call regressions.
      const upsert = vi.fn().mockImplementation(
        () =>
          new Promise((resolve) =>
            setTimeout(() => resolve({ data: null, error: null }), 50),
          ),
      );
      const maybeSingle = vi
        .fn()
        .mockResolvedValue({ data: null, error: null });
      const eq = vi.fn(() => ({ maybeSingle }));
      const select = vi.fn(() => ({ eq }));
      const from = vi.fn(() => ({ select, upsert }));
      vi.doMock("../../shared/supabaseClient.js", () => ({
        supabase: { from },
        hasSupabase: true,
      }));
      const { createBlockCursor } = await import(
        "../../src/lib/blockCursor.js"
      );
      const cursor = await createBlockCursor("test:event", {
        throttleMs: 30_000,
        monotonicNow: () => t,
      });

      // Fire two set() calls without awaiting the first.
      const p1 = cursor.set(500n);
      const p2 = cursor.set(501n);
      await Promise.all([p1, p2]);

      // Only one persist should be in flight; the second set() sees
      // the inflight latch and just updates the buffer.
      expect(upsert).toHaveBeenCalledTimes(1);
      expect(upsert).toHaveBeenLastCalledWith(
        expect.objectContaining({ last_block: 500 }),
        expect.anything(),
      );

      // The buffered 501n should still be pending — flush picks it up.
      await cursor.flush();
      expect(upsert).toHaveBeenCalledTimes(2);
      expect(upsert).toHaveBeenLastCalledWith(
        expect.objectContaining({ last_block: 501 }),
        expect.anything(),
      );
    });
  });
});
