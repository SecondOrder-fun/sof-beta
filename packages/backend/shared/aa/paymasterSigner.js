// Build the paymasterAndData payload for SOFPaymaster verifying flow.
//
// SOFPaymaster.validatePaymasterUserOp expects (from contract comments):
//   [0:20]   paymaster address
//   [20:36]  paymasterVerificationGasLimit (uint128)
//   [36:52]  paymasterPostOpGasLimit      (uint128)
//   [52:58]  validUntil (uint48, 0 = no expiry)
//   [58:64]  validAfter (uint48, 0 = immediately valid)
//   [64:129] ECDSA signature over keccak256(getHash inputs) prefixed with
//            \x19Ethereum Signed Message:\n32 (EIP-191 v45).
//
// `getHash` is the contract's own digest, which excludes the variable
// signature bytes from paymasterAndData (chicken-and-egg avoidance — see
// SOFPaymaster.getHash for the canonical layout).
//
// The ERC-7677 JSON-RPC response splits this: `paymaster` is the address,
// `paymasterVerificationGasLimit` / `paymasterPostOpGasLimit` are numbers,
// and `paymasterData` is the trailing 77 bytes (validUntil + validAfter + sig).

import {
  encodeAbiParameters,
  keccak256,
  numberToHex,
  pad,
  parseAbiParameters,
  toHex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { toPackedUserOperation } from "viem/account-abstraction";

const VALIDITY_BYTES = 6; // uint48
const SIG_BYTES = 65;
const PAYMASTER_DATA_BYTES = VALIDITY_BYTES * 2 + SIG_BYTES; // 77

/**
 * Mirror SOFPaymaster.getHash — must encode exactly the same fields in the
 * same order as the contract or the off-chain signature won't validate.
 */
export function buildPaymasterDigest({
  userOperation,
  paymasterAddress,
  chainId,
  validUntil,
  validAfter,
  paymasterVerificationGasLimit,
  paymasterPostOpGasLimit,
}) {
  const packed = toPackedUserOperation(userOperation);
  // The contract slices `paymasterAndData[0:52]` = address(20) + verifGas(16) + postOp(16),
  // i.e. the prefix WITHOUT validUntil/validAfter/signature. We construct that
  // prefix ourselves to keep the digest deterministic regardless of whatever
  // partial paymasterAndData the caller passed in.
  const paymasterPrefix =
    "0x" +
    paymasterAddress.toLowerCase().replace(/^0x/, "") +
    pad(numberToHex(paymasterVerificationGasLimit), { size: 16 }).slice(2) +
    pad(numberToHex(paymasterPostOpGasLimit), { size: 16 }).slice(2);

  return keccak256(
    encodeAbiParameters(
      parseAbiParameters(
        "address,uint256,bytes32,bytes32,bytes32,uint256,bytes32,bytes32,uint256,address,uint48,uint48",
      ),
      [
        packed.sender,
        packed.nonce,
        keccak256(packed.initCode || "0x"),
        keccak256(packed.callData || "0x"),
        packed.accountGasLimits,
        packed.preVerificationGas,
        packed.gasFees,
        keccak256(paymasterPrefix),
        BigInt(chainId),
        paymasterAddress,
        validUntil,
        validAfter,
      ],
    ),
  );
}

/**
 * Build ERC-7677 paymaster response fields using the SOFPaymaster verifying scheme.
 *
 * @param {object} opts
 * @param {object} opts.userOperation - viem-shape UserOperation (BigInts)
 * @param {`0x${string}`} opts.paymasterAddress - SOFPaymaster address
 * @param {`0x${string}`} opts.signerKey - verifyingSigner private key (hex)
 * @param {number} opts.chainId
 * @param {bigint} [opts.validUntil=0n] - unix seconds; 0 = never expires
 * @param {bigint} [opts.validAfter=0n] - unix seconds; 0 = valid immediately
 * @param {bigint} [opts.paymasterVerificationGasLimit=150000n]
 * @param {bigint} [opts.paymasterPostOpGasLimit=30000n]
 */
export async function buildPaymasterResponse({
  userOperation,
  paymasterAddress,
  signerKey,
  chainId,
  validUntil = 0n,
  validAfter = 0n,
  paymasterVerificationGasLimit = 150_000n,
  paymasterPostOpGasLimit = 30_000n,
}) {
  const signer = privateKeyToAccount(signerKey);

  const hash = buildPaymasterDigest({
    userOperation,
    paymasterAddress,
    chainId,
    validUntil,
    validAfter,
    paymasterVerificationGasLimit,
    paymasterPostOpGasLimit,
  });

  // EIP-191 ethSignedMessage: signer.signMessage does \x19... prefix for us
  const signature = await signer.signMessage({ message: { raw: hash } });
  if (signature.length !== 2 + SIG_BYTES * 2) {
    throw new Error(`unexpected signature length ${signature.length}`);
  }

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
