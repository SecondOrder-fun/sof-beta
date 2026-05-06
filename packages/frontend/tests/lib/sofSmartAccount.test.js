/*
  @vitest-environment jsdom
*/
import { describe, it, expect, vi } from "vitest";
import { toSofSmartAccount } from "@/lib/sofSmartAccount";

const ENTRY_POINT_V08 = "0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108";

function makeOwner(address = "0x000000000000000000000000000000000000beef") {
  return {
    account: { address, type: "json-rpc" },
    address,
    signTypedData: vi.fn().mockResolvedValue("0xdeadbeef"),
    signMessage: vi.fn().mockResolvedValue("0xdeadbeef"),
  };
}

function makeClient({
  predictedSma = "0x000000000000000000000000000000000000c0de",
  // viem's getCode returns `undefined` for "0x" — match that convention.
  code = undefined,
  chainId = 31337,
} = {}) {
  return {
    readContract: vi.fn().mockResolvedValue(predictedSma),
    getCode: vi.fn().mockResolvedValue(code),
    chain: { id: chainId },
  };
}

describe("toSofSmartAccount", () => {
  it("returns an account with deterministic address from factory.getAddress", async () => {
    const client = makeClient({ predictedSma: "0x000000000000000000000000000000000000c0de" });
    const owner = makeOwner();

    const account = await toSofSmartAccount({
      client,
      owner,
      factory: "0x0000000000000000000000000000000000000fac",
      entryPoint: { address: ENTRY_POINT_V08, version: "0.8" },
    });

    expect(account.address.toLowerCase()).toBe("0x000000000000000000000000000000000000c0de");
    expect(client.readContract).toHaveBeenCalledWith(
      expect.objectContaining({ functionName: "getAddress", args: [owner.account.address] }),
    );
  });

  it("getFactoryArgs returns factory + createAccount calldata for first-time deploy", async () => {
    const client = makeClient({ code: undefined });
    const owner = makeOwner();

    const account = await toSofSmartAccount({
      client,
      owner,
      factory: "0x0000000000000000000000000000000000000fac",
      entryPoint: { address: ENTRY_POINT_V08, version: "0.8" },
    });

    const args = await account.getFactoryArgs();
    expect(args.factory?.toLowerCase()).toBe("0x0000000000000000000000000000000000000fac");
    expect(args.factoryData).toMatch(/^0x/);
    // createAccount(address) selector = 0x... must include the owner address (lowercase, no 0x).
    expect(args.factoryData.toLowerCase()).toContain(owner.account.address.slice(2).toLowerCase());
  });

  it("getFactoryArgs returns undefined factory + factoryData when SMA already deployed", async () => {
    const client = makeClient({ code: "0x6080604052" });
    const owner = makeOwner();

    const account = await toSofSmartAccount({
      client,
      owner,
      factory: "0x0000000000000000000000000000000000000fac",
      entryPoint: { address: ENTRY_POINT_V08, version: "0.8" },
    });

    const args = await account.getFactoryArgs();
    expect(args.factory).toBeUndefined();
    expect(args.factoryData).toBeUndefined();
  });

  it("encodeCalls wraps a single call in ERC-7821 batch mode", async () => {
    const client = makeClient();
    const owner = makeOwner();

    const account = await toSofSmartAccount({
      client,
      owner,
      factory: "0x0000000000000000000000000000000000000fac",
      entryPoint: { address: ENTRY_POINT_V08, version: "0.8" },
    });

    const encoded = await account.encodeCalls([
      { to: "0x0000000000000000000000000000000000000abc", value: 0n, data: "0x" },
    ]);
    // ERC-7821 batch-mode bytes32: 0x01 in the high byte, all others zero.
    // The execute selector is 0xe9ae5c53; verify the mode argument is in the encoded calldata.
    expect(encoded).toMatch(/^0xe9ae5c53/);
    expect(encoded.toLowerCase()).toContain("0100000000000000000000000000000000000000000000000000000000000000");
  });

  it("getStubSignature returns a 65-byte filler", async () => {
    const client = makeClient();
    const owner = makeOwner();

    const account = await toSofSmartAccount({
      client,
      owner,
      factory: "0x0000000000000000000000000000000000000fac",
      entryPoint: { address: ENTRY_POINT_V08, version: "0.8" },
    });

    const stub = await account.getStubSignature();
    // 0x + 130 hex chars = 65 bytes.
    expect(stub).toMatch(/^0x[0-9a-fA-F]{130}$/);
  });
});
