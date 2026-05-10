// tests/services/smartAccountService.test.js
// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the contracts deployments lookup so we don't depend on the runtime
// network env. The factory address returned here is checksummed; the
// service itself is responsible for not caring about case.
vi.mock("@sof/contracts/deployments", () => ({
  getDeployment: vi.fn(() => ({
    SOFSmartAccountFactory: "0x9A676E781A523B5D0c0e43731313A708CB607508",
  })),
}));

import {
  ensureSmartAccount,
  getSmaFromFactory,
} from "../../shared/services/smartAccountService.js";

const EOA = "0xAAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa";
const EOA_LC = EOA.toLowerCase();
const SMA = "0xBBbBbBBbBbbbBBbBBbbBbbbbBbbbBBBBbBbbBBBb";
const SMA_LC = SMA.toLowerCase();

function makeFakeChain(returnedSma = SMA) {
  return {
    readContract: vi.fn().mockResolvedValue(returnedSma),
  };
}

function makeFakeAirdrop() {
  return {
    transferToSma: vi.fn().mockResolvedValue("0xTXHASH"),
  };
}

function makeFakeDb({ existing = null } = {}) {
  return {
    getSmartAccountByEoa: vi.fn().mockResolvedValue(existing),
    upsertSmartAccount: vi.fn().mockResolvedValue(undefined),
    markFunded: vi.fn().mockResolvedValue(undefined),
  };
}

describe("getSmaFromFactory", () => {
  it("calls factory.getAddress(eoa) via publicClient.readContract", async () => {
    const chain = makeFakeChain(SMA);
    const result = await getSmaFromFactory(
      chain,
      "0xfactory0000000000000000000000000000000000",
      EOA,
    );

    expect(chain.readContract).toHaveBeenCalledTimes(1);
    const callArg = chain.readContract.mock.calls[0][0];
    expect(callArg.functionName).toBe("getAddress");
    expect(callArg.args).toEqual([EOA]);
    expect(callArg.address).toBe(
      "0xfactory0000000000000000000000000000000000",
    );
    expect(result).toBe(SMA_LC);
  });
});

describe("ensureSmartAccount", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("computes SMA via factory.getAddress, upserts row, kicks airdrop for new users", async () => {
    const db = makeFakeDb({ existing: null });
    const chain = makeFakeChain(SMA);
    const airdrop = makeFakeAirdrop();

    const result = await ensureSmartAccount({
      eoa: EOA,
      db,
      chain,
      airdrop,
      network: "local",
    });

    expect(chain.readContract).toHaveBeenCalledWith(
      expect.objectContaining({
        functionName: "getAddress",
        args: [EOA],
      }),
    );
    expect(db.upsertSmartAccount).toHaveBeenCalledWith({
      eoa: EOA_LC,
      sma: SMA_LC,
    });
    expect(airdrop.transferToSma).toHaveBeenCalledWith(SMA_LC);
    expect(result).toEqual({ eoa: EOA_LC, sma: SMA_LC, isNew: true });
  });

  it("skips factory + airdrop for returning users with funded_at set", async () => {
    const db = makeFakeDb({
      existing: {
        eoa: EOA_LC,
        sma: SMA_LC,
        funded_at: new Date().toISOString(),
      },
    });
    const chain = makeFakeChain(SMA);
    const airdrop = makeFakeAirdrop();

    const result = await ensureSmartAccount({
      eoa: EOA,
      db,
      chain,
      airdrop,
      network: "local",
    });

    expect(chain.readContract).not.toHaveBeenCalled();
    expect(db.upsertSmartAccount).not.toHaveBeenCalled();
    expect(airdrop.transferToSma).not.toHaveBeenCalled();
    expect(result).toEqual({ eoa: EOA_LC, sma: SMA_LC, isNew: false });
  });

  it("re-runs factory + airdrop when row exists but funded_at is null (previous airdrop failed)", async () => {
    const db = makeFakeDb({
      existing: { eoa: EOA_LC, sma: SMA_LC, funded_at: null },
    });
    const chain = makeFakeChain(SMA);
    const airdrop = makeFakeAirdrop();

    const result = await ensureSmartAccount({
      eoa: EOA,
      db,
      chain,
      airdrop,
      network: "local",
    });

    expect(chain.readContract).toHaveBeenCalledTimes(1);
    expect(db.upsertSmartAccount).toHaveBeenCalledWith({
      eoa: EOA_LC,
      sma: SMA_LC,
    });
    expect(airdrop.transferToSma).toHaveBeenCalledWith(SMA_LC);
    expect(result).toEqual({ eoa: EOA_LC, sma: SMA_LC, isNew: true });
  });

  it("normalizes returned SMA address to lowercase regardless of factory casing", async () => {
    const db = makeFakeDb({ existing: null });
    const chain = makeFakeChain(SMA); // checksummed
    const airdrop = makeFakeAirdrop();

    const result = await ensureSmartAccount({
      eoa: EOA,
      db,
      chain,
      airdrop,
      network: "local",
    });

    expect(result.sma).toBe(SMA_LC);
    expect(db.upsertSmartAccount).toHaveBeenCalledWith({
      eoa: EOA_LC,
      sma: SMA_LC,
    });
  });
});
