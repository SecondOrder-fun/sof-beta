// src/lib/v4PoolMath.js
//
// Uniswap v4 pool state -> the numbers the launchpad UI shows: current price,
// FDV, the multiple since launch, how much supply has sold, and exact
// buy/sell quotes.
//
// Everything is derived from a few reads with no quoter contract and no
// indexer: the pool's slot0 and liquidity (via PoolManager.extsload), plus the
// placement's span and orientation (UniV4LiquidityPlacer.getPlacement), its bands
// (UniV4LiquidityPlacer.bandsOf) and its snipe-tax schedule
// (UniV4LiquidityPlacer.snipeTaxOf).
//
// Orientation — which side of the pool the launch token is on. v4 sorts the two
// currencies by address and prices the pool as currency1/currency0 in raw units:
//   - QUOTE is currency0 (always for ETH, address 0; and an ERC-20 below the
//     token): v4 price = TOKENS PER QUOTE. A buy (quote in) is zeroForOne and
//     moves sqrtPrice DOWN. The ladder spans [minUsableTick, tickUpper] and the
//     pool opens at tickUpper.
//   - TOKEN is currency0 (`placement.tokenIsCurrency0`, an ERC-20 quote above the
//     token): v4 price = QUOTE PER TOKEN. A buy is oneForZero and moves sqrtPrice
//     UP. The ladder spans [tickLower, maxUsableTick] and the pool opens at
//     tickLower.
// Either way the ladder runs from the launch price to the end of v4's price
// scale, so there is liquidity at every price and the token never sells out.
//
// Bands. The supply is placed as one to three single-sided positions laid end to
// end from the launch price (the creator's liquidity preset, lib/liquidityPresets.js),
// each with its own liquidity. A swap trades against the sum of the bands whose
// range contains the price and, like v4 crossing an initialized tick, steps at
// every band edge, where that sum changes. Classic is one band, the single
// position every launch had before presets.
//
// Amounts are in raw units throughout: the quote token's (wei for ETH, 1e-6 for
// USDC) and the launch token's (always 18 decimals).
//
// The swap math mirrors v4-core's SqrtPriceMath, SwapMath and Pool.swap's step
// loop (a step per tick-bitmap word, given the pool's tick spacing, and at every
// band edge), and is pinned to the wei against real PoolManager swaps by
// test_fixture_quoteMathForFrontend (one band) and
// test_fixture_presetQuoteMathForFrontend (three) in the contracts package.
//
// Trade fee. Launch pools have a ZERO LP fee; the placer is each pool's v4 hook
// and charges the launch's own `tradeFee` (pips, 10_000 = 1%, chosen by the
// creator, `placement.tradeFee`) in the QUOTE token only, as that rate of the
// gross quote flow, rounded up (FullMath.mulDivRoundingUp). For the exact-input
// swaps the launch router makes:
//   - buy:  the trader pays G; fee = ceil(G·f/1e6); the pool swaps G − fee.
//   - sell: the pool pays O for the tokens; fee = ceil(O·f/1e6); the trader
//           receives O − fee.
// The swap step itself charges only what v4 does (slot0's LP fee, 0 here, plus
// any protocol fee — swapFeeFor).
//
// Snipe tax (buys only). For `duration` seconds after a launch a BUY pays a
// higher rate that falls linearly from the schedule's start to the trade fee
// (buyFeeAt, from UniV4LiquidityPlacer.snipeTaxOf); the fee is still that rate of
// the gross payment, rounded up, so quoteBuy takes it as its `tradeFee`. Sells
// always pay the trade fee. The creator's buy inside the launch transaction is
// exempt; no in-app trade is.

import { encodePacked, keccak256 } from 'viem';

export const Q96 = 1n << 96n;
const Q192 = 1n << 192n;
const WAD = 10n ** 18n;
/** v4 fees, and the launch trade fee, are in pips (hundredths of a bip): 1_000_000 = 100%. */
const MAX_SWAP_FEE = 1_000_000n;
/** UniV4LiquidityPlacer.MAX_TRADE_FEE — the highest trade fee a launch may choose: 10%. */
export const MAX_TRADE_FEE = 100_000;
/** Basis points -> pips. */
const BPS_TO_PIPS = 100;
/** StateLibrary.POOLS_SLOT — `pools` is the 7th storage slot of PoolManager. */
const POOLS_SLOT = 6n;
/** StateLibrary.LIQUIDITY_OFFSET — Pool.State.liquidity sits 3 slots in. */
const LIQUIDITY_OFFSET = 3n;

// ---------------------------------------------------------------------------
// Integer helpers, matching FullMath / UnsafeMath rounding
// ---------------------------------------------------------------------------

const mulDiv = (a, b, d) => (a * b) / d;
const mulDivRoundingUp = (a, b, d) => {
  const q = (a * b) / d;
  return (a * b) % d === 0n ? q : q + 1n;
};
const divRoundingUp = (a, d) => (a % d === 0n ? a / d : a / d + 1n);

// ---------------------------------------------------------------------------
// Reading pool state
// ---------------------------------------------------------------------------

/**
 * Storage slot of `pools[poolId]` in the PoolManager — StateLibrary._getPoolStateSlot.
 * @param {`0x${string}`} poolId
 */
export function poolStateSlot(poolId) {
  return keccak256(encodePacked(['bytes32', 'uint256'], [poolId, POOLS_SLOT]));
}

/** Slot holding the pool's active liquidity. */
export function poolLiquiditySlot(poolId) {
  const base = BigInt(poolStateSlot(poolId));
  return `0x${(base + LIQUIDITY_OFFSET).toString(16).padStart(64, '0')}`;
}

/**
 * Decode the packed slot0 word — StateLibrary.getSlot0.
 * Layout, low to high: sqrtPriceX96 (160) | tick (24, signed) | protocolFee (24) | lpFee (24).
 * @param {`0x${string}` | bigint} word
 */
export function decodeSlot0(word) {
  const data = BigInt(word);
  const sqrtPriceX96 = data & ((1n << 160n) - 1n);
  let tick = Number((data >> 160n) & 0xffffffn);
  if (tick & 0x800000) tick -= 0x1000000; // sign-extend 24 bits
  const protocolFee = Number((data >> 184n) & 0xffffffn);
  const lpFee = Number((data >> 208n) & 0xffffffn);
  return { sqrtPriceX96, tick, protocolFee, lpFee };
}

/**
 * The liquidity a swap from the current price will actually trade against, given
 * v4's active liquidity and the placer's liquidity at that price (liquidityAt).
 *
 * Whenever the price is out of every band's [lower, upper) range v4 reports active
 * liquidity as 0, yet the next swap back toward the ladder crosses that edge at
 * zero cost and trades against the band there. Ladder ends that hit this:
 *   - A launch whose quote is currency0 (every ETH launch) opens EXACTLY on the
 *     upper tick, outside the half-open range, so the first buy would quote nothing.
 *   - A price parked on the upper edge of a token-is-currency0 ladder — the far
 *     end of the price scale — reads 0 the same way.
 *
 * @param {{ activeLiquidity: bigint, placementLiquidity: bigint }} s
 */
export function tradableLiquidity({ activeLiquidity, placementLiquidity }) {
  return activeLiquidity > 0n ? activeLiquidity : placementLiquidity;
}

/**
 * A launch's bands, each with its edges as exact sqrt prices, from the placer's
 * `bandsOf(token)`; or, from a placer without bands (before liquidity presets),
 * the placement's single range with `placement.liquidity`.
 * @param {{ tickLower: number, tickUpper: number, liquidity: bigint }[] | null | undefined} bands
 * @param {{ tickLower: number, tickUpper: number, liquidity: bigint }} placement
 * @returns {{ tickLower: number, tickUpper: number, liquidity: bigint, sqrtLowerX96: bigint, sqrtUpperX96: bigint }[]}
 */
export function normalizeBands(bands, placement) {
  const list = bands?.length ? bands : [placement];
  return list.map((b) => {
    const tickLower = Number(b.tickLower);
    const tickUpper = Number(b.tickUpper);
    return {
      tickLower,
      tickUpper,
      liquidity: BigInt(b.liquidity ?? 0n),
      sqrtLowerX96: sqrtPriceX96AtTick(tickLower),
      sqrtUpperX96: sqrtPriceX96AtTick(tickUpper),
    };
  });
}

/**
 * The bands' summed liquidity over the price interval [a, b] (either order): what
 * v4 trades against between two prices with no band edge in between.
 */
function liquidityBetween(bands, a, b) {
  const [lo, hi] = a < b ? [a, b] : [b, a];
  let sum = 0n;
  for (const band of bands) if (band.sqrtLowerX96 <= lo && band.sqrtUpperX96 >= hi) sum += band.liquidity;
  return sum;
}

/**
 * The placer's liquidity a swap from `sqrtPriceX96` trades against first, in its
 * direction: the bands containing the price just below it (zeroForOne) or just
 * above it. On a band edge that is the band the swap moves into, as v4 sees it
 * once it has crossed the edge's tick.
 * @param {{ sqrtLowerX96: bigint, sqrtUpperX96: bigint, liquidity: bigint }[]} bands
 * @param {bigint} sqrtPriceX96
 * @param {boolean} zeroForOne
 */
export function liquidityAt(bands, sqrtPriceX96, zeroForOne) {
  let sum = 0n;
  for (const b of bands) {
    const inside = zeroForOne
      ? b.sqrtLowerX96 < sqrtPriceX96 && sqrtPriceX96 <= b.sqrtUpperX96
      : b.sqrtLowerX96 <= sqrtPriceX96 && sqrtPriceX96 < b.sqrtUpperX96;
    if (inside) sum += b.liquidity;
  }
  return sum;
}

// ---------------------------------------------------------------------------
// TickMath
// ---------------------------------------------------------------------------

const MAX_TICK = 887272;
const MAX_UINT256 = (1n << 256n) - 1n;
// TickMath's Q128.128 constants: 1/sqrt(1.0001^(2^i)) for each bit i of |tick|.
const TICK_FACTORS = [
  [0x2n, 0xfff97272373d413259a46990580e213an],
  [0x4n, 0xfff2e50f5f656932ef12357cf3c7fdccn],
  [0x8n, 0xffe5caca7e10e4e61c3624eaa0941cd0n],
  [0x10n, 0xffcb9843d60f6159c9db58835c926644n],
  [0x20n, 0xff973b41fa98c081472e6896dfb254c0n],
  [0x40n, 0xff2ea16466c96a3843ec78b326b52861n],
  [0x80n, 0xfe5dee046a99a2a811c461f1969c3053n],
  [0x100n, 0xfcbe86c7900a88aedcffc83b479aa3a4n],
  [0x200n, 0xf987a7253ac413176f2b074cf7815e54n],
  [0x400n, 0xf3392b0822b70005940c7a398e4b70f3n],
  [0x800n, 0xe7159475a2c29b7443b29c7fa6e889d9n],
  [0x1000n, 0xd097f3bdfd2022b8845ad8f792aa5825n],
  [0x2000n, 0xa9f746462d870fdf8a65dc1f90e061e5n],
  [0x4000n, 0x70d869a156d2a1b890bb3df62baf32f7n],
  [0x8000n, 0x31be135f97d08fd981231505542fcfa6n],
  [0x10000n, 0x9aa508b5b7a84e1c677de54f3e99bc9n],
  [0x20000n, 0x5d6af8dedb81196699c329225ee604n],
  [0x40000n, 0x2216e584f5fa1ea926041bedfe98n],
  [0x80000n, 0x48a170391f7dc42444e8fa2n],
];

/**
 * Exact port of v4-core TickMath.getSqrtPriceAtTick — the bit-for-bit value the
 * pool uses for a range edge.
 *
 * Must be exact, not a float: capping a quote at the range floor with a float
 * approximation (53 bits standing in for 160) overstated the tokens out past the
 * whole supply. A quote may never promise more than the bands hold.
 */
export function sqrtPriceX96AtTick(tick) {
  const absTick = BigInt(Math.abs(tick));
  if (absTick > BigInt(MAX_TICK)) throw new RangeError(`tick ${tick} out of range`);

  let price = absTick & 0x1n ? 0xfffcb933bd6fad37aa2d162d1a594001n : 1n << 128n;
  for (const [bit, factor] of TICK_FACTORS) {
    if (absTick & bit) price = (price * factor) >> 128n;
  }
  if (tick > 0) price = MAX_UINT256 / price;

  // Q128.128 -> Q128.96, rounding up (so getTickAtSqrtPrice round-trips).
  return (price + (1n << 32n) - 1n) >> 32n;
}

// ---------------------------------------------------------------------------
// Price, valuation, progress
// ---------------------------------------------------------------------------

/**
 * Quote raw units per WHOLE launch token at `sqrtPriceX96`, floored.
 * v4's raw price is (sqrtP / 2^96)^2 = currency1/currency0: tokens per quote when
 * the quote is currency0 (invert it), quote per token when the token is. The
 * launch token has 18 decimals, so "per whole token" scales by 1e18.
 *
 * Coarse for a low-decimal quote — a 2,500 USDC launch is 2.5 raw units per
 * token — so values and displays use fdvAt, which keeps the precision.
 * @param {bigint} sqrtPriceX96
 * @param {boolean} [tokenIsCurrency0=false]
 */
export function pricePerToken(sqrtPriceX96, tokenIsCurrency0 = false) {
  if (!sqrtPriceX96) return 0n;
  const sq = sqrtPriceX96 * sqrtPriceX96;
  return tokenIsCurrency0 ? (WAD * sq) / Q192 : (WAD * Q192) / sq;
}

/**
 * Fully diluted valuation, in quote raw units: the whole supply at this price.
 * Computed from the raw supply directly rather than as price × supply, so a
 * 6-decimal quote keeps its precision.
 * @param {bigint} sqrtPriceX96
 * @param {bigint | number} wholeSupply  whole tokens (TOKEN_SUPPLY / 1e18)
 * @param {boolean} [tokenIsCurrency0=false]
 */
export function fdvAt(sqrtPriceX96, wholeSupply, tokenIsCurrency0 = false) {
  if (!sqrtPriceX96) return 0n;
  const supplyRaw = BigInt(wholeSupply) * WAD;
  const sq = sqrtPriceX96 * sqrtPriceX96;
  return tokenIsCurrency0 ? (supplyRaw * sq) / Q192 : (supplyRaw * Q192) / sq;
}

/**
 * How many times the price has multiplied since launch.
 * Measured from the pool's launch sqrtPrice (the ladder's start edge), not from
 * the creator's requested valuation, which the placer snaps to a tick — so a
 * fresh launch reads exactly 1×.
 * @param {bigint} sqrtNowX96
 * @param {bigint} sqrtLaunchX96
 * @param {boolean} [tokenIsCurrency0=false]
 */
export function multipleSinceLaunch(sqrtNowX96, sqrtLaunchX96, tokenIsCurrency0 = false) {
  if (!sqrtNowX96 || !sqrtLaunchX96) return 1;
  const r = tokenIsCurrency0
    ? Number(sqrtNowX96) / Number(sqrtLaunchX96)
    : Number(sqrtLaunchX96) / Number(sqrtNowX96);
  return r * r;
}

/**
 * Fraction of the placed supply that has left the pool, 0..1 — what has actually
 * sold, from the bands' own token balances.
 *
 * Quote is currency0: a band holds amount1 = L·(√P − √P_lower) tokens (√P clamped
 * to its range), all of its share at launch (√P_upper). Token is currency0: it
 * holds amount0 = L·(1/√P − 1/√P_upper), all of it at launch (√P_lower). Summed
 * over the bands and divided by what they held at launch, so each band weighs in
 * with its own liquidity; for one band L cancels.
 *
 * The ladder runs to the end of v4's price scale, so 100% is never reached and
 * the scale is not linear in price: under Classic (one band) half the supply has
 * sold at 4× the launch price, 90% at 100×. There is no graduation; this is the
 * launch's progress.
 * @param {bigint} sqrtNowX96
 * @param {{ sqrtLowerX96: bigint, sqrtUpperX96: bigint, liquidity: bigint }[]} bands  normalizeBands()
 * @param {boolean} [tokenIsCurrency0=false]
 */
export function bandsSoldFraction(sqrtNowX96, bands, tokenIsCurrency0 = false) {
  const now = Number(sqrtNowX96);
  if (!(now > 0) || !bands?.length) return 0;
  let placed = 0;
  let held = 0;
  for (const b of bands) {
    const lo = Number(b.sqrtLowerX96);
    const hi = Number(b.sqrtUpperX96);
    const L = Number(b.liquidity);
    if (!(hi > lo) || !(L > 0)) continue;
    const p = Math.min(hi, Math.max(lo, now));
    placed += tokenIsCurrency0 ? L * (1 / lo - 1 / hi) : L * (hi - lo);
    held += tokenIsCurrency0 ? L * (1 / p - 1 / hi) : L * (p - lo);
  }
  if (!(placed > 0)) return 0;
  return Math.min(1, Math.max(0, 1 - held / placed));
}

/**
 * soldFraction for a single range [tickLower, tickUpper] — one band, where the
 * liquidity cancels. See bandsSoldFraction.
 * @param {bigint} sqrtNowX96
 * @param {number} tickLower
 * @param {number} tickUpper
 * @param {boolean} [tokenIsCurrency0=false]
 */
export function soldFraction(sqrtNowX96, tickLower, tickUpper, tokenIsCurrency0 = false) {
  return bandsSoldFraction(sqrtNowX96, normalizeBands(null, { tickLower, tickUpper, liquidity: 1n }), tokenIsCurrency0);
}

/**
 * What `rawTokens` of a launch token are worth in its quote, raw units, at the
 * market's price (a prize pool).
 * @param {bigint} rawTokens
 * @param {{ fdv: bigint, totalSupplyRaw: bigint } | null | undefined} market
 * @returns {bigint | null} null without a priced market
 */
export function tokensToQuote(rawTokens, market) {
  if (rawTokens == null || !market?.fdv || !market.totalSupplyRaw) return null;
  return (BigInt(rawTokens) * market.fdv) / market.totalSupplyRaw;
}

// ---------------------------------------------------------------------------
// Quotes — Pool.swap's step loop, SwapMath.computeSwapStep for each step
// ---------------------------------------------------------------------------

const MAX_UINT160 = (1n << 160n) - 1n;

/** SqrtPriceMath.getAmount0Delta. */
function amount0Delta(sqrtA, sqrtB, liquidity, roundUp) {
  const [lo, hi] = sqrtA < sqrtB ? [sqrtA, sqrtB] : [sqrtB, sqrtA];
  const numerator1 = liquidity << 96n;
  const numerator2 = hi - lo;
  return roundUp
    ? divRoundingUp(mulDivRoundingUp(numerator1, numerator2, hi), lo)
    : mulDiv(numerator1, numerator2, hi) / lo;
}

/** SqrtPriceMath.getAmount1Delta. */
function amount1Delta(sqrtA, sqrtB, liquidity, roundUp) {
  const diff = sqrtA < sqrtB ? sqrtB - sqrtA : sqrtA - sqrtB;
  return roundUp ? mulDivRoundingUp(liquidity, diff, Q96) : mulDiv(liquidity, diff, Q96);
}

/**
 * SqrtPriceMath.getNextSqrtPriceFromInput: currency0 in (zeroForOne) via
 * getNextSqrtPriceFromAmount0RoundingUp, currency1 in via
 * getNextSqrtPriceFromAmount1RoundingDown — both with add = true.
 */
function nextSqrtPriceFromInput(sqrtPriceX96, liquidity, amountIn, zeroForOne) {
  if (amountIn === 0n) return sqrtPriceX96;
  if (zeroForOne) {
    const numerator1 = liquidity << 96n;
    const product = amountIn * sqrtPriceX96;
    // The EVM takes the exact path only while the product fits 256 bits.
    if (product <= MAX_UINT256) {
      const denominator = numerator1 + product;
      if (denominator <= MAX_UINT256) return mulDivRoundingUp(numerator1, sqrtPriceX96, denominator);
    }
    return divRoundingUp(numerator1, numerator1 / sqrtPriceX96 + amountIn);
  }
  const quotient = amountIn <= MAX_UINT160 ? (amountIn << 96n) / liquidity : mulDiv(amountIn, Q96, liquidity);
  return sqrtPriceX96 + quotient;
}

/**
 * SwapMath.computeSwapStep for an exact input: how far `remaining` (fee
 * included) moves the price toward `target`, what it spends, and what comes out.
 */
function computeSwapStep(sqrtPriceX96, target, liquidity, remaining, feePips, zeroForOne) {
  const fee = BigInt(feePips);
  const remainingLessFee = mulDiv(remaining, MAX_SWAP_FEE - fee, MAX_SWAP_FEE);
  let amountIn = zeroForOne
    ? amount0Delta(target, sqrtPriceX96, liquidity, true)
    : amount1Delta(sqrtPriceX96, target, liquidity, true);
  let sqrtNext;
  let feeAmount;
  if (remainingLessFee >= amountIn) {
    sqrtNext = target;
    feeAmount = fee === MAX_SWAP_FEE ? amountIn : mulDivRoundingUp(amountIn, fee, MAX_SWAP_FEE - fee);
  } else {
    amountIn = remainingLessFee;
    sqrtNext = nextSqrtPriceFromInput(sqrtPriceX96, liquidity, remainingLessFee, zeroForOne);
    feeAmount = remaining - amountIn;
  }
  const out = zeroForOne
    ? amount1Delta(sqrtNext, sqrtPriceX96, liquidity, false)
    : amount0Delta(sqrtPriceX96, sqrtNext, liquidity, false);
  return { sqrtNext, spent: amountIn + feeAmount, out };
}

/**
 * The prices at which v4 ends a swap step on its own, nearest first, in the swap's
 * direction from `sqrtPriceX96`: the edges of the tick bitmap's 256-spacing words
 * (TickBitmap.nextInitializedTickWithinOneWord where nothing in the word is
 * initialized). A step that reaches one snaps the price to TickMath's exact value
 * there, which is why a quote must step where v4 does to match it to the wei.
 *
 * Going down (zeroForOne) a step ends at each word's first tick at or below the
 * price; going up, at each word's last tick above it. Generated lazily; the band
 * edges (v4's initialized ticks) and the ladder's far edge, the swap's limit, are
 * added by the caller.
 */
function* wordEdges(sqrtPriceX96, tickSpacing, zeroForOne) {
  const word = 256 * tickSpacing;
  // An estimate of the price's tick; the loops below make it exact.
  const est = Math.floor(Math.log(Number(sqrtPriceX96) / 2 ** 96) / Math.log(Math.sqrt(1.0001)));
  const at = (tick) => sqrtPriceX96AtTick(Math.max(-MAX_TICK, Math.min(MAX_TICK, tick)));
  if (zeroForOne) {
    let edge = Math.floor(est / word) * word;
    while (edge - word >= -MAX_TICK && at(edge) > sqrtPriceX96) edge -= word;
    while (edge + word <= MAX_TICK && at(edge + word) <= sqrtPriceX96) edge += word;
    for (; edge >= -MAX_TICK; edge -= word) yield at(edge);
    yield at(-MAX_TICK);
  } else {
    let edge = Math.floor(est / word) * word + word - tickSpacing;
    while (edge + word <= MAX_TICK && at(edge) <= sqrtPriceX96) edge += word;
    while (edge - word >= -MAX_TICK && at(edge - word) > sqrtPriceX96) edge -= word;
    for (; edge <= MAX_TICK; edge += word) yield at(edge);
    yield at(MAX_TICK);
  }
}

/** v4's raw price — currency1 per currency0 — as a float, for price impact only. */
const rawPrice = (sqrtPriceX96) => Number(sqrtPriceX96) ** 2 / 2 ** 192;

/**
 * The pool's liquidity for a quote: `bands` (normalizeBands) when given, else one
 * band of `liquidity` over [sqrtLowerX96, sqrtUpperX96] (the whole price scale
 * where an edge is missing).
 */
function quoteBands({ bands, liquidity, sqrtLowerX96, sqrtUpperX96 }) {
  if (bands?.length) return bands;
  return [{ sqrtLowerX96: sqrtLowerX96 || 0n, sqrtUpperX96: sqrtUpperX96 || MAX_UINT160, liquidity: BigInt(liquidity ?? 0n) }];
}

/**
 * The nearest band edge strictly beyond `price` in the swap's direction, or
 * undefined past the last one.
 */
function nextBandEdge(bands, price, zeroForOne) {
  let next;
  for (const b of bands) {
    for (const edge of [b.sqrtLowerX96, b.sqrtUpperX96]) {
      if (zeroForOne ? edge < price && (next === undefined || edge > next) : edge > price && (next === undefined || edge < next)) {
        next = edge;
      }
    }
  }
  return next;
}

/**
 * One exact-input swap in either direction, as v4's Pool.swap runs it: a step to
 * whichever comes first of the next tick-bitmap word edge (when `tickSpacing` is
 * known), the next band edge and the ladder's far edge, until the input is spent
 * or the price reaches that far edge. Each step trades against the summed
 * liquidity of the bands covering it, so the liquidity changes exactly where v4's
 * does when it crosses a band's initialized tick.
 *
 * The quote uses the placer's bands only. Liquidity anyone else adds to the pool
 * can only deepen it, which fills an exact-input trade at least as well, so the
 * quote (and the minimum-out built from it) errs low, never high.
 *
 * Outside [lower, upper] — the whole ladder — the pool has no liquidity, and
 * anyone can push its price there with a zero-amount swap; the next trade crosses
 * back to the edge for free and fills from there. So a price past the edge this
 * swap starts from is quoted from that edge — quoting from the pushed price would
 * promise more than the fill, and the minimum-out built from it would revert. A
 * price at or past the edge this swap moves TOWARD has nothing left to fill.
 *
 * `swapFee` is v4's own fee inside the swap (slot0's LP fee plus any protocol
 * fee); the launch's trade fee is the hook's, applied by quoteBuy / quoteSell.
 */
function quoteStep({
  sqrtPriceX96: raw,
  bands: bandsIn,
  liquidity,
  swapFee = 0,
  amountIn,
  zeroForOne,
  sqrtLowerX96: lowerIn,
  sqrtUpperX96: upperIn,
  tickSpacing,
}) {
  const bands = quoteBands({ bands: bandsIn, liquidity, sqrtLowerX96: lowerIn, sqrtUpperX96: upperIn });
  // The ladder's span; from the bands when the caller gave none.
  const fromBands = Boolean(bandsIn?.length);
  const sqrtLowerX96 = lowerIn || (fromBands ? bands.reduce((m, b) => (b.sqrtLowerX96 < m ? b.sqrtLowerX96 : m), bands[0].sqrtLowerX96) : undefined);
  const sqrtUpperX96 = upperIn || (fromBands ? bands.reduce((m, b) => (b.sqrtUpperX96 > m ? b.sqrtUpperX96 : m), bands[0].sqrtUpperX96) : undefined);

  let sqrtPriceX96 = raw;
  if (zeroForOne && sqrtUpperX96 && raw > sqrtUpperX96) sqrtPriceX96 = sqrtUpperX96;
  if (!zeroForOne && sqrtLowerX96 && raw < sqrtLowerX96) sqrtPriceX96 = sqrtLowerX96;
  const empty = { out: 0n, sqrtPriceAfter: sqrtPriceX96, priceImpact: 0, exceedsRange: false };
  const totalLiquidity = bands.reduce((sum, b) => sum + b.liquidity, 0n);
  if (!amountIn || amountIn <= 0n || !totalLiquidity || !sqrtPriceX96) return empty;
  const limit = zeroForOne ? sqrtLowerX96 : sqrtUpperX96;
  if (limit && (zeroForOne ? sqrtPriceX96 <= limit : sqrtPriceX96 >= limit)) return { ...empty, exceedsRange: true };

  const amountLessFee = mulDiv(amountIn, MAX_SWAP_FEE - BigInt(swapFee), MAX_SWAP_FEE);
  if (amountLessFee === 0n) return empty;

  const pastLimit = (p) => limit && (zeroForOne ? p <= limit : p >= limit);
  const beyond = (p, from) => (zeroForOne ? p < from : p > from);
  const edges = tickSpacing ? wordEdges(sqrtPriceX96, Number(tickSpacing), zeroForOne) : null;
  let wordEdge = edges ? edges.next().value : undefined;
  let price = sqrtPriceX96;
  let remaining = amountIn;
  let out = 0n;
  while (remaining > 0n && !(limit && price === limit)) {
    // A word edge the price already sits on is a zero-length step in v4: skip it.
    while (wordEdge !== undefined && !beyond(wordEdge, price)) wordEdge = edges.next().value;
    let target = edges ? wordEdge : zeroForOne ? limit || 1n : limit || MAX_UINT160;
    if (target === undefined) break; // past the end of the price scale with no limit
    // v4 also ends a step at every initialized tick: here, each band edge.
    const bandEdge = nextBandEdge(bands, price, zeroForOne);
    if (bandEdge !== undefined && !beyond(bandEdge, target)) target = bandEdge;
    // SwapMath.getSqrtPriceTarget: never step past the swap's price limit.
    if (pastLimit(target)) target = limit;
    if (target === price) break;
    const step = computeSwapStep(price, target, liquidityBetween(bands, price, target), remaining, swapFee, zeroForOne);
    remaining -= step.spent;
    out += step.out;
    price = step.sqrtNext;
  }

  // Impact vs. spot, fees excluded — the part of the cost that is the curve.
  const spot = zeroForOne ? rawPrice(sqrtPriceX96) : 1 / rawPrice(sqrtPriceX96);
  const atSpot = Number(amountLessFee) * spot;
  const priceImpact = atSpot > 0 ? Math.max(0, 1 - Number(out) / atSpot) : 0;

  return { out, sqrtPriceAfter: price, priceImpact, exceedsRange: remaining > 0n };
}

/**
 * The launch trade fee on a gross quote amount — the hook's
 * `FullMath.mulDivRoundingUp(amount, tradeFee, 1e6)`, so never less than the rate.
 * @param {bigint} amount     raw quote units
 * @param {number | bigint} tradeFee  pips (10_000 = 1%)
 */
export function tradeFeeOn(amount, tradeFee) {
  if (!amount || amount <= 0n || !tradeFee) return 0n;
  return mulDivRoundingUp(amount, BigInt(tradeFee), MAX_SWAP_FEE);
}

// ---------------------------------------------------------------------------
// Snipe tax — the buy rate inside a launch's first seconds
// ---------------------------------------------------------------------------

/**
 * Whether a launch's schedule ever charges more than its trade fee: a window, and
 * a starting rate above the fee (the hook charges the fee alone otherwise).
 * @param {number} tradeFee  pips
 * @param {{ startBps: number, duration: number, launchedAt: number } | null | undefined} snipeTax
 */
export function hasSnipeTax(tradeFee, snipeTax) {
  if (!snipeTax || !(snipeTax.duration > 0)) return false;
  return snipeTax.startBps * BPS_TO_PIPS > Number(tradeFee ?? 0);
}

/**
 * The rate, in pips, a buy pays at `nowSec` — UniV4LiquidityPlacer._buyRate to the
 * pip: `start − floor((start − tradeFee) × elapsed / duration)` while
 * `elapsed < duration` (start = startBps × 100), then the trade fee. A start at or
 * below the trade fee, a zero window or no schedule (a placer from before the
 * snipe tax) is the trade fee throughout.
 *
 * The rate never rises with time, so evaluating it at an EARLIER time never
 * quotes less than the chain will charge; callers pass a `nowSec` a little behind
 * the chain's (useLaunchBuyFee) for that reason. A `nowSec` before the launch
 * (a clock behind the block that placed it) counts as elapsed 0 — the top rate.
 *
 * @param {number} tradeFee  the launch's trade fee, pips
 * @param {{ startBps: number, duration: number, launchedAt: number } | null | undefined} snipeTax
 *   UniV4LiquidityPlacer.snipeTaxOf(token)
 * @param {number} nowSec    unix seconds
 * @returns {number} pips
 */
export function buyFeeAt(tradeFee, snipeTax, nowSec) {
  const base = Number(tradeFee ?? 0);
  if (!hasSnipeTax(base, snipeTax)) return base;
  const elapsed = Math.max(0, Math.floor(nowSec) - Number(snipeTax.launchedAt));
  if (elapsed >= snipeTax.duration) return base;
  const start = snipeTax.startBps * BPS_TO_PIPS;
  return start - Math.floor(((start - base) * elapsed) / snipeTax.duration);
}

/**
 * When a launch's snipe window closes (unix seconds), or null when it has none.
 * @param {number} tradeFee  pips
 * @param {{ startBps: number, duration: number, launchedAt: number } | null | undefined} snipeTax
 */
export function snipeWindowEnd(tradeFee, snipeTax) {
  return hasSnipeTax(tradeFee, snipeTax) ? Number(snipeTax.launchedAt) + snipeTax.duration : null;
}

/**
 * Quote a buy: exactly `quoteIn` raw quote units in, launch tokens out.
 * The hook takes the buy's fee off the top (`fee` = the rate of quoteIn, rounded
 * up) and the pool swaps the rest. Quote is currency0 → zeroForOne, toward the
 * ladder's floor; token is currency0 → oneForZero, toward the ceiling.
 *
 * A buy whose fee would be all of it reverts on-chain (`SwapTooSmallForFee`), and
 * so does one the ladder cannot fill in full when a fee is charged
 * (`PartialFillWithFee`): both quote no tokens out — the second with
 * `exceedsRange`, so the caller can say why.
 *
 * @param {object} p
 * @param {bigint} p.sqrtPriceX96       current price
 * @param {{ sqrtLowerX96: bigint, sqrtUpperX96: bigint, liquidity: bigint }[]} [p.bands]
 *                                      market.bands (normalizeBands); the swap steps at
 *                                      their edges. Without them, `liquidity` over the range
 * @param {bigint} [p.liquidity]        one band's liquidity, used only without `bands`
 * @param {number} [p.tradeFee=0]       the rate this buy pays, in pips: the launch's trade
 *                                      fee (market.tradeFee) or, inside the snipe window,
 *                                      buyFeeAt(market.tradeFee, market.snipeTax, now)
 * @param {number} [p.swapFee=0]        v4's own fee inside the swap — market.buySwapFee
 *                                      (LP fee, 0 on a launch pool, plus any protocol fee)
 * @param {bigint} p.quoteIn            raw quote units (wei for ETH), fee included
 * @param {boolean} [p.tokenIsCurrency0=false]
 * @param {bigint} [p.sqrtLowerX96]     the ladder's lower edge (from the bands when omitted)
 * @param {bigint} [p.sqrtUpperX96]     the ladder's upper edge (from the bands when omitted)
 * @param {number} [p.tickSpacing]      the pool's tick spacing — market.tickSpacing; without
 *                                      it the swap is quoted as one step, which can differ
 *                                      from v4 by rounding at its word edges
 * @returns {{ tokensOut: bigint, fee: bigint, sqrtPriceAfter: bigint, priceImpact: number, exceedsRange: boolean }}
 */
export function quoteBuy({ quoteIn, tradeFee = 0, tokenIsCurrency0 = false, ...pool }) {
  const fee = tradeFeeOn(quoteIn, tradeFee);
  if (quoteIn > 0n && fee >= quoteIn) {
    return { tokensOut: 0n, fee: 0n, sqrtPriceAfter: pool.sqrtPriceX96, priceImpact: 0, exceedsRange: false };
  }
  const { out, ...rest } = quoteStep({
    ...pool,
    amountIn: quoteIn == null ? quoteIn : quoteIn - fee,
    zeroForOne: !tokenIsCurrency0,
  });
  // The hook priced its fee on the whole amount, so a fill cut short at the ladder's
  // far edge reverts rather than spend part of it.
  if (rest.exceedsRange && fee > 0n) return { ...rest, tokensOut: 0n, fee: 0n };
  return { tokensOut: out, fee: out > 0n ? fee : 0n, ...rest };
}

/**
 * Quote a sell: exactly `tokensIn` raw launch-token units in, quote out — the
 * mirror of quoteBuy, back toward the launch price. The pool pays out its
 * amount, then the hook keeps the trade fee from it (rounded up), so the
 * seller receives `quoteOut` = pool payout − `fee`. A sell capped at the launch
 * price fills partly (the fee is on what the pool actually paid).
 *
 * @param {object} p
 * @param {bigint} p.sqrtPriceX96
 * @param {{ sqrtLowerX96: bigint, sqrtUpperX96: bigint, liquidity: bigint }[]} [p.bands]  as quoteBuy
 * @param {bigint} [p.liquidity]        as quoteBuy
 * @param {number} [p.tradeFee=0]       the launch's trade fee in pips — market.tradeFee
 * @param {number} [p.swapFee=0]        v4's own fee inside the swap — market.sellSwapFee
 * @param {bigint} p.tokensIn
 * @param {boolean} [p.tokenIsCurrency0=false]
 * @param {bigint} [p.sqrtLowerX96]
 * @param {bigint} [p.sqrtUpperX96]
 * @param {number} [p.tickSpacing]
 * @returns {{ quoteOut: bigint, fee: bigint, sqrtPriceAfter: bigint, priceImpact: number, exceedsRange: boolean }}
 */
export function quoteSell({ tokensIn, tradeFee = 0, tokenIsCurrency0 = false, ...pool }) {
  const { out, ...rest } = quoteStep({ ...pool, amountIn: tokensIn, zeroForOne: tokenIsCurrency0 });
  const fee = tradeFeeOn(out, tradeFee);
  return { quoteOut: out - fee, fee, ...rest };
}

/** Apply slippage tolerance (percent, e.g. "1") to a quoted amount. */
export function minimumReceived(amount, slippagePct) {
  const bps = BigInt(Math.round(Number(slippagePct || 0) * 100));
  return (amount * (10_000n - bps)) / 10_000n;
}

// ---------------------------------------------------------------------------
// Everything a card or token page needs, from raw reads
// ---------------------------------------------------------------------------

/**
 * The fee v4 itself charges inside a swap: the LP fee combined with the protocol fee
 * for that direction (ProtocolFeeLibrary.calculateSwapFee). slot0's protocolFee packs
 * two 12-bit values — low for zeroForOne, high for oneForZero. Which of those is a
 * buy depends on the pool's orientation (deriveMarketState picks). A launch pool's LP
 * fee is 0, so this is only ever a protocol fee; the launch's trade fee is the hook's,
 * separate (quoteBuy / quoteSell).
 * @param {number} protocolFee  slot0.protocolFee
 * @param {number} lpFee        slot0.lpFee
 * @param {boolean} zeroForOne  the swap's direction
 * @returns {number} hundredths of a bip
 */
export function swapFeeFor(protocolFee, lpFee, zeroForOne) {
  const proto = zeroForOne ? protocolFee & 0xfff : (protocolFee >> 12) & 0xfff;
  return proto + lpFee - Math.floor((proto * lpFee) / 1_000_000);
}

/** snipeTaxOf's [startBps, duration, launchedAt] (or that object) as numbers; null for none. */
function normalizeSnipeTax(raw) {
  if (!raw) return null;
  const [startBps, duration, launchedAt] = Array.isArray(raw)
    ? raw
    : [raw.startBps, raw.duration, raw.launchedAt];
  return { startBps: Number(startBps ?? 0), duration: Number(duration ?? 0), launchedAt: Number(launchedAt ?? 0) };
}

/** getPlacement's liquidityPreset as a number; null when the placement has none. */
function presetOf(placement) {
  const raw = placement.liquidityPreset;
  return raw == null ? null : Number(raw);
}

/**
 * Turn the raw reads for one launch into display state.
 *
 * @param {object} p
 * @param {`0x${string}`} p.slot0Word          extsload(poolStateSlot)
 * @param {`0x${string}`} p.liquidityWord      extsload(poolLiquiditySlot)
 * @param {{ tickLower: number, tickUpper: number, liquidity: bigint, tokenIsCurrency0?: boolean, tradeFee?: number, liquidityPreset?: number }} p.placement
 *   UniV4LiquidityPlacer.getPlacement(token): the whole ladder's span, the
 *   launch-price band's liquidity and the preset it was placed with
 * @param {{ tickLower: number, tickUpper: number, liquidity: bigint }[] | null} [p.bands]
 *   UniV4LiquidityPlacer.bandsOf(token); null or empty from a placer before liquidity
 *   presets, whose one position is the placement's range and liquidity
 * @param {bigint} p.wholeSupply               TOKEN_SUPPLY / 1e18
 * @param {{ address: string, symbol: string, decimals: number }} [p.quote]
 *   what the launch is paired with; carried through for formatting
 * @param {readonly [number, number, number] | { startBps: number, duration: number, launchedAt: number } | null} [p.snipeTax]
 *   UniV4LiquidityPlacer.snipeTaxOf(token) — positional as viem decodes it, or an
 *   object; null for a placer without one (it charges the trade fee alone)
 * @returns {object | null} null when the pool is not initialised (no placement)
 */
export function deriveMarketState({ slot0Word, liquidityWord, placement, bands: rawBands, wholeSupply, quote, snipeTax }) {
  if (!placement || !slot0Word) return null;
  const { sqrtPriceX96: poolSqrtPriceX96, tick, lpFee, protocolFee } = decodeSlot0(slot0Word);
  if (poolSqrtPriceX96 === 0n) return null;

  const tokenIsCurrency0 = Boolean(placement.tokenIsCurrency0);
  const tickLower = Number(placement.tickLower);
  const tickUpper = Number(placement.tickUpper);
  const activeLiquidity = BigInt(liquidityWord ?? 0n) & ((1n << 128n) - 1n);
  const bands = normalizeBands(rawBands, placement);

  const sqrtLowerX96 = sqrtPriceX96AtTick(tickLower);
  const sqrtUpperX96 = sqrtPriceX96AtTick(tickUpper);
  // The pool was initialised AT the ladder's token-only edge, so that IS the
  // launch price — exact.
  const launchSqrtX96 = tokenIsCurrency0 ? sqrtLowerX96 : sqrtUpperX96;

  // The price the ladder actually trades at. Outside it the pool has no
  // liquidity, and anyone can move its price there for free with a zero-amount
  // swap; the next trade crosses back to the edge at no cost. So the edge, not the
  // pushed pool price, is the token's price — for display and for quotes alike.
  const sqrtPriceX96 =
    poolSqrtPriceX96 > sqrtUpperX96 ? sqrtUpperX96 : poolSqrtPriceX96 < sqrtLowerX96 ? sqrtLowerX96 : poolSqrtPriceX96;

  const supply = BigInt(wholeSupply);
  return {
    quote: quote ?? null,
    tokenIsCurrency0,
    sqrtPriceX96,
    tick,
    // The launch's trade fee in pips (10_000 = 1%), charged by the hook in the quote
    // token on every buy and sell; fixed for the pool's life.
    tradeFee: Number(placement.tradeFee ?? 0),
    // Which ladder the supply was placed with (lib/liquidityPresets.js); null when the
    // placement does not say.
    liquidityPreset: presetOf(placement),
    // The launch's snipe-tax schedule, { startBps, duration, launchedAt } (seconds), or
    // null. A buy pays buyFeeAt(tradeFee, snipeTax, now): more than tradeFee for
    // `duration` seconds after launch. Sells never pay it.
    snipeTax: normalizeSnipeTax(snipeTax),
    // What v4 itself charges inside a buy / sell swap — the LP fee (0 on a launch pool)
    // plus any protocol fee. Quote with these as well as tradeFee, or a protocol fee
    // makes every quote (and its minimum-out) high. A buy is zeroForOne exactly when
    // the quote is currency0.
    buySwapFee: swapFeeFor(protocolFee, lpFee, !tokenIsCurrency0),
    sellSwapFee: swapFeeFor(protocolFee, lpFee, tokenIsCurrency0),
    // The whole ladder's span.
    tickLower,
    tickUpper,
    // The pool key's tick spacing: where v4 splits a swap into steps (quoteBuy / quoteSell).
    tickSpacing: placement.key?.tickSpacing != null ? Number(placement.key.tickSpacing) : undefined,
    sqrtLowerX96,
    sqrtUpperX96,
    launchSqrtX96,
    // The placer's positions, launch-price band first; quotes step across their edges.
    bands,
    // What the next buy trades against at this price.
    liquidity: tradableLiquidity({
      activeLiquidity,
      placementLiquidity: liquidityAt(bands, sqrtPriceX96, !tokenIsCurrency0),
    }),
    totalSupplyRaw: supply * WAD,
    // Quote raw units per whole token (coarse in a 6-decimal quote; see pricePerToken).
    price: pricePerToken(sqrtPriceX96, tokenIsCurrency0),
    // The price the pool actually opened at — the creator's requested valuation
    // snapped to a tick. Anything measuring "since launch" uses this.
    launchPrice: pricePerToken(launchSqrtX96, tokenIsCurrency0),
    fdv: fdvAt(sqrtPriceX96, supply, tokenIsCurrency0),
    launchFdv: fdvAt(launchSqrtX96, supply, tokenIsCurrency0),
    multiple: multipleSinceLaunch(sqrtPriceX96, launchSqrtX96, tokenIsCurrency0),
    soldFraction: bandsSoldFraction(sqrtPriceX96, bands, tokenIsCurrency0),
  };
}
