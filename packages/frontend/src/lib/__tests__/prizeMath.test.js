import { describe, it, expect } from "vitest";
import { splitPrizePool, perLoserShareWei, GRAND_PRIZE_BPS } from "@/lib/prizeMath";

describe("splitPrizePool", () => {
  it("splits 65/35 by bps", () => {
    const { grandWei, consolationWei } = splitPrizePool(1000n);
    expect(grandWei).toBe(650n);
    expect(consolationWei).toBe(350n);
    expect(GRAND_PRIZE_BPS).toBe(6500n);
  });
  it("returns zeros for 0 reserves", () => {
    expect(splitPrizePool(0n)).toEqual({ grandWei: 0n, consolationWei: 0n });
  });
  it("coerces nullish/garbage reserves to zero", () => {
    expect(splitPrizePool(undefined)).toEqual({ grandWei: 0n, consolationWei: 0n });
    expect(splitPrizePool("not-a-bigint")).toEqual({ grandWei: 0n, consolationWei: 0n });
  });
});

describe("perLoserShareWei", () => {
  it("divides consolation across losers (participants - 1)", () => {
    expect(perLoserShareWei(350n, 8)).toBe(50n); // 350 / 7
  });
  it("returns 0 with <= 1 participant", () => {
    expect(perLoserShareWei(350n, 1)).toBe(0n);
    expect(perLoserShareWei(350n, 0)).toBe(0n);
  });
  it("returns 0 with empty consolation", () => {
    expect(perLoserShareWei(0n, 5)).toBe(0n);
  });
});
