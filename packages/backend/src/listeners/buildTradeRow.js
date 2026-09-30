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
 * Two facts it rests on, both pinned by
 * contracts/test/UniV4LaunchRouter.t.sol:test_swapEventSignConvention_forTheIndexer:
 *
 *   - amount0 / amount1 are the CALLER's deltas: negative = paid in. ETH is
 *     always currency0 on a launch pool, so amount0 < 0 is a BUY. (IPoolManager's
 *     own doc comment reads as the opposite sign; the test pins behaviour.)
 *   - `sender` is whatever called PoolManager.swap — a router, not the trader.
 *     attributeTrader recovers the real account from the launch router's own
 *     event, paired to the swap by log order.
 */

import { decodeEventLog } from "viem";

const WAD = 10n ** 18n;
const Q192 = 1n << 192n;

/** Wei of ETH per whole token at a sqrtPriceX96 (token/ETH pools, both 18 dp). */
export function priceWeiPerToken(sqrtPriceX96) {
  const s = BigInt(sqrtPriceX96 ?? 0);
  if (s === 0n) return 0n;
  return (WAD * Q192) / (s * s);
}

const abs = (x) => (x < 0n ? -x : x);

/**
 * @param {object} log      viem-decoded Swap log
 * @param {object} ctx
 * @param {string} ctx.token        the launch token this pool trades
 * @param {number} [ctx.blockTimeSec]
 * @param {string} [ctx.trader]     from attributeTrader; falls back to the swap sender
 * @returns {object | null}
 */
export function buildTradeRow(log, { token, blockTimeSec, trader } = {}) {
  const a = log?.args;
  if (!a || a.amount0 == null || a.amount1 == null || !token) return null;

  const amount0 = BigInt(a.amount0);
  const amount1 = BigInt(a.amount1);
  if (amount0 === 0n && amount1 === 0n) return null; // zero-size swap: nothing traded

  return {
    tx_hash: log.transactionHash,
    log_index: Number(log.logIndex),
    token_address: token,
    pool_id: a.id,
    trader: trader || a.sender || null,
    side: amount0 < 0n ? "BUY" : "SELL",
    eth_amount: abs(amount0).toString(),
    token_amount: abs(amount1).toString(),
    price_wei: priceWeiPerToken(a.sqrtPriceX96).toString(),
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
 * @param {Iterable<string>} ctx.routers      trusted launch router addresses
 * @param {string} ctx.poolManager            the v4 PoolManager (emitter of Swap)
 * @param {import('viem').Abi} ctx.poolManagerAbi
 * @param {import('viem').Abi} ctx.routerAbi
 * @returns {string | null}
 */
export function attributeTrader(
  receiptLogs,
  swapLog,
  { token, routers, poolManager, poolManagerAbi, routerAbi } = {},
) {
  const a = swapLog?.args;
  if (!receiptLogs?.length || !a?.sender || a.amount0 == null || !poolManager) return null;

  const sender = String(a.sender).toLowerCase();
  const trusted = new Set([...(routers ?? [])].map((r) => String(r).toLowerCase()));
  if (!trusted.has(sender)) return null;

  const pm = String(poolManager).toLowerCase();
  const swapIndex = Number(swapLog.logIndex);
  const side = BigInt(a.amount0) < 0n ? "BUY" : "SELL";

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
