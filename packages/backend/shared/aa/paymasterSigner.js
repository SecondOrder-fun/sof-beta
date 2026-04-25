// Build the paymasterAndData payload for SOFPaymaster verifying flow.
//
// SOFPaymaster.validatePaymasterUserOp expects (from contract comments):
//   [0:20]   paymaster address
//   [20:36]  paymasterVerificationGasLimit (uint128)
//   [36:52]  paymasterPostOpGasLimit      (uint128)
//   [52:58]  validUntil (uint48, 0 = no expiry)
//   [58:64]  validAfter (uint48, 0 = immediately valid)
//   [64:129] ECDSA signature over
//              keccak256(abi.encode(userOpHash, validUntil, validAfter))
//            prefixed with \x19Ethereum Signed Message:\n32 (EIP-191 v45).
//
// The ERC-7677 JSON-RPC response splits this: `paymaster` is the address,
// `paymasterVerificationGasLimit` / `paymasterPostOpGasLimit` are numbers,
// and `paymasterData` is the trailing 77 bytes (validUntil + validAfter + sig).

import {
  encodeAbiParameters,
  keccak256,
  numberToHex,
  parseAbiParameters,
  toHex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const VALIDITY_BYTES = 6; // uint48
const SIG_BYTES = 65;
const PAYMASTER_DATA_BYTES = VALIDITY_BYTES * 2 + SIG_BYTES; // 77

/**
 * Build ERC-7677 paymaster response fields using the SOFPaymaster verifying scheme.
 *
 * @param {object} opts
 * @param {`0x${string}`} opts.userOpHash - EntryPoint-computed user op hash
 * @param {`0x${string}`} opts.paymasterAddress - SOFPaymaster address
 * @param {`0x${string}`} opts.signerKey - verifyingSigner private key (hex)
 * @param {bigint} [opts.validUntil=0n] - unix seconds; 0 = never expires
 * @param {bigint} [opts.validAfter=0n] - unix seconds; 0 = valid immediately
 * @param {bigint} [opts.paymasterVerificationGasLimit=150000n]
 * @param {bigint} [opts.paymasterPostOpGasLimit=30000n]
 */
export async function buildPaymasterResponse({
  userOpHash,
  paymasterAddress,
  signerKey,
  validUntil = 0n,
  validAfter = 0n,
  paymasterVerificationGasLimit = 150_000n,
  paymasterPostOpGasLimit = 30_000n,
}) {
  const signer = privateKeyToAccount(signerKey);

  // keccak256(abi.encode(userOpHash, uint48 validUntil, uint48 validAfter))
  // viem accepts bigint for uint48 directly; never cast through Number() —
  // any value above MAX_SAFE_INTEGER would silently corrupt the encoding.
  const encoded = encodeAbiParameters(
    parseAbiParameters("bytes32, uint48, uint48"),
    [userOpHash, validUntil, validAfter],
  );
  const hash = keccak256(encoded);

  // EIP-191 ethSignedMessage: signer.signMessage does \x19... prefix for us
  const signature = await signer.signMessage({ message: { raw: hash } });
  if (signature.length !== 2 + SIG_BYTES * 2) {
    throw new Error(`unexpected signature length ${signature.length}`);
  }

  // paymasterData = validUntil(6) || validAfter(6) || sig(65) — exactly 77 bytes
  const paymasterData =
    "0x" +
    toHex(validUntil, { size: VALIDITY_BYTES }).slice(2) +
    toHex(validAfter, { size: VALIDITY_BYTES }).slice(2) +
    signature.slice(2);

  if ((paymasterData.length - 2) / 2 !== PAYMASTER_DATA_BYTES) {
    throw new Error(`paymasterData size mismatch: ${paymasterData.length}`);
  }

  return {
    paymaster: paymasterAddress,
    paymasterData,
    paymasterVerificationGasLimit: numberToHex(paymasterVerificationGasLimit),
    paymasterPostOpGasLimit: numberToHex(paymasterPostOpGasLimit),
  };
}

export const _internals = { PAYMASTER_DATA_BYTES, VALIDITY_BYTES, SIG_BYTES };
