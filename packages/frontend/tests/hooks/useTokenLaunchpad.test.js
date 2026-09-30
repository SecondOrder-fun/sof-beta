import { describe, it, expect } from "vitest";
import {
  parseFdvEth,
  fdvWeiToStartPriceWei,
  startPriceWeiToFdvWei,
  validateLaunchForm,
  MAX_NAME_LENGTH,
  MAX_SYMBOL_LENGTH,
  utf8Length,
} from "@/hooks/useTokenLaunchpad";

const WHOLE_SUPPLY = 1_000_000_000n;
const ONE_ETH = 10n ** 18n;

// The deployed bounds (script/deploy/21_DeployTokenLaunchpad.s.sol).
const CONFIG = {
  minFdvWei: ONE_ETH,
  maxFdvWei: 1000n * ONE_ETH,
};

describe("FDV <-> start price", () => {
  // The whole reason the form works in FDV: price and valuation are nine orders
  // of magnitude apart, and the per-token price is the unit in which the
  // contract's floor looks arbitrary.
  it("converts the 1 ETH floor to 1 gwei per token", () => {
    expect(fdvWeiToStartPriceWei(ONE_ETH, WHOLE_SUPPLY)).toBe(1_000_000_000n);
  });

  it("converts the 1000 ETH ceiling to 1000 gwei per token", () => {
    expect(fdvWeiToStartPriceWei(1000n * ONE_ETH, WHOLE_SUPPLY)).toBe(1_000_000_000_000n);
  });

  it("round-trips", () => {
    const fdv = 42n * ONE_ETH;
    const price = fdvWeiToStartPriceWei(fdv, WHOLE_SUPPLY);
    expect(startPriceWeiToFdvWei(price, WHOLE_SUPPLY)).toBe(fdv);
  });

  it("does not divide by a zero supply", () => {
    expect(fdvWeiToStartPriceWei(ONE_ETH, 0n)).toBe(0n);
  });
});

describe("parseFdvEth", () => {
  it("parses a decimal entry", () => {
    expect(parseFdvEth("2.5")).toBe(2_500_000_000_000_000_000n);
  });

  it("returns null for anything unusable, so 'not filled in' is distinguishable from zero", () => {
    expect(parseFdvEth("")).toBeNull();
    expect(parseFdvEth("   ")).toBeNull();
    expect(parseFdvEth("0")).toBeNull();
    expect(parseFdvEth("abc")).toBeNull();
    expect(parseFdvEth("-1")).toBeNull();
    expect(parseFdvEth(undefined)).toBeNull();
  });
});

describe("validateLaunchForm", () => {
  const valid = { name: "Second Order", symbol: "SOF", fdvWei: 5n * ONE_ETH };

  it("accepts a well-formed launch", () => {
    expect(validateLaunchForm(valid, CONFIG)).toEqual({});
  });

  it("requires a name and a symbol", () => {
    expect(validateLaunchForm({ ...valid, name: "  " }, CONFIG).name).toBe("errors.nameRequired");
    expect(validateLaunchForm({ ...valid, symbol: "" }, CONFIG).symbol).toBe(
      "errors.symbolRequired",
    );
  });

  it("mirrors the contract's length limits", () => {
    expect(validateLaunchForm({ ...valid, name: "x".repeat(MAX_NAME_LENGTH) }, CONFIG)).toEqual({});
    expect(
      validateLaunchForm({ ...valid, name: "x".repeat(MAX_NAME_LENGTH + 1) }, CONFIG).name,
    ).toBe("errors.nameTooLong");
    expect(
      validateLaunchForm({ ...valid, symbol: "x".repeat(MAX_SYMBOL_LENGTH + 1) }, CONFIG).symbol,
    ).toBe("errors.symbolTooLong");
  });

  // The contract counts bytes(name).length — UTF-8 bytes. 20 CJK characters are 60 bytes:
  // fine by .length (20 < 48) but a NameTooLong revert after the user has signed.
  it("measures the limits in UTF-8 bytes, as the contract does", () => {
    expect(utf8Length("蛙".repeat(20))).toBe(60);
    expect(validateLaunchForm({ ...valid, name: "蛙".repeat(16) }, CONFIG)).toEqual({}); // 48 bytes
    expect(validateLaunchForm({ ...valid, name: "蛙".repeat(17) }, CONFIG).name).toBe("errors.nameTooLong");
    expect(validateLaunchForm({ ...valid, symbol: "🐸".repeat(5) }, CONFIG).symbol).toBe(
      "errors.symbolTooLong",
    ); // 20 bytes
    expect(validateLaunchForm({ ...valid, symbol: "🐸".repeat(4) }, CONFIG)).toEqual({}); // 16 bytes
  });

  // The failure the floor exists to prevent: below a 1 ETH valuation a single
  // ordinary buy consumes most of the position.
  it("rejects a valuation below the floor", () => {
    expect(validateLaunchForm({ ...valid, fdvWei: ONE_ETH - 1n }, CONFIG).fdv).toBe(
      "errors.fdvTooLow",
    );
  });

  it("rejects a valuation above the ceiling", () => {
    expect(validateLaunchForm({ ...valid, fdvWei: 1000n * ONE_ETH + 1n }, CONFIG).fdv).toBe(
      "errors.fdvTooHigh",
    );
  });

  it("accepts both bounds exactly — they are inclusive on the contract", () => {
    expect(validateLaunchForm({ ...valid, fdvWei: CONFIG.minFdvWei }, CONFIG).fdv).toBeUndefined();
    expect(validateLaunchForm({ ...valid, fdvWei: CONFIG.maxFdvWei }, CONFIG).fdv).toBeUndefined();
  });

  it("requires a valuation at all", () => {
    expect(validateLaunchForm({ ...valid, fdvWei: null }, CONFIG).fdv).toBe("errors.fdvRequired");
  });

  // Config arrives asynchronously; the form must not claim a valuation is out of
  // range before it knows the range.
  it("checks names and symbols but not bounds while config is still loading", () => {
    const errors = validateLaunchForm({ ...valid, fdvWei: 1n }, undefined);
    expect(errors.fdv).toBeUndefined();
    expect(validateLaunchForm({ ...valid, name: "" }, undefined).name).toBe("errors.nameRequired");
  });
});
