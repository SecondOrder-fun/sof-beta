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
 *     attributeTrader recovers the real account from the router's own event.
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
 * A router (the swap's `sender`) that emits Bought/Sold in the same transaction
 * names the account: the recipient of a buy, the payer of a sell. Only events
 * emitted BY the swap's sender count — any contract can emit a log with that
 * signature, so trusting one from elsewhere would let a third party relabel a
 * trade. Swaps through routers that emit nothing (another app, a direct
 * integration) keep the sender.
 *
 * @param {object[]} receiptLogs  raw logs from the transaction receipt
 * @param {string} swapSender
 * @param {string} token
 * @param {import('viem').Abi} routerAbi
 * @returns {string | null}
 */
export function attributeTrader(receiptLogs, swapSender, token, routerAbi) {
  if (!receiptLogs || !swapSender) return null;
  const sender = String(swapSender).toLowerCase();
  const tokenLc = String(token).toLowerCase();

  for (const raw of receiptLogs) {
    if (String(raw.address).toLowerCase() !== sender) continue;
    let ev;
    try {
      ev = decodeEventLog({ abi: routerAbi, data: raw.data, topics: raw.topics });
    } catch {
      continue; // not a router event
    }
    if (String(ev.args?.token ?? "").toLowerCase() !== tokenLc) continue;
    if (ev.eventName === "Bought") return String(ev.args.recipient).toLowerCase();
    if (ev.eventName === "Sold") return String(ev.args.payer).toLowerCase();
  }
  return null;
}
