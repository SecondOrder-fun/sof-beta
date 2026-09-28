import { describe, it, expect } from "vitest";
import {
  formatFdvEth,
  formatPriceGwei,
  formatSupply,
  formatAge,
} from "@/lib/launchFormat";

describe("formatFdvEth", () => {
  it("renders the deployed bounds as the valuations they are", () => {
    // The contract's floor and ceiling — 1 ETH and 1000 ETH.
    expect(formatFdvEth(10n ** 18n)).toBe("1");
    expect(formatFdvEth(1000n * 10n ** 18n)).toBe("1,000");
  });
  it("keeps a fraction but drops trailing zeros", () => {
    expect(formatFdvEth(2_500_000_000_000_000_000n)).toBe("2.5");
  });
  it("renders nullish as a dash rather than zero", () => {
    expect(formatFdvEth(null)).toBe("—");
    expect(formatFdvEth(undefined)).toBe("—");
  });
});

describe("formatPriceGwei", () => {
  // Why gwei: at the 1 ETH floor against a 1e9 supply the price is exactly
  // 1 gwei per token, and the ceiling is 1000. In ETH those are
  // 0.000000001 and 0.000001 — indistinguishable at a glance.
  it("renders the floor price as 1 gwei", () => {
    expect(formatPriceGwei(1_000_000_000n)).toBe("1");
  });
  it("renders the ceiling price as 1000 gwei", () => {
    expect(formatPriceGwei(1_000_000_000_000n)).toBe("1000");
  });
});

describe("formatSupply", () => {
  it("abbreviates a launch supply", () => {
    expect(formatSupply(1_000_000_000n * 10n ** 18n)).toBe("1B");
  });
  it("abbreviates smaller magnitudes", () => {
    expect(formatSupply(2_500_000n * 10n ** 18n)).toBe("2.5M");
    expect(formatSupply(1_500n * 10n ** 18n)).toBe("1.5K");
  });
  it("renders nullish as a dash", () => {
    expect(formatSupply(null)).toBe("—");
  });
});

describe("formatAge", () => {
  const now = 1_700_000_000_000; // fixed clock so the test is not time-dependent
  const at = (secondsAgo) => BigInt(now / 1000 - secondsAgo);

  it("steps through seconds, minutes, hours and days", () => {
    expect(formatAge(at(30), now)).toBe("30s");
    expect(formatAge(at(180), now)).toBe("3m");
    expect(formatAge(at(3600 * 5), now)).toBe("5h");
    expect(formatAge(at(86400 * 2), now)).toBe("2d");
  });

  it("clamps a future timestamp to zero rather than showing a negative age", () => {
    expect(formatAge(at(-60), now)).toBe("0s");
  });
});
