// @vitest-environment node
import { describe, it, expect } from "vitest";
import { encodeAbiParameters, encodeEventTopics } from "viem";
import { UniV4LaunchRouterABI } from "@sof/contracts";
import { attributeTrader, buildTradeRow, priceWeiPerToken } from "../buildTradeRow.js";

const TOKEN = "0x1111111111111111111111111111111111111111";
const ROUTER = "0x7777777777777777777777777777777777777777";
const TRADER = "0x9999999999999999999999999999999999999999";
const POOL = `0x${"ab".repeat(32)}`;

// The launch price from the v4 fixture (1 ETH FDV, tick 207200).
const LAUNCH_SQRT = 2500031419217008302293562112940196n;

const swap = (amount0, amount1, extra = {}) => ({
  transactionHash: "0xtx",
  logIndex: 3,
  blockNumber: 100n,
  args: { id: POOL, sender: ROUTER, amount0, amount1, sqrtPriceX96: LAUNCH_SQRT, liquidity: 1n, tick: 207200, fee: 10000 },
  ...extra,
});

describe("buildTradeRow", () => {
  // Sign convention pinned in contracts/test/UniV4LaunchRouter.t.sol:
  // amount0 < 0 means the caller PAID ETH in — a buy.
  it("classifies negative amount0 as a BUY, with unsigned amounts", () => {
    const row = buildTradeRow(swap(-(10n ** 17n), 90544562424768864432372374n), { token: TOKEN, blockTimeSec: 1_700_000_000 });
    expect(row.side).toBe("BUY");
    expect(row.eth_amount).toBe("100000000000000000");
    expect(row.token_amount).toBe("90544562424768864432372374");
    expect(row.block_time).toBe(new Date(1_700_000_000 * 1000).toISOString());
  });

  it("classifies positive amount0 as a SELL", () => {
    expect(buildTradeRow(swap(5n, -7n), { token: TOKEN }).side).toBe("SELL");
  });

  it("records the price after the swap, in wei per whole token", () => {
    const row = buildTradeRow(swap(-1n, 1n), { token: TOKEN });
    // ~1 gwei per token at the 1 ETH-FDV launch price
    expect(BigInt(row.price_wei)).toBeGreaterThan(990_000_000n);
    expect(BigInt(row.price_wei)).toBeLessThan(1_010_000_000n);
  });

  it("uses the attributed trader, falling back to the swap sender", () => {
    expect(buildTradeRow(swap(-1n, 1n), { token: TOKEN, trader: TRADER }).trader).toBe(TRADER);
    expect(buildTradeRow(swap(-1n, 1n), { token: TOKEN }).trader).toBe(ROUTER);
  });

  it("skips a zero-size swap and unusable logs", () => {
    expect(buildTradeRow(swap(0n, 0n), { token: TOKEN })).toBeNull();
    expect(buildTradeRow({ args: {} }, { token: TOKEN })).toBeNull();
    expect(buildTradeRow(swap(-1n, 1n), {})).toBeNull();
  });
});

describe("priceWeiPerToken", () => {
  it("returns 0 for an empty price rather than dividing by zero", () => {
    expect(priceWeiPerToken(0n)).toBe(0n);
  });
});

/** A raw receipt log as a router emitting `eventName` would produce it. */
function routerLog(eventName, { address = ROUTER, token = TOKEN, payer = TRADER, recipient = TRADER } = {}) {
  const topics = encodeEventTopics({ abi: UniV4LaunchRouterABI, eventName, args: { token, payer, recipient } });
  const data = encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], [1n, 2n]);
  return { address, topics, data };
}

describe("attributeTrader", () => {
  it("credits a buy to the recipient named by the router", () => {
    const logs = [routerLog("Bought", { payer: ROUTER, recipient: TRADER })];
    expect(attributeTrader(logs, ROUTER, TOKEN, UniV4LaunchRouterABI)).toBe(TRADER);
  });

  it("credits a sell to the payer", () => {
    const seller = "0x5555555555555555555555555555555555555555";
    const logs = [routerLog("Sold", { payer: seller, recipient: TRADER })];
    expect(attributeTrader(logs, ROUTER, TOKEN, UniV4LaunchRouterABI)).toBe(seller);
  });

  // Any contract can emit a log with the Bought signature. Only the contract
  // that actually called swap() may name the trader, or a third party could
  // relabel someone else's trade.
  it("ignores a look-alike event emitted by a different contract", () => {
    const forged = routerLog("Bought", { address: "0x6666666666666666666666666666666666666666" });
    expect(attributeTrader([forged], ROUTER, TOKEN, UniV4LaunchRouterABI)).toBeNull();
  });

  it("ignores router events for a different token in the same transaction", () => {
    const other = routerLog("Bought", { token: "0x2222222222222222222222222222222222222222" });
    expect(attributeTrader([other], ROUTER, TOKEN, UniV4LaunchRouterABI)).toBeNull();
  });

  it("returns null when the swap went through a router that emits nothing", () => {
    expect(attributeTrader([{ address: ROUTER, topics: ["0x00"], data: "0x" }], ROUTER, TOKEN, UniV4LaunchRouterABI)).toBeNull();
    expect(attributeTrader([], ROUTER, TOKEN, UniV4LaunchRouterABI)).toBeNull();
  });
});
