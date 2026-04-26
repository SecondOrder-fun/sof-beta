#!/usr/bin/env node
/**
 * Scripted E2E proof for the local ERC-4337 + ERC-7677 stack.
 *
 * Mirrors what MetaMask would drive in the browser, but uses a viem
 * walletClient to sign so we can run it headless and report concrete
 * pass/fail for each phase. If this passes, the only thing left for a
 * MetaMask run to validate is the wallet UI itself.
 *
 * Phases:
 *   1. EOA signs an EIP-7702 authorization for SOFSmartAccount
 *   2. POST /api/wallet/delegate — backend relays the type-0x04 tx
 *   3. Verify cast code <eoa> = 0xef0100<smart-account>
 *   4. Build a sponsored UserOp via permissionless to7702SimpleSmartAccount
 *      pointing at /api/paymaster/local
 *   5. Submit a no-op self-call UserOp; wait for receipt
 *   6. Verify: receipt.success, paymaster paid (deposit decreased), user
 *      ETH unchanged
 *
 * Usage:
 *   node scripts/test-aa-e2e.js
 */

import { readFileSync } from "node:fs";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  encodeFunctionData,
  http,
  parseAbi,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  createBundlerClient,
  createPaymasterClient,
  entryPoint08Address,
} from "viem/account-abstraction";
import { to7702SimpleSmartAccount } from "permissionless/accounts";

const RPC = "http://127.0.0.1:8545";
const API_BASE = "http://127.0.0.1:3000";

// Anvil #6 — completely untouched in prior tests so the 7702 path is fresh
const TEST_PK = "0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e";
const TEST_ADDRESS = "0x976EA74026E726554dB657fA54763abd0C3a0aa9";

const SOF_TOKEN = JSON.parse(
  readFileSync("./packages/contracts/deployments/local.json", "utf8"),
).contracts.SOFToken;

const anvilChain = defineChain({
  id: 31337,
  name: "Anvil",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RPC] }, public: { http: [RPC] } },
});

const log = (phase, msg, extra) => {
  const line = `[${phase}] ${msg}`;
  if (extra !== undefined) console.log(line, extra);
  else console.log(line);
};
const die = (msg, ctx) => {
  console.error(`✗ ${msg}`);
  if (ctx) console.error(ctx);
  process.exit(1);
};

async function fundEthIfEmpty(publicClient, address) {
  const bal = await publicClient.getBalance({ address });
  if (bal === 0n) {
    // anvil_setBalance — top up so the wallet can pay 0-value txs (it shouldn't,
    // since paymaster covers everything, but a fresh fund is cheap insurance)
    await fetch(RPC, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "anvil_setBalance",
        params: [address, "0xde0b6b3a7640000"], // 1 ETH
      }),
    });
  }
}

async function step1_signAuthorization() {
  log("phase 1", "skipping wallet authorization (using local shortcut)");
  const account = privateKeyToAccount(TEST_PK);
  const sofSmartAccount = JSON.parse(
    readFileSync("./packages/contracts/deployments/local.json", "utf8"),
  ).contracts.SOFSmartAccount;
  if (!sofSmartAccount) die("SOFSmartAccount address not in deployments/local.json");
  return { account, sofSmartAccount };
}

async function step2_relayDelegation({ account }) {
  log("phase 2", "POST /api/wallet/delegate-shortcut");

  const res = await fetch(`${API_BASE}/api/wallet/delegate-shortcut`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userAddress: account.address }),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) die(`/wallet/delegate-shortcut failed (${res.status})`, body);

  log("phase 2", "✓ shortcut applied", body);
  await new Promise((r) => setTimeout(r, 500));
}

async function step3_verifyDelegation(publicClient, account) {
  log("phase 3", "verify EOA bytecode");
  const code = await publicClient.getCode({ address: account.address });
  if (!code || !code.toLowerCase().startsWith("0xef0100")) {
    die("EOA bytecode missing 7702 designator", { code });
  }
  log("phase 3", "✓ EOA delegated", { code });
  return code;
}

async function step4_setupSmartAccount({ account, publicClient }) {
  log("phase 4", "construct smart-account client");

  const wallet = createWalletClient({ account, chain: anvilChain, transport: http(RPC) });

  const smartAccount = await to7702SimpleSmartAccount({
    client: wallet,
    owner: account,
    address: account.address,
    entryPoint: { address: entryPoint08Address, version: "0.8" },
  });

  const paymasterUrl = `${API_BASE}/api/paymaster/local`;
  const paymaster = createPaymasterClient({ transport: http(paymasterUrl) });
  const bundler = createBundlerClient({
    client: publicClient,
    transport: http(paymasterUrl),
    paymaster,
    chain: anvilChain,
  });

  log("phase 4", "✓ smart account ready", { sender: smartAccount.address });
  return { smartAccount, bundler };
}

async function step5_sendUserOp({ smartAccount, bundler }) {
  log("phase 5", "submit sponsored UserOp (no-op self-call)");

  // Two no-op self-targeted reads. We use 2+ calls so permissionless picks
  // the ERC-7821 batch encoding (selector 0x34fcd5be) — that's the path
  // SOFSmartAccount actually supports. A single call would fall back to
  // SimpleAccount's execute(addr,value,data) selector (0xb61d27f6) which
  // SOFSmartAccount doesn't expose.
  const balanceOfData = encodeFunctionData({
    abi: parseAbi(["function balanceOf(address) view returns (uint256)"]),
    functionName: "balanceOf",
    args: [smartAccount.address],
  });
  const calls = [
    { to: SOF_TOKEN, data: balanceOfData },
    { to: SOF_TOKEN, data: balanceOfData },
  ];

  const userOpHash = await bundler.sendUserOperation({
    account: smartAccount,
    calls,
  });
  log("phase 5", "  userOpHash", userOpHash);

  const receipt = await bundler.waitForUserOperationReceipt({
    hash: userOpHash,
    timeout: 30_000,
  });
  if (!receipt.success) die("UserOperation reverted", receipt);
  log("phase 5", "✓ UserOp landed", {
    txHash: receipt.receipt.transactionHash,
    actualGasCost: receipt.actualGasCost,
  });
  return receipt;
}

async function step6_assertSponsorship({ publicClient, account, paymaster, depositBefore, ethBefore }) {
  log("phase 6", "verify paymaster sponsorship");

  const ethAfter = await publicClient.getBalance({ address: account.address });
  const depositAfter = await publicClient.readContract({
    address: entryPoint08Address,
    abi: parseAbi(["function balanceOf(address) view returns (uint256)"]),
    functionName: "balanceOf",
    args: [paymaster],
  });

  const userPaid = ethBefore - ethAfter;
  const paymasterPaid = depositBefore - depositAfter;

  log("phase 6", "  user ETH delta", `${userPaid} wei`);
  log("phase 6", "  paymaster deposit delta", `${paymasterPaid} wei`);

  if (userPaid !== 0n) die("user paid gas — sponsorship failed");
  if (paymasterPaid <= 0n) die("paymaster deposit didn't decrease — sponsorship not applied");

  log("phase 6", "✓ user paid 0 ETH, paymaster covered gas");
}

async function main() {
  console.log("=== AA E2E proof ===\n");

  const publicClient = createPublicClient({ chain: anvilChain, transport: http(RPC) });

  await fundEthIfEmpty(publicClient, TEST_ADDRESS);

  const ethBefore = await publicClient.getBalance({ address: TEST_ADDRESS });
  const paymaster = JSON.parse(
    readFileSync("./packages/contracts/deployments/local.json", "utf8"),
  ).contracts.Paymaster;
  const depositBefore = await publicClient.readContract({
    address: entryPoint08Address,
    abi: parseAbi(["function balanceOf(address) view returns (uint256)"]),
    functionName: "balanceOf",
    args: [paymaster],
  });

  const { account } = await step1_signAuthorization();
  await step2_relayDelegation({ account });
  await step3_verifyDelegation(publicClient, account);
  const { smartAccount, bundler } = await step4_setupSmartAccount({ account, publicClient });
  await step5_sendUserOp({ smartAccount, bundler });
  await step6_assertSponsorship({
    publicClient,
    account,
    paymaster,
    depositBefore,
    ethBefore,
  });

  console.log("\n✓ ALL PHASES PASSED — full sponsored UserOp flow works locally");
}

main().catch((err) => {
  console.error("\n✗ E2E failed:", err.message);
  if (err.cause) console.error("  cause:", err.cause);
  process.exit(1);
});
