import { describe, it, expect } from "vitest";
import { decodeFunctionData, getAddress } from "viem";

import { UniV4LiquidityPlacerAbi } from "@/utils/abis";
import {
  buildLaunchClaimCalls,
  buildTransferCalls,
  claimSender,
  formatFeeTokens,
  isSponsoredClaim,
  launchEarnings,
  planClaimAllEth,
  planClaimToken,
  recipientShare,
  sameAddress,
  sendOptions,
  summarizeCreatorFees,
  validateNewRecipient,
} from "@/lib/creatorFees";

const PLACER = getAddress("0x3000000000000000000000000000000000000003");
const OLD_PLACER = getAddress("0x4000000000000000000000000000000000000004");
const TOKEN = getAddress("0xaaaa00000000000000000000000000000000aaaa");
const TOKEN_B = getAddress("0xbbbb00000000000000000000000000000000bbbb");
const TOKEN_C = getAddress("0xcccc00000000000000000000000000000000cccc");
const SMA = getAddress("0x5555555555555555555555555555555555555555");
const EOA = getAddress("0x6666666666666666666666666666666666666666");
const OTHER = getAddress("0x7777777777777777777777777777777777777777");
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
  recipient: SMA,
  claimableToken: {},
  uncollectedEth: 0n,
  uncollectedTokens: 0n,
  ...over,
});
const placer = (claimableEth = {}, address = PLACER) => ({ address, creatorFeeBps: BPS, claimableEth });
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

describe("claimSender", () => {
  it("claims from the smart account when the fees are credited to it", () => {
    expect(claimSender(SMA.toUpperCase().replace("0X", "0x"), { eoa: EOA, sma: SMA })).toEqual({
      account: SMA,
      mode: "smart",
    });
  });

  // executeBatch sends from the SMA on a desktop wallet; only bypassSponsorship
  // sends from the EOA, whose credit it is.
  it("claims from the EOA itself when the fees are credited to the EOA", () => {
    const sender = claimSender(EOA, { eoa: EOA, sma: SMA });
    expect(sender).toEqual({ account: EOA, mode: "eoa" });
    expect(sendOptions(sender)).toEqual({ bypassSponsorship: true });
  });

  it("treats a wallet whose connected address is the smart account as one account", () => {
    expect(claimSender(SMA, { eoa: SMA, sma: SMA })).toEqual({ account: SMA, mode: "smart" });
    expect(sendOptions({ account: SMA, mode: "smart" })).toEqual({});
  });

  it("returns null for someone else, or with nobody connected", () => {
    expect(claimSender(OTHER, { eoa: EOA, sma: SMA })).toBeNull();
    expect(claimSender(SMA, {})).toBeNull();
    expect(claimSender(null, { eoa: EOA, sma: SMA })).toBeNull();
  });

  it("still finds the EOA while the smart account address is loading", () => {
    expect(claimSender(EOA, { eoa: EOA })).toEqual({ account: EOA, mode: "eoa" });
  });
});

describe("isSponsoredClaim", () => {
  const current = { isCurrent: true };
  const smart = { account: SMA, mode: "smart" };

  it("is gas-free only from a desktop wallet's smart account to the current placer", () => {
    expect(isSponsoredClaim(smart, "desktop-eoa", current)).toBe(true);
  });

  // SOFPaymaster sponsors the launchpad's current placer only.
  it("promises nothing on a placer the launchpad has replaced", () => {
    expect(isSponsoredClaim(smart, "desktop-eoa", { isCurrent: false })).toBe(false);
  });

  // Those batches go through other paymasters, optionally.
  it("promises nothing on Coinbase Smart Wallet", () => {
    expect(isSponsoredClaim(smart, "coinbase-smart", current)).toBe(false);
  });

  it("is never gas-free from the EOA", () => {
    expect(isSponsoredClaim({ account: EOA, mode: "eoa" }, "desktop-eoa", current)).toBe(false);
  });
});

describe("launchEarnings", () => {
  it("adds the recipient's share of what is still in the pool to what is credited", () => {
    const e = launchEarnings(
      launch({ claimableToken: { [lc(SMA)]: 5n * E }, uncollectedEth: 10n * E, uncollectedTokens: 100n * E }),
      placer({ [lc(SMA)]: 1n * E }),
      SMA,
    );
    expect(e).toMatchObject({
      isRecipient: true,
      ethClaimable: 1n * E,
      ethInPool: 8_800_000_000_000_000_000n,
      eth: 9_800_000_000_000_000_000n,
      tokensClaimable: 5n * E,
      tokensInPool: 88n * E,
      tokens: 93n * E,
    });
  });

  // collectFees credits whoever is the recipient AT collection.
  it("counts uncollected fees only for the current recipient", () => {
    const e = launchEarnings(
      launch({ recipient: OTHER, claimableToken: { [lc(SMA)]: 5n }, uncollectedEth: 10n * E, uncollectedTokens: 10n * E }),
      placer({ [lc(SMA)]: 7n }),
      SMA,
    );
    expect(e).toMatchObject({ isRecipient: false, eth: 7n, tokens: 5n, ethInPool: 0n, tokensInPool: 0n });
  });

  it("treats an unknown uncollected amount (collect would revert) as nothing in the pool", () => {
    const e = launchEarnings(launch({ uncollectedEth: null, uncollectedTokens: null }), placer({ [lc(SMA)]: 3n }), SMA);
    expect(e).toMatchObject({ eth: 3n, tokens: 0n, ethInPool: 0n });
  });
});

describe("buildLaunchClaimCalls (token page)", () => {
  const build = (l, credits = {}) => buildLaunchClaimCalls(launch(l), placer(credits), SMA);

  it("collects, then claims both sides, when the pool holds both", () => {
    const { calls, eth, tokens } = build({ uncollectedEth: 100n, uncollectedTokens: 1000n });
    expect(decode(calls)).toEqual([
      [PLACER, "collectFees", TOKEN],
      [PLACER, "claimEth", SMA],
      [PLACER, "claimToken", TOKEN, SMA],
    ]);
    expect(eth).toBe(88n);
    expect(tokens).toBe(880n);
  });

  it("claims credited fees without a collect when the pool holds nothing", () => {
    const { calls } = build({}, { [lc(SMA)]: 5n });
    expect(decode(calls)).toEqual([[PLACER, "claimEth", SMA]]);
  });

  it("claims only tokens when only tokens are earned", () => {
    const { calls } = build({ claimableToken: { [lc(SMA)]: 9n } });
    expect(decode(calls)).toEqual([[PLACER, "claimToken", TOKEN, SMA]]);
  });

  it("collects ETH only, then claims ETH but not the token", () => {
    const { calls } = build({ uncollectedEth: 100n });
    expect(decode(calls).map((c) => c[1])).toEqual(["collectFees", "claimEth"]);
  });

  it("collects tokens only, then claims the token but not ETH", () => {
    const { calls } = build({ uncollectedTokens: 100n });
    expect(decode(calls).map((c) => c[1])).toEqual(["collectFees", "claimToken"]);
  });

  // claimEth / claimToken revert NothingToClaim on zero, which would revert the batch.
  it("never claims a side whose share floors to zero", () => {
    const { calls, eth } = build({ uncollectedEth: 1n, uncollectedTokens: 1n });
    expect(eth).toBe(0n);
    expect(decode(calls)).toEqual([[PLACER, "collectFees", TOKEN]]);
  });

  it("builds nothing when nothing is earned", () => {
    expect(build({}).calls).toEqual([]);
  });

  it("skips the collect when it could not be simulated, and claims what is credited", () => {
    const { calls } = build({ uncollectedEth: null, uncollectedTokens: null, claimableToken: { [lc(SMA)]: 4n } }, { [lc(SMA)]: 2n });
    expect(decode(calls).map((c) => c[1])).toEqual(["claimEth", "claimToken"]);
  });

  it("sends the claim to the claimant: an EOA recipient claims to the EOA", () => {
    const { calls } = buildLaunchClaimCalls(
      launch({ recipient: EOA, uncollectedEth: 100n }),
      placer({}),
      EOA,
    );
    expect(decode(calls)).toEqual([
      [PLACER, "collectFees", TOKEN],
      [PLACER, "claimEth", EOA],
    ]);
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
    expect(decode(buildTransferCalls(launch({ uncollectedEth: null }), OTHER))).toEqual([
      [PLACER, "setFeeRecipient", TOKEN, OTHER],
    ]);
  });
});

describe("planClaimAllEth (profile)", () => {
  const fees = {
    launches: [
      launch({ token: TOKEN, uncollectedEth: 100n }),
      launch({ token: TOKEN_B, uncollectedEth: 0n, uncollectedTokens: 50n }),
      launch({ token: TOKEN_C, placer: OLD_PLACER, uncollectedEth: 200n }),
    ],
    placers: { [lc(PLACER)]: placer({ [lc(SMA)]: 10n }), [lc(OLD_PLACER)]: placer({}, OLD_PLACER) },
  };

  it("groups by placer: each placer's collects, then its claimEth, in one batch", () => {
    const batches = planClaimAllEth(fees, { eoa: SMA, sma: SMA });
    expect(batches).toHaveLength(1);
    expect(batches[0].sender).toEqual({ account: SMA, mode: "smart" });
    expect(decode(batches[0].calls)).toEqual([
      [PLACER, "collectFees", TOKEN],
      [PLACER, "claimEth", SMA],
      [OLD_PLACER, "collectFees", TOKEN_C],
      [OLD_PLACER, "claimEth", SMA],
    ]);
    // 10 credited + 88 + 176
    expect(batches[0].eth).toBe(274n);
  });

  it("does not collect a launch whose pool holds no ETH", () => {
    const calls = decode(planClaimAllEth(fees, { sma: SMA })[0].calls);
    expect(calls).not.toContainEqual([PLACER, "collectFees", TOKEN_B]);
  });

  it("claims a placer's pooled ETH even with no listed launch on it", () => {
    const batches = planClaimAllEth(
      { launches: [], placers: { [lc(PLACER)]: placer({ [lc(SMA)]: 3n }) } },
      { sma: SMA },
    );
    expect(decode(batches[0].calls)).toEqual([[PLACER, "claimEth", SMA]]);
  });

  it("skips a placer with nothing for the account — no NothingToClaim", () => {
    const batches = planClaimAllEth(
      { launches: [launch({ uncollectedEth: 1n })], placers: { [lc(PLACER)]: placer({}) } },
      { sma: SMA },
    );
    expect(batches).toEqual([]);
  });

  it("does not collect a launch whose fees now go to someone else", () => {
    const batches = planClaimAllEth(
      { launches: [launch({ recipient: OTHER, uncollectedEth: 100n })], placers: { [lc(PLACER)]: placer({ [lc(SMA)]: 1n }) } },
      { sma: SMA },
    );
    expect(decode(batches[0].calls)).toEqual([[PLACER, "claimEth", SMA]]);
  });

  it("makes one batch per account, each from its own claimant", () => {
    const batches = planClaimAllEth(
      {
        launches: [launch({ recipient: EOA, uncollectedEth: 100n })],
        placers: { [lc(PLACER)]: placer({ [lc(SMA)]: 5n }) },
      },
      { eoa: EOA, sma: SMA },
    );
    expect(batches.map((b) => b.sender)).toEqual([
      { account: SMA, mode: "smart" },
      { account: EOA, mode: "eoa" },
    ]);
    expect(decode(batches[0].calls)).toEqual([[PLACER, "claimEth", SMA]]);
    expect(decode(batches[1].calls)).toEqual([
      [PLACER, "collectFees", TOKEN],
      [PLACER, "claimEth", EOA],
    ]);
  });
});

describe("planClaimToken (profile row)", () => {
  it("collects when the pool holds tokens, then claims the token", () => {
    const batches = planClaimToken(launch({ uncollectedTokens: 100n }), placer(), { sma: SMA });
    expect(decode(batches[0].calls)).toEqual([
      [PLACER, "collectFees", TOKEN],
      [PLACER, "claimToken", TOKEN, SMA],
    ]);
    expect(batches[0].tokens).toBe(88n);
  });

  it("does not collect for ETH alone — the row claims tokens", () => {
    const batches = planClaimToken(
      launch({ uncollectedEth: 100n, claimableToken: { [lc(SMA)]: 4n } }),
      placer(),
      { sma: SMA },
    );
    expect(decode(batches[0].calls)).toEqual([[PLACER, "claimToken", TOKEN, SMA]]);
  });

  it("claims tokens credited before the fees were handed on, without collecting for the new recipient", () => {
    const batches = planClaimToken(
      launch({ recipient: OTHER, uncollectedTokens: 100n, claimableToken: { [lc(SMA)]: 4n } }),
      placer(),
      { sma: SMA },
    );
    expect(decode(batches[0].calls)).toEqual([[PLACER, "claimToken", TOKEN, SMA]]);
  });

  it("plans nothing when no tokens are earned", () => {
    expect(planClaimToken(launch({ uncollectedTokens: 1n }), placer(), { sma: SMA })).toEqual([]);
  });
});

describe("summarizeCreatorFees", () => {
  it("lists launches the account earns from, totals pooled + in-pool ETH", () => {
    const summary = summarizeCreatorFees(
      {
        launches: [
          launch({ token: TOKEN, uncollectedEth: 100n, uncollectedTokens: 1000n }),
          launch({ token: TOKEN_B }),
          // handed on, but tokens credited before still claimable: listed
          launch({ token: TOKEN_C, recipient: OTHER, uncollectedEth: 999n, claimableToken: { [lc(SMA)]: 7n } }),
          // handed on with nothing left: dropped
          launch({ token: getAddress("0xdddd00000000000000000000000000000000dddd"), recipient: OTHER, uncollectedEth: 999n }),
        ],
        placers: { [lc(PLACER)]: placer({ [lc(SMA)]: 12n }) },
      },
      { sma: SMA },
    );
    expect(summary.rows.map((r) => [r.launch.token, r.isRecipient, r.ethInPool, r.tokens])).toEqual([
      [TOKEN, true, 88n, 880n],
      [TOKEN_B, true, 0n, 0n],
      [TOKEN_C, false, 0n, 7n],
    ]);
    expect(summary).toMatchObject({ ethCollected: 12n, ethInPool: 88n, eth: 100n });
  });

  it("counts both accounts once each", () => {
    const summary = summarizeCreatorFees(
      { launches: [launch({ recipient: EOA, claimableToken: { [lc(SMA)]: 1n, [lc(EOA)]: 2n } })], placers: { [lc(PLACER)]: placer({ [lc(SMA)]: 1n, [lc(EOA)]: 2n }) } },
      { eoa: EOA, sma: SMA },
    );
    expect(summary.rows[0].tokens).toBe(3n);
    expect(summary.eth).toBe(3n);
  });
});

describe("validateNewRecipient", () => {
  it("accepts a different, well-formed address", () => {
    expect(validateNewRecipient(` ${OTHER} `, SMA)).toBeNull();
  });

  it("rejects text that is not an address, or a bad checksum", () => {
    expect(validateNewRecipient("", SMA)).toBe("invalid");
    expect(validateNewRecipient("0x1234", SMA)).toBe("invalid");
    expect(validateNewRecipient("0x7a3c…05d1", SMA)).toBe("invalid");
    // A checksummed address with one letter's case flipped.
    const good = getAddress(TOKEN);
    const i = good.search(/[a-fA-F]/);
    const flipped = good.slice(0, i) + (good[i] === good[i].toUpperCase() ? good[i].toLowerCase() : good[i].toUpperCase()) + good.slice(i + 1);
    expect(validateNewRecipient(good, SMA)).toBeNull();
    expect(validateNewRecipient(flipped, SMA)).toBe("invalid");
  });

  it("rejects the zero address (setFeeRecipient reverts ZeroAddress)", () => {
    expect(validateNewRecipient(`0x${"0".repeat(40)}`, SMA)).toBe("zero");
  });

  it("rejects the current recipient, in any case", () => {
    expect(validateNewRecipient(SMA.toLowerCase(), SMA)).toBe("same");
  });
});

describe("formatting", () => {
  it("abbreviates whole tokens and keeps a fraction of one", () => {
    expect(formatFeeTokens(1_240_000n * E)).toBe("1.24M");
    expect(formatFeeTokens(5n * 10n ** 17n)).toBe("0.5");
    expect(formatFeeTokens(0n)).toBe("0");
  });

  it("compares addresses case-insensitively", () => {
    expect(sameAddress(SMA.toUpperCase(), SMA)).toBe(true);
    expect(sameAddress(undefined, undefined)).toBe(false);
  });
});
