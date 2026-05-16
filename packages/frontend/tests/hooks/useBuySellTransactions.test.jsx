// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

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
vi.mock("@/hooks/useSOFToken", () => ({
  useSOFToken: () => ({ refetchBalance: vi.fn() }),
}));

import { useBuySellTransactions } from "@/hooks/buysell/useBuySellTransactions";

const ONE_SOF = 10n ** 18n;

describe("useBuySellTransactions.executeBuy mixed-batch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExecuteBatch.mockResolvedValue("0xtxhash");
  });

  function setup() {
    const { result } = renderHook(() =>
      useBuySellTransactions(ADDR_CURVE, null, vi.fn(), vi.fn())
    );
    return result;
  }

  it("submits wallet-only batch when rolloverAmount = 0", async () => {
    const result = setup();
    await act(async () => {
      await result.current.executeBuy({
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
      await result.current.executeBuy({
        tokenAmount: 1000n,
        maxSofAmount: 1000n * ONE_SOF,
        slippagePct: "1",
        rolloverSeasonId: 1n,
        rolloverAmount: 1000n * ONE_SOF,
        walletTopupTickets: 0n,
        walletTopupMaxSof: 0n,
      });
    });
    const calls = mockExecuteBatch.mock.calls[0][0];
    expect(calls).toHaveLength(1);
    expect(calls[0].to).toBe(ADDR_ESCROW);
  });

  it("submits 3-call mixed batch when rolloverAmount < estBuyWithFees", async () => {
    const result = setup();
    await act(async () => {
      await result.current.executeBuy({
        tokenAmount: 1000n,
        maxSofAmount: 1000n * ONE_SOF,
        slippagePct: "1",
        rolloverSeasonId: 1n,
        rolloverAmount: 455n * ONE_SOF,
        walletTopupTickets: 545n,
        walletTopupMaxSof: 551n * ONE_SOF,
      });
    });
    const calls = mockExecuteBatch.mock.calls[0][0];
    expect(calls).toHaveLength(3);
    expect(calls[0].to).toBe(ADDR_ESCROW);
    expect(calls[0].data).toContain("455");      // sofAmount (455 * ONE_SOF)
    expect(calls[1].to).toBe(ADDR_SOF);          // approve
    expect(calls[2].to).toBe(ADDR_CURVE);        // buyTokens for top-up
  });

  it("computes rolloverTickets in the mixed branch by tokenAmount − walletTopupTickets", async () => {
    const result = setup();
    await act(async () => {
      await result.current.executeBuy({
        tokenAmount: 1000n,
        maxSofAmount: 1000n * ONE_SOF,
        slippagePct: "1",
        rolloverSeasonId: 1n,
        rolloverAmount: 455n * ONE_SOF,
        walletTopupTickets: 545n,
        walletTopupMaxSof: 551n * ONE_SOF,
      });
    });
    const spendCall = mockExecuteBatch.mock.calls[0][0][0];
    // ticketAmount in spendFromRollover args is 1000 - 545 = 455
    expect(spendCall.data).toContain(",455,");
  });
});
