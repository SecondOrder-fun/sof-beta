import { describe, it, expect } from "vitest";
import { decodeFunctionData, getAddress } from "viem";

import { UniV4LiquidityPlacerAbi } from "@/utils/abis";
import {
  buildLaunchClaimCalls,
  buildTransferCalls,
  formatFeeTokens,
  launchEarnings,
  planClaimAllQuote,
  planClaimToken,
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
  claimableTokens: {},
  uncollectedQuote: 0n,
  uncollectedTokens: 0n,
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
  it("adds the recipient's share of what is still in the pool to what is credited", () => {
    const e = launchEarnings(
      launch({ claimableTokens: { [lc(WALLET)]: 5n * E }, uncollectedQuote: 10n * E, uncollectedTokens: 100n * E }),
      placer({ [lc(WALLET)]: 1n * E }),
      WALLET,
    );
    expect(e).toMatchObject({
      isRecipient: true,
      quoteClaimable: 1n * E,
      quoteInPool: 8_800_000_000_000_000_000n,
      quote: 9_800_000_000_000_000_000n,
      tokensClaimable: 5n * E,
      tokensInPool: 88n * E,
      tokens: 93n * E,
    });
  });

  // collectFees credits whoever is the recipient AT collection.
  it("counts uncollected fees only for the current recipient", () => {
    const e = launchEarnings(
      launch({ recipient: OTHER, claimableTokens: { [lc(WALLET)]: 5n }, uncollectedQuote: 10n * E, uncollectedTokens: 10n * E }),
      placer({ [lc(WALLET)]: 7n }),
      WALLET,
    );
    expect(e).toMatchObject({ isRecipient: false, quote: 7n, tokens: 5n, quoteInPool: 0n, tokensInPool: 0n });
  });

  it("treats an unknown uncollected amount (collect would revert) as nothing in the pool", () => {
    const e = launchEarnings(launch({ uncollectedQuote: null, uncollectedTokens: null }), placer({ [lc(WALLET)]: 3n }), WALLET);
    expect(e).toMatchObject({ quote: 3n, tokens: 0n, quoteInPool: 0n });
  });
});

describe("buildLaunchClaimCalls (token page)", () => {
  const build = (l, credits = {}) => buildLaunchClaimCalls(launch(l), placer(credits), WALLET);

  it("collects, then claims both sides, when the pool holds both", () => {
    const { calls, quote, tokens } = build({ uncollectedQuote: 100n, uncollectedTokens: 1000n });
    expect(decode(calls)).toEqual([
      [PLACER, "collectFees", TOKEN],
      [PLACER, "claim", ZERO, WALLET],
      [PLACER, "claim", TOKEN, WALLET],
    ]);
    expect(quote).toBe(88n);
    expect(tokens).toBe(880n);
  });

  it("claims credited fees without a collect when the pool holds nothing", () => {
    const { calls } = build({}, { [lc(WALLET)]: 5n });
    expect(decode(calls)).toEqual([[PLACER, "claim", ZERO, WALLET]]);
  });

  it("claims only tokens when only tokens are earned", () => {
    const { calls } = build({ claimableTokens: { [lc(WALLET)]: 9n } });
    expect(decode(calls)).toEqual([[PLACER, "claim", TOKEN, WALLET]]);
  });

  it("collects quote only, then claims the quote but not the token", () => {
    const { calls } = build({ uncollectedQuote: 100n });
    expect(decode(calls)).toEqual([[PLACER, "collectFees", TOKEN], [PLACER, "claim", ZERO, WALLET]]);
  });

  it("collects tokens only, then claims the token but not the quote", () => {
    const { calls } = build({ uncollectedTokens: 100n });
    expect(decode(calls)).toEqual([[PLACER, "collectFees", TOKEN], [PLACER, "claim", TOKEN, WALLET]]);
  });

  // claim reverts NothingToClaim on zero, which would revert the batch.
  it("never claims a side whose share floors to zero", () => {
    const { calls, quote } = build({ uncollectedQuote: 1n, uncollectedTokens: 1n });
    expect(quote).toBe(0n);
    expect(decode(calls)).toEqual([[PLACER, "collectFees", TOKEN]]);
  });

  it("builds nothing when nothing is earned", () => {
    expect(build({}).calls).toEqual([]);
  });

  it("skips the collect when it could not be simulated, and claims what is credited", () => {
    const { calls } = build({ uncollectedQuote: null, uncollectedTokens: null, claimableTokens: { [lc(WALLET)]: 4n } }, { [lc(WALLET)]: 2n });
    expect(decode(calls)).toEqual([[PLACER, "claim", ZERO, WALLET], [PLACER, "claim", TOKEN, WALLET]]);
  });

  it("sends the claim to the claimant", () => {
    const { calls } = buildLaunchClaimCalls(
      launch({ recipient: SECOND, uncollectedQuote: 100n }),
      placer({}),
      SECOND,
    );
    expect(decode(calls)).toEqual([
      [PLACER, "collectFees", TOKEN],
      [PLACER, "claim", ZERO, SECOND],
    ]);
  });
});

describe("buildLaunchClaimCalls — a USDC-paired launch", () => {
  it("claims the launch's quote currency — USDC — not ETH", () => {
    const { calls, quote } = buildLaunchClaimCalls(
      launch({ quoteToken: USDC, uncollectedQuote: 1_000_000n }),
      placer({ [lc(WALLET)]: 9n * E }, PLACER, { [lc(USDC)]: { [lc(WALLET)]: 500_000n } }),
      WALLET,
    );
    expect(decode(calls)).toEqual([
      [PLACER, "collectFees", TOKEN],
      [PLACER, "claim", USDC, WALLET],
    ]);
    // 0.5 USDC credited + 88% of 1 USDC in the pool; the 9 ETH is not this launch's.
    expect(quote).toBe(1_380_000n);
  });
});

describe("buildTransferCalls", () => {
  // Without the collect, fees earned before the transfer would be credited to
  // the new recipient — the dialog promises they stay with the old one.
  it("collects first when the pool holds fees", () => {
    expect(decode(buildTransferCalls(launch({ uncollectedTokens: 5n }), OTHER))).toEqual([
      [PLACER, "collectFees", TOKEN],
      [PLACER, "setFeeRecipient", TOKEN, OTHER],
    ]);
  });

  it("only sets the recipient when there is nothing to collect", () => {
    expect(decode(buildTransferCalls(launch({ uncollectedQuote: null }), OTHER))).toEqual([
      [PLACER, "setFeeRecipient", TOKEN, OTHER],
    ]);
  });
});

describe("planClaimAllQuote (profile)", () => {
  const fees = {
    launches: [
      launch({ token: TOKEN, uncollectedQuote: 100n }),
      launch({ token: TOKEN_B, uncollectedQuote: 0n, uncollectedTokens: 50n }),
      launch({ token: TOKEN_C, placer: OLD_PLACER, uncollectedQuote: 200n }),
    ],
    placers: { [lc(PLACER)]: placer({ [lc(WALLET)]: 10n }), [lc(OLD_PLACER)]: placer({}, OLD_PLACER) },
  };

  it("groups by placer: each placer's collects, then its claim, in one batch", () => {
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

  it("does not collect a launch whose pool holds no ETH", () => {
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
      { launches: [launch({ uncollectedQuote: 1n })], placers: { [lc(PLACER)]: placer({}) } },
      WALLET,
      ZERO,
    );
    expect(plan).toEqual({ calls: [], amount: 0n });
  });

  it("does not collect a launch whose fees now go to someone else", () => {
    const plan = planClaimAllQuote(
      { launches: [launch({ recipient: OTHER, uncollectedQuote: 100n })], placers: { [lc(PLACER)]: placer({ [lc(WALLET)]: 1n }) } },
      WALLET,
      ZERO,
    );
    expect(decode(plan.calls)).toEqual([[PLACER, "claim", ZERO, WALLET]]);
  });

  it("plans nothing with nobody connected", () => {
    expect(planClaimAllQuote(fees, undefined, ZERO)).toEqual({ calls: [], amount: 0n });
  });

  // One claim per currency: the ETH plan never touches a USDC launch's pool or
  // USDC credits, and the USDC plan claims USDC only.
  it("keeps each quote currency to its own plan", () => {
    const mixed = {
      launches: [
        launch({ token: TOKEN, uncollectedQuote: 100n }),
        launch({ token: TOKEN_B, quoteToken: USDC, uncollectedQuote: 1_000_000n }),
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

describe("planClaimToken (profile row)", () => {
  it("collects when the pool holds tokens, then claims the token", () => {
    const plan = planClaimToken(launch({ uncollectedTokens: 100n }), placer(), WALLET);
    expect(decode(plan.calls)).toEqual([
      [PLACER, "collectFees", TOKEN],
      [PLACER, "claim", TOKEN, WALLET],
    ]);
    expect(plan.tokens).toBe(88n);
  });

  it("does not collect for quote fees alone — the row claims tokens", () => {
    const plan = planClaimToken(
      launch({ uncollectedQuote: 100n, claimableTokens: { [lc(WALLET)]: 4n } }),
      placer(),
      WALLET,
    );
    expect(decode(plan.calls)).toEqual([[PLACER, "claim", TOKEN, WALLET]]);
  });

  it("claims tokens credited before the fees were handed on, without collecting for the new recipient", () => {
    const plan = planClaimToken(
      launch({ recipient: OTHER, uncollectedTokens: 100n, claimableTokens: { [lc(WALLET)]: 4n } }),
      placer(),
      WALLET,
    );
    expect(decode(plan.calls)).toEqual([[PLACER, "claim", TOKEN, WALLET]]);
  });

  it("plans nothing when no tokens are earned", () => {
    expect(planClaimToken(launch({ uncollectedTokens: 1n }), placer(), WALLET)).toEqual({ calls: [], tokens: 0n });
  });
});

describe("summarizeCreatorFees", () => {
  it("lists launches the account earns from, totals pooled + in-pool quote per currency", () => {
    const summary = summarizeCreatorFees(
      {
        launches: [
          launch({ token: TOKEN, uncollectedQuote: 100n, uncollectedTokens: 1000n }),
          launch({ token: TOKEN_B }),
          // handed on, but tokens credited before still claimable: listed
          launch({ token: TOKEN_C, recipient: OTHER, uncollectedQuote: 999n, claimableTokens: { [lc(WALLET)]: 7n } }),
          // handed on with nothing left: dropped
          launch({ token: getAddress("0xdddd00000000000000000000000000000000dddd"), recipient: OTHER, uncollectedQuote: 999n }),
        ],
        placers: { [lc(PLACER)]: placer({ [lc(WALLET)]: 12n }) },
      },
      WALLET,
    );
    expect(summary.rows.map((r) => [r.launch.token, r.isRecipient, r.quoteInPool, r.tokens])).toEqual([
      [TOKEN, true, 88n, 880n],
      [TOKEN_B, true, 0n, 0n],
      [TOKEN_C, false, 0n, 7n],
    ]);
    expect(summary.currencies).toEqual([{ currency: ZERO, collected: 12n, inPool: 88n, total: 100n, launchCount: 3 }]);
  });

  it("is empty with nobody connected", () => {
    const summary = summarizeCreatorFees(
      { launches: [launch({ claimableTokens: { [lc(WALLET)]: 1n } })], placers: { [lc(PLACER)]: placer({ [lc(WALLET)]: 1n }) } },
      undefined,
    );
    expect(summary).toEqual({ rows: [], currencies: [] });
  });

  it("totals each quote currency apart, ETH first, including credits from launches not listed", () => {
    const summary = summarizeCreatorFees(
      {
        launches: [
          launch({ token: TOKEN_B, quoteToken: USDC, uncollectedQuote: 1_000_000n }),
          launch({ token: TOKEN, uncollectedQuote: 100n }),
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
      { currency: ZERO, collected: 15n, inPool: 88n, total: 103n, launchCount: 1 },
      { currency: lc(USDC), collected: 5n, inPool: 880_000n, total: 880_005n, launchCount: 1 },
    ]);
    expect(summary.rows.map((r) => [r.launch.token, r.quoteInPool])).toEqual([
      [TOKEN_B, 880_000n],
      [TOKEN, 88n],
    ]);
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
  it("abbreviates whole tokens and keeps a fraction of one", () => {
    expect(formatFeeTokens(1_240_000n * E)).toBe("1.24M");
    expect(formatFeeTokens(5n * 10n ** 17n)).toBe("0.5");
    expect(formatFeeTokens(0n)).toBe("0");
  });

  it("compares addresses case-insensitively", () => {
    expect(sameAddress(WALLET.toUpperCase(), WALLET)).toBe(true);
    expect(sameAddress(undefined, undefined)).toBe(false);
  });
});
