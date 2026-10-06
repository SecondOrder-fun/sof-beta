import { describe, it, expect } from "vitest";
import { decodeFunctionData, getAddress } from "viem";

import { UniV4LiquidityPlacerAbi } from "@/utils/abis";
import {
  buildLaunchClaimCalls,
  buildTransferCalls,
  launchEarnings,
  planClaimAllQuote,
  recipientShare,
  sameAddress,
  summarizeCreatorFees,
  validateNewRecipient,
} from "@/lib/creatorFees";

const PLACER = getAddress("0x3000000000000000000000000000000000000003");
const OLD_PLACER = getAddress("0x4000000000000000000000000000000000000004");
const TOKEN = getAddress("0xaaaa00000000000000000000000000000000aaaa");
const TOKEN_B = getAddress("0xbbbb00000000000000000000000000000000bbbb");
const TOKEN_C = getAddress("0xcccc00000000000000000000000000000000cccc");
const WALLET = getAddress("0x5555555555555555555555555555555555555555");
const SECOND = getAddress("0x6666666666666666666666666666666666666666");
const OTHER = getAddress("0x7777777777777777777777777777777777777777");
const ZERO = "0x0000000000000000000000000000000000000000";
const USDC = getAddress("0x036CbD53842c5426634e7929541eC2318f3dCF7e");
const BPS = 8800n;
const E = 10n ** 18n;
const ABI_FUNCTIONS = new Set(UniV4LiquidityPlacerAbi.filter((e) => e.type === "function").map((e) => e.name));

/** What each call does: [target, function, ...args] — the batch, readable. */
const decode = (calls) =>
  calls.map(({ to, data }) => {
    const { functionName, args } = decodeFunctionData({ abi: UniV4LiquidityPlacerAbi, data });
    return [to, functionName, ...(args ?? [])];
  });

const launch = (over = {}) => ({
  token: TOKEN,
  placer: PLACER,
  quoteToken: ZERO,
  recipient: WALLET,
  pendingFees: 0n,
  ...over,
});
/** A placer with ETH credits, and optionally credits in other currencies keyed by lowercased address. */
const placer = (ethCredits = {}, address = PLACER, others = {}) => ({
  address,
  creatorFeeBps: BPS,
  claimable: { [ZERO]: ethCredits, ...others },
});
const lc = (a) => a.toLowerCase();

describe("recipientShare", () => {
  it("floors 88% exactly as the placer does", () => {
    expect(recipientShare(10_000n, BPS)).toBe(8_800n);
    expect(recipientShare(3n, BPS)).toBe(2n); // 2.64 -> 2
    expect(recipientShare(1n, BPS)).toBe(0n); // a 1-wei collection credits the recipient nothing
  });

  it("is zero for nothing, an unknown amount, or no rate", () => {
    expect(recipientShare(0n, BPS)).toBe(0n);
    expect(recipientShare(null, BPS)).toBe(0n);
    expect(recipientShare(100n, 0n)).toBe(0n);
  });
});

describe("launchEarnings", () => {
  it("adds the recipient's share of the pending fees to what is credited — all in the quote", () => {
    const e = launchEarnings(launch({ pendingFees: 10n * E }), placer({ [lc(WALLET)]: 1n * E }), WALLET);
    expect(e).toEqual({
      isRecipient: true,
      quoteClaimable: 1n * E,
      quotePending: 8_800_000_000_000_000_000n,
      quote: 9_800_000_000_000_000_000n,
    });
  });

  // collectFees credits whoever is the recipient AT collection.
  it("counts pending fees only for the current recipient", () => {
    const e = launchEarnings(launch({ recipient: OTHER, pendingFees: 10n * E }), placer({ [lc(WALLET)]: 7n }), WALLET);
    expect(e).toMatchObject({ isRecipient: false, quote: 7n, quotePending: 0n });
  });

  it("treats an unread pending amount as nothing pending", () => {
    const e = launchEarnings(launch({ pendingFees: null }), placer({ [lc(WALLET)]: 3n }), WALLET);
    expect(e).toMatchObject({ quote: 3n, quotePending: 0n });
  });

  // Fees are only ever in the quote: nothing in the result names the launch token.
  it("has no launch-token side", () => {
    const e = launchEarnings(launch({ pendingFees: 100n }), placer(), WALLET);
    expect(Object.keys(e).some((k) => /token/i.test(k))).toBe(false);
  });
});

describe("buildLaunchClaimCalls (token page)", () => {
  const build = (l, credits = {}) => buildLaunchClaimCalls(launch(l), placer(credits), WALLET);

  it("collects, then claims the quote, when fees are pending", () => {
    const { calls, quote } = build({ pendingFees: 100n });
    expect(decode(calls)).toEqual([
      [PLACER, "collectFees", TOKEN],
      [PLACER, "claim", ZERO, WALLET],
    ]);
    expect(quote).toBe(88n);
  });

  it("claims credited fees without a collect when nothing is pending", () => {
    const { calls } = build({}, { [lc(WALLET)]: 5n });
    expect(decode(calls)).toEqual([[PLACER, "claim", ZERO, WALLET]]);
  });

  // claim reverts NothingToClaim on zero, which would revert the batch.
  it("never claims when the share floors to zero", () => {
    const { calls, quote } = build({ pendingFees: 1n });
    expect(quote).toBe(0n);
    expect(decode(calls)).toEqual([[PLACER, "collectFees", TOKEN]]);
  });

  it("builds nothing when nothing is earned", () => {
    expect(build({}).calls).toEqual([]);
  });

  it("never claims the launch token", () => {
    const { calls } = build({ pendingFees: 10n * E }, { [lc(WALLET)]: 5n });
    expect(decode(calls).filter(([, fn, currency]) => fn === "claim" && currency === TOKEN)).toEqual([]);
  });

  it("skips the collect when pending is unread, and claims what is credited", () => {
    const { calls } = build({ pendingFees: null }, { [lc(WALLET)]: 2n });
    expect(decode(calls)).toEqual([[PLACER, "claim", ZERO, WALLET]]);
  });

  it("sends the claim to the claimant", () => {
    const { calls } = buildLaunchClaimCalls(launch({ recipient: SECOND, pendingFees: 100n }), placer({}), SECOND);
    expect(decode(calls)).toEqual([
      [PLACER, "collectFees", TOKEN],
      [PLACER, "claim", ZERO, SECOND],
    ]);
  });
});

describe("buildLaunchClaimCalls — a USDC-paired launch", () => {
  it("claims the launch's quote currency — USDC — not ETH", () => {
    const { calls, quote } = buildLaunchClaimCalls(
      launch({ quoteToken: USDC, pendingFees: 1_000_000n }),
      placer({ [lc(WALLET)]: 9n * E }, PLACER, { [lc(USDC)]: { [lc(WALLET)]: 500_000n } }),
      WALLET,
    );
    expect(decode(calls)).toEqual([
      [PLACER, "collectFees", TOKEN],
      [PLACER, "claim", USDC, WALLET],
    ]);
    // 0.5 USDC credited + 88% of 1 USDC pending; the 9 ETH is not this launch's.
    expect(quote).toBe(1_380_000n);
  });
});

describe("buildTransferCalls", () => {
  // Without the collect, fees earned before the transfer would be credited to
  // the new recipient — the dialog promises they stay with the old one.
  it("collects first when fees are pending", () => {
    expect(decode(buildTransferCalls(launch({ pendingFees: 5n }), OTHER))).toEqual([
      [PLACER, "collectFees", TOKEN],
      [PLACER, "setFeeRecipient", TOKEN, OTHER],
    ]);
  });

  it("only sets the recipient when there is nothing to collect", () => {
    expect(decode(buildTransferCalls(launch({ pendingFees: null }), OTHER))).toEqual([
      [PLACER, "setFeeRecipient", TOKEN, OTHER],
    ]);
  });
});

describe("planClaimAllQuote (profile)", () => {
  const fees = {
    launches: [
      launch({ token: TOKEN, pendingFees: 100n }),
      launch({ token: TOKEN_B, pendingFees: 0n }),
      launch({ token: TOKEN_C, placer: OLD_PLACER, pendingFees: 200n }),
    ],
    placers: { [lc(PLACER)]: placer({ [lc(WALLET)]: 10n }), [lc(OLD_PLACER)]: placer({}, OLD_PLACER) },
  };

  it("groups by placer: each placer's collects for launches with pending fees, then its claim", () => {
    const plan = planClaimAllQuote(fees, WALLET, ZERO);
    expect(decode(plan.calls)).toEqual([
      [PLACER, "collectFees", TOKEN],
      [PLACER, "claim", ZERO, WALLET],
      [OLD_PLACER, "collectFees", TOKEN_C],
      [OLD_PLACER, "claim", ZERO, WALLET],
    ]);
    // 10 credited + 88 + 176
    expect(plan.amount).toBe(274n);
  });

  it("does not collect a launch with nothing pending", () => {
    const calls = decode(planClaimAllQuote(fees, WALLET, ZERO).calls);
    expect(calls).not.toContainEqual([PLACER, "collectFees", TOKEN_B]);
  });

  it("claims a placer's pooled ETH even with no listed launch on it", () => {
    const plan = planClaimAllQuote(
      { launches: [], placers: { [lc(PLACER)]: placer({ [lc(WALLET)]: 3n }) } },
      WALLET,
      ZERO,
    );
    expect(decode(plan.calls)).toEqual([[PLACER, "claim", ZERO, WALLET]]);
  });

  it("skips a placer with nothing for the account — no NothingToClaim", () => {
    const plan = planClaimAllQuote(
      { launches: [launch({ pendingFees: 1n })], placers: { [lc(PLACER)]: placer({}) } },
      WALLET,
      ZERO,
    );
    expect(plan).toEqual({ calls: [], amount: 0n });
  });

  it("does not collect a launch whose fees now go to someone else", () => {
    const plan = planClaimAllQuote(
      { launches: [launch({ recipient: OTHER, pendingFees: 100n })], placers: { [lc(PLACER)]: placer({ [lc(WALLET)]: 1n }) } },
      WALLET,
      ZERO,
    );
    expect(decode(plan.calls)).toEqual([[PLACER, "claim", ZERO, WALLET]]);
  });

  it("plans nothing with nobody connected", () => {
    expect(planClaimAllQuote(fees, undefined, ZERO)).toEqual({ calls: [], amount: 0n });
  });

  // One claim per currency: the ETH plan never touches a USDC launch or USDC
  // credits, and the USDC plan claims USDC only.
  it("keeps each quote currency to its own plan", () => {
    const mixed = {
      launches: [
        launch({ token: TOKEN, pendingFees: 100n }),
        launch({ token: TOKEN_B, quoteToken: USDC, pendingFees: 1_000_000n }),
      ],
      placers: { [lc(PLACER)]: placer({ [lc(WALLET)]: 10n }, PLACER, { [lc(USDC)]: { [lc(WALLET)]: 2n } }) },
    };
    const eth = planClaimAllQuote(mixed, WALLET, ZERO);
    expect(decode(eth.calls)).toEqual([
      [PLACER, "collectFees", TOKEN],
      [PLACER, "claim", ZERO, WALLET],
    ]);
    expect(eth.amount).toBe(98n);
    const usdc = planClaimAllQuote(mixed, WALLET, USDC);
    expect(decode(usdc.calls)).toEqual([
      [PLACER, "collectFees", TOKEN_B],
      [PLACER, "claim", USDC, WALLET],
    ]);
    expect(usdc.amount).toBe(880_002n);
  });
});

describe("summarizeCreatorFees", () => {
  it("lists launches the account is recipient of, totals credited + pending quote per currency", () => {
    const summary = summarizeCreatorFees(
      {
        launches: [
          launch({ token: TOKEN, pendingFees: 100n }),
          launch({ token: TOKEN_B }),
          // handed on: dropped (its collected fees are in the ETH total)
          launch({ token: TOKEN_C, recipient: OTHER, pendingFees: 999n }),
        ],
        placers: { [lc(PLACER)]: placer({ [lc(WALLET)]: 12n }) },
      },
      WALLET,
    );
    expect(summary.rows.map((r) => [r.launch.token, r.quotePending])).toEqual([
      [TOKEN, 88n],
      [TOKEN_B, 0n],
    ]);
    expect(summary.currencies).toEqual([{ currency: ZERO, collected: 12n, pending: 88n, total: 100n, launchCount: 2 }]);
  });

  it("is empty with nobody connected", () => {
    const summary = summarizeCreatorFees(
      { launches: [launch({ pendingFees: 100n })], placers: { [lc(PLACER)]: placer({ [lc(WALLET)]: 1n }) } },
      undefined,
    );
    expect(summary).toEqual({ rows: [], currencies: [] });
  });

  it("totals each quote currency apart, ETH first, including credits from launches not listed", () => {
    const summary = summarizeCreatorFees(
      {
        launches: [
          launch({ token: TOKEN_B, quoteToken: USDC, pendingFees: 1_000_000n }),
          launch({ token: TOKEN, pendingFees: 100n }),
        ],
        placers: {
          [lc(PLACER)]: placer({ [lc(WALLET)]: 12n }, PLACER, { [lc(USDC)]: { [lc(WALLET)]: 5n } }),
          // Another placer with ETH credited from a launch this list does not show.
          [lc(OLD_PLACER)]: placer({ [lc(WALLET)]: 3n }, OLD_PLACER),
        },
      },
      WALLET,
    );
    expect(summary.currencies).toEqual([
      { currency: ZERO, collected: 15n, pending: 88n, total: 103n, launchCount: 1 },
      { currency: lc(USDC), collected: 5n, pending: 880_000n, total: 880_005n, launchCount: 1 },
    ]);
    expect(summary.rows.map((r) => [r.launch.token, r.quotePending])).toEqual([
      [TOKEN_B, 880_000n],
      [TOKEN, 88n],
    ]);
  });
});

describe("the placer ABI the fees code calls", () => {
  it("has pendingFees and a single-value collectFees, and none of the removed functions", () => {
    expect(ABI_FUNCTIONS).toContain("pendingFees");
    const collect = UniV4LiquidityPlacerAbi.find((e) => e.type === "function" && e.name === "collectFees");
    expect(collect.outputs.map((o) => o.type)).toEqual(["uint256"]);
    for (const gone of ["sweepDust", "totalClaimable", "setGate", "gate", "fee", "setPoolParams"]) {
      expect(ABI_FUNCTIONS.has(gone), gone).toBe(false);
    }
  });
});

describe("validateNewRecipient", () => {
  it("accepts a different, well-formed address", () => {
    expect(validateNewRecipient(` ${OTHER} `, WALLET)).toBeNull();
  });

  it("rejects text that is not an address, or a bad checksum", () => {
    expect(validateNewRecipient("", WALLET)).toBe("invalid");
    expect(validateNewRecipient("0x1234", WALLET)).toBe("invalid");
    expect(validateNewRecipient("0x7a3c…05d1", WALLET)).toBe("invalid");
    // A checksummed address with one letter's case flipped.
    const good = getAddress(TOKEN);
    const i = good.search(/[a-fA-F]/);
    const flipped = good.slice(0, i) + (good[i] === good[i].toUpperCase() ? good[i].toLowerCase() : good[i].toUpperCase()) + good.slice(i + 1);
    expect(validateNewRecipient(good, WALLET)).toBeNull();
    expect(validateNewRecipient(flipped, WALLET)).toBe("invalid");
  });

  it("rejects the zero address (setFeeRecipient reverts ZeroAddress)", () => {
    expect(validateNewRecipient(`0x${"0".repeat(40)}`, WALLET)).toBe("zero");
  });

  it("rejects the current recipient, in any case", () => {
    expect(validateNewRecipient(WALLET.toLowerCase(), WALLET)).toBe("same");
  });
});

describe("formatting", () => {
  it("compares addresses case-insensitively", () => {
    expect(sameAddress(WALLET.toUpperCase(), WALLET)).toBe(true);
    expect(sameAddress(undefined, undefined)).toBe(false);
  });
});
