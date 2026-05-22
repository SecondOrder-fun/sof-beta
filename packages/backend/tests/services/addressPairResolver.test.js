// tests/services/addressPairResolver.test.js
// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from "vitest";

const dbMocks = vi.hoisted(() => ({
  mockGetByEoa: vi.fn(),
  mockGetBySma: vi.fn(),
}));

vi.mock("../../shared/services/smartAccountsDb.js", () => ({
  smartAccountsDb: {
    getSmartAccountByEoa: (...args) => dbMocks.mockGetByEoa(...args),
    getSmartAccountBySma: (...args) => dbMocks.mockGetBySma(...args),
  },
}));

import { resolveAddressPair } from "../../shared/services/addressPairResolver.js";

const EOA_LC = "0xaaaa000000000000000000000000000000000001";
const SMA_LC = "0xbbbb000000000000000000000000000000000002";
const PAIR_ROW = { eoa: EOA_LC, sma: SMA_LC };

function makeLogger() {
  return { warn: vi.fn(), error: vi.fn() };
}

beforeEach(() => {
  dbMocks.mockGetByEoa.mockReset();
  dbMocks.mockGetBySma.mockReset();
});

describe("resolveAddressPair", () => {
  it("returns the pair when input is the EOA", async () => {
    dbMocks.mockGetByEoa.mockResolvedValueOnce(PAIR_ROW);
    const result = await resolveAddressPair(EOA_LC, makeLogger());
    expect(result).toEqual({ eoa: EOA_LC, sma: SMA_LC });
    expect(dbMocks.mockGetByEoa).toHaveBeenCalledWith(EOA_LC);
    expect(dbMocks.mockGetBySma).not.toHaveBeenCalled();
  });

  it("returns the pair when input is the SMA (reverse direction)", async () => {
    dbMocks.mockGetByEoa.mockResolvedValueOnce(null);
    dbMocks.mockGetBySma.mockResolvedValueOnce(PAIR_ROW);
    const result = await resolveAddressPair(SMA_LC, makeLogger());
    expect(result).toEqual({ eoa: EOA_LC, sma: SMA_LC });
    expect(dbMocks.mockGetByEoa).toHaveBeenCalledWith(SMA_LC);
    expect(dbMocks.mockGetBySma).toHaveBeenCalledWith(SMA_LC);
  });

  it("returns null when the address is not in smart_accounts", async () => {
    dbMocks.mockGetByEoa.mockResolvedValueOnce(null);
    dbMocks.mockGetBySma.mockResolvedValueOnce(null);
    const result = await resolveAddressPair("0xdeadbeef0000000000000000000000000000beef", makeLogger());
    expect(result).toBeNull();
  });

  it("lowercases the input before querying", async () => {
    dbMocks.mockGetByEoa.mockResolvedValueOnce(PAIR_ROW);
    const MIXED = "0xAaAa000000000000000000000000000000000001";
    await resolveAddressPair(MIXED, makeLogger());
    expect(dbMocks.mockGetByEoa).toHaveBeenCalledWith(EOA_LC);
  });

  it("catches a DB error and returns null with a warn log", async () => {
    dbMocks.mockGetByEoa.mockRejectedValueOnce(new Error("supabase boom"));
    const logger = makeLogger();
    const result = await resolveAddressPair(EOA_LC, logger);
    expect(result).toBeNull();
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it("returns null when address is null/undefined/empty without calling the db", async () => {
    expect(await resolveAddressPair(null, makeLogger())).toBeNull();
    expect(await resolveAddressPair(undefined, makeLogger())).toBeNull();
    expect(await resolveAddressPair("", makeLogger())).toBeNull();
    expect(dbMocks.mockGetByEoa).not.toHaveBeenCalled();
    expect(dbMocks.mockGetBySma).not.toHaveBeenCalled();
  });
});
