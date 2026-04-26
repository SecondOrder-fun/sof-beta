// Unit tests for the SOFPaymaster signing helper. Verifies the produced
// paymasterData exactly matches the layout the contract parses and that the
// signature recovers to the configured signer — no wiring to a live chain.

import { describe, expect, it } from "vitest";
import { hashMessage, recoverAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import {
  buildPaymasterResponse,
  buildPaymasterDigest,
  _internals,
} from "../../shared/aa/paymasterSigner.js";

const SIGNER_PK = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"; // Anvil #0
const PAYMASTER = "0x4A679253410272dd5232B3Ff7cF5dbB88f295319";

// Minimal viem-shape userOp. Fields not in the digest are intentionally bare;
// the digest hashes sender/nonce/initCode/callData/gasLimits/preVerif/gasFees
// plus a paymaster-prefix slice that the helper builds itself, so the
// userOp's own paymaster fields don't have to be filled in for the test.
const USER_OP = {
  sender: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
  nonce: 0n,
  callData: "0xdeadbeef",
  callGasLimit: 100_000n,
  verificationGasLimit: 200_000n,
  preVerificationGas: 50_000n,
  maxFeePerGas: 0n,
  maxPriorityFeePerGas: 0n,
  signature: "0x",
};

const CHAIN_ID = 31337;

describe("buildPaymasterResponse", () => {
  it("produces a 77-byte paymasterData with the contract-expected layout", async () => {
    const res = await buildPaymasterResponse({
      userOperation: USER_OP,
      paymasterAddress: PAYMASTER,
      signerKey: SIGNER_PK,
      chainId: CHAIN_ID,
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
      userOperation: USER_OP,
      paymasterAddress: PAYMASTER,
      signerKey: SIGNER_PK,
      chainId: CHAIN_ID,
      validUntil,
      validAfter,
    });

    const sig = `0x${res.paymasterData.slice(2 + 24)}`;
    const digest = buildPaymasterDigest({
      userOperation: USER_OP,
      paymasterAddress: PAYMASTER,
      chainId: CHAIN_ID,
      validUntil,
      validAfter,
      paymasterVerificationGasLimit: 150_000n,
      paymasterPostOpGasLimit: 30_000n,
    });
    const ethHash = hashMessage({ raw: digest });

    const recovered = await recoverAddress({ hash: ethHash, signature: sig });
    const expected = privateKeyToAccount(SIGNER_PK).address;
    expect(recovered.toLowerCase()).toBe(expected.toLowerCase());
  });

  it("encodes validUntil/validAfter as big-endian uint48 in the first 12 bytes", async () => {
    const validUntil = 0x0a0b0c0d0e0fn; // 6 bytes
    const validAfter = 0x010203040506n;
    const res = await buildPaymasterResponse({
      userOperation: USER_OP,
      paymasterAddress: PAYMASTER,
      signerKey: SIGNER_PK,
      chainId: CHAIN_ID,
      validUntil,
      validAfter,
    });

    expect(res.paymasterData.slice(2, 2 + 12)).toBe("0a0b0c0d0e0f");
    expect(res.paymasterData.slice(2 + 12, 2 + 24)).toBe("010203040506");
  });

  it("returns gas limits as hex strings", async () => {
    const res = await buildPaymasterResponse({
      userOperation: USER_OP,
      paymasterAddress: PAYMASTER,
      signerKey: SIGNER_PK,
      chainId: CHAIN_ID,
      paymasterVerificationGasLimit: 250_000n,
      paymasterPostOpGasLimit: 45_000n,
    });

    expect(res.paymasterVerificationGasLimit).toBe("0x3d090");
    expect(res.paymasterPostOpGasLimit).toBe("0xafc8");
  });

  it("digest depends on validUntil/validAfter — same userOp + different bounds → different sig", async () => {
    // Both responses for the same userOp; only the validity window differs.
    // The contract hashes `getHash(userOp, validUntil, validAfter)` so the
    // signed digest must differ. If the bundler ever reverts to signing over
    // a static digest the two sigs would collide here.
    const a = await buildPaymasterResponse({
      userOperation: USER_OP,
      paymasterAddress: PAYMASTER,
      signerKey: SIGNER_PK,
      chainId: CHAIN_ID,
      validUntil: 1_000_000n,
      validAfter: 0n,
    });
    const b = await buildPaymasterResponse({
      userOperation: USER_OP,
      paymasterAddress: PAYMASTER,
      signerKey: SIGNER_PK,
      chainId: CHAIN_ID,
      validUntil: 2_000_000n,
      validAfter: 0n,
    });

    const sigA = a.paymasterData.slice(2 + 24);
    const sigB = b.paymasterData.slice(2 + 24);
    expect(sigA).not.toBe(sigB);
  });

  it("digest depends on userOp.callData — replaying the same paymasterData on a different op fails", async () => {
    const res = await buildPaymasterResponse({
      userOperation: USER_OP,
      paymasterAddress: PAYMASTER,
      signerKey: SIGNER_PK,
      chainId: CHAIN_ID,
    });

    // Recompute the digest for a userOp with different callData. The signature
    // we got was over USER_OP, so recovery against the new digest must yield
    // someone other than the signer (anti-replay across ops).
    const sig = `0x${res.paymasterData.slice(2 + 24)}`;
    const tampered = { ...USER_OP, callData: "0xc0ffeec0" };
    const digestTampered = buildPaymasterDigest({
      userOperation: tampered,
      paymasterAddress: PAYMASTER,
      chainId: CHAIN_ID,
      validUntil: 0n,
      validAfter: 0n,
      paymasterVerificationGasLimit: 150_000n,
      paymasterPostOpGasLimit: 30_000n,
    });
    const recovered = await recoverAddress({
      hash: hashMessage({ raw: digestTampered }),
      signature: sig,
    });
    const expected = privateKeyToAccount(SIGNER_PK).address;
    expect(recovered.toLowerCase()).not.toBe(expected.toLowerCase());
  });
});
