import { describe, it, expect } from "vitest";
import {
  Q96,
  poolStateSlot,
  poolLiquiditySlot,
  decodeSlot0,
  tradableLiquidity,
  pricePerToken,
  fdvAt,
  multipleSinceLaunch,
  soldFraction,
  sqrtPriceX96AtTick,
  tokensToQuote,
  quoteBuy,
  quoteSell,
  minimumReceived,
  deriveMarketState,
  swapFeeFor,
  tradeFeeOn,
  MAX_TRADE_FEE,
} from "@/lib/v4PoolMath";

// Every constant below was emitted by a REAL PoolManager swap in
// packages/contracts/test/UniV4LiquidityPlacer.t.sol:test_fixture_quoteMathForFrontend
// (`forge test --match-test test_fixture_quoteMathForFrontend -vv`).
// An ETH launch at a 1 ETH FDV (a 1% trade fee taken by the placer as the pool's
// hook, LP fee 0, tick spacing 200, range [minUsableTick, tickUpper]), then a
// 0.1 ETH buy, a 1 ETH buy, and a sale of half the second buy's tokens. If any
// of these tests fail after a contracts change, re-run the fixture and update
// the numbers — do not loosen the tolerances.
//
// The pool key carries the placer as its hook, so the poolId (and with it the
// state slot) changes with the placer's address: the fixture prints both, and
// poolStateSlot() is checked against that pair alone.
const FIX = {
  poolId: "0xb826ba3cd87f6c1f69ce2cd36194eb7ef645c081f006d74489b4cf463239f73f",
  poolStateSlot: "0x0a3428b771fd3ceb735dbb12c030187f7340a858597ac2a62a64ffed29c52855",
  slot0Word: "0x0000000000000000000329600000000000007b42d530bfeef6c84ca32f6118a4",
  placementLiquidity: 31690866724818211737594n,
  tickLower: -887200,
  tickUpper: 207200,
  launchSqrt: 2500031419217008302293562112940196n,
  launchTick: 207200,
  lpFee: 0,
  tradeFee: 10_000,
  tickSpacing: 200,
  buy1: {
    ethIn: 100000000000000000n,
    tokensOut: 89729910215527505885256588n,
    sqrtAfter: 2275703824434668340440887773871330n,
  },
  buy2: {
    ethIn: 1000000000000000000n,
    tokensOut: 430498561536536844228747640n,
    sqrtAfter: 1199443894665599551439045032215605n,
  },
  sell: {
    tokensIn: 215249280768268422114373820n,
    ethOut: 641819427148231841n,
    sqrtAfter: 1737573859550133945939966401206119n,
  },
};

const WHOLE_SUPPLY = 1_000_000_000n;
const ONE_ETH = 10n ** 18n;
const SUPPLY_RAW = WHOLE_SUPPLY * ONE_ETH;
const abs = (x) => (x < 0n ? -x : x);
const rel = (a, b) => Number(abs(a - b)) / Number(b);

const SQRT_LOWER = sqrtPriceX96AtTick(FIX.tickLower);
/** The fixture pool as quoteBuy / quoteSell take it, ETH (quote) as currency0. */
const POOL = {
  liquidity: FIX.placementLiquidity,
  tradeFee: FIX.tradeFee,
  tickSpacing: FIX.tickSpacing,
  sqrtLowerX96: SQRT_LOWER,
  sqrtUpperX96: FIX.launchSqrt,
};

describe("reading pool state", () => {
  it("derives the same pool-state slot as StateLibrary", () => {
    expect(poolStateSlot(FIX.poolId)).toBe(FIX.poolStateSlot);
  });

  it("puts liquidity three slots past the state slot", () => {
    expect(BigInt(poolLiquiditySlot(FIX.poolId))).toBe(BigInt(FIX.poolStateSlot) + 3n);
  });

  it("unpacks the raw slot0 word exactly as getSlot0 does", () => {
    const s = decodeSlot0(FIX.slot0Word);
    expect(s.sqrtPriceX96).toBe(FIX.launchSqrt);
    expect(s.tick).toBe(FIX.launchTick);
    expect(s.lpFee).toBe(FIX.lpFee);
    expect(s.protocolFee).toBe(0);
  });

  it("sign-extends a negative tick", () => {
    // tick = -1 in the 24-bit field, nothing else set
    const word = (0xffffffn << 160n).toString(16);
    expect(decodeSlot0(`0x${word}`).tick).toBe(-1);
  });
});

describe("sqrtPriceX96AtTick — exact TickMath port", () => {
  // The pool was initialised AT tickUpper, so its launch sqrtPrice IS
  // TickMath.getSqrtPriceAtTick(tickUpper). Bit-for-bit, not approximately.
  it("reproduces the pool's own launch price exactly", () => {
    expect(sqrtPriceX96AtTick(FIX.tickUpper)).toBe(FIX.launchSqrt);
  });

  it("is 2^96 at tick 0", () => {
    expect(sqrtPriceX96AtTick(0)).toBe(Q96);
  });

  it("matches TickMath's published bounds", () => {
    // TickMath.MIN_SQRT_PRICE / MAX_SQRT_PRICE
    expect(sqrtPriceX96AtTick(-887272)).toBe(4295128739n);
    expect(sqrtPriceX96AtTick(887272)).toBe(1461446703485210103287273052203988822378723970342n);
  });

  it("rejects ticks outside the valid range", () => {
    expect(() => sqrtPriceX96AtTick(887273)).toThrow(RangeError);
  });
});

describe("tradableLiquidity", () => {
  // The trap: at launch v4 reports active liquidity 0, because an ETH launch's
  // price sits exactly on the upper edge of a [lower, upper) range. The first buy
  // crosses that edge for free and then trades against the whole position.
  it("uses the position's liquidity at launch, when v4 reports 0 active", () => {
    expect(tradableLiquidity({ activeLiquidity: 0n, placementLiquidity: FIX.placementLiquidity })).toBe(
      FIX.placementLiquidity,
    );
  });

  it("uses active liquidity once the position is in range", () => {
    expect(tradableLiquidity({ activeLiquidity: 5n, placementLiquidity: FIX.placementLiquidity })).toBe(5n);
  });
});

describe("quoteBuy — against real v4 swaps", () => {
  it("matches the first buy from launch exactly", () => {
    const q = quoteBuy({ ...POOL, sqrtPriceX96: FIX.launchSqrt, quoteIn: FIX.buy1.ethIn });
    expect(q.tokensOut).toBe(FIX.buy1.tokensOut);
    expect(q.sqrtPriceAfter).toBe(FIX.buy1.sqrtAfter);
    expect(q.exceedsRange).toBe(false);
    // 1% of the gross 0.1 ETH, in ETH.
    expect(q.fee).toBe(FIX.buy1.ethIn / 100n);
  });

  // This buy crosses the tick-bitmap word edge at tick 204800, where v4 ends a
  // step and snaps sqrtPrice to TickMath's exact value; the quote steps there too.
  it("matches a second, larger buy exactly — across a word edge", () => {
    const q = quoteBuy({ ...POOL, sqrtPriceX96: FIX.buy1.sqrtAfter, quoteIn: FIX.buy2.ethIn });
    expect(q.tokensOut).toBe(FIX.buy2.tokensOut);
    expect(q.sqrtPriceAfter).toBe(FIX.buy2.sqrtAfter);
  });

  // Without the tick spacing the swap is one step: off by rounding at the edge,
  // far below anything the UI displays.
  it("quotes one step without a tick spacing, within 1e-15 of v4", () => {
    const { tickSpacing: _omit, ...oneStep } = POOL;
    const q = quoteBuy({ ...oneStep, sqrtPriceX96: FIX.buy1.sqrtAfter, quoteIn: FIX.buy2.ethIn });
    expect(rel(q.tokensOut, FIX.buy2.tokensOut)).toBeLessThan(1e-15);
  });

  it("reports price impact that grows with size", () => {
    const small = quoteBuy({ ...POOL, sqrtPriceX96: FIX.launchSqrt, quoteIn: ONE_ETH / 100n });
    const big = quoteBuy({ ...POOL, sqrtPriceX96: FIX.launchSqrt, quoteIn: ONE_ETH });
    expect(small.priceImpact).toBeGreaterThan(0);
    expect(big.priceImpact).toBeGreaterThan(small.priceImpact);
  });

  // The range runs to the end of v4's price scale: even a buy of a million times
  // the launch valuation stays inside it and never takes the whole supply.
  it("never sells out — a huge buy stays in range and below the supply", () => {
    const q = quoteBuy({ ...POOL, sqrtPriceX96: FIX.launchSqrt, quoteIn: 1_000_000n * ONE_ETH });
    expect(q.exceedsRange).toBe(false);
    expect(q.tokensOut).toBeLessThan(SUPPLY_RAW);
    expect(q.tokensOut).toBeGreaterThan((SUPPLY_RAW * 99n) / 100n);
  });

  it("caps a buy at the range floor when it would cross it", () => {
    // Start a hair above the floor, where a modest buy runs past it.
    const start = SQRT_LOWER * 2n;
    const q = quoteBuy({ ...POOL, sqrtPriceX96: start, quoteIn: 10n ** 45n });
    expect(q.exceedsRange).toBe(true);
    expect(q.sqrtPriceAfter).toBe(SQRT_LOWER);
    expect(q.tokensOut).toBeLessThanOrEqual(SUPPLY_RAW);
  });

  it("returns an empty quote for zero, negative or missing input", () => {
    const base = { ...POOL, sqrtPriceX96: FIX.launchSqrt };
    expect(quoteBuy({ ...base, quoteIn: 0n }).tokensOut).toBe(0n);
    expect(quoteBuy({ ...base, quoteIn: -1n }).tokensOut).toBe(0n);
    expect(quoteBuy({ ...base, liquidity: 0n, quoteIn: ONE_ETH }).tokensOut).toBe(0n);
  });

  it("quotes nothing — never a negative amount — once the price sits on the floor", () => {
    for (const sqrtPriceX96 of [SQRT_LOWER, SQRT_LOWER - 1n]) {
      const q = quoteBuy({ ...POOL, sqrtPriceX96, quoteIn: ONE_ETH });
      expect(q.tokensOut).toBe(0n);
      expect(q.exceedsRange).toBe(true);
    }
  });
});

describe("quoteSell — against a real v4 swap", () => {
  it("matches the sell exactly", () => {
    const q = quoteSell({ ...POOL, sqrtPriceX96: FIX.buy2.sqrtAfter, tokensIn: FIX.sell.tokensIn });
    expect(q.quoteOut).toBe(FIX.sell.ethOut);
    expect(q.sqrtPriceAfter).toBe(FIX.sell.sqrtAfter);
    // The fee is 1% of what the pool paid, rounded up: the seller got the rest.
    const gross = q.quoteOut + q.fee;
    expect(q.fee).toBe((gross + 99n) / 100n);
  });

  it("caps a sell at the launch price — there is no liquidity above it", () => {
    const q = quoteSell({ ...POOL, sqrtPriceX96: FIX.buy1.sqrtAfter, tokensIn: SUPPLY_RAW });
    expect(q.exceedsRange).toBe(true);
    expect(q.sqrtPriceAfter).toBe(FIX.launchSqrt);
  });

  it("quotes nothing at the launch price — the pool holds no ETH yet", () => {
    const q = quoteSell({ ...POOL, sqrtPriceX96: FIX.launchSqrt, tokensIn: ONE_ETH });
    expect(q.quoteOut).toBe(0n);
  });
});

describe("price, valuation and progress", () => {
  it("prices the launch at about 1 gwei per token — 1 ETH FDV, tick-aligned", () => {
    const p = pricePerToken(FIX.launchSqrt);
    // The placer snaps the start to a tick on the dearer side, within one spacing (~2%).
    expect(p).toBeGreaterThanOrEqual(1_000_000_000n);
    expect(p).toBeLessThan(1_021_000_000n);
  });

  it("values the launch at about 1 ETH FDV", () => {
    const f = fdvAt(FIX.launchSqrt, WHOLE_SUPPLY);
    expect(f).toBeGreaterThanOrEqual(ONE_ETH);
    expect(f).toBeLessThan((ONE_ETH * 1021n) / 1000n);
  });

  it("agrees with price × supply to within the price's flooring", () => {
    const f = fdvAt(FIX.launchSqrt, WHOLE_SUPPLY);
    const fromPrice = pricePerToken(FIX.launchSqrt) * WHOLE_SUPPLY;
    expect(f - fromPrice).toBeGreaterThanOrEqual(0n);
    expect(f - fromPrice).toBeLessThan(WHOLE_SUPPLY);
  });

  // Measured from the launch sqrtPrice rather than the requested start price,
  // so tick alignment cannot make a brand-new token read 1.004×.
  it("reads exactly 1× at launch", () => {
    expect(multipleSinceLaunch(FIX.launchSqrt, FIX.launchSqrt)).toBe(1);
  });

  it("rises as buys push the price", () => {
    const after1 = multipleSinceLaunch(FIX.buy1.sqrtAfter, FIX.launchSqrt);
    const after2 = multipleSinceLaunch(FIX.buy2.sqrtAfter, FIX.launchSqrt);
    expect(after1).toBeGreaterThan(1);
    expect(after2).toBeGreaterThan(after1);
  });

  it("reads 0% sold at launch", () => {
    expect(soldFraction(FIX.launchSqrt, FIX.tickLower, FIX.tickUpper)).toBeCloseTo(0, 6);
  });

  // The strongest check: sold fraction is derived from price alone, and must
  // agree with the tokens that ACTUALLY left the pool in the real swap.
  it("agrees with the tokens that actually left the pool after the first buy", () => {
    const fromPrice = soldFraction(FIX.buy1.sqrtAfter, FIX.tickLower, FIX.tickUpper);
    const fromSwap = Number(FIX.buy1.tokensOut) / Number(SUPPLY_RAW);
    expect(fromPrice).toBeCloseTo(fromSwap, 4);
  });

  it("agrees again after both buys", () => {
    const fromPrice = soldFraction(FIX.buy2.sqrtAfter, FIX.tickLower, FIX.tickUpper);
    const fromSwap = Number(FIX.buy1.tokensOut + FIX.buy2.tokensOut) / Number(SUPPLY_RAW);
    expect(fromPrice).toBeCloseTo(fromSwap, 4);
  });

  // With the range running to the end of the price scale, half the supply has
  // sold at 4x the launch price (sqrtPrice halved).
  it("reads half sold at 4× the launch price", () => {
    expect(soldFraction(FIX.launchSqrt / 2n, FIX.tickLower, FIX.tickUpper)).toBeCloseTo(0.5, 6);
  });

  it("clamps outside the range", () => {
    expect(soldFraction(FIX.launchSqrt * 2n, FIX.tickLower, FIX.tickUpper)).toBe(0);
    expect(soldFraction(1n, FIX.tickLower, FIX.tickUpper)).toBe(1);
  });

  it("values tokens in the quote at the market price", () => {
    const m = deriveMarketState({
      slot0Word: FIX.slot0Word,
      liquidityWord: "0x0",
      placement: { tickLower: FIX.tickLower, tickUpper: FIX.tickUpper, liquidity: FIX.placementLiquidity },
      wholeSupply: WHOLE_SUPPLY,
    });
    expect(tokensToQuote(SUPPLY_RAW, m)).toBe(m.fdv);
    expect(tokensToQuote(SUPPLY_RAW / 2n, m)).toBe(m.fdv / 2n);
    expect(tokensToQuote(1n, null)).toBeNull();
  });
});

describe("minimumReceived", () => {
  it("applies slippage in percent", () => {
    expect(minimumReceived(10_000n, "1")).toBe(9_900n);
    expect(minimumReceived(10_000n, "0.5")).toBe(9_950n);
    expect(minimumReceived(10_000n, "")).toBe(10_000n);
  });
});

it("Q96 is 2^96", () => {
  expect(Q96).toBe(79228162514264337593543950336n);
});

describe("deriveMarketState", () => {
  const placement = { tickLower: FIX.tickLower, tickUpper: FIX.tickUpper, liquidity: FIX.placementLiquidity };
  const ETH = { address: "0x0000000000000000000000000000000000000000", symbol: "ETH", decimals: 18 };

  it("reads a fresh launch as 1x, 0% sold, about 1 ETH FDV, and tradable", () => {
    const m = deriveMarketState({ slot0Word: FIX.slot0Word, liquidityWord: "0x0", placement, wholeSupply: WHOLE_SUPPLY, quote: ETH });
    expect(m.multiple).toBe(1);
    expect(m.soldFraction).toBeCloseTo(0, 6);
    expect(m.fdv).toBe(m.launchFdv);
    // v4 reports 0 active liquidity here; the state must carry the tradable amount.
    expect(m.liquidity).toBe(FIX.placementLiquidity);
    expect(m.launchSqrtX96).toBe(FIX.launchSqrt);
    expect(m.tokenIsCurrency0).toBe(false);
    expect(m.quote).toBe(ETH);
  });

  it("carries the pool's actual launch price, consistent with the launch FDV", () => {
    const m = deriveMarketState({ slot0Word: FIX.slot0Word, liquidityWord: "0x0", placement, wholeSupply: WHOLE_SUPPLY });
    // Untraded: the pool sits exactly at its launch price.
    expect(m.launchPrice).toBe(m.price);
    expect(m.launchFdv - m.launchPrice * WHOLE_SUPPLY).toBeLessThan(WHOLE_SUPPLY);
    expect(m.totalSupplyRaw).toBe(SUPPLY_RAW);
  });

  it("returns null for an uninitialised pool", () => {
    expect(deriveMarketState({ slot0Word: "0x0", liquidityWord: "0x0", placement, wholeSupply: WHOLE_SUPPLY })).toBeNull();
    expect(deriveMarketState({ slot0Word: FIX.slot0Word, liquidityWord: "0x0", placement: null, wholeSupply: WHOLE_SUPPLY })).toBeNull();
  });
});

describe("swapFeeFor", () => {
  it("is the LP fee alone when no protocol fee is set", () => {
    expect(swapFeeFor(0, 10_000, true)).toBe(10_000);
    expect(swapFeeFor(0, 10_000, false)).toBe(10_000);
  });

  it("combines LP and directional protocol fee as v4's ProtocolFeeLibrary does", () => {
    // 0.1% protocol fee for zeroForOne (low 12 bits), 0.2% for oneForZero (high 12 bits), 1% LP fee.
    const protocolFee = (2_000 << 12) | 1_000;
    expect(swapFeeFor(protocolFee, 10_000, true)).toBe(1_000 + 10_000 - Math.floor((1_000 * 10_000) / 1_000_000));
    expect(swapFeeFor(protocolFee, 10_000, false)).toBe(2_000 + 10_000 - Math.floor((2_000 * 10_000) / 1_000_000));
  });
});

/** The fixture's slot0 word with its protocolFee field set to 0.1% zeroForOne / 0.2% oneForZero. */
const withProtocolFee = (word) => {
  const w = BigInt(word);
  const mask = ((1n << 24n) - 1n) << 184n;
  return `0x${((w & ~mask) | (BigInt((2_000 << 12) | 1_000) << 184n)).toString(16).padStart(64, "0")}`;
};

describe("deriveMarketState fees", () => {
  const placement = {
    tickLower: FIX.tickLower,
    tickUpper: FIX.tickUpper,
    liquidity: FIX.placementLiquidity,
    tradeFee: FIX.tradeFee,
    key: { tickSpacing: FIX.tickSpacing },
  };

  it("carries the launch's trade fee and tick spacing from its placement", () => {
    const m = deriveMarketState({ slot0Word: FIX.slot0Word, liquidityWord: "0x0", placement, wholeSupply: WHOLE_SUPPLY });
    expect(m.tradeFee).toBe(10_000);
    expect(m.tickSpacing).toBe(200);
    // Launch pools have no LP fee: v4 itself charges nothing inside the swap.
    expect(m.buySwapFee).toBe(0);
    expect(m.sellSwapFee).toBe(0);
  });

  it("charges buys the zeroForOne protocol fee when the quote is currency0", () => {
    const m = deriveMarketState({ slot0Word: withProtocolFee(FIX.slot0Word), liquidityWord: "0x0", placement, wholeSupply: WHOLE_SUPPLY });
    expect(m.buySwapFee).toBe(1_000);
    expect(m.sellSwapFee).toBe(2_000);
    expect(m.tradeFee).toBe(10_000);
  });
});

// The hook's fee on the quote side, at a launch's own rate. Compared against a
// direct computation: the same swap with no trade fee, and the fee by hand.
describe("trade fee — in the quote, at the launch's rate", () => {
  const RATE = 25_000; // 2.5%
  const ceilFee = (amount) => (amount * BigInt(RATE) + 999_999n) / 1_000_000n;

  it("rounds the fee up, like FullMath.mulDivRoundingUp", () => {
    expect(tradeFeeOn(1_000_000n, 10_000)).toBe(10_000n);
    expect(tradeFeeOn(1_000_001n, 10_000)).toBe(10_001n);
    expect(tradeFeeOn(1n, 5_000)).toBe(1n);
    expect(tradeFeeOn(123n, 0)).toBe(0n);
    expect(tradeFeeOn(0n, 10_000)).toBe(0n);
    expect(MAX_TRADE_FEE).toBe(100_000);
  });

  const orientations = [
    ["the quote is currency0 (ETH)", { ...POOL, tradeFee: RATE }, FIX.launchSqrt, FIX.buy2.sqrtAfter],
    [
      "the token is currency0",
      {
        liquidity: FIX.placementLiquidity,
        tradeFee: RATE,
        tickSpacing: FIX.tickSpacing,
        sqrtLowerX96: sqrtPriceX96AtTick(-FIX.tickUpper),
        sqrtUpperX96: sqrtPriceX96AtTick(887200),
        tokenIsCurrency0: true,
      },
      sqrtPriceX96AtTick(-FIX.tickUpper),
      null,
    ],
  ];

  for (const [name, pool, launchSqrt, tradedSqrt] of orientations) {
    describe(name, () => {
      // Somewhere with quote in the pool to sell back into.
      const traded =
        tradedSqrt ?? quoteBuy({ ...pool, tradeFee: 0, sqrtPriceX96: launchSqrt, quoteIn: 2n * ONE_ETH }).sqrtPriceAfter;

      it("a buy swaps the gross amount less the fee", () => {
        const gross = 333_333_333_333_333_333n;
        const q = quoteBuy({ ...pool, sqrtPriceX96: launchSqrt, quoteIn: gross });
        const fee = ceilFee(gross);
        const direct = quoteBuy({ ...pool, tradeFee: 0, sqrtPriceX96: launchSqrt, quoteIn: gross - fee });
        expect(q.fee).toBe(fee);
        expect(q.tokensOut).toBe(direct.tokensOut);
        expect(q.sqrtPriceAfter).toBe(direct.sqrtPriceAfter);
        expect(q.tokensOut).toBeLessThan(quoteBuy({ ...pool, tradeFee: 0, sqrtPriceX96: launchSqrt, quoteIn: gross }).tokensOut);
      });

      it("a sell pays out the pool's amount less the fee", () => {
        const tokensIn = 77_777_777_777_777_777_777_777n;
        const q = quoteSell({ ...pool, sqrtPriceX96: traded, tokensIn });
        const gross = quoteSell({ ...pool, tradeFee: 0, sqrtPriceX96: traded, tokensIn }).quoteOut;
        expect(gross).toBeGreaterThan(0n);
        expect(q.fee).toBe(ceilFee(gross));
        expect(q.quoteOut).toBe(gross - ceilFee(gross));
        // The fee does not move the pool: it is taken outside the swap.
        expect(q.sqrtPriceAfter).toBe(quoteSell({ ...pool, tradeFee: 0, sqrtPriceX96: traded, tokensIn }).sqrtPriceAfter);
      });

      it("a buy too small to be more than its fee quotes nothing (SwapTooSmallForFee)", () => {
        const q = quoteBuy({ ...pool, sqrtPriceX96: launchSqrt, quoteIn: 1n });
        expect(q.tokensOut).toBe(0n);
        expect(q.fee).toBe(0n);
      });
    });
  }

  it("a buy the range cannot fill in full quotes nothing when a fee is charged (PartialFillWithFee)", () => {
    const start = SQRT_LOWER * 2n;
    const q = quoteBuy({ ...POOL, sqrtPriceX96: start, quoteIn: 10n ** 45n });
    expect(q.exceedsRange).toBe(true);
    expect(q.tokensOut).toBe(0n);
    expect(q.fee).toBe(0n);
  });

  it("a sell capped at the launch price fills partly, with the fee on what the pool paid", () => {
    const q = quoteSell({ ...POOL, sqrtPriceX96: FIX.buy1.sqrtAfter, tokensIn: SUPPLY_RAW });
    const gross = quoteSell({ ...POOL, tradeFee: 0, sqrtPriceX96: FIX.buy1.sqrtAfter, tokensIn: SUPPLY_RAW }).quoteOut;
    expect(q.exceedsRange).toBe(true);
    expect(q.fee).toBe((gross + 99n) / 100n);
    expect(q.quoteOut).toBe(gross - q.fee);
  });
});

// Pools are permissionless for swaps: a zero-amount swap moves the price out of the
// position's range for free. The router then crosses back to the range edge at no
// cost and fills exactly as before, so the quote must too — or the minimum-out
// built from it reverts every in-app trade.
describe("a price pushed outside the range", () => {
  const PUSHED_ABOVE = sqrtPriceX96AtTick(253200);
  const placement = { tickLower: FIX.tickLower, tickUpper: FIX.tickUpper, liquidity: FIX.placementLiquidity };
  const withSqrtPrice = (sqrt) => {
    const word = BigInt(FIX.slot0Word);
    const mask = (1n << 160n) - 1n;
    return `0x${((word & ~mask) | sqrt).toString(16).padStart(64, "0")}`;
  };

  it("a buy is quoted from the launch price — exactly the router's fill", () => {
    const q = quoteBuy({ ...POOL, sqrtPriceX96: PUSHED_ABOVE, quoteIn: FIX.buy1.ethIn });
    expect(q.tokensOut).toBe(FIX.buy1.tokensOut);
    expect(q.sqrtPriceAfter).toBe(FIX.buy1.sqrtAfter);
  });

  it("a sell is quoted from the floor", () => {
    const base = { ...POOL, tokensIn: 10n ** 24n };
    const fromFloor = quoteSell({ ...base, sqrtPriceX96: SQRT_LOWER });
    const pushedBelow = quoteSell({ ...base, sqrtPriceX96: SQRT_LOWER - 1n });
    expect(pushedBelow.quoteOut).toBe(fromFloor.quoteOut);
  });

  it("the market reads the launch price, not the pushed one", () => {
    const m = deriveMarketState({ slot0Word: withSqrtPrice(PUSHED_ABOVE), liquidityWord: "0x0", placement, wholeSupply: WHOLE_SUPPLY });
    expect(m.sqrtPriceX96).toBe(FIX.launchSqrt);
    expect(m.multiple).toBe(1);
    expect(m.fdv).toBe(m.launchFdv);
  });

  it("the market reads the floor when pushed below it", () => {
    const m = deriveMarketState({ slot0Word: withSqrtPrice(SQRT_LOWER - 1n), liquidityWord: "0x0", placement, wholeSupply: WHOLE_SUPPLY });
    expect(m.sqrtPriceX96).toBe(SQRT_LOWER);
  });
});

// ---------------------------------------------------------------------------
// The other orientation: an ERC-20 quote whose address sorts ABOVE the launch
// token makes the TOKEN currency0. v4's price is then quote per token, the
// position is [tickLower, maxUsableTick], the pool opens at tickLower and buys
// move the price UP (oneForZero).
//
// No fixture swap exists for it, so it is pinned against the ETH fixture by
// symmetry: the same launch with the ticks negated is the same market seen from
// the other side. Negating a tick inverts its sqrtPrice (TickMath rounds each
// to within a unit of 1/2^96), so every amount must agree with the real swap to
// far below display precision, and every rule that depends on direction must
// come out mirrored.
// ---------------------------------------------------------------------------
describe("token is currency0 — mirrored against the ETH fixture", () => {
  const M = {
    tickLower: -FIX.tickUpper, // -207200: the launch price
    tickUpper: 887200, // maxUsableTick for spacing 200
    liquidity: FIX.placementLiquidity,
  };
  const launch = sqrtPriceX96AtTick(M.tickLower);
  const upper = sqrtPriceX96AtTick(M.tickUpper);
  const MPOOL = {
    liquidity: M.liquidity,
    tradeFee: FIX.tradeFee,
    tickSpacing: FIX.tickSpacing,
    sqrtLowerX96: launch,
    sqrtUpperX96: upper,
    tokenIsCurrency0: true,
  };
  const placement = { ...M, tokenIsCurrency0: true };
  // A slot0 word at the launch price: tick -207200, lpFee 0 (the fee is the hook's).
  const launchWord = (() => {
    const tick = BigInt(M.tickLower) & 0xffffffn;
    return `0x${((tick << 160n) | launch).toString(16).padStart(64, "0")}`;
  })();
  const USDC = { address: "0xffffffffffffffffffffffffffffffffffffffff", symbol: "USDC", decimals: 6 };

  it("opens at the inverse of the ETH launch price", () => {
    // sqrtA * sqrtB / 2^192 == 1 to within TickMath's rounding.
    const product = Number((launch * FIX.launchSqrt) / Q96) / Number(Q96);
    expect(product).toBeCloseTo(1, 12);
  });

  it("a buy matches the mirrored real swap and moves the price UP", () => {
    const q = quoteBuy({ ...MPOOL, sqrtPriceX96: launch, quoteIn: FIX.buy1.ethIn });
    expect(rel(q.tokensOut, FIX.buy1.tokensOut)).toBeLessThan(1e-12);
    expect(q.sqrtPriceAfter).toBeGreaterThan(launch);
    expect(q.exceedsRange).toBe(false);
  });

  it("a second buy and the sell match the mirrored swaps", () => {
    const b1 = quoteBuy({ ...MPOOL, sqrtPriceX96: launch, quoteIn: FIX.buy1.ethIn });
    const b2 = quoteBuy({ ...MPOOL, sqrtPriceX96: b1.sqrtPriceAfter, quoteIn: FIX.buy2.ethIn });
    expect(rel(b2.tokensOut, FIX.buy2.tokensOut)).toBeLessThan(1e-12);
    const s = quoteSell({ ...MPOOL, sqrtPriceX96: b2.sqrtPriceAfter, tokensIn: FIX.sell.tokensIn });
    expect(rel(s.quoteOut, FIX.sell.ethOut)).toBeLessThan(1e-12);
    // Selling moves it back DOWN, toward launch.
    expect(s.sqrtPriceAfter).toBeLessThan(b2.sqrtPriceAfter);
    expect(s.sqrtPriceAfter).toBeGreaterThan(launch);
  });

  it("is monotonic: more quote in buys more tokens at a higher price", () => {
    let last = { tokensOut: 0n, sqrtPriceAfter: launch };
    for (const quoteIn of [ONE_ETH / 100n, ONE_ETH / 10n, ONE_ETH, 10n * ONE_ETH]) {
      const q = quoteBuy({ ...MPOOL, sqrtPriceX96: launch, quoteIn });
      expect(q.tokensOut).toBeGreaterThan(last.tokensOut);
      expect(q.sqrtPriceAfter).toBeGreaterThan(last.sqrtPriceAfter);
      last = q;
    }
  });

  it("a round trip never returns more than it cost", () => {
    const b = quoteBuy({ ...MPOOL, sqrtPriceX96: launch, quoteIn: ONE_ETH });
    const s = quoteSell({ ...MPOOL, sqrtPriceX96: b.sqrtPriceAfter, tokensIn: b.tokensOut });
    expect(s.quoteOut).toBeLessThan(ONE_ETH);
    // Two 1% trade fees, and nothing else lost.
    expect(Number(s.quoteOut) / Number(ONE_ETH)).toBeGreaterThan(0.97);
  });

  it("quotes no sell at the launch price, and a sell larger than the pool's quote is capped there", () => {
    expect(quoteSell({ ...MPOOL, sqrtPriceX96: launch, tokensIn: ONE_ETH }).quoteOut).toBe(0n);
    const b = quoteBuy({ ...MPOOL, sqrtPriceX96: launch, quoteIn: FIX.buy1.ethIn });
    const s = quoteSell({ ...MPOOL, sqrtPriceX96: b.sqrtPriceAfter, tokensIn: SUPPLY_RAW });
    expect(s.exceedsRange).toBe(true);
    expect(s.sqrtPriceAfter).toBe(launch);
  });

  it("quotes from the launch price when the pool is pushed below it", () => {
    const fromLaunch = quoteBuy({ ...MPOOL, sqrtPriceX96: launch, quoteIn: FIX.buy1.ethIn });
    const pushed = quoteBuy({ ...MPOOL, sqrtPriceX96: launch / 3n, quoteIn: FIX.buy1.ethIn });
    expect(pushed.tokensOut).toBe(fromLaunch.tokensOut);
  });

  it("prices, values and progresses from the other side", () => {
    const b = quoteBuy({ ...MPOOL, sqrtPriceX96: launch, quoteIn: FIX.buy1.ethIn });
    // Price and FDV invert: quote per token rather than token per quote.
    expect(rel(pricePerToken(launch, true), pricePerToken(FIX.launchSqrt))).toBeLessThan(1e-9);
    expect(rel(fdvAt(launch, WHOLE_SUPPLY, true), fdvAt(FIX.launchSqrt, WHOLE_SUPPLY))).toBeLessThan(1e-9);
    expect(multipleSinceLaunch(launch, launch, true)).toBe(1);
    expect(multipleSinceLaunch(b.sqrtPriceAfter, launch, true)).toBeCloseTo(
      multipleSinceLaunch(FIX.buy1.sqrtAfter, FIX.launchSqrt),
      9,
    );
    expect(soldFraction(launch, M.tickLower, M.tickUpper, true)).toBeCloseTo(0, 9);
    expect(soldFraction(b.sqrtPriceAfter, M.tickLower, M.tickUpper, true)).toBeCloseTo(
      Number(FIX.buy1.tokensOut) / Number(SUPPLY_RAW),
      4,
    );
    expect(soldFraction(launch * 2n, M.tickLower, M.tickUpper, true)).toBeCloseTo(0.5, 6);
  });

  it("derives the market: in range at launch, 1×, mirrored fees, the quote carried through", () => {
    const m = deriveMarketState({
      slot0Word: withProtocolFee(launchWord),
      // At tickLower the position IS in range, so v4 reports its liquidity.
      liquidityWord: `0x${M.liquidity.toString(16)}`,
      placement,
      wholeSupply: WHOLE_SUPPLY,
      quote: USDC,
    });
    expect(m.tokenIsCurrency0).toBe(true);
    expect(m.launchSqrtX96).toBe(launch);
    expect(m.sqrtPriceX96).toBe(launch);
    expect(m.liquidity).toBe(M.liquidity);
    expect(m.multiple).toBe(1);
    expect(m.soldFraction).toBeCloseTo(0, 9);
    expect(m.fdv).toBe(m.launchFdv);
    expect(m.quote).toBe(USDC);
    // A buy is oneForZero here, so it pays the HIGH 12 bits' protocol fee.
    expect(m.buySwapFee).toBe(2_000);
    expect(m.sellSwapFee).toBe(1_000);
  });

  it("the market reads the launch price when pushed below it", () => {
    const pushed = (() => {
      const w = BigInt(launchWord);
      const mask = (1n << 160n) - 1n;
      return `0x${((w & ~mask) | (launch / 2n)).toString(16).padStart(64, "0")}`;
    })();
    const m = deriveMarketState({ slot0Word: pushed, liquidityWord: "0x0", placement, wholeSupply: WHOLE_SUPPLY });
    expect(m.sqrtPriceX96).toBe(launch);
    expect(m.multiple).toBe(1);
  });
});
