// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/hooks/useRaffleAccount", () => ({
  useRaffleAccount: () => ({ sma: "0xsma" }),
}));

import { useUserMarketPosition, useMarketInfo } from "../useUserMarketPosition";

function makeWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  global.fetch = vi.fn(async () => ({
    ok: true,
    json: async () => ({
      yes: "0", no: "0", net: "0", isHedged: false, numTradesYes: 0, numTradesNo: 0,
      totalYesPool: "0", totalNoPool: "0", volume: "0",
    }),
  }));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function settle() {
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
}

describe("useUserMarketPosition isLive gating", () => {
  it("does not poll a settled market (isLive: false)", async () => {
    renderHook(() => useUserMarketPosition(7, { isLive: false }), { wrapper: makeWrapper() });
    await settle();
    const after = global.fetch.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
    expect(global.fetch.mock.calls.length).toBe(after);
  });

  it("polls a live market (isLive: true / default)", async () => {
    renderHook(() => useUserMarketPosition(7), { wrapper: makeWrapper() });
    await settle();
    const after = global.fetch.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
    expect(global.fetch.mock.calls.length).toBeGreaterThan(after);
  });
});

describe("useMarketInfo isLive gating", () => {
  it("does not poll a settled market (isLive: false)", async () => {
    renderHook(() => useMarketInfo(7, { isLive: false }), { wrapper: makeWrapper() });
    await settle();
    const after = global.fetch.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(25_000); });
    expect(global.fetch.mock.calls.length).toBe(after);
  });

  it("polls a live market (isLive: true / default)", async () => {
    renderHook(() => useMarketInfo(7), { wrapper: makeWrapper() });
    await settle();
    const after = global.fetch.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(25_000); });
    expect(global.fetch.mock.calls.length).toBeGreaterThan(after);
  });
});
