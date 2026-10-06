import { describe, it, expect } from "vitest";
import {
  Q96,
  bandsSoldFraction,
  deriveMarketState,
  liquidityAt,
  normalizeBands,
  quoteBuy,
  quoteSell,
  soldFraction,
  sqrtPriceX96AtTick,
} from "@/lib/v4PoolMath";

// Every constant below was emitted by REAL PoolManager swaps in
// packages/contracts/test/LaunchLiquidityPresets.t.sol:test_fixture_presetQuoteMathForFrontend
// (`forge test --match-test test_fixture_presetQuoteMathForFrontend -vv`): a Steady
// start launch (30% 1x-3x, 55% 3x-30x, 15% after) paired with ETH at a 1 ETH
// valuation, a 1% trade fee, no snipe tax, tick spacing 200; then router exact-in
// buys of 0.2 ETH and 3 ETH and an exact-in sell through the hook's fee. The second
// buy crosses the first band's edge (tick 196200), where the active liquidity
// changes. If these fail after a contracts change, re-run the fixture and update
// the numbers — do not loosen the tolerances.
const PRESET = {
  bands: [
    { tickLower: 196200, tickUpper: 207200, liquidity: 22473968353028949577470n },
    { tickLower: 173200, tickUpper: 196200, liquidity: 44208603119777946811819n },
    { tickLower: -887200, tickUpper: 173200, liquidity: 26018909033662068996986n },
  ],
  launchSqrt: 2500031419217008302293562112940196n,
  tradeFee: 10_000,
  tickSpacing: 200,
  buy1: {
    ethIn: 200000000000000000n,
    tokensOut: 154264034639256887034067517n,
    sqrtAfter: 1956199737401103767082063561059004n,
    activeLiquidityAfter: 22473968353028949577470n,
  },
  buy2: {
    ethIn: 3000000000000000000n,
    tokensOut: 565423289497079606208594334n,
    sqrtAfter: 690292389994002800887681888042503n,
    activeLiquidityAfter: 44208603119777946811819n,
  },
  sell: {
    tokensIn: 359843662068168246621330925n,
    ethOut: 2426241642891537441n,
    sqrtAfter: 1335183884548152640528417837924072n,
  },
};

const ONE_ETH = 10n ** 18n;
const WHOLE_SUPPLY = 1_000_000_000n;
const SUPPLY_RAW = WHOLE_SUPPLY * ONE_ETH;
const MIN_USABLE = -887200;
const MAX_USABLE = 887200;
const abs = (x) => (x < 0n ? -x : x);
const rel = (a, b) => Number(abs(a - b)) / Number(b);

const BANDS = normalizeBands(PRESET.bands);
/** The fixture pool as the buy panel passes it: ETH (quote) is currency0. */
const POOL = {
  bands: BANDS,
  tradeFee: PRESET.tradeFee,
  tickSpacing: PRESET.tickSpacing,
  sqrtLowerX96: sqrtPriceX96AtTick(MIN_USABLE),
  sqrtUpperX96: PRESET.launchSqrt,
};

describe("the preset fixture's ladder", () => {
  it("opens at the first band's upper edge", () => {
    expect(sqrtPriceX96AtTick(PRESET.bands[0].tickUpper)).toBe(PRESET.launchSqrt);
  });

  // amount1 = L·(√P_upper − √P_lower) / Q96: what each band held at launch.
  it("holds the preset's shares of the supply: 30%, 55%, 15%", () => {
    const held = BANDS.map((b) => Number((b.liquidity * (b.sqrtUpperX96 - b.sqrtLowerX96)) / Q96) / Number(SUPPLY_RAW));
    expect(held[0]).toBeCloseTo(0.3, 9);
    expect(held[1]).toBeCloseTo(0.55, 9);
    expect(held[2]).toBeCloseTo(0.15, 9);
  });
});

describe("multi-band quotes — against real v4 swaps", () => {
  it("matches the first buy exactly, inside the first band", () => {
    const q = quoteBuy({ ...POOL, sqrtPriceX96: PRESET.launchSqrt, quoteIn: PRESET.buy1.ethIn });
    expect(q.tokensOut).toBe(PRESET.buy1.tokensOut);
    expect(q.sqrtPriceAfter).toBe(PRESET.buy1.sqrtAfter);
    expect(q.exceedsRange).toBe(false);
    expect(q.fee).toBe(PRESET.buy1.ethIn / 100n);
    expect(liquidityAt(BANDS, q.sqrtPriceAfter, true)).toBe(PRESET.buy1.activeLiquidityAfter);
  });

  it("matches the second buy exactly — across the band edge and word edges", () => {
    const q = quoteBuy({ ...POOL, sqrtPriceX96: PRESET.buy1.sqrtAfter, quoteIn: PRESET.buy2.ethIn });
    expect(q.tokensOut).toBe(PRESET.buy2.tokensOut);
    expect(q.sqrtPriceAfter).toBe(PRESET.buy2.sqrtAfter);
    expect(liquidityAt(BANDS, q.sqrtPriceAfter, true)).toBe(PRESET.buy2.activeLiquidityAfter);
    // It really crossed: it started in the first band and ended below its lower edge.
    expect(PRESET.buy1.sqrtAfter).toBeGreaterThan(BANDS[0].sqrtLowerX96);
    expect(q.sqrtPriceAfter).toBeLessThan(BANDS[0].sqrtLowerX96);
  });

  it("matches the sell exactly, net of the hook's fee", () => {
    const q = quoteSell({ ...POOL, sqrtPriceX96: PRESET.buy2.sqrtAfter, tokensIn: PRESET.sell.tokensIn });
    expect(q.quoteOut).toBe(PRESET.sell.ethOut);
    expect(q.sqrtPriceAfter).toBe(PRESET.sell.sqrtAfter);
    expect(q.fee).toBe((q.quoteOut + q.fee + 99n) / 100n);
  });

  // The band edges are load-bearing: quoting the crossing buy as one position at
  // the first band's liquidity (the pre-preset assumption) is badly wrong.
  it("is not reproduced by a single position at the launch band's liquidity", () => {
    const single = quoteBuy({
      liquidity: BANDS[0].liquidity,
      tradeFee: PRESET.tradeFee,
      tickSpacing: PRESET.tickSpacing,
      sqrtLowerX96: POOL.sqrtLowerX96,
      sqrtUpperX96: POOL.sqrtUpperX96,
      sqrtPriceX96: PRESET.buy1.sqrtAfter,
      quoteIn: PRESET.buy2.ethIn,
    });
    expect(rel(single.tokensOut, PRESET.buy2.tokensOut)).toBeGreaterThan(0.01);
  });

  it("finds the ladder's span from the bands when the caller gives none", () => {
    const { sqrtLowerX96: _l, sqrtUpperX96: _u, ...bandsOnly } = POOL;
    const q = quoteBuy({ ...bandsOnly, sqrtPriceX96: PRESET.buy1.sqrtAfter, quoteIn: PRESET.buy2.ethIn });
    expect(q.tokensOut).toBe(PRESET.buy2.tokensOut);
  });

  it("never sells out — a huge buy stays in the last band and below the supply", () => {
    const q = quoteBuy({ ...POOL, sqrtPriceX96: PRESET.launchSqrt, quoteIn: 1_000_000n * ONE_ETH });
    expect(q.exceedsRange).toBe(false);
    expect(q.tokensOut).toBeLessThan(SUPPLY_RAW);
    expect(liquidityAt(BANDS, q.sqrtPriceAfter, true)).toBe(BANDS[2].liquidity);
  });

  it("caps a sell at the launch price, back through every band", () => {
    const q = quoteSell({ ...POOL, sqrtPriceX96: PRESET.buy2.sqrtAfter, tokensIn: SUPPLY_RAW });
    expect(q.exceedsRange).toBe(true);
    expect(q.sqrtPriceAfter).toBe(PRESET.launchSqrt);
  });
});

describe("liquidityAt", () => {
  it("is the band a swap moves into, on an edge", () => {
    const edge = BANDS[0].sqrtLowerX96;
    expect(liquidityAt(BANDS, edge, true)).toBe(BANDS[1].liquidity); // a buy, moving down
    expect(liquidityAt(BANDS, edge, false)).toBe(BANDS[0].liquidity); // a sell, moving up
    // At launch, a buy trades against the first band; nothing lies above it.
    expect(liquidityAt(BANDS, PRESET.launchSqrt, true)).toBe(BANDS[0].liquidity);
    expect(liquidityAt(BANDS, PRESET.launchSqrt, false)).toBe(0n);
  });
});

describe("supply sold, summed over the bands", () => {
  it("reads 0% at launch", () => {
    expect(bandsSoldFraction(PRESET.launchSqrt, BANDS)).toBeCloseTo(0, 9);
  });

  it("agrees with the tokens that actually left the pool after each trade", () => {
    const after1 = Number(PRESET.buy1.tokensOut) / Number(SUPPLY_RAW);
    const after2 = Number(PRESET.buy1.tokensOut + PRESET.buy2.tokensOut) / Number(SUPPLY_RAW);
    const afterSell = Number(PRESET.buy1.tokensOut + PRESET.buy2.tokensOut - PRESET.sell.tokensIn) / Number(SUPPLY_RAW);
    expect(bandsSoldFraction(PRESET.buy1.sqrtAfter, BANDS)).toBeCloseTo(after1, 6);
    expect(bandsSoldFraction(PRESET.buy2.sqrtAfter, BANDS)).toBeCloseTo(after2, 6);
    expect(bandsSoldFraction(PRESET.sell.sqrtAfter, BANDS)).toBeCloseTo(afterSell, 6);
  });

  it("reads exactly the first band's 30% at its lower edge (3×)", () => {
    expect(bandsSoldFraction(BANDS[0].sqrtLowerX96, BANDS)).toBeCloseTo(0.3, 9);
    expect(bandsSoldFraction(BANDS[1].sqrtLowerX96, BANDS)).toBeCloseTo(0.85, 9);
  });

  it("is soldFraction for one band", () => {
    const one = normalizeBands([{ tickLower: MIN_USABLE, tickUpper: 207200, liquidity: 5n }]);
    for (const sqrt of [PRESET.launchSqrt, PRESET.launchSqrt / 2n, PRESET.buy2.sqrtAfter]) {
      expect(bandsSoldFraction(sqrt, one)).toBe(soldFraction(sqrt, MIN_USABLE, 207200));
    }
  });
});

// The other orientation: the token is currency0, buys are oneForZero and move the
// price UP, and the ladder climbs from tickLower. No fixture swap exists for it, so
// a buy that crosses a band edge is checked against the SqrtPriceMath formulas by
// hand, and the whole fixture sequence against its mirror.
describe("token is currency0 — a buy across a band edge", () => {
  const MIRRORED = normalizeBands(
    PRESET.bands.map((b) => ({ tickLower: -b.tickUpper, tickUpper: b.tickLower === MIN_USABLE ? MAX_USABLE : -b.tickLower, liquidity: b.liquidity })),
  );
  const launch = MIRRORED[0].sqrtLowerX96;
  const MPOOL = {
    bands: MIRRORED,
    tokenIsCurrency0: true,
    sqrtLowerX96: launch,
    sqrtUpperX96: sqrtPriceX96AtTick(MAX_USABLE),
  };

  it("lays the mirrored bands end to end, climbing from the launch price", () => {
    expect(MIRRORED.map((b) => [b.tickLower, b.tickUpper])).toEqual([
      [-207200, -196200],
      [-196200, -173200],
      [-173200, MAX_USABLE],
    ]);
  });

  it("equals a direct computation: the first band to its edge, the rest in the second", () => {
    const quoteIn = 2n * ONE_ETH;
    const [b0, b1] = MIRRORED;
    const edge = b0.sqrtUpperX96;
    // getAmount1Delta(launch, edge, L0, roundUp): the quote that takes the price to the edge.
    const toEdge = (b0.liquidity * (edge - launch) + Q96 - 1n) / Q96;
    expect(toEdge).toBeLessThan(quoteIn);
    // getAmount0Delta(launch, edge, L0, roundDown): the tokens the first band pays out.
    const out0 = ((b0.liquidity << 96n) * (edge - launch)) / edge / launch;
    // getNextSqrtPriceFromAmount1RoundingDown in the second band, then its tokens.
    const next = edge + ((quoteIn - toEdge) << 96n) / b1.liquidity;
    const out1 = ((b1.liquidity << 96n) * (next - edge)) / next / edge;

    const q = quoteBuy({ ...MPOOL, sqrtPriceX96: launch, quoteIn });
    expect(q.sqrtPriceAfter).toBe(next);
    expect(q.tokensOut).toBe(out0 + out1);
    expect(q.exceedsRange).toBe(false);
  });

  it("matches the mirrored fixture sequence", () => {
    const pool = { ...MPOOL, tradeFee: PRESET.tradeFee, tickSpacing: PRESET.tickSpacing };
    const b1 = quoteBuy({ ...pool, sqrtPriceX96: launch, quoteIn: PRESET.buy1.ethIn });
    expect(rel(b1.tokensOut, PRESET.buy1.tokensOut)).toBeLessThan(1e-12);
    const b2 = quoteBuy({ ...pool, sqrtPriceX96: b1.sqrtPriceAfter, quoteIn: PRESET.buy2.ethIn });
    expect(rel(b2.tokensOut, PRESET.buy2.tokensOut)).toBeLessThan(1e-12);
    expect(liquidityAt(MIRRORED, b2.sqrtPriceAfter, false)).toBe(PRESET.buy2.activeLiquidityAfter);
    const s = quoteSell({ ...pool, sqrtPriceX96: b2.sqrtPriceAfter, tokensIn: PRESET.sell.tokensIn });
    expect(rel(s.quoteOut, PRESET.sell.ethOut)).toBeLessThan(1e-12);
    expect(bandsSoldFraction(b2.sqrtPriceAfter, MIRRORED, true)).toBeCloseTo(
      Number(PRESET.buy1.tokensOut + PRESET.buy2.tokensOut) / Number(SUPPLY_RAW),
      6,
    );
  });
});

describe("deriveMarketState with bands", () => {
  // The preset fixture's pool at its launch price: tick 207200, LP fee 0.
  const LAUNCH_WORD = "0x0000000000000000000329600000000000007b42d530bfeef6c84ca32f6118a4";
  const withSqrtPrice = (sqrt) => {
    const mask = (1n << 160n) - 1n;
    return `0x${((BigInt(LAUNCH_WORD) & ~mask) | sqrt).toString(16).padStart(64, "0")}`;
  };
  const placement = {
    tickLower: MIN_USABLE,
    tickUpper: 207200,
    liquidity: PRESET.bands[0].liquidity,
    tradeFee: PRESET.tradeFee,
    liquidityPreset: 1,
    key: { tickSpacing: PRESET.tickSpacing },
  };
  const base = { liquidityWord: "0x0", placement, bands: PRESET.bands, wholeSupply: WHOLE_SUPPLY };

  it("carries the bands, the preset and the launch band's liquidity at launch", () => {
    const m = deriveMarketState({ ...base, slot0Word: LAUNCH_WORD });
    expect(m.bands).toEqual(BANDS);
    expect(m.liquidityPreset).toBe(1);
    expect(m.liquidity).toBe(PRESET.bands[0].liquidity);
    expect(m.soldFraction).toBeCloseTo(0, 9);
    expect(m.multiple).toBe(1);
  });

  it("quotes the fixture's first buy from the market as the buy panel does", () => {
    const m = deriveMarketState({ ...base, slot0Word: LAUNCH_WORD });
    const q = quoteBuy({
      sqrtPriceX96: m.sqrtPriceX96,
      bands: m.bands,
      liquidity: m.liquidity,
      sqrtLowerX96: m.sqrtLowerX96,
      sqrtUpperX96: m.sqrtUpperX96,
      tickSpacing: m.tickSpacing,
      tradeFee: m.tradeFee,
      quoteIn: PRESET.buy1.ethIn,
    });
    expect(q.tokensOut).toBe(PRESET.buy1.tokensOut);
  });

  it("reads supply sold over every band after the buys", () => {
    const m = deriveMarketState({
      ...base,
      slot0Word: withSqrtPrice(PRESET.buy2.sqrtAfter),
      liquidityWord: `0x${PRESET.buy2.activeLiquidityAfter.toString(16)}`,
    });
    expect(m.liquidity).toBe(PRESET.buy2.activeLiquidityAfter);
    expect(m.soldFraction).toBeCloseTo(Number(PRESET.buy1.tokensOut + PRESET.buy2.tokensOut) / Number(SUPPLY_RAW), 6);
  });

  // A placer from before presets has no bandsOf: its one position is the placement.
  it("falls back to the placement's single range without bands", () => {
    for (const bands of [null, undefined, []]) {
      const m = deriveMarketState({ ...base, bands, placement: { ...placement, liquidityPreset: undefined }, slot0Word: LAUNCH_WORD });
      expect(m.bands).toEqual(normalizeBands([{ tickLower: MIN_USABLE, tickUpper: 207200, liquidity: placement.liquidity }]));
      expect(m.liquidityPreset).toBeNull();
    }
  });
});
