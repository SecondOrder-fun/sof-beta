// tests/services/seasonLifecycleService.poke.test.js
// @vitest-environment node
//
// Tests that finalizeSeason calls pokeConsolationEligible in 500-participant
// chunks after the finalize tx confirms.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// -------------------------------------------------------------------
// Module-level mocks — must appear before any dynamic imports.
// -------------------------------------------------------------------

// Prevent viemClient.js from throwing on missing NETWORK env var at load time.
vi.mock("../../src/lib/viemClient.js", () => {
  const mockPublicClient = {
    readContract: vi.fn(),
    waitForTransactionReceipt: vi.fn(),
  };
  const mockWalletClient = {
    writeContract: vi.fn(),
  };
  return {
    publicClient: mockPublicClient,
    getWalletClient: vi.fn(() => mockWalletClient),
  };
});

// Silence adminAlertService so it doesn't blow up in the test environment.
vi.mock("../../src/services/adminAlertService.js", () => ({
  adminAlertService: { sendAlert: vi.fn().mockResolvedValue(undefined) },
}));

// -------------------------------------------------------------------
// Imports (after vi.mock hoisting)
// -------------------------------------------------------------------
import { publicClient, getWalletClient } from "../../src/lib/viemClient.js";
import { SeasonLifecycleService } from "../../src/services/seasonLifecycleService.js";

// -------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------
function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

describe("SeasonLifecycleService.finalizeSeason — pokeConsolationEligible chunks", () => {
  let svc;
  let walletClient;

  beforeEach(async () => {
    vi.clearAllMocks();

    walletClient = getWalletClient();

    // Default: writeContract returns a fake hash; receipt is successful.
    walletClient.writeContract.mockResolvedValue("0xfaketxhash");
    publicClient.waitForTransactionReceipt.mockResolvedValue({
      status: "success",
      blockNumber: 1n,
    });

    svc = new SeasonLifecycleService(makeLogger());
    await svc.initialize("0xRaffleContract");
  });

  it("calls pokeConsolationEligible 3 times (offsets 0, 500, 1000) for 1200 participants", async () => {
    // 1200-element participant array
    publicClient.readContract.mockResolvedValue(Array(1200).fill("0xabc"));

    await svc.finalizeSeason(7n, "test");

    // Total writeContract calls: 1 (finalizeSeason) + 3 (poke chunks)
    expect(walletClient.writeContract).toHaveBeenCalledTimes(4);

    // First call must be finalizeSeason
    const firstCall = walletClient.writeContract.mock.calls[0][0];
    expect(firstCall.functionName).toBe("finalizeSeason");
    expect(firstCall.args).toEqual([7n]);

    // Remaining 3 calls must be pokeConsolationEligible at offsets 0, 500, 1000
    const pokeCalls = walletClient.writeContract.mock.calls.slice(1);
    const expectedOffsets = [0n, 500n, 1000n];

    for (let i = 0; i < pokeCalls.length; i++) {
      const call = pokeCalls[i][0];
      expect(call.functionName).toBe("pokeConsolationEligible");
      expect(call.args[0]).toBe(7n);                    // seasonId
      expect(call.args[1]).toBe(expectedOffsets[i]);    // offset
      expect(call.args[2]).toBe(500n);                  // chunkSize
    }
  });

  it("does not call pokeConsolationEligible when there are no participants", async () => {
    publicClient.readContract.mockResolvedValue([]);

    await svc.finalizeSeason(7n, "test");

    // Only finalizeSeason should have been written
    expect(walletClient.writeContract).toHaveBeenCalledTimes(1);
    const onlyCall = walletClient.writeContract.mock.calls[0][0];
    expect(onlyCall.functionName).toBe("finalizeSeason");
  });

  it("calls pokeConsolationEligible exactly once for 1 participant", async () => {
    publicClient.readContract.mockResolvedValue(["0xabc"]);

    await svc.finalizeSeason(7n, "test");

    expect(walletClient.writeContract).toHaveBeenCalledTimes(2);
    const pokeCall = walletClient.writeContract.mock.calls[1][0];
    expect(pokeCall.functionName).toBe("pokeConsolationEligible");
    expect(pokeCall.args).toEqual([7n, 0n, 500n]);
  });

  it("does not throw when poke fails — finalize itself already succeeded", async () => {
    // Use fake timers to skip retry back-off delays instantly.
    vi.useFakeTimers();

    publicClient.readContract.mockResolvedValue(Array(10).fill("0xabc"));

    // Poke calls throw on every attempt (exhausts all 3 retries immediately).
    walletClient.writeContract
      .mockResolvedValueOnce("0xfinalizeHash") // finalizeSeason succeeds
      .mockRejectedValue(new Error("poke reverted"));

    // Advance fake timers while the promise is in-flight so retry delays resolve.
    const promise = svc.finalizeSeason(7n, "test");
    await vi.runAllTimersAsync();
    await expect(promise).resolves.toBeUndefined();

    vi.useRealTimers();
  });
});
