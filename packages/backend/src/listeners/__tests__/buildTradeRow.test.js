// @vitest-environment node
import { describe, it, expect } from "vitest";
import { encodeAbiParameters, encodeEventTopics } from "viem";
import { PoolManagerABI, UniV4LaunchRouterABI } from "@sof/contracts";
import { attributeTrader, buildTradeRow, priceE18, tokenIsCurrency0 } from "../buildTradeRow.js";

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
    const row = buildTradeRow(swap(-(10n ** 17n), 89729910215527505885256588n), { token: TOKEN, blockTimeSec: 1_700_000_000 });
    expect(row.side).toBe("BUY");
    expect(row.quote_amount).toBe("100000000000000000");
    expect(row.token_amount).toBe("89729910215527505885256588");
    expect(row.block_time).toBe(new Date(1_700_000_000 * 1000).toISOString());
  });

  it("classifies positive amount0 as a SELL", () => {
    expect(buildTradeRow(swap(5n, -7n), { token: TOKEN }).side).toBe("SELL");
  });

  it("records the price after the swap, in quote raw units per whole token × 1e18", () => {
    const row = buildTradeRow(swap(-1n, 1n), { token: TOKEN });
    // 2^192 * 1e36 / sqrt^2: ~1.0043 gwei per token at the 1 ETH-FDV launch
    // price (tick 207200), every digit kept
    expect(row.price_e18).toBe("1004311033770190170432878001");
    expect(row).not.toHaveProperty("price");
  });

  // An ERC-20 quote above the token makes the TOKEN currency0: the quote is
  // amount1, so a negative amount1 is the BUY, and v4's price is quote per token.
  it("reads the quote from amount1 when the token is currency0", () => {
    const buy = buildTradeRow(swap(4_000_000n * 10n ** 18n, -100_000_000n), { token: TOKEN, tokenIsCurrency0: true });
    expect(buy.side).toBe("BUY");
    expect(buy.quote_amount).toBe("100000000");
    expect(buy.token_amount).toBe("4000000000000000000000000");
    expect(buildTradeRow(swap(-5n, 7n), { token: TOKEN, tokenIsCurrency0: true }).side).toBe("SELL");
  });

  const atSqrt = (sqrtPriceX96) => ({ ...swap(1n, -1n), args: { ...swap(1n, -1n).args, sqrtPriceX96 } });

  it("inverts the price when the token is currency0", () => {
    // sqrtPrice for 5 raw USDC per whole token (5e-18 per raw token): sqrt(5e-18) * 2^96,
    // floored — so the price lands a hair under 5e18, not on 4 as raw units would
    const row = buildTradeRow(atSqrt(177159557114295710296n), { token: TOKEN, tokenIsCurrency0: true });
    expect(row.price_e18).toBe("4999999999999999999");
  });

  // The case the e18 scale exists for: a 2,500 USDC valuation of 1e9 tokens is
  // 2.5 raw USDC units per token. In whole raw units that floored to 2 — every
  // trade near the launch price read the same step.
  it("keeps a 6-decimal quote's precision", () => {
    // isqrt(2.5e-18 * 2^192): 2.5 raw USDC per whole token
    const row = buildTradeRow(atSqrt(125270724187523965593n), { token: TOKEN, tokenIsCurrency0: true });
    expect(row.price_e18).toBe("2499999999999999999");
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

describe("priceE18", () => {
  it("returns 0 for an empty price rather than dividing by zero", () => {
    expect(priceE18(0n)).toBe(0n);
    expect(priceE18(0n, true)).toBe(0n);
    expect(priceE18(undefined)).toBe(0n);
  });

  // Both orientations of one price agree: Q96^2 is a raw price of exactly 1,
  // i.e. 1e18 quote raw units per whole token either way round.
  it("scales before dividing, in both orientations", () => {
    const one = 1n << 96n;
    expect(priceE18(one)).toBe(10n ** 36n);
    expect(priceE18(one, true)).toBe(10n ** 36n);
    // A sqrt price of 2^95 is a raw price of 1/4: the token-currency0 reading
    // is 0.25e36 and the inverted one 4e36, exactly.
    expect(priceE18(1n << 95n, true)).toBe(25n * 10n ** 34n);
    expect(priceE18(1n << 95n)).toBe(4n * 10n ** 36n);
  });
});

describe("tokenIsCurrency0", () => {
  it("is false for ETH (address 0 sorts first) and follows address order for ERC-20s", () => {
    expect(tokenIsCurrency0(TOKEN, "0x0000000000000000000000000000000000000000")).toBe(false);
    expect(tokenIsCurrency0(TOKEN, "0xffffffffffffffffffffffffffffffffffffffff")).toBe(true);
    expect(tokenIsCurrency0(TOKEN, "0x0000000000000000000000000000000000100000")).toBe(false);
  });
});

const POOL_MANAGER = "0x4444444444444444444444444444444444444444";
const OTHER_ROUTER = "0x6666666666666666666666666666666666666666";

/** A raw receipt log as a router emitting `eventName` would produce it. */
function routerLog(eventName, logIndex, { address = ROUTER, token = TOKEN, payer = TRADER, recipient = TRADER } = {}) {
  const topics = encodeEventTopics({ abi: UniV4LaunchRouterABI, eventName, args: { token, payer, recipient } });
  const data = encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], [1n, 2n]);
  return { address, topics, data, logIndex };
}

/** A raw PoolManager Swap receipt log. */
function swapLog(logIndex, { sender = ROUTER, amount0 = -1n, amount1 = 1n } = {}) {
  const topics = encodeEventTopics({ abi: PoolManagerABI, eventName: "Swap", args: { id: POOL, sender } });
  const data = encodeAbiParameters(
    [{ type: "int128" }, { type: "int128" }, { type: "uint160" }, { type: "uint128" }, { type: "int24" }, { type: "uint24" }],
    [amount0, amount1, LAUNCH_SQRT, 1n, 207200, 10000],
  );
  return { address: POOL_MANAGER, topics, data, logIndex };
}

/** The decoded Swap the indexer is attributing, at `logIndex`. */
const decodedSwap = (logIndex, amount0, sender = ROUTER) => ({
  ...swap(amount0, -amount0),
  logIndex,
  args: { ...swap(amount0, -amount0).args, sender },
});

const ctx = (over = {}) => ({
  token: TOKEN,
  routers: [ROUTER],
  poolManager: POOL_MANAGER,
  poolManagerAbi: PoolManagerABI,
  routerAbi: UniV4LaunchRouterABI,
  ...over,
});

describe("attributeTrader", () => {
  it("credits a buy to the recipient named by the router", () => {
    const logs = [swapLog(0), routerLog("Bought", 1, { payer: ROUTER, recipient: TRADER })];
    expect(attributeTrader(logs, decodedSwap(0, -1n), ctx())).toBe(TRADER);
  });

  // With the token as currency0 the quote is amount1: a BUY pays amount1 in.
  // Reading the side from amount0 here would pair the buy with a Sold.
  it("reads the side from the quote when the token is currency0", () => {
    const logs = [swapLog(0, { amount0: 1n, amount1: -1n }), routerLog("Bought", 1, { payer: ROUTER, recipient: TRADER })];
    const decoded = { ...swap(1n, -1n), logIndex: 0 };
    expect(attributeTrader(logs, decoded, ctx({ tokenIsCurrency0: true }))).toBe(TRADER);
    expect(attributeTrader(logs, decoded, ctx())).toBeNull();
  });

  it("credits a sell to the payer", () => {
    const seller = "0x5555555555555555555555555555555555555555";
    const logs = [swapLog(0, { amount0: 1n, amount1: -1n }), routerLog("Sold", 1, { payer: seller, recipient: TRADER })];
    expect(attributeTrader(logs, decodedSwap(0, 1n), ctx())).toBe(seller);
  });

  // Any contract can emit a log with the Bought signature. Only the contract
  // that actually called swap() may name the trader, or a third party could
  // relabel someone else's trade.
  it("ignores a look-alike event emitted by a different contract", () => {
    const logs = [swapLog(0), routerLog("Bought", 1, { address: OTHER_ROUTER })];
    expect(attributeTrader(logs, decodedSwap(0, -1n), ctx())).toBeNull();
  });

  // A contract that is not the launch router can call PoolManager.swap itself
  // and emit a Bought naming anyone. Being the sender is not enough.
  it("ignores a sender that is not the launch router, even when it emitted the event", () => {
    const logs = [swapLog(0, { sender: OTHER_ROUTER }), routerLog("Bought", 1, { address: OTHER_ROUTER })];
    expect(attributeTrader(logs, decodedSwap(0, -1n, OTHER_ROUTER), ctx())).toBeNull();
  });

  it("trusts any router in the known set (a router swapped out keeps attributing)", () => {
    const logs = [swapLog(0, { sender: OTHER_ROUTER }), routerLog("Bought", 1, { address: OTHER_ROUTER })];
    expect(attributeTrader(logs, decodedSwap(0, -1n, OTHER_ROUTER), ctx({ routers: [ROUTER, OTHER_ROUTER] }))).toBe(TRADER);
  });

  it("ignores router events for a different token in the same transaction", () => {
    const logs = [swapLog(0), routerLog("Bought", 1, { token: "0x2222222222222222222222222222222222222222" })];
    expect(attributeTrader(logs, decodedSwap(0, -1n), ctx())).toBeNull();
  });

  it("does not take a Sold as the trader of a BUY", () => {
    const logs = [swapLog(0), routerLog("Sold", 1)];
    expect(attributeTrader(logs, decodedSwap(0, -1n), ctx())).toBeNull();
  });

  // One transaction, two router swaps on the same token: a buy by A, then a
  // sell by B. Each swap takes the router event that follows it, not the first
  // event for the token.
  it("pairs each swap in a batched buy-then-sell with the event that follows it", () => {
    const buyer = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const seller = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    const logs = [
      swapLog(2),
      routerLog("Bought", 3, { payer: ROUTER, recipient: buyer }),
      swapLog(5, { amount0: 1n, amount1: -1n }),
      routerLog("Sold", 6, { payer: seller, recipient: ROUTER }),
    ];
    // Receipt order must not depend on how the RPC listed them.
    const shuffled = [logs[3], logs[1], logs[0], logs[2]];
    expect(attributeTrader(shuffled, decodedSwap(2, -1n), ctx())).toBe(buyer);
    expect(attributeTrader(shuffled, decodedSwap(5, 1n), ctx())).toBe(seller);
  });

  it("returns null when the swap went through a router that emits nothing", () => {
    expect(attributeTrader([swapLog(0), { address: ROUTER, topics: ["0x00"], data: "0x", logIndex: 1 }], decodedSwap(0, -1n), ctx())).toBeNull();
    expect(attributeTrader([], decodedSwap(0, -1n), ctx())).toBeNull();
  });
});
