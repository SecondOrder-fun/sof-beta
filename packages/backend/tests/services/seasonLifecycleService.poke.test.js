// tests/services/seasonLifecycleService.poke.test.js
// @vitest-environment node
//
// Confirms that finalizeSeason no longer drives the poke step itself —
// poke is now triggered by the SeasonCompleted event listener
// (see ../../src/listeners/seasonCompletedListener.js + the standalone
// helper in ../../src/services/pokeConsolationEligible.js).
//
// Why this test still exists rather than just being deleted: the previous
// version of this file asserted that finalizeSeason emitted N+1 writeContract
// calls (1 finalize + N poke chunks). That coupling is intentionally gone —
// see commit history. This file pins the new contract: finalizeSeason emits
// exactly one writeContract call.

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

vi.mock("../../src/services/adminAlertService.js", () => ({
  adminAlertService: { sendAlert: vi.fn().mockResolvedValue(undefined) },
}));

import { publicClient, getWalletClient } from "../../src/lib/viemClient.js";
import { SeasonLifecycleService } from "../../src/services/seasonLifecycleService.js";

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

describe("SeasonLifecycleService.finalizeSeason — poke decoupling", () => {
  let svc;
  let walletClient;

  beforeEach(async () => {
    vi.clearAllMocks();
    walletClient = getWalletClient();
    walletClient.writeContract.mockResolvedValue("0xfaketxhash");
    publicClient.waitForTransactionReceipt.mockResolvedValue({
      status: "success",
      blockNumber: 1n,
    });

    svc = new SeasonLifecycleService(makeLogger());
    await svc.initialize("0xRaffleContract");
  });

  it("submits exactly one tx (finalizeSeason) — poke is now the listener's job", async () => {
    await svc.finalizeSeason(7n, "test season");

    expect(walletClient.writeContract).toHaveBeenCalledTimes(1);
    const call = walletClient.writeContract.mock.calls[0][0];
    expect(call.functionName).toBe("finalizeSeason");
    expect(call.args).toEqual([7n]);
  });

  it("does NOT call pokeConsolationEligible from finalizeSeason", async () => {
    await svc.finalizeSeason(7n, "test season");

    const pokeCalls = walletClient.writeContract.mock.calls.filter(
      (c) => c[0].functionName === "pokeConsolationEligible"
    );
    expect(pokeCalls).toHaveLength(0);
  });
});
