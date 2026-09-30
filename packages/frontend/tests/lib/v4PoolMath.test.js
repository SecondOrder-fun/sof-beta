import { describe, it, expect } from "vitest";
import {
  Q96,
  poolStateSlot,
  poolLiquiditySlot,
  decodeSlot0,
  tradableLiquidity,
  priceWeiPerToken,
  fdvWei,
  multipleSinceLaunch,
  soldFraction,
  sqrtPriceX96AtTick,
  quoteBuy,
  quoteSell,
  minimumReceived,
  deriveMarketState,
  swapFeeFor,
} from "@/lib/v4PoolMath";

// Every constant below was emitted by a REAL PoolManager swap in
// packages/contracts/test/UniV4LiquidityPlacer.t.sol:test_fixture_quoteMathForFrontend
// (`forge test --match-test test_fixture_quoteMathForFrontend -vv`).
// A launch at 1e9 wei/token (1 ETH FDV), then a 0.1 ETH buy, a 1 ETH buy, and a
// sale of half the second buy's tokens. If any of these tests fail after a
// contracts change, re-run the fixture and update the numbers — do not loosen
// the tolerances.
const FIX = {
  poolId: "0x0972042a90604aa539119bf09c589a9d1253c65e6fba97697364e1055c165df8",
  poolStateSlot: "0xfa1c1475e56cbb1cfa948beb5cd7584d637a1a0537c3488046beff883eb6b7e2",
  slot0Word: "0x0000000027100000000329600000000000007b42d530bfeef6c84ca32f6118a4",
  placementLiquidity: 35222655548218972599314n,
  tickLower: 161200,
  tickUpper: 207200,
  launchSqrt: 2500031419217008302293562112940196n,
  launchTick: 207200,
  lpFee: 10000,
  buy1: {
    ethIn: 100000000000000000n,
    tokensOut: 90544562424768864432372374n,
    sqrtAfter: 2296364796274511973167666432089657n,
  },
  buy2: {
    ethIn: 1000000000000000000n,
    tokensOut: 458314310870065520885587454n,
    sqrtAfter: 1265454430799166740796726144042039n,
  },
  sell: {
    tokensIn: 229157155435032760442793727n,
    ethOut: 633721166099902280n,
    sqrtAfter: 1775755061709462630820341583343757n,
  },
};

const WHOLE_SUPPLY = 1_000_000_000n;
const ONE_ETH = 10n ** 18n;
const abs = (x) => (x < 0n ? -x : x);

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
  // The trap: at launch v4 reports active liquidity 0, because the price sits
  // exactly on the upper edge of a [lower, upper) range. The first buy crosses
  // that edge for free and then trades against the whole position.
  it("uses the position's liquidity at launch, when v4 reports 0 active", () => {
    expect(
      tradableLiquidity({
        activeLiquidity: 0n,
        placementLiquidity: FIX.placementLiquidity,
        tick: FIX.launchTick,
        tickUpper: FIX.tickUpper,
      }),
    ).toBe(FIX.placementLiquidity);
  });

  it("uses active liquidity once the position is in range", () => {
    expect(
      tradableLiquidity({
        activeLiquidity: 5n,
        placementLiquidity: FIX.placementLiquidity,
        tick: 200000,
        tickUpper: FIX.tickUpper,
      }),
    ).toBe(5n);
  });

  // After a buy exhausts the range the router parks the price on the floor, where
  // the tick reads one below tickLower and v4 again reports 0 active liquidity.
  // Sells back must still quote against the whole position.
  it("uses the position's liquidity below the range, after a sell-out", () => {
    expect(
      tradableLiquidity({
        activeLiquidity: 0n,
        placementLiquidity: FIX.placementLiquidity,
      }),
    ).toBe(FIX.placementLiquidity);
  });
});

describe("quoteBuy — against real v4 swaps", () => {
  it("matches the first buy from launch exactly", () => {
    const q = quoteBuy({
      sqrtPriceX96: FIX.launchSqrt,
      liquidity: FIX.placementLiquidity,
      lpFee: FIX.lpFee,
      ethIn: FIX.buy1.ethIn,
    });
    expect(q.tokensOut).toBe(FIX.buy1.tokensOut);
    expect(q.sqrtPriceAfter).toBe(FIX.buy1.sqrtAfter);
    expect(q.exceedsRange).toBe(false);
  });

  // v4 splits this swap at a tick-bitmap word boundary (tick 204800) and runs
  // it as two steps: it snaps sqrtPrice to TickMath's exact value at the
  // boundary and charges the fee PER STEP, rounded up each time. The quote does
  // it in one step. So the gap is not a fixed few wei — it scales with the
  // trade — but it is bounded far below anything the UI can display (4
  // significant figures). Measured: ~3e8 raw units on a 4.6e26 result, 7e-19.
  // The bound below is 1e-15, a thousand times looser than measured and a
  // trillion times tighter than the display.
  it("matches a second, word-crossing buy to within 1e-15 relative", () => {
    const q = quoteBuy({
      sqrtPriceX96: FIX.buy1.sqrtAfter,
      liquidity: FIX.placementLiquidity,
      lpFee: FIX.lpFee,
      ethIn: FIX.buy2.ethIn,
    });
    const rel = (a, b) => Number(abs(a - b)) / Number(b);
    expect(rel(q.tokensOut, FIX.buy2.tokensOut)).toBeLessThan(1e-15);
    expect(rel(q.sqrtPriceAfter, FIX.buy2.sqrtAfter)).toBeLessThan(1e-15);
    // Direction, measured: the quote is ~3e8 units HIGH — it promises slightly
    // more than v4 delivers, never less. Minimum-received applies slippage to
    // it, which absorbs this many times over.
    expect(q.tokensOut).toBeGreaterThanOrEqual(FIX.buy2.tokensOut);
  });

  it("reports price impact that grows with size", () => {
    const small = quoteBuy({
      sqrtPriceX96: FIX.launchSqrt,
      liquidity: FIX.placementLiquidity,
      lpFee: FIX.lpFee,
      ethIn: ONE_ETH / 100n,
    });
    const big = quoteBuy({
      sqrtPriceX96: FIX.launchSqrt,
      liquidity: FIX.placementLiquidity,
      lpFee: FIX.lpFee,
      ethIn: ONE_ETH,
    });
    expect(small.priceImpact).toBeGreaterThan(0);
    expect(big.priceImpact).toBeGreaterThan(small.priceImpact);
  });

  it("caps a buy that would run past the bottom of the range", () => {
    const sqrtLowerX96 = sqrtPriceX96AtTick(FIX.tickLower);
    const q = quoteBuy({
      sqrtPriceX96: FIX.launchSqrt,
      liquidity: FIX.placementLiquidity,
      lpFee: FIX.lpFee,
      ethIn: 1_000n * ONE_ETH,
      sqrtLowerX96,
    });
    expect(q.exceedsRange).toBe(true);
    expect(q.sqrtPriceAfter).toBe(sqrtLowerX96);
    // Everything, less the placer's dust: essentially the whole supply.
    expect(q.tokensOut).toBeLessThanOrEqual(WHOLE_SUPPLY * ONE_ETH);
    expect(q.tokensOut).toBeGreaterThan((WHOLE_SUPPLY * ONE_ETH * 999n) / 1000n);
  });

  it("returns an empty quote for zero, negative or missing input", () => {
    const base = { sqrtPriceX96: FIX.launchSqrt, liquidity: FIX.placementLiquidity, lpFee: FIX.lpFee };
    expect(quoteBuy({ ...base, ethIn: 0n }).tokensOut).toBe(0n);
    expect(quoteBuy({ ...base, ethIn: -1n }).tokensOut).toBe(0n);
    expect(quoteBuy({ ...base, liquidity: 0n, ethIn: ONE_ETH }).tokensOut).toBe(0n);
  });

  it("quotes nothing — never a negative amount — once the price sits on the floor", () => {
    const sqrtLowerX96 = sqrtPriceX96AtTick(FIX.tickLower);
    for (const sqrtPriceX96 of [sqrtLowerX96, sqrtLowerX96 - 1n]) {
      const q = quoteBuy({
        sqrtPriceX96,
        liquidity: FIX.placementLiquidity,
        lpFee: FIX.lpFee,
        ethIn: ONE_ETH,
        sqrtLowerX96,
      });
      expect(q.tokensOut).toBe(0n);
      expect(q.exceedsRange).toBe(true);
    }
  });
});

describe("quoteSell — against a real v4 swap", () => {
  it("matches the sell exactly", () => {
    const q = quoteSell({
      sqrtPriceX96: FIX.buy2.sqrtAfter,
      liquidity: FIX.placementLiquidity,
      lpFee: FIX.lpFee,
      tokensIn: FIX.sell.tokensIn,
    });
    expect(q.ethOut).toBe(FIX.sell.ethOut);
    expect(q.sqrtPriceAfter).toBe(FIX.sell.sqrtAfter);
  });

  it("caps a sell at the launch price — there is no liquidity above it", () => {
    const q = quoteSell({
      sqrtPriceX96: FIX.buy1.sqrtAfter,
      liquidity: FIX.placementLiquidity,
      lpFee: FIX.lpFee,
      tokensIn: WHOLE_SUPPLY * ONE_ETH,
      sqrtUpperX96: FIX.launchSqrt,
    });
    expect(q.exceedsRange).toBe(true);
    expect(q.sqrtPriceAfter).toBe(FIX.launchSqrt);
  });

  it("sells back from the floor against the whole position", () => {
    const sqrtLowerX96 = sqrtPriceX96AtTick(FIX.tickLower);
    const q = quoteSell({
      sqrtPriceX96: sqrtLowerX96,
      liquidity: FIX.placementLiquidity,
      lpFee: FIX.lpFee,
      tokensIn: ONE_ETH * 1_000_000n,
      sqrtUpperX96: FIX.launchSqrt,
    });
    expect(q.ethOut).toBeGreaterThan(0n);
    expect(q.exceedsRange).toBe(false);
  });

  it("quotes nothing at the launch price — the pool holds no ETH yet", () => {
    const q = quoteSell({
      sqrtPriceX96: FIX.launchSqrt,
      liquidity: FIX.placementLiquidity,
      lpFee: FIX.lpFee,
      tokensIn: ONE_ETH,
      sqrtUpperX96: FIX.launchSqrt,
    });
    expect(q.ethOut).toBe(0n);
  });
});

describe("price, valuation and progress", () => {
  it("prices the launch at about 1 gwei per token — the requested 1e9 wei, tick-aligned", () => {
    const p = priceWeiPerToken(FIX.launchSqrt);
    // The placer floors the start price to a tick, so it lands within 1% of the request.
    expect(p).toBeGreaterThan(990_000_000n);
    expect(p).toBeLessThan(1_010_000_000n);
  });

  it("values the launch at about 1 ETH FDV", () => {
    const f = fdvWei(FIX.launchSqrt, WHOLE_SUPPLY);
    expect(f).toBeGreaterThan((ONE_ETH * 99n) / 100n);
    expect(f).toBeLessThan((ONE_ETH * 101n) / 100n);
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
    const fromSwap = Number(FIX.buy1.tokensOut) / Number(WHOLE_SUPPLY * ONE_ETH);
    expect(fromPrice).toBeCloseTo(fromSwap, 4);
  });

  it("agrees again after both buys", () => {
    const fromPrice = soldFraction(FIX.buy2.sqrtAfter, FIX.tickLower, FIX.tickUpper);
    const fromSwap =
      Number(FIX.buy1.tokensOut + FIX.buy2.tokensOut) / Number(WHOLE_SUPPLY * ONE_ETH);
    expect(fromPrice).toBeCloseTo(fromSwap, 4);
  });

  it("clamps outside the range", () => {
    expect(soldFraction(FIX.launchSqrt * 2n, FIX.tickLower, FIX.tickUpper)).toBe(0);
    expect(soldFraction(1n, FIX.tickLower, FIX.tickUpper)).toBe(1);
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

  it("reads a fresh launch as 1x, 0% sold, about 1 ETH FDV, and tradable", () => {
    const m = deriveMarketState({ slot0Word: FIX.slot0Word, liquidityWord: "0x0", placement, wholeSupply: WHOLE_SUPPLY });
    expect(m.multiple).toBe(1);
    expect(m.soldFraction).toBeCloseTo(0, 6);
    expect(m.fdvWei).toBe(m.launchFdvWei);
    // v4 reports 0 active liquidity here; the state must carry the tradable amount.
    expect(m.liquidity).toBe(FIX.placementLiquidity);
    expect(m.launchSqrtX96).toBe(FIX.launchSqrt);
  });

  it("carries the pool's actual launch price, consistent with the launch FDV", () => {
    const m = deriveMarketState({ slot0Word: FIX.slot0Word, liquidityWord: "0x0", placement, wholeSupply: WHOLE_SUPPLY });
    // Untraded: the pool sits exactly at its launch price.
    expect(m.launchPriceWei).toBe(m.priceWei);
    expect(m.launchPriceWei * WHOLE_SUPPLY).toBe(m.launchFdvWei);
  });

  it("puts sellout at about 100x the launch valuation — the placer's 46,000-tick range", () => {
    const m = deriveMarketState({ slot0Word: FIX.slot0Word, liquidityWord: "0x0", placement, wholeSupply: WHOLE_SUPPLY });
    const ratio = Number(m.selloutFdvWei) / Number(m.launchFdvWei);
    expect(ratio).toBeGreaterThan(95);
    expect(ratio).toBeLessThan(105);
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
    // 0.1% protocol fee for buys (low 12 bits), 0.2% for sells (high 12 bits), 1% LP fee.
    const protocolFee = (2_000 << 12) | 1_000;
    expect(swapFeeFor(protocolFee, 10_000, true)).toBe(1_000 + 10_000 - Math.floor((1_000 * 10_000) / 1_000_000));
    expect(swapFeeFor(protocolFee, 10_000, false)).toBe(2_000 + 10_000 - Math.floor((2_000 * 10_000) / 1_000_000));
  });
});

describe("deriveMarketState fees", () => {
  const placement = { tickLower: FIX.tickLower, tickUpper: FIX.tickUpper, liquidity: FIX.placementLiquidity };

  it("exposes the protocol-inclusive buy and sell fees read from slot0", () => {
    // Rewrite the fixture's protocolFee field (bits 184..207) to 0.1% buys / 0.2% sells.
    const word = BigInt(FIX.slot0Word);
    const mask = ((1n << 24n) - 1n) << 184n;
    const withProto = (word & ~mask) | (BigInt((2_000 << 12) | 1_000) << 184n);
    const m = deriveMarketState({
      slot0Word: `0x${withProto.toString(16).padStart(64, "0")}`,
      liquidityWord: "0x0",
      placement,
      wholeSupply: WHOLE_SUPPLY,
    });
    expect(m.lpFee).toBe(10_000);
    expect(m.buyFee).toBe(10_990);
    expect(m.sellFee).toBe(11_980);
  });
});

// Pools are permissionless for swaps: a zero-amount swap moves the price out of the
// position's range for free (measured against a real PoolManager: from the launch
// tick 207200 up to 253200, both deltas 0). The router then crosses back to the
// range edge at no cost and fills exactly as before, so the quote must too — or the
// minimum-out built from it reverts every in-app trade.
describe("a price pushed outside the range", () => {
  const PUSHED_ABOVE = 24932902260564625575815087136221213n; // tick 253200
  const placement = { tickLower: FIX.tickLower, tickUpper: FIX.tickUpper, liquidity: FIX.placementLiquidity };
  const withSqrtPrice = (sqrt) => {
    const word = BigInt(FIX.slot0Word);
    const mask = (1n << 160n) - 1n;
    return `0x${((word & ~mask) | sqrt).toString(16).padStart(64, "0")}`;
  };

  it("a buy is quoted from the launch price — exactly the router's fill", () => {
    const q = quoteBuy({
      sqrtPriceX96: PUSHED_ABOVE,
      liquidity: FIX.placementLiquidity,
      lpFee: FIX.lpFee,
      ethIn: FIX.buy1.ethIn,
      sqrtLowerX96: sqrtPriceX96AtTick(FIX.tickLower),
      sqrtUpperX96: FIX.launchSqrt,
    });
    expect(q.tokensOut).toBe(FIX.buy1.tokensOut);
    expect(q.sqrtPriceAfter).toBe(FIX.buy1.sqrtAfter);
  });

  it("a sell is quoted from the floor", () => {
    const sqrtLowerX96 = sqrtPriceX96AtTick(FIX.tickLower);
    const base = { liquidity: FIX.placementLiquidity, lpFee: FIX.lpFee, tokensIn: 10n ** 24n, sqrtUpperX96: FIX.launchSqrt, sqrtLowerX96 };
    const fromFloor = quoteSell({ ...base, sqrtPriceX96: sqrtLowerX96 });
    const pushedBelow = quoteSell({ ...base, sqrtPriceX96: sqrtLowerX96 / 10n });
    expect(pushedBelow.ethOut).toBe(fromFloor.ethOut);
    expect(pushedBelow.ethOut).toBeGreaterThan(0n);
  });

  it("the market reads the launch price, not the pushed one", () => {
    const m = deriveMarketState({ slot0Word: withSqrtPrice(PUSHED_ABOVE), liquidityWord: "0x0", placement, wholeSupply: WHOLE_SUPPLY });
    expect(m.sqrtPriceX96).toBe(FIX.launchSqrt);
    expect(m.multiple).toBe(1);
    expect(m.fdvWei).toBe(m.launchFdvWei);
  });

  it("the market reads the floor when pushed below it", () => {
    const sqrtLowerX96 = sqrtPriceX96AtTick(FIX.tickLower);
    const m = deriveMarketState({ slot0Word: withSqrtPrice(sqrtLowerX96 / 10n), liquidityWord: "0x0", placement, wholeSupply: WHOLE_SUPPLY });
    expect(m.sqrtPriceX96).toBe(sqrtLowerX96);
    expect(m.fdvWei).toBe(m.selloutFdvWei);
  });
});
