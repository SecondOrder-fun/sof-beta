// Local ERC-4337 bundler: accepts UserOperations, signs paymaster data when
// asked, submits via EntryPoint.handleOps from the backend relay wallet.
// Intentionally single-op, single-beneficiary — we don't mempool or batch.

import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  hexToBigInt,
  http,
  numberToHex,
  parseEventLogs,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  entryPoint08Abi,
  entryPoint08Address,
  getUserOperationHash,
  toPackedUserOperation,
} from "viem/account-abstraction";

import { buildPaymasterResponse } from "./paymasterSigner.js";

/**
 * @typedef {object} UserOperationRpc
 * RPC-shape UserOperation — viem field names, hex encoding for numbers.
 */

/**
 * Decode a hex/number into BigInt; tolerate undefined → 0n.
 */
const big = (v) => (v == null ? 0n : typeof v === "bigint" ? v : hexToBigInt(v));

/**
 * Convert RPC-shape UserOp to viem's canonical shape (BigInts + bytes).
 */
function normalizeUserOp(raw) {
  if (!raw || !raw.sender) throw new Error("userOp missing sender");
  return {
    sender: raw.sender,
    nonce: big(raw.nonce),
    factory: raw.factory ?? undefined,
    factoryData: raw.factoryData ?? undefined,
    callData: raw.callData ?? "0x",
    callGasLimit: big(raw.callGasLimit ?? "0x186a0"), // 100k default
    verificationGasLimit: big(raw.verificationGasLimit ?? "0x249f0"), // 150k
    preVerificationGas: big(raw.preVerificationGas ?? "0xc350"), // 50k
    maxFeePerGas: big(raw.maxFeePerGas ?? "0x3b9aca00"), // 1 gwei
    maxPriorityFeePerGas: big(raw.maxPriorityFeePerGas ?? "0x3b9aca00"),
    paymaster: raw.paymaster ?? undefined,
    paymasterVerificationGasLimit:
      raw.paymasterVerificationGasLimit != null
        ? big(raw.paymasterVerificationGasLimit)
        : undefined,
    paymasterPostOpGasLimit:
      raw.paymasterPostOpGasLimit != null ? big(raw.paymasterPostOpGasLimit) : undefined,
    paymasterData: raw.paymasterData ?? undefined,
    signature: raw.signature ?? "0x",
  };
}

export function createBundlerService({ rpcUrl, chain, relayKey, paymasterAddress }) {
  // Hoisted to the top so any closure that fires before `return` (e.g. in
  // future refactors that extract methods) doesn't hit a TDZ on `submissions`.
  const submissions = new Map();

  const account = privateKeyToAccount(
    relayKey.startsWith("0x") ? relayKey : `0x${relayKey}`,
  );

  const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
  const walletClient = createWalletClient({ account, chain, transport: http(rpcUrl) });

  const entryPoint = entryPoint08Address;

  /**
   * Compute the userOpHash the EntryPoint will verify against. v0.8 uses an
   * EIP-712 typed hash incorporating chainId + entrypoint address, which viem
   * already implements.
   */
  function hashUserOp(userOp) {
    return getUserOperationHash({
      userOperation: userOp,
      chainId: chain.id,
      entryPointAddress: entryPoint,
      entryPointVersion: "0.8",
    });
  }

  /**
   * Build the digest the paymaster signs over.
   *
   * Verifying paymasters have a chicken-and-egg problem: the userOpHash
   * computed by the EntryPoint depends on paymasterAndData, which contains
   * the very signature being computed. To break the cycle we strip the
   * variable paymaster fields (paymasterData / signature) before hashing,
   * matching what the on-chain EntryPoint sees in the canonical hash path.
   *
   * Gas limits stay populated because they're fixed by `buildPaymasterResponse`'s
   * defaults — both stub and final return the same numbers.
   */
  async function getPaymasterData(userOp) {
    const cleaned = {
      ...userOp,
      signature: "0x",
      // Zero-length paymaster signature placeholder so stub & final hashes match.
      paymasterData: "0x",
    };
    const userOpHash = hashUserOp(cleaned);
    return buildPaymasterResponse({
      userOpHash,
      paymasterAddress,
      signerKey: relayKey,
    });
  }

  /**
   * pm_getPaymasterStubData: return dummy paymaster data that the client
   * can use for gas estimation before the real signature is requested.
   * We still sign here because local Anvil doesn't have separate estimate
   * vs. production flows — one signature is enough.
   */
  async function pmGetPaymasterStubData(userOp) {
    return getPaymasterData(userOp);
  }

  async function pmGetPaymasterData(userOp) {
    return getPaymasterData(userOp);
  }

  /**
   * eth_estimateUserOperationGas: minimal — use preset generous defaults
   * since we don't implement full simulation. Real Pimlico would simulate
   * validation + execution to squeeze these numbers down.
   */
  async function estimateUserOperationGas() {
    return {
      preVerificationGas: numberToHex(80_000n),
      verificationGasLimit: numberToHex(300_000n),
      callGasLimit: numberToHex(300_000n),
      paymasterVerificationGasLimit: numberToHex(150_000n),
      paymasterPostOpGasLimit: numberToHex(30_000n),
    };
  }

  /**
   * eth_sendUserOperation: pack, call EntryPoint.handleOps from the relay
   * wallet, wait for receipt, derive userOpHash, index the event log.
   */
  async function sendUserOperation(rawUserOp) {
    const userOp = normalizeUserOp(rawUserOp);
    const userOpHash = hashUserOp(userOp);
    const packed = toPackedUserOperation(userOp);

    const txHash = await walletClient.writeContract({
      address: entryPoint,
      abi: entryPoint08Abi,
      functionName: "handleOps",
      args: [[packed], account.address],
    });

    // Record the submission for later eth_getUserOperationReceipt queries.
    submissions.set(userOpHash, { txHash, userOp, submittedAt: Date.now() });
    return userOpHash;
  }

  /**
   * eth_getUserOperationReceipt: look up the tx receipt, extract the
   * UserOperationEvent matching this userOpHash.
   */
  async function getUserOperationReceipt(userOpHash) {
    const record = submissions.get(userOpHash);
    if (!record) return null;

    const receipt = await publicClient.getTransactionReceipt({ hash: record.txHash });
    if (!receipt) return null;

    const events = parseEventLogs({
      abi: entryPoint08Abi,
      logs: receipt.logs,
      eventName: "UserOperationEvent",
    });
    const match = events.find(
      (e) => e.args?.userOpHash?.toLowerCase() === userOpHash.toLowerCase(),
    );

    return {
      userOpHash,
      entryPoint,
      sender: match?.args?.sender ?? record.userOp.sender,
      nonce: numberToHex(match?.args?.nonce ?? record.userOp.nonce),
      paymaster: match?.args?.paymaster ?? null,
      actualGasCost: numberToHex(match?.args?.actualGasCost ?? 0n),
      actualGasUsed: numberToHex(match?.args?.actualGasUsed ?? 0n),
      success: match?.args?.success ?? false,
      reason: "",
      logs: receipt.logs,
      receipt: {
        transactionHash: receipt.transactionHash,
        transactionIndex: numberToHex(receipt.transactionIndex),
        blockHash: receipt.blockHash,
        blockNumber: numberToHex(receipt.blockNumber),
        from: receipt.from,
        to: receipt.to,
        cumulativeGasUsed: numberToHex(receipt.cumulativeGasUsed),
        gasUsed: numberToHex(receipt.gasUsed),
        contractAddress: receipt.contractAddress,
        status: receipt.status === "success" ? "0x1" : "0x0",
        logsBloom: receipt.logsBloom,
      },
    };
  }

  async function getUserOperationByHash(userOpHash) {
    const record = submissions.get(userOpHash);
    if (!record) return null;
    return {
      userOperation: serializeUserOp(record.userOp),
      entryPoint,
      transactionHash: record.txHash,
      blockHash: null,
      blockNumber: null,
    };
  }

  function supportedEntryPoints() {
    return [entryPoint];
  }

  function chainIdHex() {
    return numberToHex(chain.id);
  }

  return {
    // ERC-7677 paymaster
    pm_getPaymasterStubData: pmGetPaymasterStubData,
    pm_getPaymasterData: pmGetPaymasterData,
    // ERC-4337 bundler
    eth_estimateUserOperationGas: estimateUserOperationGas,
    eth_sendUserOperation: sendUserOperation,
    eth_getUserOperationReceipt: getUserOperationReceipt,
    eth_getUserOperationByHash: getUserOperationByHash,
    eth_supportedEntryPoints: supportedEntryPoints,
    eth_chainId: chainIdHex,
    // test / inspection
    _hashUserOp: hashUserOp,
    _relayAddress: account.address,
    _entryPointAddress: entryPoint,
  };
}

/**
 * Convert a viem-shape UserOp back to RPC JSON for echo-back endpoints.
 */
function serializeUserOp(op) {
  const toHex = (v) => (v == null ? undefined : numberToHex(v));
  return {
    sender: op.sender,
    nonce: toHex(op.nonce),
    factory: op.factory ?? null,
    factoryData: op.factoryData ?? null,
    callData: op.callData,
    callGasLimit: toHex(op.callGasLimit),
    verificationGasLimit: toHex(op.verificationGasLimit),
    preVerificationGas: toHex(op.preVerificationGas),
    maxFeePerGas: toHex(op.maxFeePerGas),
    maxPriorityFeePerGas: toHex(op.maxPriorityFeePerGas),
    paymaster: op.paymaster ?? null,
    paymasterVerificationGasLimit: op.paymasterVerificationGasLimit
      ? toHex(op.paymasterVerificationGasLimit)
      : null,
    paymasterPostOpGasLimit: op.paymasterPostOpGasLimit
      ? toHex(op.paymasterPostOpGasLimit)
      : null,
    paymasterData: op.paymasterData ?? null,
    signature: op.signature,
  };
}
