import { describe, it, expect } from "vitest";
import {
  formatFdvEth,
  formatFdv,
  formatQuoteAmount,
  formatTokenPrice,
  parseQuoteAmount,
  formatSupply,
  formatAge,
  formatMultiple,
  formatPercent,
  formatTimeLeft,
  formatTokenAmount,
  formatEthAmount,
  tokensToEthWei,
  formatTradeFee,
  formatFeeRate,
  splitSeconds,
  parseTradeFeePct,
} from "@/lib/launchFormat";
import { getCountdownParts, timeUntil } from "@/lib/utils";

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

describe("formatTokenPrice", () => {
  const USDC = { symbol: "USDC", decimals: 6 };
  // Why gwei: at the 1 ETH floor against a 1e9 supply the price is exactly
  // 1 gwei per token, and the ceiling is 1000. In ETH those are
  // 0.000000001 and 0.000001 — indistinguishable at a glance.
  it("renders the ETH floor and ceiling as 1 and 1000 gwei", () => {
    expect(formatTokenPrice(10n ** 18n, null)).toEqual({ value: "1", unit: "gwei" });
    expect(formatTokenPrice(1000n * 10n ** 18n, { symbol: "ETH", decimals: 18 })).toEqual({ value: "1000", unit: "gwei" });
  });
  // A 2,500 USDC launch is 2.5 raw units per token: taken from the valuation,
  // the price keeps the half a floored per-token price would lose.
  it("renders a USDC price in USDC, to four significant digits", () => {
    expect(formatTokenPrice(2_500_000_000n, USDC)).toEqual({ value: "0.0000025", unit: "USDC" });
    expect(formatTokenPrice(1_234_567_891n, USDC)).toEqual({ value: "0.000001234", unit: "USDC" });
    expect(formatTokenPrice(2_500_000n * 10n ** 6n, USDC)).toEqual({ value: "0.0025", unit: "USDC" });
  });
  it("renders a missing valuation as a dash, keeping the unit", () => {
    expect(formatTokenPrice(null, USDC)).toEqual({ value: "—", unit: "USDC" });
  });
});

describe("formatFdv", () => {
  it("renders a USDC valuation in whole USDC", () => {
    expect(formatFdv(2_500n * 10n ** 6n, 6)).toBe("2,500");
    expect(formatFdv(2_500_500_000n, 6, 2)).toBe("2,500.5");
  });
});

describe("formatQuoteAmount", () => {
  it("keeps cents from 0.01 up and significant digits below, in the quote's decimals", () => {
    expect(formatQuoteAmount(1_250_000_000n, 6)).toBe("1,250");
    expect(formatQuoteAmount(12_345n, 6)).toBe("0.01");
    expect(formatQuoteAmount(4_720n, 6)).toBe("0.00472");
    expect(formatQuoteAmount(0n, 6)).toBe("0");
  });
  it("defaults to 18 decimals, as formatEthAmount", () => {
    expect(formatQuoteAmount(4n * 10n ** 15n)).toBe(formatEthAmount(4n * 10n ** 15n));
  });
});

describe("parseQuoteAmount", () => {
  it("parses in the quote's decimals", () => {
    expect(parseQuoteAmount("2.5", 18)).toBe(2_500_000_000_000_000_000n);
    expect(parseQuoteAmount("2500", 6)).toBe(2_500_000_000n);
    expect(parseQuoteAmount("0.000001", 6)).toBe(1n);
  });
  it("is null for empty, zero, junk, or more decimals than the quote has", () => {
    for (const bad of ["", " ", "0", "0.0", ".", "abc", "1e5", "-1", "0.0000001"]) {
      expect(parseQuoteAmount(bad, 6)).toBeNull();
    }
  });
});

describe("trade fee percentages", () => {
  it("formats pips as a percentage", () => {
    expect(formatTradeFee(10_000)).toBe("1");
    expect(formatTradeFee(5_000)).toBe("0.5");
    expect(formatTradeFee(25_000)).toBe("2.5");
    expect(formatTradeFee(100_000)).toBe("10");
    expect(formatTradeFee(1)).toBe("0.0001");
    expect(formatTradeFee(null)).toBe("—");
  });
  it("parses a typed percentage into pips", () => {
    expect(parseTradeFeePct("1")).toBe(10_000);
    expect(parseTradeFeePct("0.5")).toBe(5_000);
    expect(parseTradeFeePct(" 2.5% ")).toBe(25_000);
    expect(parseTradeFeePct("0.0001")).toBe(1);
  });
  it("is null for empty, zero, junk, or finer than a pip", () => {
    for (const bad of ["", "0", "abc", "-1", "0.00001", "1e2"]) {
      expect(parseTradeFeePct(bad)).toBeNull();
    }
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
  // The English launchpad strings, so the assertions read as the reader sees them.
  const EN = { "time.days": "{{count}}d", "time.hours": "{{count}}h", "time.minutes": "{{count}}m", "time.pair": "{{first}} {{second}}" };
  const en = (key, opts = {}) => EN[key].replace(/\{\{(\w+)\}\}/g, (_, k) => String(opts[k]));

  it("shows the two largest units", () => {
    expect(formatTimeLeft(at(2 * 86400 + 4 * 3600 + 11 * 60), en, NOW_MS)).toBe("2d 4h");
    expect(formatTimeLeft(at(2 * 3600 + 10 * 60), en, NOW_MS)).toBe("2h 10m");
    expect(formatTimeLeft(at(9 * 60 + 30), en, NOW_MS)).toBe("9m");
  });

  it("drops a zero second unit", () => {
    expect(formatTimeLeft(at(3 * 86400), en, NOW_MS)).toBe("3d");
    expect(formatTimeLeft(at(2 * 3600), en, NOW_MS)).toBe("2h");
  });

  it("floors at 0m once the time has passed, and dashes a missing time", () => {
    expect(formatTimeLeft(at(-60), en, NOW_MS)).toBe("0m");
    expect(formatTimeLeft(null, en, NOW_MS)).toBe("—");
  });

  it("splits time exactly as the CountdownTimer does", () => {
    const target = at(2 * 86400 + 4 * 3600 + 11 * 60);
    const { days, hours } = getCountdownParts(target, NOW_MS);
    expect(formatTimeLeft(target, en, NOW_MS)).toBe(`${days}d ${hours}h`);
  });

  it("names every unit through the translator, never a hardcoded English letter", () => {
    const echo = (key, opts) => `${key}${JSON.stringify(opts)}`;
    expect(formatTimeLeft(at(2 * 3600 + 10 * 60), echo, NOW_MS)).toBe(
      'time.pair{"first":"time.hours{\\"count\\":2}","second":"time.minutes{\\"count\\":10}"}',
    );
    const ja = { "time.days": "{{count}}日", "time.hours": "{{count}}時間", "time.minutes": "{{count}}分", "time.pair": "{{first}}{{second}}" };
    const tJa = (key, opts = {}) => ja[key].replace(/\{\{(\w+)\}\}/g, (_, k) => String(opts[k]));
    expect(formatTimeLeft(at(86400 + 3 * 3600), tJa, NOW_MS)).toBe("1日3時間");
  });
});

describe("timeUntil", () => {
  const NOW_MS = 1_700_000_000_000;

  it("returns the two largest units as numbers, from the clock it is given", () => {
    expect(timeUntil(NOW_MS / 1000 + 2 * 86400 + 4 * 3600, NOW_MS)).toEqual([
      { unit: "days", value: 2 },
      { unit: "hours", value: 4 },
    ]);
    expect(timeUntil(NOW_MS / 1000 + 9 * 60, NOW_MS)).toEqual([{ unit: "minutes", value: 9 }]);
    expect(timeUntil(NOW_MS / 1000 - 5, NOW_MS)).toEqual([{ unit: "minutes", value: 0 }]);
  });

  it("accepts milliseconds and dates as well as seconds", () => {
    const target = NOW_MS + 3 * 3600 * 1000;
    expect(timeUntil(target, NOW_MS)).toEqual([{ unit: "hours", value: 3 }]);
    expect(timeUntil(new Date(target), NOW_MS)).toEqual([{ unit: "hours", value: 3 }]);
  });
});

describe("tokensToEthWei", () => {
  it("prices whole tokens at a pool price", () => {
    // 10 tokens at 47 gwei each.
    expect(tokensToEthWei(10, 47n * 10n ** 9n)).toBe(470n * 10n ** 9n);
    expect(tokensToEthWei(0.5, 10n ** 18n)).toBe(5n * 10n ** 17n);
  });

  it("is null without a price or a usable amount", () => {
    expect(tokensToEthWei(10, null)).toBeNull();
    expect(tokensToEthWei(Number.NaN, 1n)).toBeNull();
    expect(tokensToEthWei(-1, 1n)).toBeNull();
  });
});

describe("formatEthAmount", () => {
  const ETH = 10n ** 18n;

  it("keeps two decimals from 0.01 ETH up", () => {
    expect(formatEthAmount(4n * ETH / 10n)).toBe("0.4");
    expect(formatEthAmount(1_250n * ETH)).toBe("1,250");
    expect(formatEthAmount(1_234_567n * ETH / 1000n)).toBe("1,234.56");
    expect(formatEthAmount(ETH / 100n)).toBe("0.01");
  });

  it("keeps three significant digits below 0.01 ETH instead of rounding to 0", () => {
    expect(formatEthAmount(4n * ETH / 1000n)).toBe("0.004");
    expect(formatEthAmount(47_200_000_000_000n)).toBe("0.0000472");
    expect(formatEthAmount(9_996_000_000_000_000n)).toBe("0.00999");
    expect(formatEthAmount(1n)).toBe("0.000000000000000001");
    expect(formatFdvEth(4n * ETH / 1000n, 2)).toBe("0");
  });

  it("renders zero as 0, accepts a wei string and dashes a missing amount", () => {
    expect(formatEthAmount(0n)).toBe("0");
    expect(formatEthAmount("4000000000000000")).toBe("0.004");
    expect(formatEthAmount(null)).toBe("—");
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

describe("formatFeeRate", () => {
  it("shows a moving rate to two decimals, rounded up so it never reads low", () => {
    expect(formatFeeRate(800_000)).toBe("80");
    expect(formatFeeRate(589_334)).toBe("58.94");
    expect(formatFeeRate(405_000)).toBe("40.5");
    expect(formatFeeRate(10_000)).toBe("1");
    expect(formatFeeRate(10_001)).toBe("1.01");
    expect(formatFeeRate(null)).toBe("—");
  });
});

describe("splitSeconds", () => {
  it("splits a countdown into minutes and seconds, rounding a fraction up", () => {
    expect(splitSeconds(22)).toEqual({ minutes: 0, seconds: 22 });
    expect(splitSeconds(90)).toEqual({ minutes: 1, seconds: 30 });
    expect(splitSeconds(0.2)).toEqual({ minutes: 0, seconds: 1 });
    expect(splitSeconds(-3)).toEqual({ minutes: 0, seconds: 0 });
  });
});
