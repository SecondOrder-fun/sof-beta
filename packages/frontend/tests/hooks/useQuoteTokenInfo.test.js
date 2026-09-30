// tests/hooks/useQuoteTokenInfo.test.js
// The pre-flight eligibility check mirrors Raffle.isAllowedQuoteToken:
// approved by the platform OR launched by the launchpad.
import { describe, it, expect, vi } from "vitest";

import { readQuoteTokenInfo } from "@/hooks/useQuoteTokenInfo";
import { RaffleABI } from "@sof/contracts";

const RAFFLE = "0x00000000000000000000000000000000000000a1";
const LAUNCHPAD = "0x00000000000000000000000000000000000000b2";
const TOKEN = "0x1111111111111111111111111111111111111111";

const ok = (result) => ({ status: "success", result });
const fail = { status: "failure", error: new Error("revert") };

/** A client whose multicall answers [approved, name, symbol, decimals, isLaunch?]. */
const clientAnswering = (answers) => ({ multicall: vi.fn().mockResolvedValue(answers) });

describe("readQuoteTokenInfo", () => {
  it("reads what the contract's rule reads: allowedQuoteTokens on the Raffle, isLaunchToken on the launchpad", async () => {
    const client = clientAnswering([ok(false), ok("Pond"), ok("POND"), ok(18), ok(true)]);
    await readQuoteTokenInfo(client, { raffle: RAFFLE, launchpad: LAUNCHPAD }, TOKEN);
    const calls = client.multicall.mock.calls[0][0].contracts;
    expect(calls.find((c) => c.functionName === "allowedQuoteTokens")).toMatchObject({ address: RAFFLE, args: [TOKEN] });
    expect(calls.find((c) => c.functionName === "isLaunchToken")).toMatchObject({ address: LAUNCHPAD, args: [TOKEN] });
    expect(calls.filter((c) => c.address === TOKEN).map((c) => c.functionName)).toEqual(["name", "symbol", "decimals"]);
  });

  it("the Raffle ABI in @sof/contracts exposes allowedQuoteTokens", () => {
    const fn = RaffleABI.find((x) => x.type === "function" && x.name === "allowedQuoteTokens");
    expect(fn?.inputs?.[0]?.type).toBe("address");
    expect(fn?.outputs?.[0]?.type).toBe("bool");
  });

  it("a launch token is eligible, as a launch token", async () => {
    const info = await readQuoteTokenInfo(
      clientAnswering([ok(false), ok("Pond"), ok("POND"), ok(18), ok(true)]),
      { raffle: RAFFLE, launchpad: LAUNCHPAD },
      TOKEN,
    );
    expect(info).toEqual({ eligible: true, kind: "launch", name: "Pond", symbol: "POND", decimals: 18 });
  });

  it("an approved token is eligible, as approved", async () => {
    const info = await readQuoteTokenInfo(
      clientAnswering([ok(true), ok("USD Coin"), ok("USDC"), ok(6), ok(false)]),
      { raffle: RAFFLE, launchpad: LAUNCHPAD },
      TOKEN,
    );
    expect(info).toMatchObject({ eligible: true, kind: "approved", symbol: "USDC", decimals: 6 });
  });

  it("a token that is neither is not eligible", async () => {
    const info = await readQuoteTokenInfo(
      clientAnswering([ok(false), ok("Random"), ok("RND"), ok(18), ok(false)]),
      { raffle: RAFFLE, launchpad: LAUNCHPAD },
      TOKEN,
    );
    expect(info).toMatchObject({ eligible: false, kind: null });
  });

  it("with no launchpad configured, only approval counts — as on-chain with none set", async () => {
    const client = clientAnswering([ok(false), ok("Pond"), ok("POND"), ok(18)]);
    const info = await readQuoteTokenInfo(client, { raffle: RAFFLE, launchpad: "" }, TOKEN);
    expect(info.eligible).toBe(false);
    expect(client.multicall.mock.calls[0][0].contracts.some((c) => c.functionName === "isLaunchToken")).toBe(false);
  });

  it("throws rather than answering when an eligibility read fails", async () => {
    await expect(
      readQuoteTokenInfo(clientAnswering([fail, ok("Pond"), ok("POND"), ok(18), ok(true)]), { raffle: RAFFLE, launchpad: LAUNCHPAD }, TOKEN),
    ).rejects.toThrow();
    await expect(
      readQuoteTokenInfo(clientAnswering([ok(false), ok("Pond"), ok("POND"), ok(18), fail]), { raffle: RAFFLE, launchpad: LAUNCHPAD }, TOKEN),
    ).rejects.toThrow();
  });

  it("tolerates missing metadata on an eligible token", async () => {
    const info = await readQuoteTokenInfo(
      clientAnswering([ok(true), fail, fail, fail, ok(false)]),
      { raffle: RAFFLE, launchpad: LAUNCHPAD },
      TOKEN,
    );
    expect(info).toEqual({ eligible: true, kind: "approved", name: "", symbol: "", decimals: 18 });
  });
});
