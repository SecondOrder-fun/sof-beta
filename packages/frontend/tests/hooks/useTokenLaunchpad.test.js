import { describe, it, expect } from "vitest";
import { decodeFunctionData } from "viem";
import {
  buildLaunchCalls,
  validateLaunchForm,
  DEFAULT_TRADE_FEE,
  TRADE_FEE_PRESETS,
  MAX_NAME_LENGTH,
  MAX_SYMBOL_LENGTH,
  utf8Length,
} from "@/hooks/useTokenLaunchpad";
import { ERC20Abi, TokenLaunchpadAbi } from "@/utils/abis";

const ONE_ETH = 10n ** 18n;

// The ETH bounds from quoteConfig(address(0)) (script/deploy/21_DeployTokenLaunchpad.s.sol).
const ETH_BOUNDS = { minFdv: ONE_ETH, maxFdv: 1000n * ONE_ETH };
const CTX = { quote: ETH_BOUNDS };

describe("validateLaunchForm", () => {
  const valid = { name: "Second Order", symbol: "SOF", fdv: 5n * ONE_ETH, tradeFee: 10_000 };

  it("accepts a well-formed launch", () => {
    expect(validateLaunchForm(valid, CTX)).toEqual({});
  });

  it("requires a name and a symbol", () => {
    expect(validateLaunchForm({ ...valid, name: "  " }, CTX).name).toBe("errors.nameRequired");
    expect(validateLaunchForm({ ...valid, symbol: "" }, CTX).symbol).toBe(
      "errors.symbolRequired",
    );
  });

  it("mirrors the contract's length limits", () => {
    expect(validateLaunchForm({ ...valid, name: "x".repeat(MAX_NAME_LENGTH) }, CTX)).toEqual({});
    expect(
      validateLaunchForm({ ...valid, name: "x".repeat(MAX_NAME_LENGTH + 1) }, CTX).name,
    ).toBe("errors.nameTooLong");
    expect(
      validateLaunchForm({ ...valid, symbol: "x".repeat(MAX_SYMBOL_LENGTH + 1) }, CTX).symbol,
    ).toBe("errors.symbolTooLong");
  });

  // The contract counts bytes(name).length — UTF-8 bytes. 20 CJK characters are 60 bytes:
  // fine by .length (20 < 48) but a NameTooLong revert after the user has signed.
  it("measures the limits in UTF-8 bytes, as the contract does", () => {
    expect(utf8Length("蛙".repeat(20))).toBe(60);
    expect(validateLaunchForm({ ...valid, name: "蛙".repeat(16) }, CTX)).toEqual({}); // 48 bytes
    expect(validateLaunchForm({ ...valid, name: "蛙".repeat(17) }, CTX).name).toBe("errors.nameTooLong");
    expect(validateLaunchForm({ ...valid, symbol: "🐸".repeat(5) }, CTX).symbol).toBe(
      "errors.symbolTooLong",
    ); // 20 bytes
    expect(validateLaunchForm({ ...valid, symbol: "🐸".repeat(4) }, CTX)).toEqual({}); // 16 bytes
  });

  // The failure the floor exists to prevent: below a 1 ETH valuation a single
  // ordinary buy consumes most of the position.
  it("rejects a valuation below the floor", () => {
    expect(validateLaunchForm({ ...valid, fdv: ONE_ETH - 1n }, CTX).fdv).toBe(
      "errors.fdvTooLow",
    );
  });

  it("rejects a valuation above the ceiling", () => {
    expect(validateLaunchForm({ ...valid, fdv: 1000n * ONE_ETH + 1n }, CTX).fdv).toBe(
      "errors.fdvTooHigh",
    );
  });

  it("accepts both bounds exactly — they are inclusive on the contract", () => {
    expect(validateLaunchForm({ ...valid, fdv: ETH_BOUNDS.minFdv }, CTX).fdv).toBeUndefined();
    expect(validateLaunchForm({ ...valid, fdv: ETH_BOUNDS.maxFdv }, CTX).fdv).toBeUndefined();
  });

  it("requires a valuation at all", () => {
    expect(validateLaunchForm({ ...valid, fdv: null }, CTX).fdv).toBe("errors.fdvRequired");
  });

  // Config arrives asynchronously; the form must not claim a valuation is out of
  // range before it knows the range.
  it("checks names and symbols but not bounds while config is still loading", () => {
    const errors = validateLaunchForm({ ...valid, fdv: 1n }, {});
    expect(errors.fdv).toBeUndefined();
    expect(validateLaunchForm({ ...valid, name: "" }).name).toBe("errors.nameRequired");
  });

  // Bounds are per quote, in that quote's raw units: 2,500 USDC is the floor
  // there, though as a raw number it is far below 1 ETH's.
  it("checks the valuation against the selected quote's own bounds", () => {
    const usdc = { quote: { minFdv: 2_500n * 10n ** 6n, maxFdv: 2_500_000n * 10n ** 6n } };
    expect(validateLaunchForm({ ...valid, fdv: 2_500n * 10n ** 6n }, usdc).fdv).toBeUndefined();
    expect(validateLaunchForm({ ...valid, fdv: 2_499n * 10n ** 6n }, usdc).fdv).toBe("errors.fdvTooLow");
    expect(validateLaunchForm({ ...valid, fdv: 5n * ONE_ETH }, usdc).fdv).toBe("errors.fdvTooHigh");
  });

  // TradeFeeOutOfRange(tradeFee, minTradeFee, MAX_TRADE_FEE), both bounds inclusive.
  describe("the trade fee", () => {
    const bounds = { ...CTX, minTradeFee: 5_000 };

    it("is required", () => {
      expect(validateLaunchForm({ ...valid, tradeFee: null }, bounds).tradeFee).toBe("errors.tradeFeeInvalid");
    });

    it("accepts the placer's minimum and the 10% maximum exactly", () => {
      expect(validateLaunchForm({ ...valid, tradeFee: 5_000 }, bounds).tradeFee).toBeUndefined();
      expect(validateLaunchForm({ ...valid, tradeFee: 100_000 }, bounds).tradeFee).toBeUndefined();
    });

    it("rejects below the placer's minimum and above 10%", () => {
      expect(validateLaunchForm({ ...valid, tradeFee: 4_999 }, bounds).tradeFee).toBe("errors.tradeFeeTooLow");
      expect(validateLaunchForm({ ...valid, tradeFee: 100_001 }, bounds).tradeFee).toBe("errors.tradeFeeTooHigh");
    });

    it("checks only the maximum while the minimum is loading", () => {
      expect(validateLaunchForm({ ...valid, tradeFee: 1 }, CTX).tradeFee).toBeUndefined();
      expect(validateLaunchForm({ ...valid, tradeFee: 200_000 }, CTX).tradeFee).toBe("errors.tradeFeeTooHigh");
    });

    it("offers presets inside the deploy-time bounds, defaulting to 1%", () => {
      expect(DEFAULT_TRADE_FEE).toBe(10_000);
      expect(TRADE_FEE_PRESETS).toEqual([5_000, 10_000, 20_000, 50_000]);
      for (const fee of TRADE_FEE_PRESETS) expect(validateLaunchForm({ ...valid, tradeFee: fee }, bounds)).toEqual({});
    });
  });

  describe("the first buy", () => {
    it("is optional", () => {
      expect(validateLaunchForm({ ...valid, firstBuyInput: "", firstBuy: null }, CTX)).toEqual({});
    });

    it("must parse when something is typed", () => {
      expect(validateLaunchForm({ ...valid, firstBuyInput: "abc", firstBuy: null }, CTX).firstBuy).toBe(
        "errors.firstBuyInvalid",
      );
    });

    // launch() reverts CreatorBuyNeedsRouter when router() is zero.
    it("needs a router", () => {
      expect(
        validateLaunchForm({ ...valid, firstBuyInput: "0.1", firstBuy: ONE_ETH / 10n }, { ...CTX, hasRouter: false })
          .firstBuy,
      ).toBe("errors.firstBuyNoRouter");
    });

    it("cannot exceed the creator's balance of the quote, when it is known", () => {
      const form = { ...valid, firstBuyInput: "1", firstBuy: ONE_ETH };
      expect(validateLaunchForm(form, { ...CTX, balance: ONE_ETH - 1n }).firstBuy).toBe("errors.firstBuyBalance");
      expect(validateLaunchForm(form, { ...CTX, balance: ONE_ETH }).firstBuy).toBeUndefined();
      expect(validateLaunchForm(form, { ...CTX, balance: null }).firstBuy).toBeUndefined();
    });
  });
});

describe("buildLaunchCalls", () => {
  const LAUNCHPAD = "0x1000000000000000000000000000000000000001";
  const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
  const ZERO = "0x0000000000000000000000000000000000000000";
  const base = { launchpad: LAUNCHPAD, name: "Second Order", symbol: "SOF", metadataURI: "ipfs://x", tradeFee: 10_000 };
  const decodeLaunch = (data) => decodeFunctionData({ abi: TokenLaunchpadAbi, data });

  // The valuation goes to the contract as-is — no conversion to a per-token price —
  // then the trade fee in pips and the liquidity preset, before creatorBuyIn.
  it("passes the valuation straight through as startFdv, the trade fee, Classic, and a 0 slippage floor", () => {
    const [call] = buildLaunchCalls({ ...base, quoteToken: ZERO, startFdv: 2n * ONE_ETH });
    const { functionName, args } = decodeLaunch(call.data);
    expect(functionName).toBe("launch");
    expect(args).toEqual(["Second Order", "SOF", "ipfs://x", ZERO, 2n * ONE_ETH, 10_000, 0, 0n, 0n]);
    expect(call.value).toBeUndefined();
  });

  it("sends the chosen liquidity preset between the trade fee and the first buy", () => {
    const calls = buildLaunchCalls({
      ...base,
      quoteToken: USDC,
      startFdv: 5_000n * 10n ** 6n,
      liquidityPreset: 1,
      creatorBuyIn: 50n * 10n ** 6n,
    });
    expect(decodeLaunch(calls[1].data).args.slice(5)).toEqual([10_000, 1, 50n * 10n ** 6n, 0n]);
    for (const id of [0, 2, 3]) {
      const [call] = buildLaunchCalls({ ...base, quoteToken: ZERO, startFdv: 2n * ONE_ETH, liquidityPreset: id });
      expect(decodeLaunch(call.data).args[6]).toBe(id);
    }
  });

  // UnknownLiquidityPreset on-chain; refused before the wallet prompt.
  it("refuses an unknown liquidity preset", () => {
    for (const liquidityPreset of [4, -1, 1.5, null]) {
      expect(() => buildLaunchCalls({ ...base, quoteToken: ZERO, startFdv: 2n * ONE_ETH, liquidityPreset })).toThrow(
        /liquidity preset/,
      );
    }
  });

  it("sends the creator's chosen trade fee", () => {
    const [call] = buildLaunchCalls({ ...base, quoteToken: ZERO, startFdv: 2n * ONE_ETH, tradeFee: 25_000 });
    expect(decodeLaunch(call.data).args[5]).toBe(25_000);
  });

  it("refuses to build a launch without a trade fee", () => {
    expect(() => buildLaunchCalls({ ...base, tradeFee: undefined, quoteToken: ZERO, startFdv: 2n * ONE_ETH })).toThrow();
  });

  // ETH launch: msg.value must equal creatorBuyIn exactly.
  it("sends an ETH first buy as the launch's value", () => {
    const calls = buildLaunchCalls({ ...base, quoteToken: ZERO, startFdv: 2n * ONE_ETH, creatorBuyIn: ONE_ETH / 10n });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ to: LAUNCHPAD, value: ONE_ETH / 10n });
    expect(decodeLaunch(calls[0].data).args.slice(3)).toEqual([ZERO, 2n * ONE_ETH, 10_000, 0, ONE_ETH / 10n, 0n]);
  });

  // ERC-20 launch: no ETH at all, and the LAUNCHPAD (not the router) is approved
  // for exactly the first buy, in the same batch.
  it("batches approve(launchpad, creatorBuyIn) before an ERC-20 launch with a first buy", () => {
    const calls = buildLaunchCalls({ ...base, quoteToken: USDC, startFdv: 5_000n * 10n ** 6n, creatorBuyIn: 50n * 10n ** 6n });
    expect(calls.map((c) => c.to)).toEqual([USDC, LAUNCHPAD]);
    expect(calls.every((c) => c.value === undefined)).toBe(true);
    const approve = decodeFunctionData({ abi: ERC20Abi, data: calls[0].data });
    expect(approve).toMatchObject({ functionName: "approve", args: [LAUNCHPAD, 50n * 10n ** 6n] });
    expect(decodeLaunch(calls[1].data).args.slice(3)).toEqual([USDC, 5_000n * 10n ** 6n, 10_000, 0, 50n * 10n ** 6n, 0n]);
  });

  it("sends just the launch for an ERC-20 pairing without a first buy", () => {
    const calls = buildLaunchCalls({ ...base, quoteToken: USDC, startFdv: 5_000n * 10n ** 6n });
    expect(calls).toHaveLength(1);
    expect(calls[0].value).toBeUndefined();
    expect(decodeLaunch(calls[0].data).args.slice(3)).toEqual([USDC, 5_000n * 10n ** 6n, 10_000, 0, 0n, 0n]);
  });
});
