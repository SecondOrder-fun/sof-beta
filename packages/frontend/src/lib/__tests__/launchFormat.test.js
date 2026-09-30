import { describe, it, expect } from "vitest";
import {
  formatFdvEth,
  formatPriceGwei,
  formatSupply,
  formatAge,
  formatMultiple,
  formatPercent,
  formatTimeLeft,
  formatTokenAmount,
} from "@/lib/launchFormat";
import { getCountdownParts } from "@/lib/utils";

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

describe("formatMultiple", () => {
  it("keeps two decimals under 10x so early moves show", () => {
    expect(formatMultiple(1)).toBe("1.00");
    expect(formatMultiple(1.004)).toBe("1.00");
    expect(formatMultiple(3.456)).toBe("3.46");
  });
  it("drops to one decimal from 10x", () => {
    expect(formatMultiple(23.64)).toBe("23.6");
  });
  it("renders unusable input as a dash", () => {
    expect(formatMultiple(null)).toBe("—");
    expect(formatMultiple(NaN)).toBe("—");
  });
});

describe("formatPercent", () => {
  it("shows one decimal under 10% and whole numbers above", () => {
    expect(formatPercent(0.0912)).toBe("9.1");
    expect(formatPercent(0.68)).toBe("68");
  });
  it("renders unusable input as a dash", () => {
    expect(formatPercent(undefined)).toBe("—");
  });
});

describe("formatTimeLeft", () => {
  const NOW_MS = 1_700_000_000_000;
  const at = (sec) => NOW_MS / 1000 + sec;

  it("shows the two largest units", () => {
    expect(formatTimeLeft(at(2 * 86400 + 4 * 3600 + 11 * 60), NOW_MS)).toBe("2d 4h");
    expect(formatTimeLeft(at(2 * 3600 + 10 * 60), NOW_MS)).toBe("2h 10m");
    expect(formatTimeLeft(at(9 * 60 + 30), NOW_MS)).toBe("9m");
  });

  it("drops a zero second unit", () => {
    expect(formatTimeLeft(at(3 * 86400), NOW_MS)).toBe("3d");
    expect(formatTimeLeft(at(2 * 3600), NOW_MS)).toBe("2h");
  });

  it("floors at 0m once the time has passed, and dashes a missing time", () => {
    expect(formatTimeLeft(at(-60), NOW_MS)).toBe("0m");
    expect(formatTimeLeft(null, NOW_MS)).toBe("—");
  });

  it("splits time exactly as the CountdownTimer does", () => {
    const target = at(2 * 86400 + 4 * 3600 + 11 * 60);
    const { days, hours } = getCountdownParts(target, NOW_MS);
    expect(formatTimeLeft(target, NOW_MS)).toBe(`${days}d ${hours}h`);
  });
});

describe("getCountdownParts with an explicit clock", () => {
  it("counts from the clock it is given", () => {
    const nowMs = 1_700_000_000_000;
    expect(getCountdownParts(nowMs / 1000 + 3661, nowMs)).toEqual({ days: 0, hours: 1, minutes: 1, seconds: 1, isEnded: false });
    expect(getCountdownParts(nowMs / 1000 - 1, nowMs).isEnded).toBe(true);
  });

  it("still defaults to the wall clock for existing callers", () => {
    const target = Math.floor(Date.now() / 1000) + 2 * 86400 + 30;
    expect(getCountdownParts(target)).toMatchObject({ days: 2, hours: 0, isEnded: false });
  });
});

describe("formatTokenAmount", () => {
  const TOKEN = 10n ** 18n;

  it("keeps the fraction formatSupply would truncate", () => {
    expect(formatTokenAmount(TOKEN / 2n)).toBe("0.5");
    expect(formatSupply(TOKEN / 2n)).toBe("0");
  });

  it("groups thousands and caps the decimals, dropping trailing zeros", () => {
    expect(formatTokenAmount(12_000n * TOKEN)).toBe("12,000");
    expect(formatTokenAmount(1_234_567_891_234_567_891_234n)).toBe("1,234.5678");
    expect(formatTokenAmount(1_234_567_891_234_567_891_234n, 2)).toBe("1,234.56");
    expect(formatTokenAmount(TOKEN + TOKEN / 10n)).toBe("1.1");
  });

  it("accepts a wei string and dashes a missing amount", () => {
    expect(formatTokenAmount(String(3n * TOKEN))).toBe("3");
    expect(formatTokenAmount(null)).toBe("—");
  });
});
