// tests/services/infoFiTradeRow.test.js
// @vitest-environment node
import { describe, it, expect } from "vitest";

import { buildInfoFiTradeRow } from "../../src/services/infoFiTradeRow.js";

const E18 = 10n ** 18n;
const base = {
  marketId: 7,
  txHash: "0xabc",
  logIndex: 5n,
  blockNumber: 123n,
  blockTime: new Date("2026-10-23T12:00:00Z"),
};

describe("buildInfoFiTradeRow", () => {
  it("maps a buy: collateral paid for shares", () => {
    const row = buildInfoFiTradeRow({
      ...base,
      args: { trader: "0xTRADER", isBuy: true, yes: false, collateral: 10n * E18, shares: 20n * E18, fee: 2n * E18 / 10n },
    });
    expect(row).toEqual({
      market_id: 7,
      user_address: "0xtrader",
      outcome: "NO",
      side: "BUY",
      amount: "10",
      shares: "20",
      fee: "0.2",
      price: "0.5",
      tx_hash: "0xabc",
      log_index: 5,
      block_number: 123,
      block_time: "2026-10-23T12:00:00.000Z",
      created_at: "2026-10-23T12:00:00.000Z",
    });
  });

  it("maps a sell: shares given up for collateral", () => {
    const row = buildInfoFiTradeRow({
      ...base,
      args: { trader: "0xT", isBuy: false, yes: true, collateral: 4n * E18, shares: 5n * E18, fee: 0n },
    });
    expect(row).toMatchObject({ side: "SELL", outcome: "YES", amount: "4", shares: "5", price: "0.8", fee: "0" });
  });

  it("refuses a pre-0.44 Trade log, which cannot say buy from sell", () => {
    expect(() =>
      buildInfoFiTradeRow({
        ...base,
        args: { trader: "0xT", buyYes: true, amountIn: E18, amountOut: E18 },
      }),
    ).toThrow(/pre-0.44/);
  });

  it("requires the block time", () => {
    expect(() =>
      buildInfoFiTradeRow({
        ...base,
        blockTime: undefined,
        args: { trader: "0xT", isBuy: true, yes: true, collateral: E18, shares: E18, fee: 0n },
      }),
    ).toThrow(/blockTime/);
  });
});
