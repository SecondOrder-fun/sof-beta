import { describe, it, expect, vi, beforeEach } from "vitest";
import { decodeFunctionData } from "viem";

// Each InfoFi market is collateralised in its own season's quote token, so the
// approve and the redeem must use the token the market reports, not a
// deployment-wide address.
const FPMM = "0x4444444444444444444444444444444444444444";
const COLLATERAL = "0x5555555555555555555555555555555555555555";
const ACCOUNT = "0x6666666666666666666666666666666666666666";
const CTF = "0x7777777777777777777777777777777777777777";

const readContract = vi.fn();
vi.mock("viem", async (importOriginal) => ({
  ...(await importOriginal()),
  createPublicClient: () => ({ readContract }),
}));
vi.mock("@/config/networks", () => ({
  getNetworkByKey: () => ({ id: 84532, rpcUrl: "http://rpc.invalid" }),
  getDefaultNetworkKey: () => "TESTNET",
}));
vi.mock("@/config/contracts", () => ({
  getContractAddresses: () => ({ CONDITIONAL_TOKENS: "0x7777777777777777777777777777777777777777" }),
}));

import { buildPlaceBetCalls, buildRedeemPositionCall } from "@/services/onchainInfoFi";

const CONDITION = `0x${"ab".repeat(32)}`;

beforeEach(() => {
  readContract.mockReset();
  readContract.mockImplementation(async ({ functionName }) => {
    if (functionName === "collateralToken") return COLLATERAL;
    if (functionName === "calcBuyAmount") return 100n;
    if (functionName === "allowance") return 0n;
    if (functionName === "conditionId") return CONDITION;
    throw new Error(`unexpected read ${functionName}`);
  });
});

describe("InfoFi calls use the market's own collateral", () => {
  it("approves the market's collateral token before a bet", async () => {
    const calls = await buildPlaceBetCalls({ prediction: true, amount: 10n ** 18n, account: ACCOUNT, fpmmAddress: FPMM });
    expect(calls[0].to).toBe(COLLATERAL);
    expect(readContract).toHaveBeenCalledWith(expect.objectContaining({ address: COLLATERAL, functionName: "allowance" }));
    expect(calls.at(-1).to).toBe(FPMM);
  });

  it("redeems against the market's collateral token", async () => {
    const call = await buildRedeemPositionCall({ seasonId: 1, player: ACCOUNT, fpmmAddress: FPMM });
    expect(call.to).toBe(CTF);
    const { args } = decodeFunctionData({
      abi: [
        {
          type: "function",
          name: "redeemPositions",
          inputs: [
            { name: "collateralToken", type: "address" },
            { name: "parentCollectionId", type: "bytes32" },
            { name: "conditionId", type: "bytes32" },
            { name: "indexSets", type: "uint256[]" },
          ],
          outputs: [],
          stateMutability: "nonpayable",
        },
      ],
      data: call.data,
    });
    expect(args[0].toLowerCase()).toBe(COLLATERAL);
  });

  it("refuses to build a bet when the market reports no collateral", async () => {
    readContract.mockImplementation(async ({ functionName }) =>
      functionName === "collateralToken" ? "0x0000000000000000000000000000000000000000" : 0n,
    );
    await expect(
      buildPlaceBetCalls({ prediction: true, amount: 1n, account: ACCOUNT, fpmmAddress: FPMM }),
    ).rejects.toThrow(/collateral/);
  });
});
