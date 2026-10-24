import { describe, it, expect, vi, beforeEach } from "vitest";
import { decodeFunctionData } from "viem";

const FPMM = "0x4444444444444444444444444444444444444444";
const ACCOUNT = "0x6666666666666666666666666666666666666666";
const CTF = "0x7777777777777777777777777777777777777777";
const E18 = 10n ** 18n;

const readContract = vi.fn();
vi.mock("viem", async (importOriginal) => ({
  ...(await importOriginal()),
  createPublicClient: () => ({ readContract }),
}));
vi.mock("@/config/networks", () => ({
  getNetworkByKey: () => ({ id: 84532, rpcUrl: "http://rpc.invalid" }),
  getDefaultNetworkKey: () => "TESTNET",
}));
vi.mock("@/config/contracts", () => ({ getContractAddresses: () => ({}) }));

import { buildSellCalls, readBet } from "@/services/onchainInfoFi";

const sellAbi = [
  {
    type: "function",
    name: "sell",
    inputs: [
      { name: "sellYes", type: "bool" },
      { name: "amountOut", type: "uint256" },
      { name: "maxAmountIn", type: "uint256" },
    ],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "setApprovalForAll",
    inputs: [
      { name: "operator", type: "address" },
      { name: "approved", type: "bool" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
];

let approved;
beforeEach(() => {
  approved = false;
  readContract.mockReset();
  readContract.mockImplementation(async ({ address, functionName, args }) => {
    if (address === FPMM) {
      if (functionName === "yesReserve" || functionName === "noReserve") return 1000n * E18;
      if (functionName === "FEE_BPS") return 200n;
      if (functionName === "conditionalTokens") return CTF;
      if (functionName === "positionIds") return args[0] === 0n ? 11n : 22n;
    }
    if (address === CTF) {
      if (functionName === "balanceOf") return args[1] === 11n ? 50n * E18 : 0n;
      if (functionName === "isApprovedForAll") return approved;
    }
    throw new Error(`unexpected read ${address} ${functionName}`);
  });
});

describe("buildSellCalls", () => {
  it("approves the pool on the conditional tokens first, then sells within the shares offered", async () => {
    const { calls, quote, minCollateral } = await buildSellCalls({
      prediction: true,
      shares: 10n * E18,
      account: ACCOUNT,
      fpmmAddress: FPMM,
    });
    expect(calls).toHaveLength(2);
    expect(calls[0].to).toBe(CTF);
    const approval = decodeFunctionData({ abi: sellAbi, data: calls[0].data });
    expect(approval.functionName).toBe("setApprovalForAll");
    expect(approval.args[0].toLowerCase()).toBe(FPMM);
    expect(approval.args[1]).toBe(true);

    expect(calls[1].to).toBe(FPMM);
    const sell = decodeFunctionData({ abi: sellAbi, data: calls[1].data });
    expect(sell.functionName).toBe("sell");
    expect(sell.args).toEqual([true, minCollateral, 10n * E18]);
    expect(minCollateral).toBe((quote * 9800n) / 10000n);
  });

  it("skips the approval once the pool is approved", async () => {
    approved = true;
    const { calls } = await buildSellCalls({ prediction: true, shares: E18, account: ACCOUNT, fpmmAddress: FPMM });
    expect(calls).toHaveLength(1);
    expect(calls[0].to).toBe(FPMM);
  });

  it("refuses to sell more shares than the wallet holds", async () => {
    await expect(
      buildSellCalls({ prediction: false, shares: E18, account: ACCOUNT, fpmmAddress: FPMM }),
    ).rejects.toThrow(/fewer shares/);
  });
});

describe("readBet", () => {
  it("reads the conditional-token balance of the market's YES or NO position", async () => {
    expect((await readBet({ account: ACCOUNT, prediction: true, fpmmAddress: FPMM })).amount).toBe(50n * E18);
    expect((await readBet({ account: ACCOUNT, prediction: false, fpmmAddress: FPMM })).amount).toBe(0n);
  });
});
