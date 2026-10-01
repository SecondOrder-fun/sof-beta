import { describe, it, expect } from "vitest";
import { splitPrizePool, perLoserShareWei, grandPrizeWei, GRAND_PRIZE_BPS } from "@/lib/prizeMath";

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

describe("grandPrizeWei", () => {
  it("prefers the indexed grand prize", () => {
    expect(grandPrizeWei({ grandPrize: "650", grandPrizeBps: 5000, prizePool: "1000" })).toBe(650n);
  });
  it("applies the season's own split to the pool when only the bps is known", () => {
    expect(grandPrizeWei({ grandPrizeBps: 6500, prizePool: "1000" })).toBe(650n);
    expect(grandPrizeWei({ grandPrizeBps: "7000", prizePool: 1000n })).toBe(700n);
  });
  it("is unknown — not the whole pool — when neither is given", () => {
    expect(grandPrizeWei({ prizePool: "1000" })).toBeNull();
    expect(grandPrizeWei({ grandPrize: "garbage" })).toBeNull();
    expect(grandPrizeWei()).toBeNull();
  });
});
