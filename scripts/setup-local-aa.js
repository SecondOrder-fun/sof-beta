#!/usr/bin/env node
/**
 * Local ERC-4337 bootstrap.
 *
 * On mainnet / Base the canonical EntryPoint v0.8 lives at
 * 0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108. On a freshly-spun Anvil node
 * the address has empty code, which breaks the sponsored-UserOp path:
 *  - permissionless' to7702SimpleSmartAccount expects that address to exist
 *  - SOFPaymaster validateUserOp is called by the EntryPoint
 *
 * We can't `CREATE` to a specific address, so we:
 *   1. Deploy the EntryPoint normally via a transaction (so the constructor
 *      runs and EIP-712 immutables — _hashedName="ERC4337", _hashedVersion="1",
 *      _cachedThis, _cachedDomainSeparator — get inlined into runtime code).
 *   2. Read eth_getCode at the freshly-deployed address.
 *   3. anvil_setCode that bytecode onto the canonical 0x4337... address.
 *      Immutables travel with the bytes since they're encoded as PUSH
 *      constants in the deployed code.
 *
 * Using only the artifact's `deployedBytecode` (placeholder zeros for
 * immutables) yields an EntryPoint whose getUserOpHash uses an empty-string
 * EIP-712 domain — viem signs with name="ERC4337" version="1" and the
 * digests don't match, so every account signature fails AA24.
 *
 * Usage:
 *   node scripts/setup-local-aa.js [rpc]
 * Default rpc: http://127.0.0.1:8545
 *
 * Side effects:
 *   - EntryPoint deployedBytecode at 0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108
 *   - Verifies with eth_getCode and a cheap view call (getDepositInfo)
 */

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const ENTRYPOINT_V08 = "0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108";
// Use a dedicated env var rather than the generic RPC_URL so a sourced
// testnet/mainnet env doesn't accidentally point us at a remote node where
// anvil_setCode is at best a no-op and at worst a footgun against a staging
// Anvil. Explicit CLI arg always wins.
const RPC = process.argv[2] || process.env.LOCAL_AA_RPC_URL || "http://127.0.0.1:8545";

const isLocalUrl = (url) => {
  try {
    const { hostname } = new URL(url);
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "0.0.0.0";
  } catch {
    return false;
  }
};

async function rpc(method, params) {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = await res.json();
  if (body.error) throw new Error(`${method}: ${body.error.message ?? JSON.stringify(body.error)}`);
  return body.result;
}

async function main() {
  if (!isLocalUrl(RPC)) {
    throw new Error(
      `refusing to run anvil_setCode against non-local RPC: ${RPC}. ` +
      `Pass a localhost URL as $1 or set LOCAL_AA_RPC_URL.`,
    );
  }

  const artifactPath = require.resolve("@account-abstraction/contracts/artifacts/EntryPoint.json");
  const { bytecode: creationBytecode } = JSON.parse(readFileSync(artifactPath, "utf8"));
  if (!creationBytecode || creationBytecode === "0x") {
    throw new Error("EntryPoint artifact has no creation bytecode");
  }

  // Anvil dev account #1. We deliberately avoid #0 (the canonical deployer
  // used by `forge script DeployAll`) — bumping its nonce here would shift
  // every contract address produced by the forge deploy, breaking the
  // recorded deployments/local.json mapping.
  const DEPLOYER = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";

  // 1. Deploy normally so the constructor runs and EIP-712 immutables are
  //    inlined into the resulting runtime bytecode.
  const txHash = await rpc("eth_sendTransaction", [
    { from: DEPLOYER, data: creationBytecode, gas: "0x1c9c380" }, // 30M gas
  ]);
  let receipt = null;
  for (let i = 0; i < 20; i++) {
    receipt = await rpc("eth_getTransactionReceipt", [txHash]);
    if (receipt) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  if (!receipt || receipt.status !== "0x1" || !receipt.contractAddress) {
    throw new Error(`EntryPoint deploy failed (txHash=${txHash}): ${JSON.stringify(receipt)}`);
  }
  const deployedAt = receipt.contractAddress;
  const deployedRuntime = await rpc("eth_getCode", [deployedAt, "latest"]);
  if (!deployedRuntime || deployedRuntime === "0x") {
    throw new Error("deployed EntryPoint has no runtime code");
  }

  // 2. Move the post-constructor runtime to the canonical address.
  const codeBefore = await rpc("eth_getCode", [ENTRYPOINT_V08, "latest"]);
  if (codeBefore === deployedRuntime) {
    console.log(`[aa-setup] EntryPoint v0.8 already at ${ENTRYPOINT_V08} (code matches)`);
    return;
  }

  await rpc("anvil_setCode", [ENTRYPOINT_V08, deployedRuntime]);

  const codeAfter = await rpc("eth_getCode", [ENTRYPOINT_V08, "latest"]);
  if (codeAfter !== deployedRuntime) {
    throw new Error("anvil_setCode did not persist bytecode");
  }

  // Smoke-test getDepositInfo(address) — selector 0x5287ce12, arg=address(0).
  const probe = await rpc("eth_call", [
    { to: ENTRYPOINT_V08, data: "0x5287ce12" + "0".repeat(64) },
    "latest",
  ]);
  if (!probe || probe === "0x") {
    throw new Error("EntryPoint getDepositInfo returned empty — injection incomplete");
  }

  // Smoke-test eip712Domain() — selector 0x84b0196e — to confirm the EIP-712
  // immutables are populated (would be empty if the constructor hadn't run).
  const domainProbe = await rpc("eth_call", [
    { to: ENTRYPOINT_V08, data: "0x84b0196e" },
    "latest",
  ]);
  if (!domainProbe || domainProbe === "0x") {
    throw new Error("EntryPoint eip712Domain returned empty");
  }
  // ABI-decoded result includes "ERC4337" and "1" — quick text grep.
  if (!domainProbe.toLowerCase().includes("4552433433333700000000000000000000")) {
    throw new Error("EntryPoint eip712Domain name != ERC4337 — immutables not set");
  }

  // 3. Patch the SenderCreator's `entryPoint` immutable.
  //
  // EntryPoint's constructor deploys a SenderCreator alongside it; SenderCreator's
  // `entryPoint` immutable is set to msg.sender at the time of that deploy —
  // i.e. the original EntryPoint deployment address (`deployedAt`). When we
  // anvil_setCode the EntryPoint runtime onto the canonical address, the
  // SenderCreator stays at its own deterministic address with `entryPoint`
  // still pointing at `deployedAt`. The canonical EntryPoint will still
  // reference the SenderCreator correctly (its `_senderCreator` immutable is
  // the deterministic CREATE address Y, which doesn't change), but when the
  // canonical EntryPoint at 0x4337... calls SenderCreator.createSender(),
  // SenderCreator's `require(msg.sender == entryPoint, "AA97 …")` fails
  // because msg.sender = 0x4337... ≠ deployedAt.
  //
  // Fix: read SenderCreator's runtime bytecode, replace every embedded
  // `deployedAt` immutable with `ENTRYPOINT_V08`, and anvil_setCode it back.
  // Solidity emits one PUSH20 per use site; counting matters — log the count
  // so a future code change that adds new use sites surfaces clearly.
  // senderCreator() selector = 0x09ccb880 (verified via `cast sig`).
  const scAddr = await rpc("eth_call", [
    { to: ENTRYPOINT_V08, data: "0x09ccb880" },
    "latest",
  ]);
  if (!scAddr || scAddr === "0x" || scAddr === "0x" + "0".repeat(64)) {
    throw new Error("EntryPoint.senderCreator() returned empty — cannot patch AA97");
  }
  // Decode address from 32-byte ABI return value (last 20 bytes).
  const senderCreatorAddr = "0x" + scAddr.slice(-40);
  const scCodeBefore = await rpc("eth_getCode", [senderCreatorAddr, "latest"]);
  if (!scCodeBefore || scCodeBefore === "0x") {
    throw new Error(`SenderCreator at ${senderCreatorAddr} has no code`);
  }

  // Find the actual `entryPoint` immutable value by diffing on-chain runtime
  // against the artifact's deployedBytecode. Solidity emits immutables as
  // 32-byte zero placeholders in the artifact (PUSH32 + AND mask). At deploy
  // time the constructor patches those 32-byte windows: an `address`
  // immutable lands RIGHT-ALIGNED in the 32-byte slot — 12 leading zero
  // bytes (carry-over) followed by the 20-byte address. So:
  //   artifact:  00000000000000000000000000000000_00000000000000000000000000000000  (64 hex = 32 bytes)
  //   on-chain:  000000000000000000000000<address-20-bytes>
  // To patch we look for 32-byte zero windows in the artifact, take the LAST
  // 20 bytes of each corresponding on-chain window as the stale immutable
  // value, and overwrite that with the canonical EntryPoint address.
  // Earlier the heuristic looked for 20-byte zero windows and patched the
  // FIRST 20 bytes of each match, which misaligned by 12 bytes and left the
  // real immutable untouched (AA97 still fired).
  const artifactPath2 = require.resolve(
    "@account-abstraction/contracts/artifacts/SenderCreator.json",
  );
  const { deployedBytecode: senderCreatorRuntime } = JSON.parse(
    readFileSync(artifactPath2, "utf8"),
  );
  const artifactBytes = senderCreatorRuntime.toLowerCase().slice(2);
  const onchainBytes = scCodeBefore.toLowerCase().slice(2);
  if (artifactBytes.length !== onchainBytes.length) {
    throw new Error(
      `SenderCreator runtime length mismatch: artifact ${artifactBytes.length}, on-chain ${onchainBytes.length}`,
    );
  }
  // Walk the bytecode 1 byte at a time. When a 32-byte window in the
  // artifact is all zeros and on-chain is non-zero, that's an immutable
  // slot. The address immutable occupies the trailing 20 bytes of the slot;
  // the leading 12 bytes are zero in both artifact and runtime (and stay
  // zero — they're not part of the address).
  let staleHex = null;
  // Each entry: { addrOffsetHex, slotOffsetHex } where addrOffsetHex is the
  // hex-string offset of the 20-byte address window inside `onchainBytes`.
  const occurrenceOffsets = [];
  for (let i = 0; i + 64 <= artifactBytes.length; i += 2) {
    const artifactWindow = artifactBytes.slice(i, i + 64);
    if (artifactWindow !== "0".repeat(64)) continue;
    // Slot is 32 bytes, address sits in the last 20 bytes (last 40 hex chars).
    const addrOffsetHex = i + 24; // 24 hex chars = 12 bytes leading zeros
    const onchainAddr = onchainBytes.slice(addrOffsetHex, addrOffsetHex + 40);
    if (onchainAddr === "0".repeat(40)) continue;
    // Sanity check: the leading 12 bytes of the slot should be zero on-chain.
    const onchainLead = onchainBytes.slice(i, addrOffsetHex);
    if (onchainLead !== "0".repeat(24)) continue;
    if (!staleHex) staleHex = onchainAddr;
    if (onchainAddr === staleHex) occurrenceOffsets.push(addrOffsetHex);
  }
  if (!staleHex || occurrenceOffsets.length === 0) {
    throw new Error("Could not locate entryPoint immutable in SenderCreator");
  }
  const canonicalHex = ENTRYPOINT_V08.toLowerCase().replace(/^0x/, "");
  let scCodePatched = onchainBytes;
  for (const off of occurrenceOffsets) {
    scCodePatched = scCodePatched.slice(0, off) + canonicalHex + scCodePatched.slice(off + 40);
  }
  scCodePatched = "0x" + scCodePatched;
  await rpc("anvil_setCode", [senderCreatorAddr, scCodePatched]);
  const scCodeAfter = await rpc("eth_getCode", [senderCreatorAddr, "latest"]);
  if (scCodeAfter.toLowerCase() !== scCodePatched.toLowerCase()) {
    throw new Error("anvil_setCode on SenderCreator did not persist");
  }

  console.log(
    `[aa-setup] EntryPoint v0.8 injected at ${ENTRYPOINT_V08} (${
      deployedRuntime.length / 2 - 1
    } bytes, deployed via ${deployedAt}); patched SenderCreator at ${senderCreatorAddr} (${occurrenceOffsets.length} immutable refs 0x${staleHex} → 0x${canonicalHex})`,
  );
}

main().catch((err) => {
  console.error(`[aa-setup] failed: ${err.message}`);
  process.exit(1);
});
