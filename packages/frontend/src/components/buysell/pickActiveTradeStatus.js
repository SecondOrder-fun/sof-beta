/**
 * Choose which trade (buy vs sell) the single TransactionStatusOverlay reflects.
 *
 * The buy/sell mutations are never `.reset()`, so their `isConfirmed`/`isError`
 * flags persist for the rest of the session. That means the status flags alone
 * can't tell us which trade is "current" — a long-confirmed buy would otherwise
 * mask a later sell. The last-initiated side is the source of truth.
 *
 * @param {"buy"|"sell"|null} lastTradeSide
 * @param {object} buyStatus  useTransactionStatus(buyMutation)
 * @param {object} sellStatus useTransactionStatus(sellMutation)
 * @returns {{ status: object, side: "buy"|"sell" }}
 */
export function pickActiveTradeStatus(lastTradeSide, buyStatus, sellStatus) {
  if (lastTradeSide === "sell") return { status: sellStatus, side: "sell" };
  return { status: buyStatus, side: "buy" };
}
