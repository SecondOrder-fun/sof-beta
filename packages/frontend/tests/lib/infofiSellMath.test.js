import { describe, it, expect } from "vitest";

import { minCollateralOut, quoteSellCollateral } from "@/lib/infofiSellMath";

// SimpleFPMM.calcSellAmount, ported line for line (contracts/src/infofi/InfoFiFPMMV2.sol):
// the shares the pool needs to pay out `amountOut` collateral.
function calcSellAmount({ yesReserve, noReserve, feeBps }, sellYes, amountOut) {
  const amountOutPlusFee = (amountOut * 10000n) / (10000n - feeBps);
  const k = yesReserve * noReserve;
  if (sellYes) {
    const newNo = noReserve - amountOutPlusFee;
    if (newNo <= 0n) throw new Error("Insufficient liquidity");
    return k / newNo - yesReserve;
  }
  const newYes = yesReserve - amountOutPlusFee;
  if (newYes <= 0n) throw new Error("Insufficient liquidity");
  return k / newYes - noReserve;
}

const E18 = 10n ** 18n;

// Small deterministic PRNG so the property test is reproducible.
function rng(seed) {
  let x = seed;
  return () => {
    x = (x * 1103515245 + 12345) % 2147483648;
    return x;
  };
}

describe("quoteSellCollateral", () => {
  it("never quotes more collateral than the shares can buy back from the contract", () => {
    const next = rng(42);
    for (let i = 0; i < 2000; i++) {
      const pool = {
        yesReserve: BigInt(next() % 100000 + 1) * E18 / 10n,
        noReserve: BigInt(next() % 100000 + 1) * E18 / 10n,
        feeBps: 200n,
      };
      const sellYes = next() % 2 === 0;
      const sharesIn = (BigInt(next() % 50000 + 1) * E18) / 100n;
      const quote = quoteSellCollateral({ ...pool, sellYes, sharesIn });
      if (quote === 0n) continue;
      const needed = calcSellAmount(pool, sellYes, quote);
      expect(needed <= sharesIn).toBe(true);
      // ...and leaves almost nothing on the table (within 0.01% of the shares).
      expect(sharesIn - needed <= sharesIn / 10000n + 10n).toBe(true);
    }
  });

  it("quotes a 50/50 pool by hand", () => {
    // yes = no = 1000; sell 100 YES: newYes 1100, newNo = ceil(1e6/1100) = 909.0909…
    const quote = quoteSellCollateral({ yesReserve: 1000n * E18, noReserve: 1000n * E18, feeBps: 200n, sellYes: true, sharesIn: 100n * E18 });
    // outPlusFee ≈ 90.909 → net of 2% ≈ 89.09
    expect(Number(quote) / 1e18).toBeCloseTo(89.0909, 3);
  });

  it("is zero for nothing to sell or an empty pool", () => {
    expect(quoteSellCollateral({ yesReserve: E18, noReserve: E18, feeBps: 200n, sellYes: true, sharesIn: 0n })).toBe(0n);
    expect(quoteSellCollateral({ yesReserve: 0n, noReserve: E18, feeBps: 200n, sellYes: true, sharesIn: E18 })).toBe(0n);
  });
});

describe("minCollateralOut", () => {
  it("takes the slippage allowance off the quote", () => {
    expect(minCollateralOut(10_000n, 200)).toBe(9_800n);
    expect(minCollateralOut(0n, 200)).toBe(0n);
  });
});
