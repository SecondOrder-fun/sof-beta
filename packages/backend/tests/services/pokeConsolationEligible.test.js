// tests/services/pokeConsolationEligible.test.js
// @vitest-environment node
//
// Tests that the standalone pokeConsolationEligibleChunked helper reads a
// season's participants and submits one pokeConsolationEligible tx per
// 500-element chunk.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/lib/viemClient.js", () => {
  const mockPublicClient = {
    readContract: vi.fn(),
    waitForTransactionReceipt: vi.fn(),
  };
  const mockWalletClient = { writeContract: vi.fn() };
  return {
    publicClient: mockPublicClient,
    getWalletClient: vi.fn(() => mockWalletClient),
  };
});

import { publicClient, getWalletClient } from "../../src/lib/viemClient.js";
import { pokeConsolationEligibleChunked } from "../../src/services/pokeConsolationEligible.js";

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

describe("pokeConsolationEligibleChunked", () => {
  let walletClient;

  beforeEach(() => {
    vi.clearAllMocks();
    walletClient = getWalletClient();
    walletClient.writeContract.mockResolvedValue("0xfaketxhash");
    publicClient.waitForTransactionReceipt.mockResolvedValue({
      status: "success",
      blockNumber: 1n,
    });
  });

  it("calls pokeConsolationEligible 3 times for 1200 participants (offsets 0, 500, 1000)", async () => {
    publicClient.readContract.mockResolvedValue(Array(1200).fill("0xabc"));

    const result = await pokeConsolationEligibleChunked({
      raffleAddress: "0xRaffleContract",
      logger: makeLogger(),
      seasonId: 7n,
    });

    expect(walletClient.writeContract).toHaveBeenCalledTimes(3);
    const expectedOffsets = [0n, 500n, 1000n];
    for (let i = 0; i < 3; i++) {
      const call = walletClient.writeContract.mock.calls[i][0];
      expect(call.functionName).toBe("pokeConsolationEligible");
      expect(call.args[0]).toBe(7n);
      expect(call.args[1]).toBe(expectedOffsets[i]);
      expect(call.args[2]).toBe(500n);
    }
    expect(result).toEqual({ chunks: 3, length: 1200n });
  });

  it("calls pokeConsolationEligible exactly once for a single participant", async () => {
    publicClient.readContract.mockResolvedValue(["0xabc"]);

    const result = await pokeConsolationEligibleChunked({
      raffleAddress: "0xRaffleContract",
      logger: makeLogger(),
      seasonId: 1n,
    });

    expect(walletClient.writeContract).toHaveBeenCalledTimes(1);
    expect(walletClient.writeContract.mock.calls[0][0].args).toEqual([
      1n,
      0n,
      500n,
    ]);
    expect(result).toEqual({ chunks: 1, length: 1n });
  });

  it("does not submit any tx when participants list is empty", async () => {
    publicClient.readContract.mockResolvedValue([]);

    const result = await pokeConsolationEligibleChunked({
      raffleAddress: "0xRaffleContract",
      logger: makeLogger(),
      seasonId: 7n,
    });

    expect(walletClient.writeContract).not.toHaveBeenCalled();
    expect(result).toEqual({ chunks: 0, length: 0n });
  });

  it("accepts a plain number for seasonId and coerces to bigint", async () => {
    publicClient.readContract.mockResolvedValue(["0xabc", "0xdef"]);

    await pokeConsolationEligibleChunked({
      raffleAddress: "0xRaffleContract",
      logger: makeLogger(),
      seasonId: 42, // number, not bigint
    });

    const readArgs = publicClient.readContract.mock.calls[0][0].args;
    expect(readArgs[0]).toBe(42n);
    const writeArgs = walletClient.writeContract.mock.calls[0][0].args;
    expect(writeArgs[0]).toBe(42n);
  });

  it("throws when raffleAddress is missing", async () => {
    await expect(
      pokeConsolationEligibleChunked({
        raffleAddress: undefined,
        logger: makeLogger(),
        seasonId: 1n,
      })
    ).rejects.toThrow(/raffleAddress is required/);
  });

  it("retries the chunk tx on transient failure then surfaces a final error", async () => {
    vi.useFakeTimers();

    publicClient.readContract.mockResolvedValue(["0xabc"]);
    walletClient.writeContract.mockRejectedValue(new Error("rpc blip"));

    const promise = pokeConsolationEligibleChunked({
      raffleAddress: "0xRaffleContract",
      logger: makeLogger(),
      seasonId: 1n,
    });
    // Attach rejection handler before any awaits so the queued rejection has
    // a listener — otherwise the runtime flags it as unhandled and Vitest
    // surfaces a trailing "errors: 1" alongside passing tests.
    const rejection = expect(promise).rejects.toThrow(/rpc blip/);

    await vi.runAllTimersAsync();
    await rejection;
    // 3 attempts per the retry policy
    expect(walletClient.writeContract).toHaveBeenCalledTimes(3);

    vi.useRealTimers();
  });
});
