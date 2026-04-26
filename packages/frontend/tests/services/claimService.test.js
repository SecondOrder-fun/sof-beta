// tests/services/claimService.test.js
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/services/onchainRaffleDistributor", () => ({
  buildClaimGrandCall: vi.fn(),
  buildClaimConsolationCall: vi.fn(),
}));

vi.mock("@/services/onchainInfoFi", () => ({
  buildClaimPayoutCall: vi.fn(),
  buildRedeemPositionCall: vi.fn(),
}));

vi.mock("@/lib/wagmi", () => ({
  getStoredNetworkKey: () => "LOCAL",
}));

import { buildClaimCalls } from "@/services/claimService";
import {
  buildClaimGrandCall,
  buildClaimConsolationCall,
} from "@/services/onchainRaffleDistributor";
import {
  buildClaimPayoutCall,
  buildRedeemPositionCall,
} from "@/services/onchainInfoFi";

describe("claimService.buildClaimCalls", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("routes raffle-grand to buildClaimGrandCall with seasonId + networkKey", async () => {
    const call = { to: "0xDist", data: "0xabc" };
    buildClaimGrandCall.mockResolvedValue(call);

    const result = await buildClaimCalls({
      type: "raffle-grand",
      params: { seasonId: 1 },
      networkKey: "LOCAL",
    });

    expect(result).toEqual({ calls: [call], error: null });
    expect(buildClaimGrandCall).toHaveBeenCalledWith({
      seasonId: 1,
      networkKey: "LOCAL",
    });
  });

  it("routes raffle-consolation with toRollover forwarded (default false)", async () => {
    const call = { to: "0xDist", data: "0xdef" };
    buildClaimConsolationCall.mockResolvedValue(call);

    const result = await buildClaimCalls({
      type: "raffle-consolation",
      params: { seasonId: 2 },
      networkKey: "TESTNET",
    });

    expect(result).toEqual({ calls: [call], error: null });
    expect(buildClaimConsolationCall).toHaveBeenCalledWith({
      seasonId: 2,
      toRollover: false,
      networkKey: "TESTNET",
    });
  });

  it("routes raffle-consolation with toRollover=true when set", async () => {
    const call = { to: "0xDist", data: "0xfff" };
    buildClaimConsolationCall.mockResolvedValue(call);

    await buildClaimCalls({
      type: "raffle-consolation",
      params: { seasonId: 3, toRollover: true },
      networkKey: "LOCAL",
    });

    expect(buildClaimConsolationCall).toHaveBeenCalledWith({
      seasonId: 3,
      toRollover: true,
      networkKey: "LOCAL",
    });
  });

  it("routes infofi-payout to buildClaimPayoutCall", async () => {
    const call = { to: "0xMarket", data: "0x111" };
    buildClaimPayoutCall.mockReturnValue(call);

    const result = await buildClaimCalls({
      type: "infofi-payout",
      params: {
        marketId: "m1",
        prediction: true,
        account: "0xUser",
        contractAddress: "0xMarket",
      },
    });

    expect(result).toEqual({ calls: [call], error: null });
    expect(buildClaimPayoutCall).toHaveBeenCalledWith({
      marketId: "m1",
      prediction: true,
      account: "0xUser",
      contractAddress: "0xMarket",
    });
  });

  it("routes fpmm-position to buildRedeemPositionCall", async () => {
    const call = { to: "0xFpmm", data: "0x222" };
    buildRedeemPositionCall.mockResolvedValue(call);

    const result = await buildClaimCalls({
      type: "fpmm-position",
      params: {
        seasonId: 4,
        player: "0xPlayer",
        fpmmAddress: "0xFpmm",
      },
      networkKey: "LOCAL",
    });

    expect(result).toEqual({ calls: [call], error: null });
    expect(buildRedeemPositionCall).toHaveBeenCalledWith({
      seasonId: 4,
      player: "0xPlayer",
      fpmmAddress: "0xFpmm",
      networkKey: "LOCAL",
    });
  });

  it("surfaces a friendly error for unknown claim types", async () => {
    const result = await buildClaimCalls({
      type: "bogus",
      params: {},
      networkKey: "LOCAL",
    });

    expect(result).toEqual({
      calls: null,
      error: "Unknown claim type: bogus",
    });
  });

  it("propagates thrown errors as { error } result", async () => {
    buildClaimGrandCall.mockRejectedValue(new Error("Insufficient funds"));

    const result = await buildClaimCalls({
      type: "raffle-grand",
      params: { seasonId: 1 },
      networkKey: "LOCAL",
    });

    expect(result).toEqual({
      calls: null,
      error: "Insufficient funds",
    });
  });
});
