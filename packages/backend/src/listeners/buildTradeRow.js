/**
 * buildTradeRow
 *
 * Maps a Uniswap v4 PoolManager `Swap` log on a launch pool onto a
 * `launch_trades` row, and works out who actually traded.
 *
 * Pure, and kept out of launchTradeListener for the same reason as
 * buildLaunchRow: the listener imports viemClient at load (which needs
 * NETWORK), and this is the mapping most likely to be subtly wrong.
 *
 * Four facts it rests on, the first two pinned by
 * contracts/test/UniV4LaunchRouter.t.sol:test_swapEventSignConvention_forTheIndexer:
 *
 *   - amount0 / amount1 are the CALLER's deltas: negative = paid in. A swap that
 *     pays the QUOTE in is a BUY. (IPoolManager's own doc comment reads as the
 *     opposite sign; the test pins behaviour.)
 *   - `sender` is whatever called PoolManager.swap — a router, not the trader.
 *     attributeTrader recovers the real account from the launch router's own
 *     event, paired to the swap by log order.
 *   - Which side the quote is on depends on the launch. v4 sorts currencies by
 *     address: ETH (address 0) and an ERC-20 below the token are currency0; an
 *     ERC-20 above the token makes the TOKEN currency0 (`tokenIsCurrency0`).
 *     Amounts, side and price are all read from the quote side accordingly.
 *   - Swap's amounts EXCLUDE the trade fee (contracts 0.42.0). Launch pools have
 *     a zero LP fee (`Swap.fee` = 0); the placer, as the pool's v4 hook, takes the
 *     creator's `tradeFee` in the quote token — plus, on a buy in a launch's first
 *     seconds, the snipe tax — and emits `TradeFeeTaken(poolId, token, fee,
 *     snipeSurcharge)` right after the Swap (tradeFeeOf pairs the two; `fee` is
 *     the whole fee). The stored
 *     `quote_amount` is what the trader paid or got: a BUY is |pool quote| + fee,
 *     a SELL pool quote − fee; `fee_amount` is the fee. A pool from an earlier
 *     launchpad charged a 1% LP fee instead (`Swap.fee` ≠ 0), which is already
 *     inside its amounts and is not reported apart (`fee_amount` null).
 */

import { decodeEventLog } from "viem";

const Q192 = 1n << 192n;
/**
 * 1e18 (raw token units per whole launch token, which is always 18 dp) times
 * 1e18 (the e18 fixed-point scale of the stored price).
 */
const E36 = 10n ** 36n;

/**
 * The price at a sqrtPriceX96, as quote raw units per WHOLE launch token × 1e18
 * (`launch_trades.price_e18`), floored. The 1e18 scale keeps a 6-decimal quote's
 * precision: a 2,500 USDC launch is 2.5 raw USDC units per token, which an
 * integer of raw units would floor to 2.
 *
 * v4's raw price is (sqrtPriceX96 / 2^96)^2 = currency1/currency0 in raw units:
 * raw tokens per raw quote when the quote is currency0 (inverted here), raw quote
 * per raw token when the token is. Both scales are applied before the one
 * division, so nothing is lost to an intermediate floor:
 *   token is currency0:  sqrt^2 * 1e36 / 2^192
 *   quote is currency0:  2^192 * 1e36 / sqrt^2
 * @param {bigint | string | number} sqrtPriceX96
 * @param {boolean} [tokenIsCurrency0]
 * @returns {bigint}
 */
export function priceE18(sqrtPriceX96, tokenIsCurrency0 = false) {
  const s = BigInt(sqrtPriceX96 ?? 0);
  if (s === 0n) return 0n;
  return tokenIsCurrency0 ? (s * s * E36) / Q192 : (Q192 * E36) / (s * s);
}

/** Whether `token` sorts below `quote` — i.e. is currency0 of their v4 pool. */
export function tokenIsCurrency0(token, quote) {
  return BigInt(token) < BigInt(quote ?? 0);
}

/** The swap's deltas split into quote side and token side. */
function sides(a, tokenFirst) {
  const amount0 = BigInt(a.amount0);
  const amount1 = BigInt(a.amount1);
  return tokenFirst ? { quote: amount1, token: amount0 } : { quote: amount0, token: amount1 };
}

const abs = (x) => (x < 0n ? -x : x);

/**
 * @param {object} log      viem-decoded Swap log
 * @param {object} ctx
 * @param {string} ctx.token        the launch token this pool trades
 * @param {boolean} [ctx.tokenIsCurrency0]  the pool's orientation (false for ETH)
 * @param {number} [ctx.blockTimeSec]
 * @param {string} [ctx.trader]     from attributeTrader; falls back to the swap sender
 * @param {bigint | null} [ctx.fee] the hook's trade fee on this swap (tradeFeeOf), in
 *   quote raw units; null/omitted = not known apart from the amounts (stored null)
 * @returns {object | null}
 */
export function buildTradeRow(log, { token, tokenIsCurrency0: tokenFirst = false, blockTimeSec, trader, fee } = {}) {
  const a = log?.args;
  if (!a || a.amount0 == null || a.amount1 == null || !token) return null;

  const { quote, token: tokenDelta } = sides(a, tokenFirst);
  if (quote === 0n && tokenDelta === 0n) return null; // zero-size swap: nothing traded

  const buy = quote < 0n;
  const feeAmount = fee == null ? null : BigInt(fee);
  // Trader-facing: the fee is on top of what a buyer paid the pool, and out of
  // what the pool paid a seller. The hook never takes more than a sell's output
  // (its fee is a fraction of it), so the floor at 0 only guards a bad pairing.
  let quoteAmount = abs(quote);
  if (feeAmount != null) {
    quoteAmount = buy ? quoteAmount + feeAmount : quoteAmount - feeAmount;
    if (quoteAmount < 0n) quoteAmount = 0n;
  }

  return {
    tx_hash: log.transactionHash,
    log_index: Number(log.logIndex),
    token_address: token,
    pool_id: a.id,
    trader: trader || a.sender || null,
    side: buy ? "BUY" : "SELL",
    quote_amount: quoteAmount.toString(),
    fee_amount: feeAmount == null ? null : feeAmount.toString(),
    token_amount: abs(tokenDelta).toString(),
    price_e18: priceE18(a.sqrtPriceX96, tokenFirst).toString(),
    tick: a.tick != null ? Number(a.tick) : null,
    block_number: Number(log.blockNumber),
    block_time: blockTimeSec != null ? new Date(Number(blockTimeSec) * 1000).toISOString() : null,
  };
}

/**
 * Find who really traded, from the receipt of the swap's transaction.
 *
 * The launch router (the swap's `sender`) emits Bought/Sold right after each
 * swap it makes, naming the account: the recipient of a buy, the payer of a
 * sell. That event is trusted only when ALL of these hold; otherwise this
 * returns null and the row keeps the sender:
 *
 *   - the swap's sender is a known launch router (TokenLaunchpad.router()).
 *     Any contract can call PoolManager.swap and emit a look-alike event about
 *     itself; only our router's word counts.
 *   - the event is emitted BY that sender. Any contract can emit a log with
 *     the Bought signature into the same transaction.
 *   - it is the event paired with THIS swap. One transaction can hold several
 *     router swaps (a batched buy-then-sell). Walking the receipt in log order,
 *     each router event pairs with the earliest unpaired Swap from that router
 *     before it.
 *   - it names this swap's token, and its kind matches the swap's side
 *     (Bought for a BUY, Sold for a SELL).
 *
 * @param {object[]} receiptLogs  raw logs from the transaction receipt
 * @param {object} swapLog        the viem-decoded Swap log being attributed
 * @param {object} ctx
 * @param {string} ctx.token                  the launch token of the swap's pool
 * @param {boolean} [ctx.tokenIsCurrency0]    the pool's orientation (false for ETH)
 * @param {Iterable<string>} ctx.routers      trusted launch router addresses
 * @param {string} ctx.poolManager            the v4 PoolManager (emitter of Swap)
 * @param {import('viem').Abi} ctx.poolManagerAbi
 * @param {import('viem').Abi} ctx.routerAbi
 * @returns {string | null}
 */
export function attributeTrader(
  receiptLogs,
  swapLog,
  { token, tokenIsCurrency0: tokenFirst = false, routers, poolManager, poolManagerAbi, routerAbi } = {},
) {
  const a = swapLog?.args;
  if (!receiptLogs?.length || !a?.sender || a.amount0 == null || a.amount1 == null || !poolManager) return null;

  const sender = String(a.sender).toLowerCase();
  const trusted = new Set([...(routers ?? [])].map((r) => String(r).toLowerCase()));
  if (!trusted.has(sender)) return null;

  const pm = String(poolManager).toLowerCase();
  const swapIndex = Number(swapLog.logIndex);
  const side = sides(a, tokenFirst).quote < 0n ? "BUY" : "SELL";

  const ordered = [...receiptLogs].sort((x, y) => Number(x.logIndex) - Number(y.logIndex));
  const unpaired = []; // logIndex of this router's Swaps not yet followed by its event

  for (const raw of ordered) {
    const emitter = String(raw.address).toLowerCase();

    if (emitter === pm) {
      const swap = tryDecode(poolManagerAbi, raw, "Swap");
      if (swap && String(swap.args.sender).toLowerCase() === sender) {
        unpaired.push(Number(raw.logIndex));
      }
      continue;
    }
    if (emitter !== sender) continue;

    const ev = tryDecode(routerAbi, raw);
    if (!ev || (ev.eventName !== "Bought" && ev.eventName !== "Sold")) continue;
    if (unpaired.shift() !== swapIndex) continue; // another swap's event

    // The event for our swap. It must agree with the swap, or it names nobody.
    if (String(ev.args?.token ?? "").toLowerCase() !== String(token).toLowerCase()) return null;
    if (ev.eventName === "Bought" && side === "BUY") return String(ev.args.recipient).toLowerCase();
    if (ev.eventName === "Sold" && side === "SELL") return String(ev.args.payer).toLowerCase();
    return null;
  }
  return null;
}

/**
 * Whether this swap may have paid the placer's trade fee, so its receipt has to
 * be read for it: a hook-fee pool (`Swap.fee` 0 — an earlier launchpad's pools
 * charged an LP fee instead and have no hook fee) where some quote moved (the
 * hook takes nothing, and emits nothing, on a zero quote amount), and either the
 * launch chose a non-zero `tradeFee` (unknown counts as non-zero) or the swap is
 * a BUY — which can pay the snipe tax in the launch's first seconds even at a
 * zero trade fee.
 * @param {object} swapLog  viem-decoded Swap log
 * @param {{ tradeFee?: number | null, tokenIsCurrency0?: boolean }} [pool]
 */
export function mayPayTradeFee(swapLog, { tradeFee, tokenIsCurrency0: tokenFirst = false } = {}) {
  const a = swapLog?.args;
  if (!a || a.amount0 == null || a.amount1 == null) return false;
  if (BigInt(a.fee ?? 0) !== 0n) return false;
  const { quote } = sides(a, tokenFirst);
  if (quote === 0n) return false;
  // The caller paid quote in (negative delta): a buy.
  if (tradeFee != null && Number(tradeFee) === 0) return quote < 0n;
  return true;
}

/**
 * The trade fee the placer took on a swap, from its transaction's receipt.
 *
 * The placer is each launch pool's v4 hook. v4 calls its afterSwap right after
 * emitting Swap, and the hook mints the fee as ERC-6909 claims (the PoolManager's
 * `Transfer`) and emits `TradeFeeTaken(poolId, token, fee, snipeSurcharge)` (`fee` is the whole fee, surcharge included) before control
 * returns to whoever called swap. So a swap's fee is the FIRST TradeFeeTaken for
 * its pool after it in log order, before the next PoolManager Swap on that pool
 * in the same transaction; none there means no fee (0). Nothing can emit between
 * the Swap and the hook's own event, so a look-alike TradeFeeTaken from another
 * contract can only come later — which is why a swap that cannot have paid a fee
 * (mayPayTradeFee) is never paired at all.
 *
 * @param {object[]} receiptLogs  raw logs from the transaction receipt
 * @param {object} swapLog        the viem-decoded Swap log
 * @param {object} ctx
 * @param {number | null} [ctx.tradeFee]     the launch's fee rate, pips (null = unknown)
 * @param {boolean} [ctx.tokenIsCurrency0]  the pool's orientation (false for ETH)
 * @param {string} ctx.poolManager           the v4 PoolManager (emitter of Swap)
 * @param {import('viem').Abi} ctx.poolManagerAbi
 * @param {import('viem').Abi} ctx.placerAbi UniV4LiquidityPlacer (TradeFeeTaken)
 * @returns {bigint | null} the fee in quote raw units; null for a pool whose LP fee
 *   is inside the Swap amounts (an earlier launchpad's), 0n when none was taken
 */
export function tradeFeeOf(receiptLogs, swapLog, { tradeFee, tokenIsCurrency0: tokenFirst = false, poolManager, poolManagerAbi, placerAbi } = {}) {
  const a = swapLog?.args;
  if (!a) return null;
  if (BigInt(a.fee ?? 0) !== 0n) return null; // LP-fee pool: the fee is in the amounts
  if (!mayPayTradeFee(swapLog, { tradeFee, tokenIsCurrency0: tokenFirst })) return 0n;

  const pm = String(poolManager).toLowerCase();
  const poolId = String(a.id).toLowerCase();
  const swapIndex = Number(swapLog.logIndex);
  const later = (receiptLogs ?? [])
    .filter((raw) => Number(raw.logIndex) > swapIndex)
    .sort((x, y) => Number(x.logIndex) - Number(y.logIndex));

  for (const raw of later) {
    if (String(raw.address).toLowerCase() === pm) {
      const next = tryDecode(poolManagerAbi, raw, "Swap");
      if (next && String(next.args.id).toLowerCase() === poolId) return 0n; // the next swap's turn
      continue;
    }
    const ev = tryDecode(placerAbi, raw, "TradeFeeTaken");
    if (ev && String(ev.args.poolId).toLowerCase() === poolId) return BigInt(ev.args.fee);
  }
  return 0n;
}

function tryDecode(abi, raw, eventName) {
  try {
    return decodeEventLog({
      abi,
      data: raw.data,
      topics: raw.topics,
      ...(eventName ? { eventName } : {}),
    });
  } catch {
    return null;
  }
}
