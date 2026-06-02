import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock Redis and Supabase before importing blockCursor. Tests that exercise
// the throttled-persist path use vi.doMock per-test below so `hasSupabase`
// can be flipped to true without colliding with the in-memory fallback test.
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
    /**
     * Build a fake Supabase client that records every upsert and lets us
     * substitute `hasSupabase: true` for the throttle path.
     */
    async function loadCursor({ throttleMs, now } = {}) {
      const upsert = vi.fn().mockResolvedValue({ data: null, error: null });
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
      const cursor = await createBlockCursor("test:event", { throttleMs, now });
      return { cursor, upsert };
    }

    it("writes on the first set() and skips subsequent writes within throttle window", async () => {
      let t = 1_000_000;
      const { cursor, upsert } = await loadCursor({
        throttleMs: 30_000,
        now: () => t,
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
        now: () => t,
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
  });
});
