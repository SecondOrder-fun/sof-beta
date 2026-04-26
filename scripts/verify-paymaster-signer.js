#!/usr/bin/env node
/**
 * Verify the paymaster RPC is signing with the expected verifyingSigner.
 *
 * Used post-rotation (see docs/02-architecture/paymaster-signer-rotation.md
 * §3.4) to confirm the bundler picked up the new BACKEND_WALLET_PRIVATE_KEY.
 *
 * Sends a probe pm_getPaymasterStubData, recovers the signer from the
 * returned paymasterData, and asserts equality with --expect-signer.
 *
 * Usage:
 *   node scripts/verify-paymaster-signer.js \
 *     --rpc https://api.sof.fun/api/paymaster/local \
 *     --paymaster 0x... \
 *     --chain-id 84532 \
 *     --expect-signer 0x... \
 *     [--sender 0x...]   # override default probe sender for non-local chains
 *
 * Local default (no flags): hits http://127.0.0.1:3000/api/paymaster/local
 * with the local-deployed paymaster + the Anvil deployer address. On testnet
 * a real bundler may reject the default Anvil-#4 sender (undeployed account
 * or stale nonce); pass --sender to override with a known-clean EOA.
 */

import { readFileSync } from "node:fs";
import { hashMessage, recoverAddress, parseAbiParameters, encodeAbiParameters, keccak256 } from "viem";

// ─── arg parsing ──────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      out[key] = next;
      i++;
    } else {
      out[key] = true;
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));

// Local defaults so the script is useful for smoke tests without flags.
const RPC_URL = args.rpc || "http://127.0.0.1:3000/api/paymaster/local";
const CHAIN_ID = Number(args["chain-id"] ?? 31337);
const EXPECT_SIGNER = args["expect-signer"];

let PAYMASTER = args.paymaster;
if (!PAYMASTER && CHAIN_ID === 31337) {
  // Read local deployment file as a convenience.
  try {
    PAYMASTER = JSON.parse(
      readFileSync("./packages/contracts/deployments/local.json", "utf8"),
    ).contracts.Paymaster;
  } catch {
    /* fall through to error below */
  }
}

if (!PAYMASTER) {
  console.error("Missing --paymaster <0x...> (no fallback for non-local chains)");
  process.exit(2);
}
if (!EXPECT_SIGNER) {
  console.error("Missing --expect-signer <0x...>");
  process.exit(2);
}

// ─── probe userOp ─────────────────────────────────────────────────────────

// Minimal viem-shape userOp; values match what permissionless typically sends
// for a stub-data request. The contract digest reads sender/nonce/initCode/
// callData/gasLimits/preVerificationGas/gasFees + paymaster prefix bytes,
// so any userOp shape works as long as it round-trips through the digest.
const PROBE_SENDER = args.sender || "0x90F79bf6EB2c4f870365E785982E1f101E93b906";
const PROBE_USER_OP = {
  sender: PROBE_SENDER, // anvil #4 default — pass --sender on testnet/mainnet
  nonce: "0x0",
  callData: "0x",
  callGasLimit: "0x186a0",
  verificationGasLimit: "0x249f0",
  preVerificationGas: "0xc350",
  maxFeePerGas: "0x0",
  maxPriorityFeePerGas: "0x0",
  signature: "0x",
};

const ENTRY_POINT_V08 = "0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108";

// ─── helpers (mirror SOFPaymaster.getHash and paymasterSigner.buildPaymasterDigest) ─

function bigFromHex(v) {
  return v == null ? 0n : typeof v === "bigint" ? v : BigInt(v);
}

function packGasFields({ verificationGasLimit, callGasLimit, maxPriorityFeePerGas, maxFeePerGas }) {
  const accountGasLimits = `0x${bigFromHex(verificationGasLimit).toString(16).padStart(32, "0")}${bigFromHex(callGasLimit).toString(16).padStart(32, "0")}`;
  const gasFees = `0x${bigFromHex(maxPriorityFeePerGas).toString(16).padStart(32, "0")}${bigFromHex(maxFeePerGas).toString(16).padStart(32, "0")}`;
  return { accountGasLimits, gasFees };
}

function buildDigest({ userOp, paymasterAddress, chainId, validUntil, validAfter, pmVerif, pmPostOp }) {
  const { accountGasLimits, gasFees } = packGasFields(userOp);
  const initCode = userOp.factory && userOp.factory !== "0x" && userOp.factory != null
    ? `0x${userOp.factory.replace(/^0x/, "")}${(userOp.factoryData ?? "0x").replace(/^0x/, "")}`
    : "0x";
  // paymasterAndData prefix: paymaster (20) + pmVerif (16) + pmPostOp (16).
  // The digest hashes the prefix without trailing validUntil/validAfter/sig.
  const pmPrefix = `0x${paymasterAddress.replace(/^0x/, "").padStart(40, "0")}${pmVerif.toString(16).padStart(32, "0")}${pmPostOp.toString(16).padStart(32, "0")}`;
  const encoded = encodeAbiParameters(
    parseAbiParameters(
      "address,uint256,bytes32,bytes32,bytes32,uint256,bytes32,bytes32,uint256,address,uint48,uint48",
    ),
    [
      userOp.sender,
      bigFromHex(userOp.nonce),
      keccak256(initCode),
      keccak256(userOp.callData ?? "0x"),
      accountGasLimits,
      bigFromHex(userOp.preVerificationGas),
      gasFees,
      keccak256(pmPrefix),
      BigInt(chainId),
      paymasterAddress,
      validUntil,
      validAfter,
    ],
  );
  return keccak256(encoded);
}

// ─── RPC ──────────────────────────────────────────────────────────────────

async function rpc(method, params) {
  const res = await fetch(RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${RPC_URL}`);
  const body = await res.json();
  if (body.error) throw new Error(`${method}: ${body.error.message ?? JSON.stringify(body.error)}`);
  return body.result;
}

// ─── main ─────────────────────────────────────────────────────────────────

async function main() {
  console.log(`[verify] paymaster=${PAYMASTER} chainId=${CHAIN_ID} rpc=${RPC_URL}`);
  console.log(`[verify] expecting signer=${EXPECT_SIGNER.toLowerCase()}`);

  const stub = await rpc("pm_getPaymasterStubData", [
    PROBE_USER_OP,
    ENTRY_POINT_V08,
    `0x${CHAIN_ID.toString(16)}`,
    {},
  ]);

  if (!stub?.paymasterData) {
    throw new Error(`stub response missing paymasterData: ${JSON.stringify(stub)}`);
  }

  // paymasterData layout: validUntil (6 bytes) || validAfter (6 bytes) || signature (65 bytes)
  const data = stub.paymasterData.replace(/^0x/, "");
  if (data.length !== 77 * 2) {
    throw new Error(
      `unexpected paymasterData length: ${data.length / 2} bytes (want 77 = 6 validUntil + 6 validAfter + 65 signature). ` +
      `Either the paymaster is not running our SOFPaymaster (different layout) or the response is corrupt.`,
    );
  }
  const validUntil = BigInt(`0x${data.slice(0, 12)}`);
  const validAfter = BigInt(`0x${data.slice(12, 24)}`);
  const signature = `0x${data.slice(24)}`;

  const pmVerif = bigFromHex(stub.paymasterVerificationGasLimit);
  const pmPostOp = bigFromHex(stub.paymasterPostOpGasLimit);

  const digest = buildDigest({
    userOp: PROBE_USER_OP,
    paymasterAddress: PAYMASTER,
    chainId: CHAIN_ID,
    validUntil,
    validAfter,
    pmVerif,
    pmPostOp,
  });

  const recovered = await recoverAddress({
    hash: hashMessage({ raw: digest }),
    signature,
  });

  console.log(`[verify] recovered signer=${recovered.toLowerCase()}`);
  console.log(`[verify] validUntil=${validUntil} validAfter=${validAfter}`);

  if (recovered.toLowerCase() !== EXPECT_SIGNER.toLowerCase()) {
    console.error(
      `[verify] MISMATCH — bundler is signing with ${recovered.toLowerCase()}, expected ${EXPECT_SIGNER.toLowerCase()}`,
    );
    process.exit(1);
  }
  console.log("[verify] OK — bundler is signing with the expected verifyingSigner");
}

main().catch((err) => {
  console.error(`[verify] failed: ${err.message}`);
  process.exit(1);
});
