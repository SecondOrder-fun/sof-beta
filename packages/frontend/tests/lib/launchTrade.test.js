import { describe, it, expect } from "vitest";
import { decodeFunctionData } from "viem";
import { buildTradeCalls, TRADE_DEADLINE_SECONDS } from "@/lib/launchTrade";
import { ERC20Abi, ILaunchRouterAbi } from "@/utils/abis";

const ROUTER = "0x7777777777777777777777777777777777777777";
const TOKEN = "0x1111111111111111111111111111111111111111";
const ME = "0x9999999999999999999999999999999999999999";
const NOW = 1_700_000_000;
const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const ZERO = "0x0000000000000000000000000000000000000000";

describe("buildTradeCalls", () => {
  it("encodes an ETH-paired buy as one payable router call, value = quoteIn", () => {
    for (const quoteToken of [undefined, ZERO]) {
      const calls = buildTradeCalls({ side: "buy", router: ROUTER, token: TOKEN, quoteToken, amountIn: 10n ** 17n, minOut: 123n, recipient: ME, nowSec: NOW });
      expect(calls).toHaveLength(1);
      expect(calls[0].to).toBe(ROUTER);
      expect(calls[0].value).toBe(10n ** 17n);

      const { functionName, args } = decodeFunctionData({ abi: ILaunchRouterAbi, data: calls[0].data });
      expect(functionName).toBe("buy");
      expect(args).toEqual([TOKEN, 10n ** 17n, 123n, ME, BigInt(NOW + TRADE_DEADLINE_SECONDS)]);
    }
  });

  // The router pulls the ERC-20 quote, so it is approved first in the same
  // batch, and no ETH is sent (the router reverts EthAmountMismatch on any).
  it("encodes an ERC-20-paired buy as approve(router, quoteIn) then buy, with no value", () => {
    const calls = buildTradeCalls({ side: "buy", router: ROUTER, token: TOKEN, quoteToken: USDC, amountIn: 25_000_000n, minOut: 9n, recipient: ME, nowSec: NOW });
    expect(calls.map((c) => c.to)).toEqual([USDC, ROUTER]);
    expect(calls.every((c) => c.value === undefined)).toBe(true);

    const approve = decodeFunctionData({ abi: ERC20Abi, data: calls[0].data });
    expect(approve.functionName).toBe("approve");
    expect(approve.args).toEqual([ROUTER, 25_000_000n]);

    const buy = decodeFunctionData({ abi: ILaunchRouterAbi, data: calls[1].data });
    expect(buy.functionName).toBe("buy");
    expect(buy.args).toEqual([TOKEN, 25_000_000n, 9n, ME, BigInt(NOW + TRADE_DEADLINE_SECONDS)]);
  });

  // The router pulls the tokens, so it must be approved first — same batch.
  it("encodes a sell as approve-then-sell, approving exactly the amount, whatever the quote", () => {
    const calls = buildTradeCalls({ side: "sell", router: ROUTER, token: TOKEN, quoteToken: USDC, amountIn: 500n, minOut: 7n, recipient: ME, nowSec: NOW });
    expect(calls.map((c) => c.to)).toEqual([TOKEN, ROUTER]);

    const approve = decodeFunctionData({ abi: ERC20Abi, data: calls[0].data });
    expect(approve.functionName).toBe("approve");
    expect(approve.args).toEqual([ROUTER, 500n]);

    const sell = decodeFunctionData({ abi: ILaunchRouterAbi, data: calls[1].data });
    expect(sell.functionName).toBe("sell");
    expect(sell.args).toEqual([TOKEN, 500n, 7n, ME, BigInt(NOW + TRADE_DEADLINE_SECONDS)]);
    expect(calls[1].value).toBeUndefined();
  });

  it("refuses to build a trade with no router — trading is switched off", () => {
    expect(() => buildTradeCalls({ side: "buy", router: null, token: TOKEN, amountIn: 1n, minOut: 0n, recipient: ME })).toThrow();
  });

  it("refuses a zero amount", () => {
    expect(() => buildTradeCalls({ side: "buy", router: ROUTER, token: TOKEN, amountIn: 0n, minOut: 0n, recipient: ME })).toThrow();
  });
});
