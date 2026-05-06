// packages/frontend/src/lib/sofSmartAccount.js
//
// Wraps SOFSmartAccount + SOFSmartAccountFactory as a viem
// `SmartAccount` so it composes cleanly with `createBundlerClient` and the
// EntryPoint v0.8 stack.
//
// Design notes
// ────────────
// • Signing: SOFSmartAccount inherits OZ's `Account` + `SignerECDSA`. It does
//   NOT override `_signableUserOpHash`, so per its NatSpec the EntryPoint v0.8
//   typed-data userOpHash IS the digest the on-chain contract will pass to
//   `ECDSA.tryRecover`. We therefore sign the EIP-712 PackedUserOperation
//   structure produced by `getUserOperationTypedData` (no custom domain wrap).
//   This matches permissionless's `toSimpleSmartAccount` v0.8 path verbatim.
//
// • Calldata: SOFSmartAccount inherits ERC-7821 and supports a single
//   `execute(bytes32 mode, bytes executionData)` entry point with batch mode
//   only (`mode = 0x0100…00`). Even a "single call" is wrapped in a 1-element
//   `Execution[]` payload — there is no separate single-call ABI.

import { encodeFunctionData, encodeAbiParameters } from "viem";
import { toSmartAccount, getUserOperationTypedData } from "viem/account-abstraction";
import { SOFSmartAccountFactoryABI, SOFSmartAccountABI } from "@sof/contracts";

/**
 * ERC-7821 batch CallType: high byte = 0x01, all others 0.
 * `bytes32(uint256(1) << 248)` per OZ ERC7821.
 */
export const ERC7821_BATCH_MODE =
  "0x0100000000000000000000000000000000000000000000000000000000000000";

/**
 * ABI for the single Execution tuple — `(address target, uint256 value, bytes callData)` —
 * used by ERC-7821's batch decode path.
 */
const EXECUTION_TUPLE = {
  type: "tuple[]",
  components: [
    { type: "address", name: "target" },
    { type: "uint256", name: "value" },
    { type: "bytes", name: "callData" },
  ],
};

/**
 * Build a viem SmartAccount targeting the user's SOFSmartAccount.
 *
 * @param {object} params
 * @param {object} params.client      viem PublicClient (must expose `chain.id`)
 * @param {object} params.owner       viem WalletClient (or any account-like with `signTypedData`)
 * @param {`0x${string}`} params.factory   SOFSmartAccountFactory address
 * @param {{address: `0x${string}`, version: string}} params.entryPoint
 *        EntryPoint config — for our stack, always v0.8 at the canonical address.
 */
export async function toSofSmartAccount({ client, owner, factory, entryPoint }) {
  const ownerAddress = owner?.account?.address ?? owner?.address;
  if (!ownerAddress) {
    throw new Error("toSofSmartAccount: owner must expose an address");
  }

  const smaAddress = await client.readContract({
    abi: SOFSmartAccountFactoryABI,
    address: factory,
    functionName: "getAddress",
    args: [ownerAddress],
  });

  return toSmartAccount({
    client,
    entryPoint,

    async getAddress() {
      return smaAddress;
    },

    async getFactoryArgs() {
      // viem's `toSmartAccount` wrapper short-circuits this to
      // `{ factory: undefined, factoryData: undefined }` whenever
      // `isDeployed()` is true (it calls `getCode(smaAddress)` itself).
      // Reaching this implementation means the SMA is not yet deployed,
      // so always return the createAccount init code.
      const factoryData = encodeFunctionData({
        abi: SOFSmartAccountFactoryABI,
        functionName: "createAccount",
        args: [ownerAddress],
      });
      return { factory, factoryData };
    },

    async getNonce() {
      // Returning undefined causes viem's toSmartAccount to fall back to
      // EntryPoint.getNonce(sender, key) — the canonical AA path.
      return undefined;
    },

    async signMessage({ message }) {
      // Plain ECDSA personal_sign — the on-chain SignerECDSA will recover
      // against an eth_signedMessage prefix when called via isValidSignature.
      // We don't currently use this path; provided for API completeness.
      return owner.signMessage({ message });
    },

    async signTypedData(parameters) {
      return owner.signTypedData(parameters);
    },

    async signUserOperation(parameters) {
      const { chainId = client.chain?.id, ...userOperation } = parameters;
      // EntryPoint v0.8 produces an EIP-712 typed-data userOpHash natively.
      // SOFSmartAccount doesn't override `_signableUserOpHash`, so the digest
      // the on-chain contract passes to ECDSA.tryRecover IS this typed-data
      // hash. Signing it directly via signTypedData is the correct path.
      const typedData = getUserOperationTypedData({
        chainId,
        entryPointAddress: entryPoint.address,
        userOperation: {
          ...userOperation,
          sender: smaAddress,
          signature: "0x",
        },
      });
      return owner.signTypedData(typedData);
    },

    async encodeCalls(calls) {
      // ERC-7821 supports batch mode only — wrap every call set in a tuple
      // array, even a single call.
      const executions = calls.map((c) => ({
        target: c.to,
        value: c.value ?? 0n,
        callData: c.data ?? "0x",
      }));
      const executionData = encodeAbiParameters([EXECUTION_TUPLE], [executions]);
      return encodeFunctionData({
        abi: SOFSmartAccountABI,
        functionName: "execute",
        args: [ERC7821_BATCH_MODE, executionData],
      });
    },

    async getStubSignature() {
      // 65-byte filler that ECDSA.recover can parse without reverting during
      // gas estimation. The bundler replaces this with the real signature
      // before submission.
      return `0x${"ff".repeat(65)}`;
    },
  });
}
