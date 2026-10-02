/*
  @vitest-environment jsdom
*/
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

// The hook now reads the warm-tier /api/token/sof/transactions/:user
// endpoint instead of running an in-browser ERC-20 transfer indexer.
// These tests cover: (1) single-address fetch, (2) newest-first ordering,
// (3) checksum casing sharing one cache entry, (4) HTTP errors surface via
// react-query.

vi.mock("@/hooks/chain/internal", () => ({
  API_BASE: "http://test/api",
}));

import { useSOFTransactions } from "@/hooks/useSOFTransactions";

const EOA = "0x1111111111111111111111111111111111111111";
const CHECKSUM = "0xAbCdEf0000000000000000000000000000000001";

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
    });
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining(`/api/token/sof/transactions/${EOA.toLowerCase()}`),
      expect.any(Object),
    );
  });

  it("returns rows newest first", async () => {
    const row = {
      type: "TRANSFER_IN",
      direction: "IN",
      description: "Received SOF",
      timestamp: 100,
      from: "0xother",
      to: EOA,
      amount: "1.0",
    };
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        transactions: [
          { ...row, hash: "0xold", logIndex: 3, blockNumber: 49 },
          { ...row, hash: "0xnew", logIndex: 5, blockNumber: 60 },
          { ...row, hash: "0xsameblock", logIndex: 7, blockNumber: 60 },
        ],
      }),
    });

    const client = makeClient();
    const { result } = renderHook(() => useSOFTransactions(EOA), {
      wrapper: wrapper(client),
    });

    await waitFor(() => expect(result.current.data?.length).toBe(3));
    expect(result.current.data.map((r) => r.hash)).toEqual([
      "0xsameblock",
      "0xnew",
      "0xold",
    ]);
  });

  it("checksum casing does not split the cache", async () => {
    fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ transactions: [] }),
    });

    const client = makeClient();
    const { rerender } = renderHook(
      ({ addr }) => useSOFTransactions(addr),
      {
        wrapper: wrapper(client),
        initialProps: { addr: CHECKSUM },
      },
    );
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining(`/transactions/${CHECKSUM.toLowerCase()}`),
      expect.any(Object),
    );
    rerender({ addr: CHECKSUM.toLowerCase() });
    // Give the query observer a tick to settle on the cached entry.
    await new Promise((r) => setTimeout(r, 10));
    expect(fetch).toHaveBeenCalledTimes(1); // unchanged
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
