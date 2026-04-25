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
 * We can't deploy via `CREATE` to a specific address, but we own the node,
 * so we inject the runtime bytecode directly with anvil_setCode. The
 * bytecode comes from @account-abstraction/contracts@0.8.0's prebuilt
 * artifact — same code that's verified on-chain at the canonical address.
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
  const { deployedBytecode } = JSON.parse(readFileSync(artifactPath, "utf8"));
  if (!deployedBytecode || deployedBytecode === "0x") {
    throw new Error("EntryPoint artifact has no deployedBytecode");
  }

  const codeBefore = await rpc("eth_getCode", [ENTRYPOINT_V08, "latest"]);
  if (codeBefore === deployedBytecode) {
    console.log(`[aa-setup] EntryPoint v0.8 already at ${ENTRYPOINT_V08} (code matches)`);
    return;
  }

  await rpc("anvil_setCode", [ENTRYPOINT_V08, deployedBytecode]);

  const codeAfter = await rpc("eth_getCode", [ENTRYPOINT_V08, "latest"]);
  if (codeAfter !== deployedBytecode) {
    throw new Error("anvil_setCode did not persist bytecode");
  }

  // Smoke-test a view call: getDepositInfo(address) → (uint112 deposit, bool staked, ...)
  // selector 0x5287ce12, arg = address(0)
  const probe = await rpc("eth_call", [
    { to: ENTRYPOINT_V08, data: "0x5287ce12" + "0".repeat(64) },
    "latest",
  ]);
  if (!probe || probe === "0x") {
    throw new Error("EntryPoint getDepositInfo returned empty — injection may be incomplete");
  }

  console.log(`[aa-setup] EntryPoint v0.8 injected at ${ENTRYPOINT_V08} (${(deployedBytecode.length / 2 - 1)} bytes)`);
}

main().catch((err) => {
  console.error(`[aa-setup] failed: ${err.message}`);
  process.exit(1);
});
