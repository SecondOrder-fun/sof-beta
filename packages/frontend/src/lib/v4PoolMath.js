// src/lib/v4PoolMath.js
//
// Uniswap v4 pool state -> the numbers the launchpad UI shows: current price,
// FDV, the multiple since launch, how much supply has sold, and exact
// buy/sell quotes.
//
// Everything is derived from two reads with no quoter contract and no
// indexer: the pool's slot0 and liquidity (via PoolManager.extsload), plus the
// placement's tick range (UniV4LiquidityPlacer.getPlacement).
//
// Orientation, fixed for every launch pool: ETH is address(0) so it is always
// currency0, and the launch token is always currency1. v4 prices are
// currency1/currency0 = TOKENS PER ETH. So a buy (ETH in) is zeroForOne and
// moves sqrtPrice DOWN; the token getting dearer is a FALLING sqrtPrice.
//
// The swap math mirrors v4-core's SqrtPriceMath and SwapMath for a single
// in-range step, and is pinned against a real PoolManager swap by
// test_fixture_quoteMathForFrontend in the contracts package.

import { encodePacked, keccak256 } from 'viem';

export const Q96 = 1n << 96n;
const Q192 = 1n << 192n;
const WAD = 10n ** 18n;
/** v4 fees are in hundredths of a bip: 1_000_000 = 100%. */
const MAX_SWAP_FEE = 1_000_000n;
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
 * The liquidity a swap from the current price will actually trade against.
 *
 * At launch the price sits EXACTLY on the position's upper tick, and a range is
 * [lower, upper), so v4 reports active liquidity as 0 — the position is not yet
 * "in range". The first buy crosses the upper tick at zero cost and then trades
 * against the full position. Quoting with the reported 0 would tell the first
 * buyer they receive nothing; this returns what the swap will really use.
 *
 * @param {{ activeLiquidity: bigint, placementLiquidity: bigint, tick: number, tickUpper: number }} s
 */
export function tradableLiquidity({ activeLiquidity, placementLiquidity, tick, tickUpper }) {
  if (activeLiquidity > 0n) return activeLiquidity;
  return tick >= tickUpper ? placementLiquidity : 0n;
}

// ---------------------------------------------------------------------------
// Price, valuation, progress
// ---------------------------------------------------------------------------

/** sqrt(1.0001^tick) as a float — for display-only ratios (supply sold). */
export function sqrtRatioAtTick(tick) {
  return Math.pow(1.0001, tick / 2);
}

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
 * whole supply. A quote may never promise more than the position holds.
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

/**
 * Wei of ETH per WHOLE token at `sqrtPriceX96`.
 * v4 price is tokens-per-ETH = (sqrtP / 2^96)^2, and both sides are 18 dp, so
 * the raw ratio is the whole-token ratio; invert it for ETH per token.
 */
export function priceWeiPerToken(sqrtPriceX96) {
  if (!sqrtPriceX96) return 0n;
  return (WAD * Q192) / (sqrtPriceX96 * sqrtPriceX96);
}

/** Implied fully diluted valuation in wei. */
export function fdvWei(sqrtPriceX96, wholeSupply) {
  return priceWeiPerToken(sqrtPriceX96) * BigInt(wholeSupply);
}

/**
 * How many times the price has multiplied since launch.
 * Measured from the launch sqrtPrice (the position's upper tick), not from the
 * creator's requested start price, which the placer rounds down to a tick — so
 * a fresh launch reads exactly 1×.
 */
export function multipleSinceLaunch(sqrtNowX96, sqrtLaunchX96) {
  if (!sqrtNowX96 || !sqrtLaunchX96) return 1;
  const r = Number(sqrtLaunchX96) / Number(sqrtNowX96);
  return r * r;
}

/**
 * Fraction of the placed supply that has left the pool, 0..1.
 *
 * The position holds amount1 = L·(√P − √P_lower) of the token, so at launch
 * (√P = √P_upper) it holds everything and at √P_lower it holds nothing. L
 * cancels, leaving a pure function of where the price sits in the range.
 * This is the launchpad's honest progress metric: there is no graduation.
 */
export function soldFraction(sqrtNowX96, tickLower, tickUpper) {
  const now = Number(sqrtNowX96) / 2 ** 96;
  const lo = sqrtRatioAtTick(tickLower);
  const hi = sqrtRatioAtTick(tickUpper);
  if (!(hi > lo)) return 0;
  const f = (hi - now) / (hi - lo);
  return Math.min(1, Math.max(0, f));
}

// ---------------------------------------------------------------------------
// Quotes — SwapMath.computeSwapStep for one in-range step
// ---------------------------------------------------------------------------

/**
 * Quote a buy: exactly `ethIn` wei of ETH in, tokens out (zeroForOne).
 *
 * @param {object} p
 * @param {bigint} p.sqrtPriceX96   current price
 * @param {bigint} p.liquidity      from tradableLiquidity()
 * @param {number} p.lpFee          the swap fee in hundredths of a bip (10_000 = 1%) —
 *                                  pass market.buyFee, which includes any protocol fee
 * @param {bigint} p.ethIn          wei
 * @param {bigint} [p.sqrtLowerX96] position floor; a buy past it is capped
 * @returns {{ tokensOut: bigint, sqrtPriceAfter: bigint, priceImpact: number, exceedsRange: boolean }}
 */
export function quoteBuy({ sqrtPriceX96, liquidity, lpFee, ethIn, sqrtLowerX96 }) {
  const empty = { tokensOut: 0n, sqrtPriceAfter: sqrtPriceX96, priceImpact: 0, exceedsRange: false };
  if (!ethIn || ethIn <= 0n || !liquidity || !sqrtPriceX96) return empty;

  const amountLessFee = mulDiv(ethIn, MAX_SWAP_FEE - BigInt(lpFee), MAX_SWAP_FEE);
  if (amountLessFee === 0n) return empty;

  // SqrtPriceMath.getNextSqrtPriceFromAmount0RoundingUp(add = true)
  const numerator1 = liquidity << 96n;
  const product = amountLessFee * sqrtPriceX96;
  const denominator = numerator1 + product;
  let sqrtNext =
    denominator >= numerator1
      ? mulDivRoundingUp(numerator1, sqrtPriceX96, denominator)
      : divRoundingUp(numerator1, numerator1 / sqrtPriceX96 + amountLessFee);

  let exceedsRange = false;
  if (sqrtLowerX96 && sqrtNext < sqrtLowerX96) {
    sqrtNext = sqrtLowerX96;
    exceedsRange = true;
  }

  // SqrtPriceMath.getAmount1Delta(roundUp = false)
  const tokensOut = mulDiv(liquidity, sqrtPriceX96 - sqrtNext, Q96);

  // Impact vs. spot, fee excluded — the part of the cost that is the curve.
  const spotTokensPerEth = Number(sqrtPriceX96) ** 2 / 2 ** 192;
  const atSpot = Number(amountLessFee) * spotTokensPerEth;
  const priceImpact = atSpot > 0 ? Math.max(0, 1 - Number(tokensOut) / atSpot) : 0;

  return { tokensOut, sqrtPriceAfter: sqrtNext, priceImpact, exceedsRange };
}

/**
 * Quote a sell: exactly `tokensIn` raw token units in, ETH out (oneForZero).
 *
 * @param {object} p
 * @param {bigint} p.sqrtPriceX96
 * @param {bigint} p.liquidity
 * @param {number} p.lpFee          the swap fee — pass market.sellFee
 * @param {bigint} p.tokensIn
 * @param {bigint} [p.sqrtUpperX96] launch price; there is no liquidity to sell into above it
 * @returns {{ ethOut: bigint, sqrtPriceAfter: bigint, priceImpact: number, exceedsRange: boolean }}
 */
export function quoteSell({ sqrtPriceX96, liquidity, lpFee, tokensIn, sqrtUpperX96 }) {
  const empty = { ethOut: 0n, sqrtPriceAfter: sqrtPriceX96, priceImpact: 0, exceedsRange: false };
  if (!tokensIn || tokensIn <= 0n || !liquidity || !sqrtPriceX96) return empty;

  const amountLessFee = mulDiv(tokensIn, MAX_SWAP_FEE - BigInt(lpFee), MAX_SWAP_FEE);
  if (amountLessFee === 0n) return empty;

  // SqrtPriceMath.getNextSqrtPriceFromAmount1RoundingDown(add = true)
  let sqrtNext = sqrtPriceX96 + (amountLessFee << 96n) / liquidity;

  let exceedsRange = false;
  if (sqrtUpperX96 && sqrtNext > sqrtUpperX96) {
    sqrtNext = sqrtUpperX96;
    exceedsRange = true;
  }

  // SqrtPriceMath.getAmount0Delta(sqrtA = current, sqrtB = next, roundUp = false)
  const ethOut = mulDiv(liquidity << 96n, sqrtNext - sqrtPriceX96, sqrtNext) / sqrtPriceX96;

  const spotEthPerToken = 2 ** 192 / Number(sqrtPriceX96) ** 2;
  const atSpot = Number(amountLessFee) * spotEthPerToken;
  const priceImpact = atSpot > 0 ? Math.max(0, 1 - Number(ethOut) / atSpot) : 0;

  return { ethOut, sqrtPriceAfter: sqrtNext, priceImpact, exceedsRange };
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
 * Turn the raw reads for one launch into display state.
 *
 * @param {object} p
 * @param {`0x${string}`} p.slot0Word          extsload(poolStateSlot)
 * @param {`0x${string}`} p.liquidityWord      extsload(poolLiquiditySlot)
 * @param {{ tickLower: number, tickUpper: number, liquidity: bigint }} p.placement
 * @param {bigint} p.wholeSupply               TOKEN_SUPPLY / 1e18
 * @returns {object | null} null when the pool is not initialised (no placement)
 */
/**
 * The fee v4 actually charges on a swap: the LP fee combined with the protocol fee
 * for that direction (ProtocolFeeLibrary.calculateSwapFee). slot0's protocolFee packs
 * two 12-bit values — low for zeroForOne (buys here), high for oneForZero (sells).
 * @param {number} protocolFee  slot0.protocolFee
 * @param {number} lpFee        slot0.lpFee
 * @param {boolean} zeroForOne  true for a buy (ETH in), false for a sell
 * @returns {number} hundredths of a bip
 */
export function swapFeeFor(protocolFee, lpFee, zeroForOne) {
  const proto = zeroForOne ? protocolFee & 0xfff : (protocolFee >> 12) & 0xfff;
  return proto + lpFee - Math.floor((proto * lpFee) / 1_000_000);
}

export function deriveMarketState({ slot0Word, liquidityWord, placement, wholeSupply }) {
  if (!placement || !slot0Word) return null;
  const { sqrtPriceX96, tick, lpFee, protocolFee } = decodeSlot0(slot0Word);
  if (sqrtPriceX96 === 0n) return null;

  const tickLower = Number(placement.tickLower);
  const tickUpper = Number(placement.tickUpper);
  const placementLiquidity = BigInt(placement.liquidity);
  const activeLiquidity = BigInt(liquidityWord ?? 0n) & ((1n << 128n) - 1n);

  // The pool was initialised AT tickUpper, so that IS the launch price — exact.
  const launchSqrtX96 = sqrtPriceX96AtTick(tickUpper);
  const sqrtLowerX96 = sqrtPriceX96AtTick(tickLower);

  return {
    sqrtPriceX96,
    tick,
    lpFee,
    // What a buy / sell is actually charged — LP fee plus any protocol fee. Quote with
    // these, not lpFee, or a protocol fee makes every quote (and its minimum-out) high.
    buyFee: swapFeeFor(protocolFee, lpFee, true),
    sellFee: swapFeeFor(protocolFee, lpFee, false),
    tickLower,
    tickUpper,
    launchSqrtX96,
    sqrtLowerX96,
    liquidity: tradableLiquidity({ activeLiquidity, placementLiquidity, tick, tickUpper }),
    priceWei: priceWeiPerToken(sqrtPriceX96),
    // The price the pool actually opened at — the creator's requested start
    // price rounded to a tick. Anything measuring "since launch" uses this.
    launchPriceWei: priceWeiPerToken(launchSqrtX96),
    fdvWei: fdvWei(sqrtPriceX96, wholeSupply),
    launchFdvWei: fdvWei(launchSqrtX96, wholeSupply),
    // What the whole supply is worth once the last token has sold — the far
    // end of the supply-sold bar.
    selloutFdvWei: fdvWei(sqrtLowerX96, wholeSupply),
    multiple: multipleSinceLaunch(sqrtPriceX96, launchSqrtX96),
    soldFraction: soldFraction(sqrtPriceX96, tickLower, tickUpper),
  };
}
