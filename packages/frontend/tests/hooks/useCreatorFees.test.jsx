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
const WALLET = "0x5555555555555555555555555555555555555555";
const OTHER = "0x6666666666666666666666666666666666666666";

// Listed for TESTNET in config/launchQuoteTokens.js.
const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

const PLACER_OF = { [OLD_TOKEN]: OLD_PLACER, [NEW_TOKEN]: CURRENT_PLACER, [FOREIGN_TOKEN]: ZERO };
// OLD_TOKEN is ETH-paired, NEW_TOKEN USDC-paired.
const QUOTE_OF = { [OLD_TOKEN]: ZERO, [NEW_TOKEN]: USDC, [FOREIGN_TOKEN]: ZERO };

// Per placer, per quote currency, per account: credited quote. Per token, per account: credited tokens.
const QUOTE_CREDITS = {
  [OLD_PLACER]: { [ZERO]: { [WALLET]: 7n }, [USDC]: { [WALLET]: 0n } },
  [CURRENT_PLACER]: { [ZERO]: { [WALLET]: 3n }, [USDC]: { [WALLET]: 5n } },
};
const TOKENS = { [OLD_TOKEN]: { [WALLET]: 11n }, [NEW_TOKEN]: { [WALLET]: 0n } };
const RECIPIENT = { [OLD_TOKEN]: WALLET, [NEW_TOKEN]: OTHER };

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
        case "quoteTokenOf":
          return QUOTE_OF[c.args[0]];
        case "CREATOR_FEE_BPS":
          return 8800n;
        case "claimable":
          return TOKENS[c.args[0]]
            ? TOKENS[c.args[0]][c.args[1]]
            : QUOTE_CREDITS[c.address][c.args[0]][c.args[1]];
        case "feeRecipientOf":
          return RECIPIENT[c.args[0]];
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
    const { result } = renderHook(() => useCreatorFees(launches, { account: WALLET }), { wrapper });
    await waitFor(() => expect(result.current.data).toBeDefined());
    const { launches: out, placers } = result.current.data;

    // A token the launchpad does not know (placer 0) is not read at all.
    expect(out.map((l) => [l.token, l.placer])).toEqual([
      [OLD_TOKEN, OLD_PLACER],
      [NEW_TOKEN, CURRENT_PLACER],
    ]);
    expect(calls.flatMap((c) => c.contracts).some((c) => c.args?.[0] === FOREIGN_TOKEN && !["placerOf", "quoteTokenOf"].includes(c.functionName))).toBe(false);

    // Quote credits per currency: ETH and the network's listed USDC on every placer.
    expect(placers[OLD_PLACER.toLowerCase()]).toEqual({
      address: OLD_PLACER,
      creatorFeeBps: 8800n,
      claimable: { [ZERO]: { [WALLET]: 7n }, [USDC.toLowerCase()]: { [WALLET]: 0n } },
    });
    expect(placers[CURRENT_PLACER.toLowerCase()]).toMatchObject({
      claimable: { [ZERO]: { [WALLET]: 3n }, [USDC.toLowerCase()]: { [WALLET]: 5n } },
    });

    expect(out[0]).toMatchObject({
      quoteToken: ZERO,
      recipient: WALLET,
      claimableTokens: { [WALLET]: 11n },
      uncollectedQuote: 100n,
      uncollectedTokens: 200n,
    });
    // A collect that would revert reads as unknown, not zero — and not as a failed query.
    expect(out[1]).toMatchObject({ quoteToken: USDC, recipient: OTHER, uncollectedQuote: null, uncollectedTokens: null });
    // Symbol and decimals for every currency read, without asking listed tokens.
    expect(result.current.data.quotes[USDC.toLowerCase()]).toMatchObject({ symbol: "USDC", decimals: 6 });
    expect(result.current.data.quotes[ZERO]).toMatchObject({ symbol: "ETH", decimals: 18 });
  });

  it("uses three multicalls: placers, then the reads and the simulated collects", async () => {
    const { result } = renderHook(() => useCreatorFees(launches, { account: WALLET }), { wrapper });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(multicall).toHaveBeenCalledTimes(3);
    expect(calls[0].fns).toEqual([
      "placer",
      "placerOf",
      "quoteTokenOf",
      "placerOf",
      "quoteTokenOf",
      "placerOf",
      "quoteTokenOf",
    ]);
    const collect = calls.find((c) => c.fns[0] === "collectFees");
    expect(collect.allowFailure).toBe(true);
    expect(collect.contracts.map((c) => [c.address, c.args[0]])).toEqual([
      [OLD_PLACER, OLD_TOKEN],
      [CURRENT_PLACER, NEW_TOKEN],
    ]);
    // The balances must all read, or the claim would be built on guesses.
    const reads = calls.find((c) => c.fns.includes("claimable"));
    expect(reads.allowFailure).toBe(false);
  });

  it("treats a failed collect simulation as unknown for every launch", async () => {
    state.collectThrows = true;
    const { result } = renderHook(() => useCreatorFees(launches, { account: WALLET }), { wrapper });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data.launches.map((l) => l.uncollectedQuote)).toEqual([null, null]);
  });

  it("reads the connected account lower-cased", async () => {
    const { result } = renderHook(() => useCreatorFees(launches, { account: WALLET.toUpperCase().replace("0X", "0x") }), { wrapper });
    await waitFor(() => expect(result.current.data).toBeDefined());
    const reads = calls.find((c) => c.fns.includes("claimable"));
    const accounts = reads.contracts.filter((c) => c.functionName === "claimable").map((c) => c.args[1]);
    expect(accounts.length).toBeGreaterThan(0);
    expect(accounts.every((a) => a === WALLET)).toBe(true);
  });

  it("reads nothing without an account or a launch", async () => {
    renderHook(() => useCreatorFees(launches, {}), { wrapper });
    renderHook(() => useCreatorFees([], { account: WALLET }), { wrapper });
    await new Promise((r) => setTimeout(r, 20));
    expect(multicall).not.toHaveBeenCalled();
  });
});

describe("useCreatorFeeWrite", () => {
  const call = { to: CURRENT_PLACER, data: "0x" };

  it("sends the calls as one executeBatch from the connected wallet", async () => {
    executeBatch.mockResolvedValue("0xhash");
    const { result } = renderHook(() => useCreatorFeeWrite(), { wrapper });
    let hash;
    await act(async () => {
      hash = await result.current.send([call, call]);
    });
    expect(hash).toBe("0xhash");
    expect(executeBatch).toHaveBeenCalledTimes(1);
    expect(executeBatch).toHaveBeenCalledWith([call, call]);
  });

  it("sends nothing for an empty batch", async () => {
    const { result } = renderHook(() => useCreatorFeeWrite(), { wrapper });
    let hash;
    await act(async () => {
      hash = await result.current.send([]);
    });
    expect(hash).toBeNull();
    expect(executeBatch).not.toHaveBeenCalled();
  });

  it("re-reads the fees after a claim, and after a failed one", async () => {
    const spy = vi.spyOn(qc, "invalidateQueries");
    executeBatch.mockRejectedValueOnce(new Error("user rejected"));
    const { result } = renderHook(() => useCreatorFeeWrite(), { wrapper });
    await act(async () => {
      await result.current.send([call]).catch(() => {});
    });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["creatorFees"] });
  });
});
