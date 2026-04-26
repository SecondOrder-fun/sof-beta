// Unit tests for the SOFPaymaster signing helper. Verifies the produced
// paymasterData exactly matches the layout the contract parses and that the
// signature recovers to the configured signer — no wiring to a live chain.

import { describe, expect, it } from "vitest";
import {
  encodeAbiParameters,
  hashMessage,
  keccak256,
  parseAbiParameters,
  recoverAddress,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { buildPaymasterResponse, _internals } from "../../shared/aa/paymasterSigner.js";

const SIGNER_PK = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"; // Anvil #0
const PAYMASTER = "0x4A679253410272dd5232B3Ff7cF5dbB88f295319";
const USER_OP_HASH = "0xbeadf00dbeadf00dbeadf00dbeadf00dbeadf00dbeadf00dbeadf00dbeadf00d";

describe("buildPaymasterResponse", () => {
  it("produces a 77-byte paymasterData with the contract-expected layout", async () => {
    const res = await buildPaymasterResponse({
      userOpHash: USER_OP_HASH,
      paymasterAddress: PAYMASTER,
      signerKey: SIGNER_PK,
    });

    expect(res.paymaster).toBe(PAYMASTER);
    expect(res.paymasterData).toMatch(/^0x[0-9a-f]+$/i);

    const bytes = (res.paymasterData.length - 2) / 2;
    expect(bytes).toBe(_internals.PAYMASTER_DATA_BYTES); // 77

    // First 6 bytes = validUntil (0), next 6 = validAfter (0), rest = signature
    expect(res.paymasterData.slice(2, 2 + 12)).toBe("0".repeat(12));
    expect(res.paymasterData.length).toBe(2 + 77 * 2);
  });

  it("signature recovers to the verifying signer under EIP-191 prefix", async () => {
    const validUntil = 0n;
    const validAfter = 0n;
    const res = await buildPaymasterResponse({
      userOpHash: USER_OP_HASH,
      paymasterAddress: PAYMASTER,
      signerKey: SIGNER_PK,
      validUntil,
      validAfter,
    });

    const sig = `0x${res.paymasterData.slice(2 + 24)}`;
    const encoded = encodeAbiParameters(
      parseAbiParameters("bytes32, uint48, uint48"),
      [USER_OP_HASH, validUntil, validAfter],
    );
    const rawHash = keccak256(encoded);
    const ethHash = hashMessage({ raw: rawHash });

    const recovered = await recoverAddress({ hash: ethHash, signature: sig });
    const expected = privateKeyToAccount(SIGNER_PK).address;
    expect(recovered.toLowerCase()).toBe(expected.toLowerCase());
  });

  it("encodes validUntil/validAfter as big-endian uint48 in the first 12 bytes", async () => {
    const validUntil = 0x0a0b0c0d0e0fn; // 6 bytes
    const validAfter = 0x010203040506n;
    const res = await buildPaymasterResponse({
      userOpHash: USER_OP_HASH,
      paymasterAddress: PAYMASTER,
      signerKey: SIGNER_PK,
      validUntil,
      validAfter,
    });

    expect(res.paymasterData.slice(2, 2 + 12)).toBe("0a0b0c0d0e0f");
    expect(res.paymasterData.slice(2 + 12, 2 + 24)).toBe("010203040506");
  });

  it("returns gas limits as hex strings", async () => {
    const res = await buildPaymasterResponse({
      userOpHash: USER_OP_HASH,
      paymasterAddress: PAYMASTER,
      signerKey: SIGNER_PK,
      paymasterVerificationGasLimit: 250_000n,
      paymasterPostOpGasLimit: 45_000n,
    });

    expect(res.paymasterVerificationGasLimit).toBe("0x3d090");
    expect(res.paymasterPostOpGasLimit).toBe("0xafc8");
  });
});
