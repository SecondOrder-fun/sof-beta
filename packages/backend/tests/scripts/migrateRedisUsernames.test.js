// Usernames exist only in Redis, so moving to a new Redis means copying them.
// The copy keeps EOA wallets and drops smart wallets; these pin how each
// address is classified and what the plan writes or skips.
import { describe, it, expect } from "vitest";

import {
  isEoaCode,
  maskUrl,
  planMigration,
} from "../../scripts/migrate-redis-usernames.js";

const A = "0x" + "a".repeat(40);
const B = "0x" + "b".repeat(40);
const C = "0x" + "c".repeat(40);

describe("isEoaCode", () => {
  it("treats no code as an EOA", () => {
    expect(isEoaCode(undefined)).toBe(true);
    expect(isEoaCode("0x")).toBe(true);
  });

  it("treats an EIP-7702 delegation designator as an EOA", () => {
    expect(isEoaCode("0xef0100" + "1".repeat(40))).toBe(true);
    expect(isEoaCode("0xEF0100" + "A".repeat(40))).toBe(true);
  });

  it("treats contract bytecode as a smart wallet", () => {
    expect(isEoaCode("0x6080604052")).toBe(false);
    // Starts like a designator but is longer: real code.
    expect(isEoaCode("0xef0100" + "1".repeat(42))).toBe(false);
  });
});

describe("maskUrl", () => {
  it("hides the password", () => {
    expect(maskUrl("rediss://default:s3cret@host.upstash.io:6379")).toBe(
      "rediss://default:***@host.upstash.io:6379",
    );
  });

  it("never echoes an unparseable value", () => {
    expect(maskUrl("not a url with s3cret")).toBe("<unparseable url>");
  });
});

describe("planMigration", () => {
  it("keeps EOAs and drops smart wallets with their reverse keys", () => {
    const wallets = new Map([[A, "Alice"], [B, "BobSma"]]);
    const reverse = new Map([["alice", A], ["bobsma", B]]);

    const plan = planMigration(wallets, reverse, new Set([B]));

    expect(plan.keep).toEqual([{ address: A, username: "Alice" }]);
    expect(plan.dropped).toEqual([{ address: B, username: "BobSma" }]);
    expect(plan.staleReverse).toEqual([]);
  });

  it("rebuilds reverse keys from the forward keys and reports stale ones", () => {
    const wallets = new Map([[A, "Alice"]]);
    // "oldname" was Alice's previous name; its reverse key was never cleaned up.
    const reverse = new Map([["alice", A], ["oldname", A]]);

    const plan = planMigration(wallets, reverse, new Set());

    expect(plan.keep).toEqual([{ address: A, username: "Alice" }]);
    expect(plan.staleReverse).toEqual([{ username: "oldname", address: A }]);
  });

  it("skips malformed addresses and empty usernames", () => {
    const wallets = new Map([["0x1234", "Short"], [A, ""]]);

    const plan = planMigration(wallets, new Map(), new Set());

    expect(plan.keep).toEqual([]);
    expect(plan.invalid).toHaveLength(2);
  });

  it("gives a name claimed twice to the address its reverse key names", () => {
    const wallets = new Map([[A, "Same"], [C, "same"]]);
    const reverse = new Map([["same", C]]);

    const plan = planMigration(wallets, reverse, new Set());

    expect(plan.keep).toEqual([{ address: C, username: "same" }]);
    expect(plan.duplicates).toEqual([{ address: A, username: "Same", keptAddress: C }]);
  });

  it("keeps the first claimant when the reverse key names neither", () => {
    const wallets = new Map([[A, "Same"], [C, "same"]]);

    const plan = planMigration(wallets, new Map(), new Set());

    expect(plan.keep).toEqual([{ address: A, username: "Same" }]);
    expect(plan.duplicates).toEqual([{ address: C, username: "same", keptAddress: A }]);
  });
});
