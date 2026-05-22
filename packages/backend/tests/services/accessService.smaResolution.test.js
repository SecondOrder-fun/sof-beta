// tests/services/accessService.smaResolution.test.js
// @vitest-environment node
//
// Focused tests for the SMA-aware wallet fallback added to getUserAccess.
// Existing accessService tests (general flow, FID priority, groups) live
// elsewhere and stay untouched.

import { describe, it, expect, vi, beforeEach } from "vitest";

const supabaseMocks = vi.hoisted(() => ({
  mockFrom: vi.fn(),
}));

const resolverMocks = vi.hoisted(() => ({
  mockResolvePair: vi.fn(),
}));

vi.mock("../../shared/supabaseClient.js", () => ({
  supabase: { from: (...args) => supabaseMocks.mockFrom(...args) },
}));

vi.mock("../../shared/services/addressPairResolver.js", () => ({
  resolveAddressPair: (...args) => resolverMocks.mockResolvePair(...args),
}));

import { getUserAccess } from "../../shared/accessService.js";

const EOA_LC = "0xaaaa000000000000000000000000000000000001";
const SMA_LC = "0xbbbb000000000000000000000000000000000002";

// Helper: builds a chainable supabase-style query object that resolves to
// either { data, error } or { data: null, error: { code: "PGRST116" } }.
function makeQuery(result) {
  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    or: vi.fn(() => chain),
    single: vi.fn(() => Promise.resolve(result)),
  };
  return chain;
}

const NOT_FOUND = { data: null, error: { code: "PGRST116" } };
const ALLOWLIST_ROW_EOA = {
  data: {
    id: 1,
    fid: null,
    wallet_address: EOA_LC,
    access_level: 3,
    is_active: true,
  },
  error: null,
};
const ALLOWLIST_ROW_SMA = {
  data: {
    id: 2,
    fid: null,
    wallet_address: SMA_LC,
    access_level: 3,
    is_active: true,
  },
  error: null,
};

beforeEach(() => {
  supabaseMocks.mockFrom.mockReset();
  resolverMocks.mockResolvePair.mockReset();
});

describe("getUserAccess SMA resolution", () => {
  it("direct wallet hit returns matchedVia: 'direct', matchedAddress: null", async () => {
    // allowlist_entries query hits directly
    supabaseMocks.mockFrom
      .mockReturnValueOnce(makeQuery(ALLOWLIST_ROW_EOA))   // entries
      .mockReturnValueOnce(makeQuery({ data: [], error: null })); // groups

    const result = await getUserAccess({ wallet: EOA_LC });
    expect(result.matchedVia).toBe("direct");
    expect(result.matchedAddress).toBeNull();
    expect(resolverMocks.mockResolvePair).not.toHaveBeenCalled();
  });

  it("wallet miss + SMA pair whose alternate is allowlisted returns matchedVia: 'sma_pair'", async () => {
    // direct miss, then pair fallback hits via alternate address
    supabaseMocks.mockFrom
      .mockReturnValueOnce(makeQuery(NOT_FOUND))           // direct EOA miss
      .mockReturnValueOnce(makeQuery(ALLOWLIST_ROW_SMA))   // alternate SMA hit
      .mockReturnValueOnce(makeQuery({ data: [], error: null })); // groups
    resolverMocks.mockResolvePair.mockResolvedValueOnce({ eoa: EOA_LC, sma: SMA_LC });

    const result = await getUserAccess({ wallet: EOA_LC });
    expect(result.matchedVia).toBe("sma_pair");
    expect(result.matchedAddress).toBe(SMA_LC);
    expect(resolverMocks.mockResolvePair).toHaveBeenCalledWith(
      EOA_LC,
      expect.anything(),
    );
  });

  it("wallet miss + no pair returns public level + null breadcrumbs", async () => {
    supabaseMocks.mockFrom.mockReturnValueOnce(makeQuery(NOT_FOUND));
    resolverMocks.mockResolvePair.mockResolvedValueOnce(null);

    const result = await getUserAccess({ wallet: EOA_LC });
    expect(result.level).toBe(0); // PUBLIC
    expect(result.matchedVia).toBeNull();
    expect(result.matchedAddress).toBeNull();
  });

  it("wallet miss + pair exists but alternate not allowlisted returns public + null", async () => {
    supabaseMocks.mockFrom
      .mockReturnValueOnce(makeQuery(NOT_FOUND))      // direct miss
      .mockReturnValueOnce(makeQuery(NOT_FOUND));     // alternate miss
    resolverMocks.mockResolvePair.mockResolvedValueOnce({ eoa: EOA_LC, sma: SMA_LC });

    const result = await getUserAccess({ wallet: EOA_LC });
    expect(result.level).toBe(0);
    expect(result.matchedVia).toBeNull();
    expect(result.matchedAddress).toBeNull();
  });

  it("does NOT call resolver when fid hits directly", async () => {
    supabaseMocks.mockFrom
      .mockReturnValueOnce(makeQuery(ALLOWLIST_ROW_EOA))
      .mockReturnValueOnce(makeQuery({ data: [], error: null }));

    const result = await getUserAccess({ fid: 1001 });
    expect(result.matchedVia).toBe("direct");
    expect(resolverMocks.mockResolvePair).not.toHaveBeenCalled();
  });
});
