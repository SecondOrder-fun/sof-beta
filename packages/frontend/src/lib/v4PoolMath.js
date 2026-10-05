// src/lib/v4PoolMath.js
//
// Uniswap v4 pool state -> the numbers the launchpad UI shows: current price,
// FDV, the multiple since launch, how much supply has sold, and exact
// buy/sell quotes.
//
// Everything is derived from two reads with no quoter contract and no
// indexer: the pool's slot0 and liquidity (via PoolManager.extsload), plus the
// placement's tick range and orientation (UniV4LiquidityPlacer.getPlacement).
//
// Orientation — which side of the pool the launch token is on. v4 sorts the two
// currencies by address and prices the pool as currency1/currency0 in raw units:
//   - QUOTE is currency0 (always for ETH, address 0; and an ERC-20 below the
//     token): v4 price = TOKENS PER QUOTE. A buy (quote in) is zeroForOne and
//     moves sqrtPrice DOWN. The position is [minUsableTick, tickUpper] and the
//     pool opens at tickUpper.
//   - TOKEN is currency0 (`placement.tokenIsCurrency0`, an ERC-20 quote above the
//     token): v4 price = QUOTE PER TOKEN. A buy is oneForZero and moves sqrtPrice
//     UP. The position is [tickLower, maxUsableTick] and the pool opens at
//     tickLower.
// Either way the range runs from the launch price to the end of v4's price
// scale, so there is liquidity at every price and the token never sells out.
//
// Amounts are in raw units throughout: the quote token's (wei for ETH, 1e-6 for
// USDC) and the launch token's (always 18 decimals).
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
 * The position is the pool's only liquidity, so whenever the price is out of its
 * [lower, upper) range v4 reports active liquidity as 0, yet the next swap back
 * toward the range crosses that edge at zero cost and trades against the whole
 * position. Range ends that hit this:
 *   - A launch whose quote is currency0 (every ETH launch) opens EXACTLY on the
 *     upper tick, outside the half-open range, so the first buy would quote nothing.
 *   - A price parked on the upper edge of a token-is-currency0 range — the far
 *     end of the price scale — reads 0 the same way.
 * This returns what the swap will really use; the quote functions cap each
 * direction at the range edge it cannot cross.
 *
 * @param {{ activeLiquidity: bigint, placementLiquidity: bigint }} s
 */
export function tradableLiquidity({ activeLiquidity, placementLiquidity }) {
  return activeLiquidity > 0n ? activeLiquidity : placementLiquidity;
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
 * Measured from the pool's launch sqrtPrice (the range's start edge), not from
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
 * sold, from the position's own token balance.
 *
 * Quote is currency0: the position holds amount1 = L·(√P − √P_lower) tokens, all
 * of the supply at launch (√P_upper). Token is currency0: it holds
 * amount0 = L·(1/√P − 1/√P_upper), all of it at launch (√P_lower). L cancels, so
 * this is a pure function of where the price sits in the range.
 *
 * The range runs to the end of v4's price scale, so 100% is never reached and
 * the scale is not linear in price: half the supply has sold at 4× the launch
 * price, 90% at 100×. There is no graduation; this is the launch's progress.
 * @param {bigint} sqrtNowX96
 * @param {number} tickLower
 * @param {number} tickUpper
 * @param {boolean} [tokenIsCurrency0=false]
 */
export function soldFraction(sqrtNowX96, tickLower, tickUpper, tokenIsCurrency0 = false) {
  const now = Number(sqrtNowX96);
  const lo = Number(sqrtPriceX96AtTick(tickLower));
  const hi = Number(sqrtPriceX96AtTick(tickUpper));
  if (!(hi > lo) || !(now > 0)) return 0;
  const f = tokenIsCurrency0 ? (1 / lo - 1 / now) / (1 / lo - 1 / hi) : (hi - now) / (hi - lo);
  return Math.min(1, Math.max(0, f));
}

/**
 * What `rawTokens` of a launch token are worth in its quote, raw units, at the
 * market's price (a prize pool, a fee balance).
 * @param {bigint} rawTokens
 * @param {{ fdv: bigint, totalSupplyRaw: bigint } | null | undefined} market
 * @returns {bigint | null} null without a priced market
 */
export function tokensToQuote(rawTokens, market) {
  if (rawTokens == null || !market?.fdv || !market.totalSupplyRaw) return null;
  return (BigInt(rawTokens) * market.fdv) / market.totalSupplyRaw;
}

// ---------------------------------------------------------------------------
// Quotes — SwapMath.computeSwapStep for one in-range step
// ---------------------------------------------------------------------------

/**
 * Exact input of currency0 (zeroForOne): the price falls.
 * SqrtPriceMath.getNextSqrtPriceFromAmount0RoundingUp(add = true), capped at
 * `limit`; out is getAmount1Delta(roundUp = false).
 */
function stepZeroForOne(sqrtPriceX96, liquidity, amountLessFee, limit) {
  const numerator1 = liquidity << 96n;
  const product = amountLessFee * sqrtPriceX96;
  const denominator = numerator1 + product;
  let sqrtNext =
    denominator >= numerator1
      ? mulDivRoundingUp(numerator1, sqrtPriceX96, denominator)
      : divRoundingUp(numerator1, numerator1 / sqrtPriceX96 + amountLessFee);
  let capped = false;
  if (limit && sqrtNext < limit) {
    sqrtNext = limit;
    capped = true;
  }
  return { out: mulDiv(liquidity, sqrtPriceX96 - sqrtNext, Q96), sqrtNext, capped };
}

/**
 * Exact input of currency1 (oneForZero): the price rises.
 * SqrtPriceMath.getNextSqrtPriceFromAmount1RoundingDown(add = true), capped at
 * `limit`; out is getAmount0Delta(roundUp = false).
 */
function stepOneForZero(sqrtPriceX96, liquidity, amountLessFee, limit) {
  let sqrtNext = sqrtPriceX96 + (amountLessFee << 96n) / liquidity;
  let capped = false;
  if (limit && sqrtNext > limit) {
    sqrtNext = limit;
    capped = true;
  }
  return { out: mulDiv(liquidity << 96n, sqrtNext - sqrtPriceX96, sqrtNext) / sqrtPriceX96, sqrtNext, capped };
}

/** v4's raw price — currency1 per currency0 — as a float, for price impact only. */
const rawPrice = (sqrtPriceX96) => Number(sqrtPriceX96) ** 2 / 2 ** 192;

/**
 * One exact-input swap step in either direction, with the range clamp both
 * quotes share.
 *
 * Outside [lower, upper] the pool has no liquidity, and anyone can push its
 * price there with a zero-amount swap; the next trade crosses back to the edge
 * for free and fills from there. So a price past the edge this swap starts
 * from is quoted from that edge — quoting from the pushed price would promise
 * more than the fill, and the minimum-out built from it would revert. A price
 * at or past the edge this swap moves TOWARD has nothing left to fill.
 */
function quoteStep({ sqrtPriceX96: raw, liquidity, lpFee, amountIn, zeroForOne, sqrtLowerX96, sqrtUpperX96 }) {
  let sqrtPriceX96 = raw;
  if (zeroForOne && sqrtUpperX96 && raw > sqrtUpperX96) sqrtPriceX96 = sqrtUpperX96;
  if (!zeroForOne && sqrtLowerX96 && raw < sqrtLowerX96) sqrtPriceX96 = sqrtLowerX96;
  const empty = { out: 0n, sqrtPriceAfter: sqrtPriceX96, priceImpact: 0, exceedsRange: false };
  if (!amountIn || amountIn <= 0n || !liquidity || !sqrtPriceX96) return empty;
  const limit = zeroForOne ? sqrtLowerX96 : sqrtUpperX96;
  if (limit && (zeroForOne ? sqrtPriceX96 <= limit : sqrtPriceX96 >= limit)) return { ...empty, exceedsRange: true };

  const amountLessFee = mulDiv(amountIn, MAX_SWAP_FEE - BigInt(lpFee), MAX_SWAP_FEE);
  if (amountLessFee === 0n) return empty;

  const { out, sqrtNext, capped } = zeroForOne
    ? stepZeroForOne(sqrtPriceX96, liquidity, amountLessFee, limit)
    : stepOneForZero(sqrtPriceX96, liquidity, amountLessFee, limit);

  // Impact vs. spot, fee excluded — the part of the cost that is the curve.
  const spot = zeroForOne ? rawPrice(sqrtPriceX96) : 1 / rawPrice(sqrtPriceX96);
  const atSpot = Number(amountLessFee) * spot;
  const priceImpact = atSpot > 0 ? Math.max(0, 1 - Number(out) / atSpot) : 0;

  return { out, sqrtPriceAfter: sqrtNext, priceImpact, exceedsRange: capped };
}

/**
 * Quote a buy: exactly `quoteIn` raw quote units in, launch tokens out.
 * Quote is currency0 → zeroForOne, toward the range floor; token is currency0 →
 * oneForZero, toward the ceiling.
 *
 * @param {object} p
 * @param {bigint} p.sqrtPriceX96       current price
 * @param {bigint} p.liquidity          from tradableLiquidity()
 * @param {number} p.lpFee              the swap fee in hundredths of a bip (10_000 = 1%) —
 *                                      pass market.buyFee, which includes any protocol fee
 * @param {bigint} p.quoteIn            raw quote units (wei for ETH)
 * @param {boolean} [p.tokenIsCurrency0=false]
 * @param {bigint} [p.sqrtLowerX96]     the range's lower edge
 * @param {bigint} [p.sqrtUpperX96]     the range's upper edge
 * @returns {{ tokensOut: bigint, sqrtPriceAfter: bigint, priceImpact: number, exceedsRange: boolean }}
 */
export function quoteBuy({ quoteIn, tokenIsCurrency0 = false, ...pool }) {
  const { out, ...rest } = quoteStep({ ...pool, amountIn: quoteIn, zeroForOne: !tokenIsCurrency0 });
  return { tokensOut: out, ...rest };
}

/**
 * Quote a sell: exactly `tokensIn` raw launch-token units in, quote out — the
 * mirror of quoteBuy, back toward the launch price.
 *
 * @param {object} p
 * @param {bigint} p.sqrtPriceX96
 * @param {bigint} p.liquidity
 * @param {number} p.lpFee              the swap fee — pass market.sellFee
 * @param {bigint} p.tokensIn
 * @param {boolean} [p.tokenIsCurrency0=false]
 * @param {bigint} [p.sqrtLowerX96]
 * @param {bigint} [p.sqrtUpperX96]
 * @returns {{ quoteOut: bigint, sqrtPriceAfter: bigint, priceImpact: number, exceedsRange: boolean }}
 */
export function quoteSell({ tokensIn, tokenIsCurrency0 = false, ...pool }) {
  const { out, ...rest } = quoteStep({ ...pool, amountIn: tokensIn, zeroForOne: tokenIsCurrency0 });
  return { quoteOut: out, ...rest };
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
 * The fee v4 actually charges on a swap: the LP fee combined with the protocol fee
 * for that direction (ProtocolFeeLibrary.calculateSwapFee). slot0's protocolFee packs
 * two 12-bit values — low for zeroForOne, high for oneForZero. Which of those is a
 * buy depends on the pool's orientation (deriveMarketState picks).
 * @param {number} protocolFee  slot0.protocolFee
 * @param {number} lpFee        slot0.lpFee
 * @param {boolean} zeroForOne  the swap's direction
 * @returns {number} hundredths of a bip
 */
export function swapFeeFor(protocolFee, lpFee, zeroForOne) {
  const proto = zeroForOne ? protocolFee & 0xfff : (protocolFee >> 12) & 0xfff;
  return proto + lpFee - Math.floor((proto * lpFee) / 1_000_000);
}

/**
 * Turn the raw reads for one launch into display state.
 *
 * @param {object} p
 * @param {`0x${string}`} p.slot0Word          extsload(poolStateSlot)
 * @param {`0x${string}`} p.liquidityWord      extsload(poolLiquiditySlot)
 * @param {{ tickLower: number, tickUpper: number, liquidity: bigint, tokenIsCurrency0?: boolean }} p.placement
 * @param {bigint} p.wholeSupply               TOKEN_SUPPLY / 1e18
 * @param {{ address: string, symbol: string, decimals: number }} [p.quote]
 *   what the launch is paired with; carried through for formatting
 * @returns {object | null} null when the pool is not initialised (no placement)
 */
export function deriveMarketState({ slot0Word, liquidityWord, placement, wholeSupply, quote }) {
  if (!placement || !slot0Word) return null;
  const { sqrtPriceX96: poolSqrtPriceX96, tick, lpFee, protocolFee } = decodeSlot0(slot0Word);
  if (poolSqrtPriceX96 === 0n) return null;

  const tokenIsCurrency0 = Boolean(placement.tokenIsCurrency0);
  const tickLower = Number(placement.tickLower);
  const tickUpper = Number(placement.tickUpper);
  const placementLiquidity = BigInt(placement.liquidity);
  const activeLiquidity = BigInt(liquidityWord ?? 0n) & ((1n << 128n) - 1n);

  const sqrtLowerX96 = sqrtPriceX96AtTick(tickLower);
  const sqrtUpperX96 = sqrtPriceX96AtTick(tickUpper);
  // The pool was initialised AT the range's token-only edge, so that IS the
  // launch price — exact.
  const launchSqrtX96 = tokenIsCurrency0 ? sqrtLowerX96 : sqrtUpperX96;

  // The price the position actually trades at. Outside the range the pool has
  // no liquidity, and anyone can move its price there for free with a
  // zero-amount swap; the next trade crosses back to the edge at no cost. So the
  // edge, not the pushed pool price, is the token's price — for display and for
  // quotes alike.
  const sqrtPriceX96 =
    poolSqrtPriceX96 > sqrtUpperX96 ? sqrtUpperX96 : poolSqrtPriceX96 < sqrtLowerX96 ? sqrtLowerX96 : poolSqrtPriceX96;

  const supply = BigInt(wholeSupply);
  return {
    quote: quote ?? null,
    tokenIsCurrency0,
    sqrtPriceX96,
    tick,
    lpFee,
    // What a buy / sell is actually charged — LP fee plus any protocol fee. Quote with
    // these, not lpFee, or a protocol fee makes every quote (and its minimum-out) high.
    // A buy is zeroForOne exactly when the quote is currency0.
    buyFee: swapFeeFor(protocolFee, lpFee, !tokenIsCurrency0),
    sellFee: swapFeeFor(protocolFee, lpFee, tokenIsCurrency0),
    tickLower,
    tickUpper,
    sqrtLowerX96,
    sqrtUpperX96,
    launchSqrtX96,
    liquidity: tradableLiquidity({ activeLiquidity, placementLiquidity }),
    totalSupplyRaw: supply * WAD,
    // Quote raw units per whole token (coarse in a 6-decimal quote; see pricePerToken).
    price: pricePerToken(sqrtPriceX96, tokenIsCurrency0),
    // The price the pool actually opened at — the creator's requested valuation
    // snapped to a tick. Anything measuring "since launch" uses this.
    launchPrice: pricePerToken(launchSqrtX96, tokenIsCurrency0),
    fdv: fdvAt(sqrtPriceX96, supply, tokenIsCurrency0),
    launchFdv: fdvAt(launchSqrtX96, supply, tokenIsCurrency0),
    multiple: multipleSinceLaunch(sqrtPriceX96, launchSqrtX96, tokenIsCurrency0),
    soldFraction: soldFraction(sqrtPriceX96, tickLower, tickUpper, tokenIsCurrency0),
  };
}
