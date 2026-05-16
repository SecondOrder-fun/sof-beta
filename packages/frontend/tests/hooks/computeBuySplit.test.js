// @vitest-environment node
import { describe, it, expect } from "vitest";
import { computeBuySplit } from "@/hooks/buysell/computeBuySplit";

describe("computeBuySplit", () => {
  it("returns all-wallet split when rolloverAmount = 0", () => {
    const r = computeBuySplit({
      tokenAmount: 1000n,
      estBuyWithFees: 1000n * 10n ** 18n,
      rolloverAmount: 0n,
    });
    expect(r.rolloverTickets).toBe(0n);
    expect(r.walletTopupTickets).toBe(1000n);
    expect(r.walletTopupSofBase).toBe(1000n * 10n ** 18n);
  });

  it("returns all-rollover split when rolloverAmount >= estBuyWithFees", () => {
    const r = computeBuySplit({
      tokenAmount: 1000n,
      estBuyWithFees: 1000n * 10n ** 18n,
      rolloverAmount: 1000n * 10n ** 18n,
    });
    expect(r.rolloverTickets).toBe(1000n);
    expect(r.walletTopupTickets).toBe(0n);
    expect(r.walletTopupSofBase).toBe(0n);
  });

  it("splits proportionally when 0 < rolloverAmount < estBuyWithFees", () => {
    // tokenAmount=1000, estBuyWithFees=1000 SOF, rollover=455 SOF → 455 tickets
    const r = computeBuySplit({
      tokenAmount: 1000n,
      estBuyWithFees: 1000n * 10n ** 18n,
      rolloverAmount: 455n * 10n ** 18n,
    });
    expect(r.rolloverTickets).toBe(455n);
    expect(r.walletTopupTickets).toBe(545n);
    expect(r.walletTopupSofBase).toBe(545n * 10n ** 18n);
  });

  it("rounds rolloverTickets DOWN so user never under-pays the curve", () => {
    // rollover=333.3 SOF on 1000 SOF total → 333 tickets (not 334)
    const r = computeBuySplit({
      tokenAmount: 1000n,
      estBuyWithFees: 1000n * 10n ** 18n,
      rolloverAmount: 3333n * 10n ** 17n, // 333.3 SOF
    });
    expect(r.rolloverTickets).toBe(333n);
    expect(r.walletTopupTickets).toBe(667n);
  });

  it("handles tokenAmount=0 without dividing by zero", () => {
    const r = computeBuySplit({
      tokenAmount: 0n,
      estBuyWithFees: 0n,
      rolloverAmount: 100n,
    });
    expect(r.rolloverTickets).toBe(0n);
    expect(r.walletTopupTickets).toBe(0n);
    expect(r.walletTopupSofBase).toBe(0n);
  });

  it("handles estBuyWithFees=0 (curve not ready) without dividing by zero", () => {
    const r = computeBuySplit({
      tokenAmount: 1000n,
      estBuyWithFees: 0n,
      rolloverAmount: 100n,
    });
    expect(r.rolloverTickets).toBe(0n);
    expect(r.walletTopupTickets).toBe(1000n);
    expect(r.walletTopupSofBase).toBe(0n);
  });
});
