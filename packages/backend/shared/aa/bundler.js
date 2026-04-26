// Local ERC-4337 bundler: accepts UserOperations, signs paymaster data when
// asked, submits via EntryPoint.handleOps from the backend relay wallet.
// Intentionally single-op, single-beneficiary — we don't mempool or batch.

import {
  createPublicClient,
  createWalletClient,
  decodeErrorResult,
  hexToBigInt,
  http,
  isAddress,
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

/**
 * How long a paymaster signature stays valid past the moment it's issued.
 * 10 minutes is enough headroom for any wallet/UI flow including the user
 * staring at a MetaMask popup, but short enough that a leaked signer key
 * stops draining the deposit shortly after detection. Override per-deploy
 * via PAYMASTER_VALIDITY_WINDOW_SEC; takes effect on backend restart (the
 * value is read once at service construction, not per request).
 */
const DEFAULT_VALIDITY_WINDOW_SECONDS = 600n;

/** Hard upper bound on the env override — one day is already excessive. */
const MAX_VALIDITY_WINDOW_SECONDS = 86_400n;

/**
 * Backdate `validAfter` slightly to absorb relay-vs-bundler clock skew. A
 * userOp signed at T=now sometimes arrives at the EntryPoint at T-2s
 * because the relay's clock leads — without a backdate the paymaster would
 * reject "valid in the future" sigs.
 */
const VALID_AFTER_BACKDATE_SECONDS = 30n;

function resolveValidityWindow(envValue, isLocalNetwork) {
  if (envValue == null || envValue === "") {
    return isLocalNetwork ? 0n : DEFAULT_VALIDITY_WINDOW_SECONDS;
  }
  if (!/^\d+$/.test(envValue)) {
    throw new Error(
      `PAYMASTER_VALIDITY_WINDOW_SEC must be a non-negative integer, got: ${envValue}`,
    );
  }
  const parsed = BigInt(envValue);
  if (parsed > MAX_VALIDITY_WINDOW_SECONDS) {
    throw new Error(
      `PAYMASTER_VALIDITY_WINDOW_SEC=${envValue} exceeds max of ${MAX_VALIDITY_WINDOW_SECONDS}s`,
    );
  }
  if (parsed === 0n && !isLocalNetwork) {
    // Don't refuse — alpha may genuinely want this — but make it loud so a
    // stray env var can't silently deploy an unbounded paymaster on testnet.
    // eslint-disable-next-line no-console
    console.warn(
      "[bundler] PAYMASTER_VALIDITY_WINDOW_SEC=0 on non-local network: paymaster signatures will be UNBOUNDED",
    );
  }
  return parsed;
}

/**
 * Per-network gas caps applied to userOps the verifying signer is asked to
 * sponsor. Off-chain caps don't change EntryPoint enforcement; they cap how
 * generous a single sponsored op can be. Chosen so that any of our real ops
 * (createSeason, which deploys two contracts in a single execute) fits, but
 * a runaway op claiming arbitrary gas budget is rejected with -32602.
 *
 * Local dev keeps the historical 8M call-gas because forge-deployed ops still
 * occasionally need it; testnet/mainnet pay real money so cap them tighter.
 */
const DEFAULT_GAS_CAPS = {
  LOCAL: {
    callGasLimit: 8_000_000n,
    verificationGasLimit: 1_000_000n,
    paymasterVerificationGasLimit: 500_000n,
    paymasterPostOpGasLimit: 100_000n,
  },
  REMOTE: {
    callGasLimit: 2_000_000n,
    verificationGasLimit: 500_000n,
    paymasterVerificationGasLimit: 200_000n,
    paymasterPostOpGasLimit: 60_000n,
  },
};

const GAS_CAP_ENV_KEYS = {
  callGasLimit: "PAYMASTER_MAX_CALL_GAS",
  verificationGasLimit: "PAYMASTER_MAX_VERIFICATION_GAS",
  paymasterVerificationGasLimit: "PAYMASTER_MAX_PAYMASTER_VERIFICATION_GAS",
  paymasterPostOpGasLimit: "PAYMASTER_MAX_PAYMASTER_POSTOP_GAS",
};

function resolveGasCaps(env, isLocalNetwork) {
  const defaults = isLocalNetwork ? DEFAULT_GAS_CAPS.LOCAL : DEFAULT_GAS_CAPS.REMOTE;
  const out = { ...defaults };
  for (const [field, key] of Object.entries(GAS_CAP_ENV_KEYS)) {
    const raw = env[key];
    if (raw == null || raw === "") continue;
    if (!/^\d+$/.test(raw)) {
      throw new Error(`${key} must be a non-negative integer, got: ${raw}`);
    }
    out[field] = BigInt(raw);
  }
  return out;
}

/**
 * Per-EOA sponsorship quota over a rolling hour window. Enforced by Redis
 * INCR + first-call EXPIRE so multiple backend instances share the count.
 * Local dev skips Redis entirely (no quota). Configurable via
 * PAYMASTER_QUOTA_PER_HOUR; defaults to 40 calls/hour/EOA on remote — that's
 * effectively 20 user-ops since the standard ERC-7677 flow makes both a stub
 * and a real call per op (both consume budget; see checkQuotaOrThrow comment).
 */
const DEFAULT_QUOTA_PER_HOUR = 40n;
const QUOTA_WINDOW_SECONDS = 3600;

function resolveQuotaPerHour(envValue, isLocalNetwork) {
  if (envValue == null || envValue === "") {
    return isLocalNetwork ? 0n : DEFAULT_QUOTA_PER_HOUR;
  }
  if (!/^\d+$/.test(envValue)) {
    throw new Error(
      `PAYMASTER_QUOTA_PER_HOUR must be a non-negative integer, got: ${envValue}`,
    );
  }
  return BigInt(envValue);
}

export const _internals = {
  DEFAULT_VALIDITY_WINDOW_SECONDS,
  MAX_VALIDITY_WINDOW_SECONDS,
  VALID_AFTER_BACKDATE_SECONDS,
  DEFAULT_GAS_CAPS,
  DEFAULT_QUOTA_PER_HOUR,
  QUOTA_WINDOW_SECONDS,
  resolveValidityWindow,
  resolveGasCaps,
  resolveQuotaPerHour,
};

export function createBundlerService({
  rpcUrl,
  chain,
  relayKey,
  paymasterAddress,
  redis = null,
}) {
  // Hoisted to the top so any closure that fires before `return` (e.g. in
  // future refactors that extract methods) doesn't hit a TDZ on `submissions`.
  const submissions = new Map();

  // Bounded validity window for paymaster signatures. On local Anvil the
  // verifying signer is the deployer key, the chain is ephemeral, and the
  // headless E2E asserts unbounded sigs (validUntil=0); on testnet/mainnet
  // unbounded sigs let a leaked signer drain the deposit until setSigner
  // lands, so default to a 10-minute window.
  const isLocalNetwork = (process.env.NETWORK || "LOCAL").toUpperCase() === "LOCAL";
  const validityWindowSec = resolveValidityWindow(
    process.env.PAYMASTER_VALIDITY_WINDOW_SEC,
    isLocalNetwork,
  );
  const gasCaps = resolveGasCaps(process.env, isLocalNetwork);
  const quotaPerHour = resolveQuotaPerHour(
    process.env.PAYMASTER_QUOTA_PER_HOUR,
    isLocalNetwork,
  );

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
   *
   * IMPORTANT: pull the paymaster gas limits from the userOp when present so
   * the digest the off-chain signer hashes over matches the bytes the client
   * will actually pack into paymasterAndData. Falling back to fixed defaults
   * here would cause AA34 the moment a client uses any other gas limit
   * (e.g. one populated from eth_estimateUserOperationGas).
   */
  /**
   * Reject userOps whose claimed gas budget would let a sponsored op consume
   * an outsized share of the deposit. Off-chain caps; the EntryPoint already
   * enforces actualGasUsed <= claimed, so this just refuses to sign for
   * unreasonable claims in the first place.
   */
  function assertGasLimitsWithinCaps(userOp) {
    for (const [field, max] of Object.entries(gasCaps)) {
      const claimed = userOp[field];
      if (claimed == null) continue;
      const claimedBig = typeof claimed === "bigint" ? claimed : BigInt(claimed);
      if (claimedBig > max) {
        const err = new Error(
          `userOp ${field}=${claimedBig} exceeds paymaster cap ${max}`,
        );
        err.code = -32602;
        throw err;
      }
    }
  }

  /**
   * Per-EOA quota: INCR a Redis counter keyed by chainId+sender, set TTL on
   * first hit, reject when over budget. Skipped entirely when quotaPerHour=0
   * (local) or when no redis client is configured. Fail-CLOSED on Redis
   * errors so a quota infra outage can't accidentally turn into unbounded
   * sponsorship.
   *
   * INCR + EXPIRE are pipelined into a single MULTI so the key always gets
   * its TTL set on first hit — otherwise an EXPIRE that fails after a
   * successful INCR would leave a permanent counter and lock the EOA out.
   *
   * Applied to BOTH stub and real paymaster calls. Splitting the quota across
   * the two would let an attacker mint unlimited *real* paymaster sigs via
   * the stub endpoint (each call returns a valid signature for the supplied
   * userOp). Default REMOTE quota is sized so a normal flow (one stub + one
   * real per user op) uses 2 of the budget.
   */
  async function checkQuotaOrThrow(sender) {
    if (quotaPerHour === 0n || !redis) return;
    if (!isAddress(sender)) {
      const err = new Error(`paymaster quota: invalid sender address "${sender}"`);
      err.code = -32602;
      throw err;
    }
    const key = `paymaster:quota:${chain.id}:${sender.toLowerCase()}`;
    let count;
    try {
      // ioredis pipeline: each entry is `[err, value]`. multi() guarantees
      // both commands run together so the EXPIRE can't be skipped by a
      // network blip after INCR has already bumped the counter.
      const [[incrErr, incrVal], [expErr]] = await redis
        .multi()
        .incr(key)
        .expire(key, QUOTA_WINDOW_SECONDS)
        .exec();
      if (incrErr) throw incrErr;
      if (expErr) throw expErr;
      count = incrVal;
    } catch (err) {
      const wrapped = new Error(`paymaster quota check failed: ${err.message}`);
      wrapped.code = -32000;
      throw wrapped;
    }
    if (BigInt(count) > quotaPerHour) {
      const err = new Error(
        `paymaster sponsorship quota exceeded for ${sender} (${count}/${quotaPerHour}/hr)`,
      );
      // -32603 is JSON-RPC "internal error" with custom data. Clients can
      // branch on data.reason instead of memorising a non-standard code.
      err.code = -32603;
      err.data = { reason: "quota_exceeded", limit: Number(quotaPerHour), count };
      throw err;
    }
  }

  async function getPaymasterData(userOp) {
    assertGasLimitsWithinCaps(userOp);
    // Bound the validity window. validityWindowSec=0 means unbounded (local
    // dev only). Otherwise: validAfter = now − backdate, validUntil = now +
    // window. Use unix seconds, not millis — the contract's uint48 fields
    // are seconds.
    let validUntil = 0n;
    let validAfter = 0n;
    if (validityWindowSec > 0n) {
      const now = BigInt(Math.floor(Date.now() / 1000));
      validAfter = now > VALID_AFTER_BACKDATE_SECONDS
        ? now - VALID_AFTER_BACKDATE_SECONDS
        : 0n;
      validUntil = now + validityWindowSec;
      // Sanity check the bound. Upstream EntryPoint rejects with AA22 when
      // validAfter >= validUntil, so failing here gives a clearer error than
      // a generic on-chain revert.
      if (validAfter >= validUntil) {
        throw new Error(
          `bundler validity window invariant broken: validAfter=${validAfter} >= validUntil=${validUntil}`,
        );
      }
    }
    return buildPaymasterResponse({
      userOperation: userOp,
      paymasterAddress,
      signerKey: relayKey,
      chainId: chain.id,
      paymasterVerificationGasLimit: userOp.paymasterVerificationGasLimit ?? 150_000n,
      paymasterPostOpGasLimit: userOp.paymasterPostOpGasLimit ?? 30_000n,
      validUntil,
      validAfter,
    });
  }

  /**
   * pm_getPaymasterStubData: return dummy paymaster data that the client
   * can use for gas estimation before the real signature is requested.
   * We still sign here because local Anvil doesn't have separate estimate
   * vs. production flows — one signature is enough.
   */
  async function pmGetPaymasterStubData(userOp) {
    // Stub returns a real signature too (we don't run a separate dummy-bytes
    // path) — so it MUST consume quota or it becomes a free-signature oracle
    // for any attacker who exhausted the real-call budget.
    await checkQuotaOrThrow(userOp.sender);
    return getPaymasterData(userOp);
  }

  async function pmGetPaymasterData(userOp) {
    await checkQuotaOrThrow(userOp.sender);
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
    // Static suggestions, then clamped to the network caps so we never hand
    // out values we would later refuse to sign for in pm_getPaymasterData.
    const suggested = {
      preVerificationGas: 100_000n,
      verificationGasLimit: 500_000n,
      callGasLimit: 8_000_000n,
      paymasterVerificationGasLimit: 200_000n,
      paymasterPostOpGasLimit: 60_000n,
    };
    const min = (a, b) => (a < b ? a : b);
    return {
      preVerificationGas: numberToHex(suggested.preVerificationGas),
      verificationGasLimit: numberToHex(
        min(suggested.verificationGasLimit, gasCaps.verificationGasLimit),
      ),
      callGasLimit: numberToHex(min(suggested.callGasLimit, gasCaps.callGasLimit)),
      paymasterVerificationGasLimit: numberToHex(
        min(suggested.paymasterVerificationGasLimit, gasCaps.paymasterVerificationGasLimit),
      ),
      paymasterPostOpGasLimit: numberToHex(
        min(suggested.paymasterPostOpGasLimit, gasCaps.paymasterPostOpGasLimit),
      ),
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
