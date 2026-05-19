/*
  @vitest-environment jsdom
*/
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

// The hook now reads the warm-tier /api/token/sof/transactions/:user
// endpoint instead of running an in-browser ERC-20 transfer indexer.
// These tests cover: (1) single-address fetch, (2) multi-address merge
// with dedup-by-(hash,logIndex), (3) origin tagging, (4) HTTP errors
// surface via react-query.

vi.mock("@/hooks/chain/internal", () => ({
  API_BASE: "http://test/api",
}));

import { useSOFTransactions } from "@/hooks/useSOFTransactions";

const EOA = "0x1111111111111111111111111111111111111111";
const SMA = "0x2222222222222222222222222222222222222222";

function wrapper(client) {
  return function W({ children }) {
    return React.createElement(QueryClientProvider, { client }, children);
  };
}

function makeClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
}

describe("useSOFTransactions", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("fetches and returns warm-tier rows for a single address", async () => {
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        transactions: [
          {
            type: "BONDING_CURVE_BUY",
            direction: "OUT",
            description: "Bought raffle tickets",
            hash: "0xa",
            logIndex: 0,
            blockNumber: 100,
            timestamp: 1,
            from: EOA,
            to: "0xcurve",
            amount: "10.0",
            seasonId: 1,
          },
        ],
      }),
    });

    const client = makeClient();
    const { result } = renderHook(() => useSOFTransactions(EOA), {
      wrapper: wrapper(client),
    });

    await waitFor(() => expect(result.current.data).toBeTruthy());
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data[0]).toMatchObject({
      type: "BONDING_CURVE_BUY",
      seasonId: 1,
      origin: EOA.toLowerCase(),
    });
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining(`/api/token/sof/transactions/${EOA.toLowerCase()}`),
      expect.any(Object),
    );
  });

  it("merges two addresses and dedupes by (hash, logIndex)", async () => {
    // EOA→SMA transfer shows up in BOTH per-address feeds; the merge
    // must keep it exactly once.
    const sharedRow = {
      type: "TRANSFER_OUT",
      direction: "OUT",
      description: "Sent SOF",
      hash: "0xshared",
      logIndex: 2,
      blockNumber: 50,
      timestamp: 100,
      from: EOA,
      to: SMA,
      amount: "1.0",
    };
    fetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          transactions: [
            sharedRow,
            { ...sharedRow, hash: "0xeoaonly", logIndex: 3, blockNumber: 49 },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          transactions: [
            sharedRow,
            { ...sharedRow, hash: "0xsmaonly", logIndex: 5, blockNumber: 60 },
          ],
        }),
      });

    const client = makeClient();
    const { result } = renderHook(() => useSOFTransactions([EOA, SMA]), {
      wrapper: wrapper(client),
    });

    await waitFor(() => expect(result.current.data?.length).toBeGreaterThan(0));
    const hashes = result.current.data.map((r) => r.hash);
    expect(hashes).toHaveLength(3);
    expect(new Set(hashes)).toEqual(
      new Set(["0xshared", "0xeoaonly", "0xsmaonly"]),
    );
    // Newest-first ordering.
    expect(result.current.data[0].blockNumber).toBe(60);
    expect(result.current.data[2].blockNumber).toBe(49);
  });

  it("address-list ordering does not split the cache", async () => {
    // Equivalent calls with the same address set must hit the same cache
    // key. We can verify by re-rendering with reversed order and asserting
    // fetch was NOT called again.
    fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ transactions: [] }),
    });

    const client = makeClient();
    const { rerender } = renderHook(
      ({ addrs }) => useSOFTransactions(addrs),
      {
        wrapper: wrapper(client),
        initialProps: { addrs: [EOA, SMA] },
      },
    );
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    rerender({ addrs: [SMA, EOA] });
    // Give the query observer a tick to settle on the cached entry.
    await new Promise((r) => setTimeout(r, 10));
    expect(fetch).toHaveBeenCalledTimes(2); // unchanged
  });

  it("surfaces HTTP errors via react-query error state", async () => {
    fetch.mockResolvedValueOnce({ ok: false, status: 502 });

    const client = makeClient();
    const { result } = renderHook(() => useSOFTransactions(EOA), {
      wrapper: wrapper(client),
    });
    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(String(result.current.error.message)).toContain("502");
  });
});
