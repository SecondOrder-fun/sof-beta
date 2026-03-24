// tests/lib/curveMath.test.js
import { describe, it, expect } from 'vitest';
import { simBuyCurve, simSellCurve, computeMinAfterSlippage, computeMaxWithSlippage } from '@/lib/curveMath';

// Helper to build steps easily
const steps = (
  // array of [price, rangeTo] as numbers for readability
  arr
) => arr.map(([price, rangeTo]) => ({ price: BigInt(price), rangeTo: BigInt(rangeTo) }));

describe('curveMath simulators', () => {
  it('simBuyCurve - expected simple case across one step', () => {
    const s = steps([
      [10n, 1000n], // price 10, up to 1000
    ]);
    const out = simBuyCurve(100n, 0n, s);
    expect(out).toBe(100n * 10n);
  });

  it('simBuyCurve - crosses multiple steps', () => {
    const s = steps([
      [10n, 1000n],
      [11n, 2000n],
    ]);
    // current 900, buy 300 => 100 in step1 (900->1000) + 200 in step2 (1000->1200)
    const out = simBuyCurve(300n, 900n, s);
    expect(out).toBe(100n * 10n + 200n * 11n);
  });

  it('simSellCurve - expected simple case within top step', () => {
    const s = steps([
      [10n, 1000n],
      [11n, 2000n],
    ]);
    // current 1500, sell 200 -> all within step2 at price 11
    const out = simSellCurve(200n, 1500n, s);
    expect(out).toBe(200n * 11n);
  });

  it('simSellCurve - spans multiple steps', () => {
    const s = steps([
      [10n, 1000n],
      [11n, 2000n],
    ]);
    // current 1050, sell 100 => 50 at price 11 (1050->1000), 50 at price 10 (1000->950)
    const out = simSellCurve(100n, 1050n, s);
    expect(out).toBe(50n * 11n + 50n * 10n);
  });

  it('simBuyCurve - edge: zero amount returns 0', () => {
    const s = steps([[10n, 1000n]]);
    expect(simBuyCurve(0n, 0n, s)).toBe(0n);
  });

  it('simSellCurve - edge: amount > supply returns 0', () => {
    const s = steps([[10n, 1000n]]);
    expect(simSellCurve(10n, 5n, s)).toBe(0n);
  });

  it('simBuyCurve - failure: no steps returns 0', () => {
    expect(simBuyCurve(10n, 0n, [])).toBe(0n);
  });

  it('simSellCurve - failure: no steps returns 0', () => {
    expect(simSellCurve(10n, 100n, [])).toBe(0n);
  });
});

describe('slippage helpers', () => {
  it('computeMinAfterSlippage reduces estimate by pct', () => {
    const est = 10000n; // wei-like
    const out = computeMinAfterSlippage(est, '10'); // 10%
    expect(out).toBe(9000n);
  });

  it('computeMaxWithSlippage increases cap by pct', () => {
    const est = 10000n;
    const out = computeMaxWithSlippage(est, '5'); // +5%
    expect(out).toBe(10500n);
  });

  it('handles invalid percent strings gracefully', () => {
    const est = 12345n;
    expect(computeMinAfterSlippage(est, 'abc')).toBe(est);
    expect(computeMaxWithSlippage(est, null)).toBe(est);
  });
});
