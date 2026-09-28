import { describe, it, expect } from "vitest";
import { encodeAbiParameters, decodeFunctionResult, parseAbiParameters } from "viem";
import { TokenLaunchpadAbi } from "@/utils/abis";

// useTokenLaunches reads decoded results by NAME (`record.token`, `record.creator`)
// for getLaunch, and POSITIONALLY for the two-output views. Those are different
// viem behaviours — a single tuple output decodes to an object, multiple outputs
// decode to an array — and nothing else in the suite would notice if a
// regenerated ABI flipped one. The feed would just render blank cards.

describe("TokenLaunchpad ABI decode shapes", () => {
  const TOKEN = "0x1111111111111111111111111111111111111111";
  const CREATOR = "0x2222222222222222222222222222222222222222";

  it("decodes getLaunch as an object with named fields", () => {
    const data = encodeAbiParameters(
      parseAbiParameters("(address,address,uint64,uint256,bytes32)"),
      [[TOKEN, CREATOR, 1700000000n, 1_000_000_000n, `0x${"ab".repeat(32)}`]],
    );

    const record = decodeFunctionResult({
      abi: TokenLaunchpadAbi,
      functionName: "getLaunch",
      data,
    });

    expect(record.token.toLowerCase()).toBe(TOKEN);
    expect(record.creator.toLowerCase()).toBe(CREATOR);
    expect(record.launchedAt).toBe(1700000000n);
    expect(record.startPriceWei).toBe(1_000_000_000n);
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

  it("decodes startPriceBoundsAsFdvWei as a positional [min, max] pair", () => {
    const ONE_ETH = 10n ** 18n;
    const data = encodeAbiParameters(parseAbiParameters("uint256, uint256"), [
      ONE_ETH,
      1000n * ONE_ETH,
    ]);

    const bounds = decodeFunctionResult({
      abi: TokenLaunchpadAbi,
      functionName: "startPriceBoundsAsFdvWei",
      data,
    });

    expect(bounds[0]).toBe(ONE_ETH);
    expect(bounds[1]).toBe(1000n * ONE_ETH);
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
      "minStartPriceWei",
      "maxStartPriceWei",
      "startPriceBoundsAsFdvWei",
      "impliedFdvWei",
    ]) {
      expect(names, `${fn} missing from the exported ABI`).toContain(fn);
    }
  });
});
