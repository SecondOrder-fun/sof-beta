import { describe, it, expect } from "vitest";
import { filterLaunches, sortLaunches } from "@/lib/launchSort";

const l = (token, name, symbol, launchedAt) => ({ token, name, symbol, launchedAt: BigInt(launchedAt) });
const A = l("0xaa", "Alpha", "ALP", 100);
const B = l("0xbb", "Beta", "BET", 300);
const C = l("0xcc", "Gamma", "GAM", 200);
const markets = {
  "0xaa": { multiple: 5, soldFraction: 0.5, fdv: 10n },
  "0xbb": { multiple: 2, soldFraction: 0.9, fdv: 30n },
};

describe("sortLaunches", () => {
  it("orders newest first by default and for unknown sorts", () => {
    expect(sortLaunches([A, B, C], markets, "new").map((x) => x.name)).toEqual(["Beta", "Gamma", "Alpha"]);
    expect(sortLaunches([A, B, C], markets, "bogus").map((x) => x.name)).toEqual(["Beta", "Gamma", "Alpha"]);
  });

  // An unpriced token is unknown, not worthless — it must not sort as zero.
  it("puts tokens that are not yet priced last, under every market sort", () => {
    for (const s of ["climb", "fdv", "sold"]) {
      expect(sortLaunches([C, A, B], markets, s).at(-1).name).toBe("Gamma");
    }
  });

  it("orders by the right metric", () => {
    expect(sortLaunches([A, B], markets, "climb")[0].name).toBe("Alpha");
    expect(sortLaunches([A, B], markets, "fdv")[0].name).toBe("Beta");
    expect(sortLaunches([A, B], markets, "sold")[0].name).toBe("Beta");
  });

  // 2,500 USDC is not "more" than 1 ETH because its raw number is bigger, nor
  // less because its whole number is: without an oracle they do not compare.
  it("groups top FDV by quote — ETH first, then by symbol — and orders within each", () => {
    const D = l("0xdd", "Delta", "DEL", 400);
    const E = l("0xee", "Epsilon", "EPS", 500);
    const mixed = {
      "0xaa": { fdv: 10n ** 18n, quote: { symbol: "ETH" } },
      "0xbb": { fdv: 2n * 10n ** 18n, quote: { symbol: "ETH" } },
      "0xdd": { fdv: 2_500n * 10n ** 6n, quote: { symbol: "USDC" } },
      "0xee": { fdv: 9_000n * 10n ** 6n, quote: { symbol: "USDC" } },
    };
    expect(sortLaunches([D, A, E, B], mixed, "fdv").map((x) => x.name)).toEqual(["Beta", "Alpha", "Epsilon", "Delta"]);
  });

  it("does not mutate its input", () => {
    const input = [A, B, C];
    sortLaunches(input, markets, "fdv");
    expect(input.map((x) => x.name)).toEqual(["Alpha", "Beta", "Gamma"]);
  });
});

describe("filterLaunches", () => {
  it("matches name, symbol with or without $, and address, ignoring case", () => {
    expect(filterLaunches([A, B, C], "alp")).toEqual([A]);
    expect(filterLaunches([A, B, C], "$BET")).toEqual([B]);
    expect(filterLaunches([A, B, C], "0xcc")).toEqual([C]);
  });

  it("returns everything for an empty query", () => {
    expect(filterLaunches([A, B, C], "  ")).toEqual([A, B, C]);
  });
});
