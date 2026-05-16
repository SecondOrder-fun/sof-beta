// @vitest-environment node
import { describe, it, expect } from "vitest";
import { computeBuySplit } from "@/hooks/buysell/computeBuySplit";

describe("computeBuySplit", () => {
  it("returns all-wallet split when rolloverAmount = 0", () => {
    const r = computeBuySplit({
      tokenAmount: 1000n,
      estBuyWithFees: 1000n * 10n ** 18n,
      rolloverEffectiveSof: 0n,
    });
    expect(r.rolloverTickets).toBe(0n);
    expect(r.walletTopupTickets).toBe(1000n);
    expect(r.walletTopupSofBase).toBe(1000n * 10n ** 18n);
  });

  it("returns all-rollover split when rolloverAmount >= estBuyWithFees", () => {
    const r = computeBuySplit({
      tokenAmount: 1000n,
      estBuyWithFees: 1000n * 10n ** 18n,
      rolloverEffectiveSof: 1000n * 10n ** 18n,
    });
    expect(r.rolloverTickets).toBe(1000n);
    expect(r.walletTopupTickets).toBe(0n);
    expect(r.walletTopupSofBase).toBe(0n);
  });

  it("regression: when rolloverAmount represents base+bonus (e.g. 376.2 SOF effective for 354.9 base @ 6% bonus), all-rollover branch fires", () => {
    // Reproduces 2026-05-16 testnet incident: user had 354.9 SOF rollover for a 360-ticket / 360.36 SOF buy.
    // Before fix, callers passed raw rolloverAmount = 354.9 SOF → mixed branch fired → wallet portion
    // was underpriced (proportional split ignored the bonus) → SlippageExceeded revert.
    //
    // After fix, callers compute rolloverEffectiveAmount = rolloverAmount + bonus and pass that here.
    // For the user's scenario the cap is rolloverNeededForFull (~339.96 SOF), so effective ~360.36 ≥
    // estBuyWithFees → all-rollover branch, no wallet portion, no slippage trap.
    const r = computeBuySplit({
      tokenAmount: 360n,
      estBuyWithFees: 360360n * 10n ** 15n,         // 360.36 SOF
      rolloverEffectiveSof: 360360n * 10n ** 15n,         // 360.36 SOF effective (= 339.96 base + 6% bonus)
    });
    expect(r.rolloverTickets).toBe(360n);
    expect(r.walletTopupTickets).toBe(0n);
    expect(r.walletTopupSofBase).toBe(0n);
  });

  it("splits proportionally when 0 < rolloverAmount < estBuyWithFees", () => {
    // tokenAmount=1000, estBuyWithFees=1000 SOF, rollover=455 SOF → 455 tickets
    const r = computeBuySplit({
      tokenAmount: 1000n,
      estBuyWithFees: 1000n * 10n ** 18n,
      rolloverEffectiveSof: 455n * 10n ** 18n,
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
      rolloverEffectiveSof: 3333n * 10n ** 17n, // 333.3 SOF
    });
    expect(r.rolloverTickets).toBe(333n);
    expect(r.walletTopupTickets).toBe(667n);
  });

  it("handles tokenAmount=0 without dividing by zero", () => {
    const r = computeBuySplit({
      tokenAmount: 0n,
      estBuyWithFees: 0n,
      rolloverEffectiveSof: 100n,
    });
    expect(r.rolloverTickets).toBe(0n);
    expect(r.walletTopupTickets).toBe(0n);
    expect(r.walletTopupSofBase).toBe(0n);
  });

  it("handles estBuyWithFees=0 (curve not ready) without dividing by zero", () => {
    const r = computeBuySplit({
      tokenAmount: 1000n,
      estBuyWithFees: 0n,
      rolloverEffectiveSof: 100n,
    });
    expect(r.rolloverTickets).toBe(0n);
    expect(r.walletTopupTickets).toBe(1000n);
    expect(r.walletTopupSofBase).toBe(0n);
  });

  it("edge: rolloverEffective 1 wei short of full → 1-ticket wallet topup with correct cap", () => {
    // Documents what the widget's bonus-aware rolloverNeededForFull ceil-div fix
    // prevents: when the effective rollover misses by even 1 wei, the split MUST
    // make the wallet cover that one ticket fully — never truncate the cap.
    const r = computeBuySplit({
      tokenAmount: 1n,
      estBuyWithFees: 1000n * 10n ** 18n,
      rolloverEffectiveSof: 1000n * 10n ** 18n - 1n, // exactly 1 wei short
    });
    expect(r.rolloverTickets).toBe(0n);
    expect(r.walletTopupTickets).toBe(1n);
    // ceil(1000e18 × 1 / 1) = 1000e18 — wallet bears the full curve cost
    expect(r.walletTopupSofBase).toBe(1000n * 10n ** 18n);
  });

  it("regression: wallet portion is ticket-proportional, not SOF-subtraction (fee-aware)", () => {
    // Reproduces 2026-05-16 testnet SlippageExceeded(cost=6.006, maxAllowed=5.5146)
    // Setup: 380 tickets @ 1 SOF base + 0.1% fee = 380.38 SOF curve cost.
    // Rollover effective (354.9 base + 6% bonus = 376.194) covers 375 tickets.
    // Wallet covers 5 tickets at curve cost 5 × 1.001 = 5.005 SOF.
    //
    // Old (buggy) math: walletTopupSofBase = estBuyWithFees − rolloverAmount
    //                                      = 380.38 − 376.194 = 4.186 SOF ← under-priced
    //                  → buyTokens reverts SlippageExceeded on 5.005 > 4.228 cap.
    //
    // New math: walletTopupSofBase = estBuyWithFees × walletTopupTickets / tokenAmount
    //                              = 380.38 × 5 / 380 = 5.005 SOF (ceil-divided)
    const r = computeBuySplit({
      tokenAmount: 380n,
      estBuyWithFees: 380380n * 10n ** 15n,        // 380.38 SOF
      rolloverEffectiveSof: 376194n * 10n ** 15n,        // 376.194 SOF (354.9 + 21.294 bonus)
    });
    expect(r.rolloverTickets).toBe(375n);
    expect(r.walletTopupTickets).toBe(5n);
    // 380.38 SOF × 5 / 380 = 5.005 SOF exactly = 5005000000000000000 wei
    expect(r.walletTopupSofBase).toBe(5005000000000000000n);
    // Critically: NOT 380.38 − 376.194 = 4.186 SOF
    expect(r.walletTopupSofBase).not.toBe(4186000000000000000n);
  });
});
