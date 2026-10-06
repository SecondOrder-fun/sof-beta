import { describe, it, expect } from "vitest";
import { encodeAbiParameters, decodeFunctionResult, parseAbiParameters } from "viem";
import { TokenLaunchpadAbi, UniV4LiquidityPlacerAbi } from "@/utils/abis";

// useTokenLaunches reads decoded results by NAME (`record.token`, `record.creator`)
// for getLaunch, and POSITIONALLY for the multi-output views (launchIdOf,
// quoteConfig in useLaunchpadConfig). Those are different
// viem behaviours — a single tuple output decodes to an object, multiple outputs
// decode to an array — and nothing else in the suite would notice if a
// regenerated ABI flipped one. The feed would just render blank cards.

describe("TokenLaunchpad ABI decode shapes", () => {
  const TOKEN = "0x1111111111111111111111111111111111111111";
  const CREATOR = "0x2222222222222222222222222222222222222222";
  const PLACER = "0x3333333333333333333333333333333333333333";
  const USDC = "0x036cbd53842c5426634e7929541ec2318f3dcf7e";

  it("decodes getLaunch as an object with named fields", () => {
    const data = encodeAbiParameters(
      parseAbiParameters("(address,address,uint64,address,uint256,bytes32,address)"),
      [[TOKEN, CREATOR, 1700000000n, USDC, 5_000_000_000n, `0x${"ab".repeat(32)}`, PLACER]],
    );

    const record = decodeFunctionResult({
      abi: TokenLaunchpadAbi,
      functionName: "getLaunch",
      data,
    });

    expect(record.token.toLowerCase()).toBe(TOKEN);
    expect(record.creator.toLowerCase()).toBe(CREATOR);
    expect(record.launchedAt).toBe(1700000000n);
    expect(record.quoteToken.toLowerCase()).toBe(USDC);
    expect(record.startFdv).toBe(5_000_000_000n);
    expect(record.placer.toLowerCase()).toBe(PLACER);
  });

  it("decodes launchIdOf as a positional [id, exists] pair", () => {
    const data = encodeAbiParameters(parseAbiParameters("uint256, bool"), [7n, true]);

    const result = decodeFunctionResult({
      abi: TokenLaunchpadAbi,
      functionName: "launchIdOf",
      data,
    });

    expect(Array.isArray(result)).toBe(true);
    const [launchId, exists] = result;
    expect(launchId).toBe(7n);
    expect(exists).toBe(true);
  });

  it("decodes quoteConfig as a positional [allowed, minStartFdv, maxStartFdv] triple", () => {
    const ONE_ETH = 10n ** 18n;
    const data = encodeAbiParameters(parseAbiParameters("bool, uint256, uint256"), [
      true,
      ONE_ETH,
      1000n * ONE_ETH,
    ]);

    const config = decodeFunctionResult({
      abi: TokenLaunchpadAbi,
      functionName: "quoteConfig",
      data,
    });

    expect(config[0]).toBe(true);
    expect(config[1]).toBe(ONE_ETH);
    expect(config[2]).toBe(1000n * ONE_ETH);
  });

  // useLaunchMarkets reads the placement by name, including the launch's trade fee
  // and liquidity preset.
  it("decodes getPlacement as an object ending in tradeFee and liquidityPreset", () => {
    const fn = UniV4LiquidityPlacerAbi.find((e) => e.type === "function" && e.name === "getPlacement");
    expect(fn.outputs[0].components.map((c) => c.name).slice(-2)).toEqual(["tradeFee", "liquidityPreset"]);
    const key = [USDC, TOKEN, 0, 200, PLACER];
    const data = encodeAbiParameters(fn.outputs, [
      { key: { currency0: key[0], currency1: key[1], fee: key[2], tickSpacing: key[3], hooks: key[4] }, tickLower: -887200, tickUpper: 207200, liquidity: 5n, tokenIsCurrency0: false, tradeFee: 25_000, liquidityPreset: 2 },
    ]);
    const p = decodeFunctionResult({ abi: UniV4LiquidityPlacerAbi, functionName: "getPlacement", data });
    expect(p.tradeFee).toBe(25_000);
    expect(p.liquidityPreset).toBe(2);
    expect(p.key.tickSpacing).toBe(200);
    expect(p.key.fee).toBe(0);
  });

  // A placer from before presets returns the struct without liquidityPreset, which
  // the current ABI cannot decode — why useLaunchMarkets retries it without the field.
  it("cannot decode a pre-preset placement with the current ABI", () => {
    const data = encodeAbiParameters(
      parseAbiParameters("((address,address,uint24,int24,address),int24,int24,uint128,bool,uint24)"),
      [[[USDC, TOKEN, 0, 200, PLACER], -887200, 207200, 5n, false, 10_000]],
    );
    expect(() => decodeFunctionResult({ abi: UniV4LiquidityPlacerAbi, functionName: "getPlacement", data })).toThrow();
  });

  // deriveMarketState reads each band by name.
  it("decodes bandsOf as an array of { tickLower, tickUpper, liquidity }", () => {
    const fn = UniV4LiquidityPlacerAbi.find((e) => e.type === "function" && e.name === "bandsOf");
    const bands = [
      { tickLower: 196200, tickUpper: 207200, liquidity: 22473968353028949577470n },
      { tickLower: 173200, tickUpper: 196200, liquidity: 44208603119777946811819n },
      { tickLower: -887200, tickUpper: 173200, liquidity: 26018909033662068996986n },
    ];
    const data = encodeAbiParameters(fn.outputs, [bands]);
    expect(decodeFunctionResult({ abi: UniV4LiquidityPlacerAbi, functionName: "bandsOf", data })).toEqual(bands);
  });

  // useLaunchMarkets hands snipeTaxOf's result to deriveMarketState, which reads it
  // positionally: [startBps, duration, launchedAt].
  it("decodes snipeTaxOf as a positional [startBps, duration, launchedAt] triple", () => {
    const data = encodeAbiParameters(parseAbiParameters("uint16, uint16, uint32"), [8000, 30, 1_700_000_000]);
    const tax = decodeFunctionResult({ abi: UniV4LiquidityPlacerAbi, functionName: "snipeTaxOf", data });
    expect(tax).toEqual([8000, 30, 1_700_000_000]);
  });

  it("exposes the placer views the launchpad reads", () => {
    const names = new Set(UniV4LiquidityPlacerAbi.filter((e) => e.type === "function").map((e) => e.name));
    for (const fn of ["getPlacement", "bandsOf", "presetBands", "snipeTaxOf", "snipeStartBps", "snipeDuration", "minTradeFee", "MAX_TRADE_FEE"]) {
      expect(names, `${fn} missing from the exported placer ABI`).toContain(fn);
    }
  });

  it("takes the trade fee and the liquidity preset in launch(), between startFdv and creatorBuyIn", () => {
    const launch = TokenLaunchpadAbi.find((e) => e.type === "function" && e.name === "launch");
    expect(launch.inputs.map((i) => i.type)).toEqual([
      "string", "string", "string", "address", "uint256", "uint24", "uint8", "uint256", "uint256",
    ]);
    expect(launch.inputs.map((i) => i.name).slice(5, 7)).toEqual(["tradeFee", "liquidityPreset"]);
  });

  it("exposes every function the launch routes call", () => {
    const names = new Set(
      TokenLaunchpadAbi.filter((e) => e.type === "function").map((e) => e.name),
    );
    for (const fn of [
      "launch",
      "launchCount",
      "getLaunch",
      "launchIdOf",
      "isLaunchToken",
      "placer",
      "TOKEN_SUPPLY",
      "quoteConfig",
      "quoteTokenOf",
      "placerOf",
      "router",
    ]) {
      expect(names, `${fn} missing from the exported ABI`).toContain(fn);
    }
  });
});
