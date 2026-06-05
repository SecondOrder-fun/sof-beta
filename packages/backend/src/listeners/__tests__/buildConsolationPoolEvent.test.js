import { describe, it, expect } from "vitest";
import { buildConsolationPoolEvent } from "../buildConsolationPoolEvent.js";

describe("buildConsolationPoolEvent", () => {
  it("builds the ConsolationPoolUpdated payload with stringified wei", () => {
    const evt = buildConsolationPoolEvent({
      seasonId: 7,
      participantCount: 142,
      reservesWei: 1000n,
      blockNumber: 18765432,
      txHash: "0xdeadbeef",
    });
    expect(evt).toEqual({
      type: "ConsolationPoolUpdated",
      seasonId: 7,
      totalParticipants: 142,
      totalPoolWei: "1000",
      blockNumber: 18765432,
      txHash: "0xdeadbeef",
    });
  });

  it("coerces missing reserves to '0' and missing count to 0", () => {
    const evt = buildConsolationPoolEvent({
      seasonId: 3,
      participantCount: undefined,
      reservesWei: undefined,
      blockNumber: 1,
      txHash: "0x1",
    });
    expect(evt.totalPoolWei).toBe("0");
    expect(evt.totalParticipants).toBe(0);
  });
});
