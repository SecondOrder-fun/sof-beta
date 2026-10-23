// src/services/infoFiTradeRow.js
//
// Pure mapping from an FPMM Trade log to an infofi_positions row (migration 032).
// Contracts 0.44 emit Trade(trader, isBuy, yes, collateral, shares, fee): a buy pays
// `collateral` (fee included) for `shares`; a sell gives up `shares` for `collateral`
// (net of the fee). Collateral and outcome shares are both 18-decimal (a season's
// quote token must be, and the conditional tokens mint 1:1 against it).

import { formatUnits } from "viem";

const WAD = 10n ** 18n;

/**
 * @param {object} p
 * @param {number|string} p.marketId     infofi_markets.id of the FPMM
 * @param {object} p.args                decoded Trade args
 * @param {string} p.txHash
 * @param {number|bigint} p.logIndex
 * @param {bigint} p.blockNumber
 * @param {Date} p.blockTime
 */
export function buildInfoFiTradeRow({ marketId, args, txHash, logIndex, blockNumber, blockTime }) {
  const { trader, isBuy, yes, collateral, shares, fee } = args;
  if (typeof isBuy !== "boolean" || typeof yes !== "boolean") {
    throw new Error("Trade log without isBuy/yes (pre-0.44 FPMM?)");
  }
  if (!(blockTime instanceof Date) || Number.isNaN(blockTime.getTime())) {
    throw new Error("blockTime is required");
  }
  const price = shares > 0n ? (collateral * WAD) / shares : 0n;
  return {
    market_id: marketId,
    user_address: trader.toLowerCase(),
    outcome: yes ? "YES" : "NO",
    side: isBuy ? "BUY" : "SELL",
    amount: formatUnits(collateral, 18),
    shares: formatUnits(shares, 18),
    fee: formatUnits(fee ?? 0n, 18),
    price: formatUnits(price, 18),
    tx_hash: txHash,
    log_index: Number(logIndex),
    block_number: Number(blockNumber),
    block_time: blockTime.toISOString(),
    created_at: blockTime.toISOString(),
  };
}
