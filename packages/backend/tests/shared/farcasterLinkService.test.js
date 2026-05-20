// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock supabaseClient before importing service
const mockFrom = vi.fn();
vi.mock("../../shared/supabaseClient.js", () => ({
  db: { client: { from: (...args) => mockFrom(...args) } },
  hasSupabase: true,
}));

let service;

beforeEach(async () => {
  vi.resetModules();
  mockFrom.mockReset();
  service = await import("../../shared/farcasterLinkService.js");
});

// Helper: build a chainable Supabase mock that returns `result` for awaits on .single()
const supabaseSingle = (result) => {
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    update: vi.fn(() => builder),
    insert: vi.fn(() => builder),
    delete: vi.fn(() => builder),
    single: vi.fn(() => Promise.resolve(result)),
  };
  return builder;
};

// Helper: build a thenable Supabase mock for chains that DON'T end in .single()
// (e.g. .delete().eq() or .update().eq()). The real PostgrestBuilder implements
// .then(), so awaiting it resolves with { data, error }.
const supabaseNoSingle = (result) => {
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    update: vi.fn(() => builder),
    insert: vi.fn(() => builder),
    delete: vi.fn(() => builder),
    then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
  };
  return builder;
};

describe("getLinkedFidForWallet", () => {
  it("returns null when no row exists", async () => {
    mockFrom.mockReturnValue(supabaseSingle({ data: null, error: null }));
    const result = await service.getLinkedFidForWallet("0xabc");
    expect(result).toBeNull();
  });

  it("returns null when row has fid=null", async () => {
    mockFrom.mockReturnValue(
      supabaseSingle({ data: { fid: null, username: null, display_name: null }, error: null }),
    );
    const result = await service.getLinkedFidForWallet("0xabc");
    expect(result).toBeNull();
  });

  it("returns {fid, username, displayName} when row has fid", async () => {
    mockFrom.mockReturnValue(
      supabaseSingle({
        data: { fid: 42, username: "alice", display_name: "Alice" },
        error: null,
      }),
    );
    const result = await service.getLinkedFidForWallet("0xABC");
    expect(result).toEqual({ fid: 42, username: "alice", displayName: "Alice" });
  });

  it("lowercases the wallet address before querying", async () => {
    const builder = supabaseSingle({ data: null, error: null });
    mockFrom.mockReturnValue(builder);
    await service.getLinkedFidForWallet("0xDEADBEEF");
    expect(builder.eq).toHaveBeenCalledWith("wallet_address", "0xdeadbeef");
  });
});

describe("linkFarcasterToWallet", () => {
  it("inserts a new row when no existing row for fid or wallet", async () => {
    // Two .single() lookups (by fid, by wallet) both return null
    const lookupBuilder = supabaseSingle({ data: null, error: null });
    const insertBuilder = supabaseSingle({
      data: { id: 1, fid: 42, wallet_address: "0xabc" },
      error: null,
    });
    mockFrom
      .mockReturnValueOnce(lookupBuilder) // by fid
      .mockReturnValueOnce(lookupBuilder) // by wallet
      .mockReturnValueOnce(insertBuilder); // insert

    const result = await service.linkFarcasterToWallet({
      walletAddress: "0xabc",
      fid: 42,
      username: "alice",
      displayName: "Alice",
    });

    expect(result.success).toBe(true);
    expect(insertBuilder.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        fid: 42,
        wallet_address: "0xabc",
        username: "alice",
        display_name: "Alice",
        source: "farcaster-link",
        is_active: true,
      }),
    );
  });

  it("updates the wallet row when wallet row exists and fid is unique", async () => {
    const fidLookup = supabaseSingle({ data: null, error: null });
    const walletLookup = supabaseSingle({
      data: { id: 7, fid: null, wallet_address: "0xabc" },
      error: null,
    });
    const updateBuilder = supabaseSingle({
      data: { id: 7, fid: 42, wallet_address: "0xabc" },
      error: null,
    });
    mockFrom
      .mockReturnValueOnce(fidLookup)
      .mockReturnValueOnce(walletLookup)
      .mockReturnValueOnce(updateBuilder);

    const result = await service.linkFarcasterToWallet({
      walletAddress: "0xabc",
      fid: 42,
      username: "alice",
      displayName: "Alice",
    });

    expect(result.success).toBe(true);
    expect(updateBuilder.update).toHaveBeenCalledWith(
      expect.objectContaining({
        fid: 42,
        username: "alice",
        display_name: "Alice",
        source: "farcaster-link",
      }),
    );
    expect(updateBuilder.eq).toHaveBeenCalledWith("id", 7);
  });

  it("reassigns: clears fid on old row (wallet-bound), updates new row", async () => {
    const fidLookup = supabaseSingle({
      data: { id: 5, fid: 42, wallet_address: "0xold" },
      error: null,
    });
    const walletLookup = supabaseSingle({
      data: { id: 7, fid: null, wallet_address: "0xnew" },
      error: null,
    });
    const clearOldBuilder = supabaseNoSingle({ data: { id: 5 }, error: null });
    const updateNewBuilder = supabaseSingle({
      data: { id: 7, fid: 42, wallet_address: "0xnew" },
      error: null,
    });
    mockFrom
      .mockReturnValueOnce(fidLookup)        // existing by fid
      .mockReturnValueOnce(walletLookup)     // existing by wallet
      .mockReturnValueOnce(clearOldBuilder)  // clear old
      .mockReturnValueOnce(updateNewBuilder); // update new

    const result = await service.linkFarcasterToWallet({
      walletAddress: "0xnew",
      fid: 42,
      username: "alice",
      displayName: "Alice",
    });

    expect(result.success).toBe(true);
    expect(clearOldBuilder.update).toHaveBeenCalledWith(
      expect.objectContaining({
        fid: null,
        username: null,
        display_name: null,
        wallet_resolved_at: null,
      }),
    );
    expect(clearOldBuilder.eq).toHaveBeenCalledWith("id", 5);
  });

  it("reassigns: deletes old row when it has wallet_address=null", async () => {
    const fidLookup = supabaseSingle({
      data: { id: 5, fid: 42, wallet_address: null },
      error: null,
    });
    const walletLookup = supabaseSingle({ data: null, error: null });
    const deleteOldBuilder = supabaseNoSingle({ data: { id: 5 }, error: null });
    const insertNewBuilder = supabaseSingle({
      data: { id: 9, fid: 42, wallet_address: "0xnew" },
      error: null,
    });
    mockFrom
      .mockReturnValueOnce(fidLookup)
      .mockReturnValueOnce(walletLookup)
      .mockReturnValueOnce(deleteOldBuilder)
      .mockReturnValueOnce(insertNewBuilder);

    const result = await service.linkFarcasterToWallet({
      walletAddress: "0xnew",
      fid: 42,
      username: "alice",
      displayName: "Alice",
    });

    expect(result.success).toBe(true);
    expect(deleteOldBuilder.delete).toHaveBeenCalled();
    expect(deleteOldBuilder.eq).toHaveBeenCalledWith("id", 5);
  });

  it("self-link is idempotent (existing fid row already on this wallet)", async () => {
    const fidLookup = supabaseSingle({
      data: { id: 7, fid: 42, wallet_address: "0xabc" },
      error: null,
    });
    const walletLookup = supabaseSingle({
      data: { id: 7, fid: 42, wallet_address: "0xabc" },
      error: null,
    });
    const refreshBuilder = supabaseSingle({
      data: { id: 7, fid: 42, wallet_address: "0xabc" },
      error: null,
    });
    mockFrom
      .mockReturnValueOnce(fidLookup)
      .mockReturnValueOnce(walletLookup)
      .mockReturnValueOnce(refreshBuilder);

    const result = await service.linkFarcasterToWallet({
      walletAddress: "0xabc",
      fid: 42,
      username: "alice",
      displayName: "Alice",
    });

    expect(result.success).toBe(true);
    expect(refreshBuilder.update).toHaveBeenCalled();
  });

  it("returns error when supabase is unavailable", async () => {
    vi.resetModules();
    vi.doMock("../../shared/supabaseClient.js", () => ({
      db: { client: { from: vi.fn() } },
      hasSupabase: false,
    }));
    const svc = await import("../../shared/farcasterLinkService.js");

    const result = await svc.linkFarcasterToWallet({
      walletAddress: "0xabc",
      fid: 42,
      username: null,
      displayName: null,
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/database/i);

    vi.doUnmock("../../shared/supabaseClient.js");
    vi.doMock("../../shared/supabaseClient.js", () => ({
      db: { client: { from: (...args) => mockFrom(...args) } },
      hasSupabase: true,
    }));
  });

  it("propagates error when cross-wallet clear update fails", async () => {
    const fidLookup = supabaseSingle({
      data: { id: 5, fid: 42, wallet_address: "0xold" },
      error: null,
    });
    const walletLookup = supabaseSingle({
      data: { id: 7, fid: null, wallet_address: "0xnew" },
      error: null,
    });
    const failedClear = supabaseNoSingle({
      data: null,
      error: { message: "deadlock detected" },
    });
    mockFrom
      .mockReturnValueOnce(fidLookup)
      .mockReturnValueOnce(walletLookup)
      .mockReturnValueOnce(failedClear);

    const result = await service.linkFarcasterToWallet({
      walletAddress: "0xnew",
      fid: 42,
      username: "alice",
      displayName: "Alice",
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("deadlock detected");
  });

  it("propagates error when cross-wallet delete-old fails", async () => {
    const fidLookup = supabaseSingle({
      data: { id: 5, fid: 42, wallet_address: null },
      error: null,
    });
    const walletLookup = supabaseSingle({ data: null, error: null });
    const failedDelete = supabaseNoSingle({
      data: null,
      error: { message: "fk violation" },
    });
    mockFrom
      .mockReturnValueOnce(fidLookup)
      .mockReturnValueOnce(walletLookup)
      .mockReturnValueOnce(failedDelete);

    const result = await service.linkFarcasterToWallet({
      walletAddress: "0xnew",
      fid: 42,
      username: null,
      displayName: null,
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("fk violation");
  });
});

describe("unlinkFarcasterFromWallet", () => {
  it("clears fid columns when row has fid", async () => {
    const lookupBuilder = supabaseSingle({
      data: { id: 7, fid: 42, wallet_address: "0xabc" },
      error: null,
    });
    const updateBuilder = supabaseNoSingle({ data: { id: 7 }, error: null });
    mockFrom
      .mockReturnValueOnce(lookupBuilder)
      .mockReturnValueOnce(updateBuilder);

    const result = await service.unlinkFarcasterFromWallet("0xABC");

    expect(result.success).toBe(true);
    expect(updateBuilder.update).toHaveBeenCalledWith(
      expect.objectContaining({
        fid: null,
        username: null,
        display_name: null,
        wallet_resolved_at: null,
      }),
    );
  });

  it("is a no-op when no row exists for the wallet", async () => {
    const lookupBuilder = supabaseSingle({ data: null, error: null });
    mockFrom.mockReturnValueOnce(lookupBuilder);

    const result = await service.unlinkFarcasterFromWallet("0xabc");

    expect(result.success).toBe(true);
    expect(result.noop).toBe(true);
  });

  it("is a no-op when row exists with fid=null", async () => {
    const lookupBuilder = supabaseSingle({
      data: { id: 7, fid: null, wallet_address: "0xabc" },
      error: null,
    });
    mockFrom.mockReturnValueOnce(lookupBuilder);

    const result = await service.unlinkFarcasterFromWallet("0xabc");

    expect(result.success).toBe(true);
    expect(result.noop).toBe(true);
  });

  it("propagates error when update fails", async () => {
    const lookupBuilder = supabaseSingle({
      data: { id: 7, fid: 42, wallet_address: "0xabc" },
      error: null,
    });
    const failedUpdate = supabaseNoSingle({
      data: null,
      error: { message: "permission denied" },
    });
    mockFrom
      .mockReturnValueOnce(lookupBuilder)
      .mockReturnValueOnce(failedUpdate);

    const result = await service.unlinkFarcasterFromWallet("0xabc");

    expect(result.success).toBe(false);
    expect(result.error).toBe("permission denied");
  });
});
