// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// Valid 20-byte addresses referenced in assertions
const ADDR_SOF    = "0x1111111111111111111111111111111111111111";
const ADDR_CURVE  = "0x2222222222222222222222222222222222222222";
const ADDR_ESCROW = "0x3333333333333333333333333333333333333333";

const mockExecuteBatch = vi.fn();
vi.mock("@/hooks/useSmartTransactions", () => ({
  useSmartTransactions: () => ({ executeBatch: mockExecuteBatch }),
}));
vi.mock("@/lib/wagmi", () => ({ getStoredNetworkKey: () => "TESTNET" }));
vi.mock("@/config/contracts", () => ({
  // Inlined — vi.mock factories are hoisted, can't close over module-scope consts
  getContractAddresses: () => ({ SOF: "0x1111111111111111111111111111111111111111" }),
}));
vi.mock("@/services/onchainRolloverEscrow", () => ({
  buildSpendFromRolloverCall: ({ seasonId, sofAmount, ticketAmount, maxTotalSof }) => ({
    to: "0x3333333333333333333333333333333333333333",
    data: `spend(${seasonId},${sofAmount},${ticketAmount},${maxTotalSof})`,
  }),
}));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (k) => k }) }));

import { useBuySellTransactions } from "@/hooks/buysell/useBuySellTransactions";

const ONE_SOF = 10n ** 18n;

describe("useBuySellTransactions.buyMutation — call building", () => {
  let queryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    mockExecuteBatch.mockResolvedValue("0xtxhash");
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
  });

  function wrapper({ children }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  }

  function setup() {
    const { result } = renderHook(
      () => useBuySellTransactions(ADDR_CURVE, null),
      { wrapper },
    );
    return result;
  }

  it("submits wallet-only batch when rolloverAmount = 0", async () => {
    const result = setup();
    await act(async () => {
      await result.current.buyMutation.mutateAsync({
        tokenAmount: 1000n,
        maxSofAmount: 1000n * ONE_SOF,
        slippagePct: "1",
        rolloverSeasonId: null,
        rolloverAmount: 0n,
        walletTopupTickets: 1000n,
        walletTopupMaxSof: 1010n * ONE_SOF,
      });
    });
    const calls = mockExecuteBatch.mock.calls[0][0];
    expect(calls).toHaveLength(2);
    expect(calls[0].to).toBe(ADDR_SOF);
    expect(calls[1].to).toBe(ADDR_CURVE);
  });

  it("submits rollover-only batch when rolloverAmount covers the full buy", async () => {
    const result = setup();
    await act(async () => {
      await result.current.buyMutation.mutateAsync({
        tokenAmount: 1000n,
        maxSofAmount: 1000n * ONE_SOF,
        slippagePct: "1",
        rolloverSeasonId: 1n,
        rolloverAmount: 1000n * ONE_SOF,
        walletTopupTickets: 0n,
        walletTopupMaxSof: 0n,
        rolloverMaxTotalSof: 1060n * ONE_SOF,
      });
    });
    const calls = mockExecuteBatch.mock.calls[0][0];
    expect(calls).toHaveLength(1);
    expect(calls[0].to).toBe(ADDR_ESCROW);
  });

  it("submits 3-call mixed batch when rolloverAmount < estBuyWithFees", async () => {
    const result = setup();
    await act(async () => {
      await result.current.buyMutation.mutateAsync({
        tokenAmount: 1000n,
        maxSofAmount: 1000n * ONE_SOF,
        slippagePct: "1",
        rolloverSeasonId: 1n,
        rolloverAmount: 455n * ONE_SOF,
        walletTopupTickets: 545n,
        walletTopupMaxSof: 551n * ONE_SOF,
        rolloverMaxTotalSof: 490n * ONE_SOF,
      });
    });
    const calls = mockExecuteBatch.mock.calls[0][0];
    expect(calls).toHaveLength(3);
    expect(calls[0].to).toBe(ADDR_ESCROW);
    // maxTotalSof should use rolloverMaxTotalSof (490 * ONE_SOF), not the 10% fallback
    expect(calls[0].data).toContain(String(490n * ONE_SOF));
    expect(calls[0].data).toContain("455");      // sofAmount (455 * ONE_SOF)
    expect(calls[1].to).toBe(ADDR_SOF);          // approve
    expect(calls[2].to).toBe(ADDR_CURVE);        // buyTokens for top-up
  });

  it("computes rolloverTickets in the mixed branch by tokenAmount − walletTopupTickets", async () => {
    const result = setup();
    await act(async () => {
      await result.current.buyMutation.mutateAsync({
        tokenAmount: 1000n,
        maxSofAmount: 1000n * ONE_SOF,
        slippagePct: "1",
        rolloverSeasonId: 1n,
        rolloverAmount: 455n * ONE_SOF,
        walletTopupTickets: 545n,
        walletTopupMaxSof: 551n * ONE_SOF,
        rolloverMaxTotalSof: 490n * ONE_SOF,
      });
    });
    const spendCall = mockExecuteBatch.mock.calls[0][0][0];
    // ticketAmount in spendFromRollover args is 1000 - 545 = 455
    expect(spendCall.data).toContain(",455,");
  });

  it("falls through to wallet-only when rolloverTickets would be 0 (1-ticket edge)", async () => {
    const result = setup();
    await act(async () => {
      await result.current.buyMutation.mutateAsync({
        tokenAmount: 1n,
        maxSofAmount: 100n * ONE_SOF,
        slippagePct: "1",
        rolloverSeasonId: 1n,
        rolloverAmount: 1n * ONE_SOF,    // 1 SOF, not enough for 1 ticket
        walletTopupTickets: 1n,           // all tickets from wallet
        walletTopupMaxSof: 101n * ONE_SOF,
        rolloverMaxTotalSof: 2n * ONE_SOF,
      });
    });
    const calls = mockExecuteBatch.mock.calls[0][0];
    // rolloverTickets = 1 - 1 = 0 → mixed branch must NOT fire, wallet-only path runs
    expect(calls).toHaveLength(2);
    expect(calls[0].to).toBe(ADDR_SOF);    // approve
    expect(calls[1].to).toBe(ADDR_CURVE);  // buyTokens
  });
});

describe("useBuySellTransactions.buyMutation — pre-flight validation", () => {
  let queryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    mockExecuteBatch.mockResolvedValue("0xtxhash");
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
  });

  function wrapper({ children }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  }

  function setup() {
    const { result } = renderHook(
      () => useBuySellTransactions(ADDR_CURVE, null),
      { wrapper },
    );
    return result;
  }

  it("throws when validation.seasonTimeNotActive is true; no batch submitted", async () => {
    const result = setup();
    let caught;
    await act(async () => {
      try {
        await result.current.buyMutation.mutateAsync({
          tokenAmount: 1n,
          maxSofAmount: 1n,
          slippagePct: "1",
          walletTopupTickets: 1n,
          walletTopupMaxSof: 1n,
          validation: { seasonTimeNotActive: true },
        });
      } catch (e) { caught = e; }
    });
    expect(caught?.message).toMatch(/Season is not active/);
    expect(mockExecuteBatch).not.toHaveBeenCalled();
  });

  it("throws when validation.tradingLocked is true; no batch submitted", async () => {
    const result = setup();
    let caught;
    await act(async () => {
      try {
        await result.current.buyMutation.mutateAsync({
          tokenAmount: 1n,
          maxSofAmount: 1n,
          slippagePct: "1",
          walletTopupTickets: 1n,
          walletTopupMaxSof: 1n,
          validation: { tradingLocked: true },
        });
      } catch (e) { caught = e; }
    });
    expect(caught?.message).toMatch(/Trading is locked/);
    expect(mockExecuteBatch).not.toHaveBeenCalled();
  });

  it("throws on hasInsufficientBalance with formatted needed amount", async () => {
    const result = setup();
    let caught;
    await act(async () => {
      try {
        await result.current.buyMutation.mutateAsync({
          tokenAmount: 1n,
          maxSofAmount: 1n,
          slippagePct: "1",
          walletTopupTickets: 1n,
          walletTopupMaxSof: 1n,
          validation: { hasInsufficientBalance: true, needed: "12.34" },
        });
      } catch (e) { caught = e; }
    });
    // i18n mock returns the key, so the message is the t() key, not the rendered string.
    expect(caught?.message).toMatch(/insufficientSOFWithAmount/);
    expect(mockExecuteBatch).not.toHaveBeenCalled();
  });
});

describe("useBuySellTransactions.sellMutation — pre-flight reserves check", () => {
  let queryClient;
  let mockClient;

  beforeEach(() => {
    vi.clearAllMocks();
    mockExecuteBatch.mockResolvedValue("0xselltx");
    mockClient = { readContract: vi.fn() };
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
  });

  function wrapper({ children }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  }

  function setup() {
    const { result } = renderHook(
      () => useBuySellTransactions(ADDR_CURVE, mockClient),
      { wrapper },
    );
    return result;
  }

  it("throws Insufficient curve reserves when curveConfig sofReserves < minSofAmount", async () => {
    // curveConfig returns [totalSupply, sofReserves, ...]; mock with sofReserves=100
    mockClient.readContract.mockResolvedValue([0n, 100n]);
    const result = setup();
    let caught;
    await act(async () => {
      try {
        await result.current.sellMutation.mutateAsync({
          tokenAmount: 1n,
          minSofAmount: 1000n,
          slippagePct: "1",
        });
      } catch (e) { caught = e; }
    });
    expect(caught?.message).toMatch(/Insufficient curve reserves/);
    expect(mockExecuteBatch).not.toHaveBeenCalled();
  });

  it("submits sell batch when reserves are sufficient", async () => {
    mockClient.readContract.mockResolvedValue([0n, 10_000n * ONE_SOF]);
    const result = setup();
    await act(async () => {
      await result.current.sellMutation.mutateAsync({
        tokenAmount: 1n,
        minSofAmount: 100n * ONE_SOF,
        slippagePct: "1",
      });
    });
    const calls = mockExecuteBatch.mock.calls[0][0];
    expect(calls).toHaveLength(1);
    expect(calls[0].to).toBe(ADDR_CURVE);
  });
});
