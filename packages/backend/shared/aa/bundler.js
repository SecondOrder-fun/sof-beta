// Local ERC-4337 bundler: accepts UserOperations, signs paymaster data when
// asked, submits via EntryPoint.handleOps from the backend relay wallet.
// Intentionally single-op, single-beneficiary — we don't mempool or batch.

import {
  createPublicClient,
  createWalletClient,
  decodeErrorResult,
  decodeEventLog,
  hexToBigInt,
  http,
  numberToHex,
  parseEventLogs,
  recoverAddress,
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
    // Default to 0 (not 1 gwei) when the field is omitted from the JSON-RPC
    // request. permissionless drops `maxFeePerGas` / `maxPriorityFeePerGas`
    // entirely when they're zero in the signed userOp; defaulting them to
    // 1 gwei here would mutate `gasFees` in the packed encoding and thus the
    // userOpHash, making the wallet signature recover to a wrong address
    // (every operation came back as AA24).
    maxFeePerGas: big(raw.maxFeePerGas ?? 0),
    maxPriorityFeePerGas: big(raw.maxPriorityFeePerGas ?? 0),
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
   * Build the ERC-7677 paymaster response. The off-chain digest is computed
   * by SOFPaymaster.getHash (mirrored in paymasterSigner.buildPaymasterDigest)
   * which intentionally excludes the trailing validUntil/validAfter/signature
   * bytes from paymasterAndData — that's the only way to break the
   * chicken-and-egg of "userOpHash depends on the paymaster signature".
   */
  async function getPaymasterData(userOp) {
    return buildPaymasterResponse({
      userOperation: userOp,
      paymasterAddress,
      signerKey: relayKey,
      chainId: chain.id,
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
   * eth_estimateUserOperationGas: we don't run real bundler-side simulation,
   * so return generous fixed numbers. The previous 300k callGasLimit was too
   * tight for ops that deploy new contracts (e.g. Raffle.createSeason, which
   * deploys a RaffleToken + bonding curve and OOG'd at 300k). Real Pimlico
   * would simulate to squeeze these; on local we'd rather over-provision than
   * fail — paymaster only pays for `actualGasUsed`, so bigger limits don't
   * cost more when the op succeeds.
   */
  async function estimateUserOperationGas() {
    return {
      preVerificationGas: numberToHex(100_000n),
      verificationGasLimit: numberToHex(500_000n),
      callGasLimit: numberToHex(8_000_000n),
      paymasterVerificationGasLimit: numberToHex(200_000n),
      paymasterPostOpGasLimit: numberToHex(60_000n),
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

    let txHash;
    try {
      txHash = await walletClient.writeContract({
        address: entryPoint,
        abi: entryPoint08Abi,
        functionName: "handleOps",
        args: [[packed], account.address],
      });
    } catch (err) {
      // viem buries the revert data in err.cause(.cause).data — walk the chain
      // and decode the FailedOp / FailedOpWithRevert error so the bundler
      // returns a useful "AA24 signature error" string instead of a generic
      // "Missing or invalid parameters" wrapper.
      let data;
      let cur = err;
      while (cur) {
        if (cur.data && typeof cur.data === "string" && cur.data.startsWith("0x")) {
          data = cur.data;
          break;
        }
        cur = cur.cause;
      }
      if (data) {
        try {
          const decoded = decodeErrorResult({ abi: entryPoint08Abi, data });
          const reason = decoded.args?.[1] ?? decoded.errorName;

          // For AA24 (account signature), surface the canonical hash + the
          // address the submitted signature actually recovers to so we can see
          // at a glance whether the wallet signed something else.
          if (typeof reason === "string" && reason.includes("AA24")) {
            try {
              const onChainHash = await publicClient.readContract({
                address: entryPoint,
                abi: entryPoint08Abi,
                functionName: "getUserOpHash",
                args: [packed],
              });
              const recovered = await recoverAddress({
                hash: onChainHash,
                signature: userOp.signature,
              });
              // eslint-disable-next-line no-console
              console.warn("[bundler] AA24 diagnostic", {
                expectedSender: userOp.sender,
                recoveredFromSig: recovered,
                onChainUserOpHash: onChainHash,
                signature: userOp.signature,
              });
            } catch (diagErr) {
              // eslint-disable-next-line no-console
              console.warn("[bundler] AA24 diagnostic failed", diagErr?.message);
            }
          }

          throw new Error(`EntryPoint.${decoded.errorName}: ${reason}`);
        } catch (decodeErr) {
          if (decodeErr instanceof Error && decodeErr.message?.startsWith("EntryPoint.")) {
            throw decodeErr;
          }
          // fall through, rethrow original
        }
      }
      throw err;
    }

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

    // viem throws TransactionReceiptNotFoundError when the tx is still in the
    // mempool. With Anvil's block-time=1 we can hit this window after the
    // bundler returns the tx hash, so swallow the error and return null —
    // permissionless will retry until either the receipt lands or its own
    // timeout fires.
    let receipt;
    try {
      receipt = await publicClient.getTransactionReceipt({ hash: record.txHash });
    } catch {
      return null;
    }
    if (!receipt) return null;

    const events = parseEventLogs({
      abi: entryPoint08Abi,
      logs: receipt.logs,
      eventName: "UserOperationEvent",
    });
    const match = events.find(
      (e) => e.args?.userOpHash?.toLowerCase() === userOpHash.toLowerCase(),
    );

    // viem returns BigInts for blockNumber/transactionIndex/logIndex on every
    // log entry — Fastify's default JSON serialiser dies on those. Strip them
    // to hex so the JSON-RPC response is round-trippable.
    const serializeLog = (l) => ({
      address: l.address,
      topics: l.topics,
      data: l.data,
      blockNumber: l.blockNumber != null ? numberToHex(l.blockNumber) : null,
      transactionHash: l.transactionHash,
      transactionIndex: l.transactionIndex != null ? numberToHex(l.transactionIndex) : null,
      blockHash: l.blockHash,
      logIndex: l.logIndex != null ? numberToHex(l.logIndex) : null,
      removed: !!l.removed,
    });

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
      logs: receipt.logs.map(serializeLog),
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
