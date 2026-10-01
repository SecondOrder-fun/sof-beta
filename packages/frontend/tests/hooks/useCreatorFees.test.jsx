/*
  @vitest-environment jsdom
*/

import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

const LAUNCHPAD = "0x1000000000000000000000000000000000000001";
const CURRENT_PLACER = "0x3000000000000000000000000000000000000003";
const OLD_PLACER = "0x4000000000000000000000000000000000000004";
const ZERO = "0x0000000000000000000000000000000000000000";

const OLD_TOKEN = "0xaaaa00000000000000000000000000000000aaaa";
const NEW_TOKEN = "0xbbbb00000000000000000000000000000000bbbb";
const FOREIGN_TOKEN = "0xcccc00000000000000000000000000000000cccc";
const SMA = "0x5555555555555555555555555555555555555555";
const EOA = "0x6666666666666666666666666666666666666666";

const PLACER_OF = { [OLD_TOKEN]: OLD_PLACER, [NEW_TOKEN]: CURRENT_PLACER, [FOREIGN_TOKEN]: ZERO };

// Per placer, per account: credited ETH. Per token, per account: credited tokens.
const ETH = { [OLD_PLACER]: { [SMA]: 7n, [EOA]: 0n }, [CURRENT_PLACER]: { [SMA]: 3n, [EOA]: 1n } };
const TOKENS = { [OLD_TOKEN]: { [SMA]: 11n, [EOA]: 0n }, [NEW_TOKEN]: { [SMA]: 0n, [EOA]: 2n } };
const RECIPIENT = { [OLD_TOKEN]: SMA, [NEW_TOKEN]: EOA };

const state = { collect: {}, collectThrows: false };
const calls = [];
const multicall = vi.fn(async ({ contracts, allowFailure }) => {
  calls.push({ fns: contracts.map((c) => c.functionName), allowFailure, contracts });
  if (contracts[0]?.functionName === "collectFees" && state.collectThrows) throw new Error("rpc down");
  return contracts.map((c) => {
    const result = (() => {
      switch (c.functionName) {
        case "placer":
          return CURRENT_PLACER;
        case "placerOf":
          return PLACER_OF[c.args[0]];
        case "CREATOR_FEE_BPS":
          return 8800n;
        case "claimableEth":
          return ETH[c.address][c.args[0]];
        case "feeRecipientOf":
          return RECIPIENT[c.args[0]];
        case "claimableToken":
          return TOKENS[c.args[0]][c.args[1]];
        case "collectFees":
          return state.collect[c.args[0]];
        default:
          throw new Error(`unexpected ${c.functionName}`);
      }
    })();
    if (!allowFailure) return result;
    return result === undefined ? { status: "failure", error: new Error("revert") } : { status: "success", result };
  });
});

vi.mock("wagmi", () => ({ usePublicClient: () => ({ multicall }) }));
vi.mock("@/lib/wagmi", () => ({ getStoredNetworkKey: () => "TESTNET" }));
vi.mock("@/config/contracts", () => ({
  getContractAddresses: () => ({ TOKEN_LAUNCHPAD: LAUNCHPAD, LIQUIDITY_PLACER: CURRENT_PLACER }),
}));
const executeBatch = vi.fn();
vi.mock("@/hooks/useSmartTransactions", () => ({ useSmartTransactions: () => ({ executeBatch }) }));

import { useCreatorFees, useCreatorFeeWrite } from "@/hooks/useCreatorFees";

let qc;
function wrapper({ children }) {
  return React.createElement(QueryClientProvider, { client: qc }, children);
}

beforeEach(() => {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  calls.length = 0;
  multicall.mockClear();
  executeBatch.mockReset();
  state.collect = { [OLD_TOKEN]: [100n, 200n] }; // NEW_TOKEN's collect reverts
  state.collectThrows = false;
});

const launches = [OLD_TOKEN, NEW_TOKEN, FOREIGN_TOKEN].map((token) => ({ token }));

describe("useCreatorFees", () => {
  it("reads each launch through the placer that placed it, plus the current placer", async () => {
    const { result } = renderHook(() => useCreatorFees(launches, { accounts: { eoa: EOA, sma: SMA } }), { wrapper });
    await waitFor(() => expect(result.current.data).toBeDefined());
    const { launches: out, placers } = result.current.data;

    // A token the launchpad does not know (placer 0) is not read at all.
    expect(out.map((l) => [l.token, l.placer])).toEqual([
      [OLD_TOKEN, OLD_PLACER],
      [NEW_TOKEN, CURRENT_PLACER],
    ]);
    expect(calls.flatMap((c) => c.contracts).some((c) => c.args?.[0] === FOREIGN_TOKEN && c.functionName !== "placerOf")).toBe(false);

    expect(placers[OLD_PLACER.toLowerCase()]).toEqual({
      address: OLD_PLACER,
      creatorFeeBps: 8800n,
      claimableEth: { [SMA]: 7n, [EOA]: 0n },
      isCurrent: false,
    });
    expect(placers[CURRENT_PLACER.toLowerCase()]).toMatchObject({
      claimableEth: { [SMA]: 3n, [EOA]: 1n },
      isCurrent: true,
    });

    expect(out[0]).toMatchObject({
      recipient: SMA,
      claimableToken: { [SMA]: 11n, [EOA]: 0n },
      uncollectedEth: 100n,
      uncollectedTokens: 200n,
    });
    // A collect that would revert reads as unknown, not zero — and not as a failed query.
    expect(out[1]).toMatchObject({ recipient: EOA, uncollectedEth: null, uncollectedTokens: null });
  });

  it("uses three multicalls: placers, then the reads and the simulated collects", async () => {
    const { result } = renderHook(() => useCreatorFees(launches, { accounts: { eoa: EOA, sma: SMA } }), { wrapper });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(multicall).toHaveBeenCalledTimes(3);
    expect(calls[0].fns).toEqual(["placer", "placerOf", "placerOf", "placerOf"]);
    const collect = calls.find((c) => c.fns[0] === "collectFees");
    expect(collect.allowFailure).toBe(true);
    expect(collect.contracts.map((c) => [c.address, c.args[0]])).toEqual([
      [OLD_PLACER, OLD_TOKEN],
      [CURRENT_PLACER, NEW_TOKEN],
    ]);
    // The balances must all read, or the claim would be built on guesses.
    const reads = calls.find((c) => c.fns.includes("claimableEth"));
    expect(reads.allowFailure).toBe(false);
  });

  it("treats a failed collect simulation as unknown for every launch", async () => {
    state.collectThrows = true;
    const { result } = renderHook(() => useCreatorFees(launches, { accounts: { sma: SMA } }), { wrapper });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data.launches.map((l) => l.uncollectedEth)).toEqual([null, null]);
  });

  it("reads nothing without an account or a launch", async () => {
    renderHook(() => useCreatorFees(launches, { accounts: {} }), { wrapper });
    renderHook(() => useCreatorFees([], { accounts: { sma: SMA } }), { wrapper });
    await new Promise((r) => setTimeout(r, 20));
    expect(multicall).not.toHaveBeenCalled();
  });
});

describe("useCreatorFeeWrite", () => {
  const call = { to: CURRENT_PLACER, data: "0x" };

  it("sends a smart-account batch as a plain executeBatch", async () => {
    executeBatch.mockResolvedValue("0xhash");
    const { result } = renderHook(() => useCreatorFeeWrite(), { wrapper });
    let hash;
    await act(async () => {
      hash = await result.current.send([{ sender: { account: SMA, mode: "smart" }, calls: [call] }]);
    });
    expect(hash).toBe("0xhash");
    expect(executeBatch).toHaveBeenCalledWith([call], {});
  });

  // Fees credited to the EOA can only be claimed by the EOA as msg.sender.
  it("sends an EOA batch from the EOA (bypassSponsorship)", async () => {
    executeBatch.mockResolvedValue("0xeoa");
    const { result } = renderHook(() => useCreatorFeeWrite(), { wrapper });
    await act(async () => {
      await result.current.send([{ sender: { account: EOA, mode: "eoa" }, calls: [call] }]);
    });
    expect(executeBatch).toHaveBeenCalledWith([call], { bypassSponsorship: true });
  });

  it("sends batches in order and resolves with the last hash", async () => {
    executeBatch.mockResolvedValueOnce("0x1").mockResolvedValueOnce("0x2");
    const { result } = renderHook(() => useCreatorFeeWrite(), { wrapper });
    let hash;
    await act(async () => {
      hash = await result.current.send([
        { sender: { account: SMA, mode: "smart" }, calls: [call] },
        { sender: { account: EOA, mode: "eoa" }, calls: [call] },
      ]);
    });
    expect(executeBatch.mock.calls.map((c) => c[1])).toEqual([{}, { bypassSponsorship: true }]);
    expect(hash).toBe("0x2");
  });

  it("refuses a batch with no sender rather than sending it from the wrong account", async () => {
    const { result } = renderHook(() => useCreatorFeeWrite(), { wrapper });
    await act(async () => {
      await expect(result.current.send([{ sender: null, calls: [call] }])).rejects.toThrow();
    });
    expect(executeBatch).not.toHaveBeenCalled();
  });

  it("re-reads the fees after a claim, and after a failed one", async () => {
    const spy = vi.spyOn(qc, "invalidateQueries");
    executeBatch.mockRejectedValueOnce(new Error("user rejected"));
    const { result } = renderHook(() => useCreatorFeeWrite(), { wrapper });
    await act(async () => {
      await result.current.send([{ sender: { account: SMA, mode: "smart" }, calls: [call] }]).catch(() => {});
    });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["creatorFees"] });
  });
});
