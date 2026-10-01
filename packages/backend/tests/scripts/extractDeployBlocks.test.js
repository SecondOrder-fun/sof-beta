// The launch-trade indexer trusts every router the launchpad ever had only if it
// reads RouterUpdated from the launchpad's deploy block. That block comes from the
// deployments file, which the address extractor fills from the broadcast receipts.
import { describe, it, expect } from "vitest";

import { deployBlocksFrom } from "../../../../scripts/extract-deployment-addresses.js";
import { getDeployBlock } from "@sof/contracts/deployments";

const LAUNCHPAD = "0x00000000000000000000000000000000000000Aa";

describe("deployBlocksFrom", () => {
  it("reads the launchpad's block from the receipt that created it, whatever the case", () => {
    const bcast = {
      receipts: [
        { contractAddress: "0x00000000000000000000000000000000000000bb", blockNumber: "0x10" },
        { contractAddress: LAUNCHPAD.toLowerCase(), blockNumber: "0x1e240" },
      ],
    };
    expect(deployBlocksFrom(bcast, { TokenLaunchpad: LAUNCHPAD })).toEqual({ TokenLaunchpad: 123456 });
  });

  it("records nothing when the launchpad was not deployed in this broadcast", () => {
    expect(deployBlocksFrom({ receipts: [] }, { TokenLaunchpad: LAUNCHPAD })).toEqual({});
    expect(deployBlocksFrom({}, {})).toEqual({});
  });
});

describe("getDeployBlock", () => {
  it("is undefined where the deployment file records none", () => {
    expect(getDeployBlock("TokenLaunchpad", "mainnet")).toBeUndefined();
  });

  it("returns the block the extractor recorded for a deployed launchpad", () => {
    expect(Number.isSafeInteger(getDeployBlock("TokenLaunchpad", "testnet"))).toBe(true);
  });
});
