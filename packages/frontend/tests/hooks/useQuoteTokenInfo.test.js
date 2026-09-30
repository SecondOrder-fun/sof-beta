// tests/hooks/useQuoteTokenInfo.test.js
// The pre-flight eligibility check asks the Raffle itself (isAllowedQuoteToken) and
// applies the 18-decimals rule createSeason enforces, so it cannot disagree with the
// transaction it guards.
import { describe, it, expect, vi } from "vitest";

import { readQuoteTokenInfo } from "@/hooks/useQuoteTokenInfo";
import { RaffleABI } from "@sof/contracts";

const RAFFLE = "0x00000000000000000000000000000000000000a1";
const LAUNCHPAD = "0x00000000000000000000000000000000000000b2";
const TOKEN = "0x1111111111111111111111111111111111111111";

const ok = (result) => ({ status: "success", result });
const fail = { status: "failure", error: new Error("revert") };

/** A client whose multicall answers [allowed, name, symbol, decimals, isLaunch?]. */
const clientAnswering = (answers) => ({ multicall: vi.fn().mockResolvedValue(answers) });
const read = (answers, contracts = { raffle: RAFFLE, launchpad: LAUNCHPAD }) =>
  readQuoteTokenInfo(clientAnswering(answers), contracts, TOKEN);

describe("readQuoteTokenInfo", () => {
  it("asks the Raffle's own rule, and the launchpad only for the label", async () => {
    const client = clientAnswering([ok(true), ok("Pond"), ok("POND"), ok(18), ok(true)]);
    await readQuoteTokenInfo(client, { raffle: RAFFLE, launchpad: LAUNCHPAD }, TOKEN);
    const calls = client.multicall.mock.calls[0][0].contracts;
    expect(calls.find((c) => c.functionName === "isAllowedQuoteToken")).toMatchObject({ address: RAFFLE, args: [TOKEN] });
    expect(calls.find((c) => c.functionName === "isLaunchToken")).toMatchObject({ address: LAUNCHPAD, args: [TOKEN] });
    expect(calls.filter((c) => c.address === TOKEN).map((c) => c.functionName)).toEqual(["name", "symbol", "decimals"]);
  });

  it("the Raffle ABI in @sof/contracts exposes isAllowedQuoteToken", () => {
    const fn = RaffleABI.find((x) => x.type === "function" && x.name === "isAllowedQuoteToken");
    expect(fn?.inputs?.[0]?.type).toBe("address");
    expect(fn?.outputs?.[0]?.type).toBe("bool");
  });

  it("an allowed launch token is eligible, as a launch token", async () => {
    const info = await read([ok(true), ok("Pond"), ok("POND"), ok(18), ok(true)]);
    expect(info).toEqual({ eligible: true, reason: null, kind: "launch", name: "Pond", symbol: "POND", decimals: 18 });
  });

  it("an allowed token the launchpad did not launch is eligible, as approved", async () => {
    const info = await read([ok(true), ok("Wrapped"), ok("WQ"), ok(18), ok(false)]);
    expect(info).toMatchObject({ eligible: true, kind: "approved" });
  });

  it("the Raffle's answer decides, even if the launchpad says it launched the token", async () => {
    const info = await read([ok(false), ok("Pond"), ok("POND"), ok(18), ok(true)]);
    expect(info).toMatchObject({ eligible: false, reason: "notAllowed", kind: null });
  });

  it("an allowed token that is not 18-decimal is blocked, as createSeason would revert", async () => {
    const info = await read([ok(true), ok("USD Coin"), ok("USDC"), ok(6), ok(false)]);
    expect(info).toMatchObject({ eligible: false, reason: "decimals", decimals: 6 });
  });

  it("an allowed token that reports no decimals is blocked too", async () => {
    const info = await read([ok(true), ok("Odd"), ok("ODD"), fail, ok(false)]);
    expect(info).toMatchObject({ eligible: false, reason: "decimals", decimals: null });
  });

  it("with no launchpad configured it still asks the Raffle, and labels the token approved", async () => {
    const client = clientAnswering([ok(true), ok("Pond"), ok("POND"), ok(18)]);
    const info = await readQuoteTokenInfo(client, { raffle: RAFFLE, launchpad: "" }, TOKEN);
    expect(info).toMatchObject({ eligible: true, kind: "approved" });
    expect(client.multicall.mock.calls[0][0].contracts.some((c) => c.functionName === "isLaunchToken")).toBe(false);
  });

  it("throws rather than answering when the eligibility read fails", async () => {
    await expect(read([fail, ok("Pond"), ok("POND"), ok(18), ok(true)])).rejects.toThrow();
  });

  it("a failed launch-token read only loses the label", async () => {
    const info = await read([ok(true), ok("Pond"), ok("POND"), ok(18), fail]);
    expect(info).toMatchObject({ eligible: true, kind: "approved" });
  });

  it("tolerates missing name and symbol on an eligible token", async () => {
    const info = await read([ok(true), fail, fail, ok(18), ok(false)]);
    expect(info).toEqual({ eligible: true, reason: null, kind: "approved", name: "", symbol: "", decimals: 18 });
  });
});
