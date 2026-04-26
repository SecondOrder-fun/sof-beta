// @vitest-environment node
//
// paymasterServiceRoutes.js mounts a JSON-RPC dispatcher that ONLY routes
// pm_getPaymasterStubData / pm_getPaymasterData / eth_chainId /
// eth_supportedEntryPoints to the bundler factory. Full-bundler methods
// (eth_sendUserOperation, eth_estimateUserOperationGas, etc.) return
// -32601 — Pimlico is the bundler in production; this endpoint is the
// paymaster only.
//
// The route registers on every NETWORK (LOCAL/TESTNET/MAINNET) with the
// appropriate chain config + RPC + paymaster-address resolution. Quota
// + gas caps + bounded validity all flow through the existing
// createBundlerService factory (PRs #28, #31).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fastify from "fastify";

// Anvil deployer key — used for tests so `privateKeyToAccount(relayKey)`
// inside the factory doesn't throw on missing/invalid key.
const RELAY_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

// We control NETWORK + paymaster resolution per test. Reset env between
// tests so caches inside the factory don't leak (vi.resetModules() handles
// the bundler module cache).
const ENV_KEYS = [
  "NETWORK",
  "BACKEND_WALLET_PRIVATE_KEY",
  "PAYMASTER_ADDRESS",
  "LOCAL_RPC_URL",
  "BASE_SEPOLIA_RPC_URL",
  "BASE_MAINNET_RPC_URL",
  "PAYMASTER_VALIDITY_WINDOW_SEC",
  "PAYMASTER_QUOTA_PER_HOUR",
  "PAYMASTER_MAX_CALL_GAS",
  "PAYMASTER_MAX_PRE_VERIFICATION_GAS",
];
const ORIGINAL_ENV = {};

beforeEach(() => {
  for (const k of ENV_KEYS) ORIGINAL_ENV[k] = process.env[k];
  process.env.BACKEND_WALLET_PRIVATE_KEY = RELAY_KEY;
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (ORIGINAL_ENV[k] === undefined) delete process.env[k];
    else process.env[k] = ORIGINAL_ENV[k];
  }
});

async function buildApp({ network, paymasterOverride, relayKey, rpcUrl } = {}) {
  process.env.NETWORK = network;
  if (paymasterOverride === null) {
    delete process.env.PAYMASTER_ADDRESS;
  } else if (paymasterOverride !== undefined) {
    process.env.PAYMASTER_ADDRESS = paymasterOverride;
  }
  if (relayKey === null) delete process.env.BACKEND_WALLET_PRIVATE_KEY;
  else if (relayKey !== undefined) process.env.BACKEND_WALLET_PRIVATE_KEY = relayKey;
  // Tests using TESTNET/MAINNET need the private RPC env to be set;
  // production refuses to mount with the public fallback. Default to a
  // bogus localhost URL — the route is built at registration time but
  // pm_* test paths don't actually call the RPC for stub data.
  if (network === "TESTNET" && process.env.BASE_SEPOLIA_RPC_URL === undefined) {
    process.env.BASE_SEPOLIA_RPC_URL = rpcUrl ?? "http://127.0.0.1:8545";
  }
  if (network === "MAINNET" && process.env.BASE_MAINNET_RPC_URL === undefined) {
    process.env.BASE_MAINNET_RPC_URL = rpcUrl ?? "http://127.0.0.1:8545";
  }
  vi.resetModules();
  const { default: route } = await import("../../fastify/routes/paymasterServiceRoutes.js");
  const app = fastify({ logger: false });
  await app.register(route, { prefix: "/api/paymaster/sof" });
  await app.ready();
  return app;
}

async function rpc(app, method, params = []) {
  const res = await app.inject({
    method: "POST",
    url: "/api/paymaster/sof/",
    payload: { jsonrpc: "2.0", id: 1, method, params },
  });
  return res.json();
}

const ENTRY_POINT_V08 = "0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108";

const userOp = {
  sender: "0x90F79bf6EB2c4f870365E785982E1f101E93b906",
  nonce: "0x0",
  callData: "0x",
  callGasLimit: "0x186a0",
  verificationGasLimit: "0x249f0",
  preVerificationGas: "0xc350",
  maxFeePerGas: "0x0",
  maxPriorityFeePerGas: "0x0",
  signature: "0x",
};

describe("paymasterServiceRoutes — chain selection", () => {
  it("LOCAL → eth_chainId returns 31337 (anvil)", async () => {
    // Use the local-deployed paymaster. local.json always has it.
    const app = await buildApp({ network: "LOCAL" });
    try {
      const r = await rpc(app, "eth_chainId");
      expect(r.result).toBe("0x7a69"); // 31337
    } finally {
      await app.close();
    }
  });

  it("TESTNET → eth_chainId returns 84532 (Base Sepolia)", async () => {
    // testnet.json doesn't yet have Paymaster but the chainId getter is
    // independent of paymaster resolution, so this should still work.
    const app = await buildApp({
      network: "TESTNET",
      paymasterOverride: "0x4A679253410272dd5232B3Ff7cF5dbB88f295319",
    });
    try {
      const r = await rpc(app, "eth_chainId");
      expect(r.result).toBe("0x14a34"); // 84532
    } finally {
      await app.close();
    }
  });

  it("MAINNET → eth_chainId returns 8453 (Base mainnet)", async () => {
    const app = await buildApp({
      network: "MAINNET",
      paymasterOverride: "0x4A679253410272dd5232B3Ff7cF5dbB88f295319",
    });
    try {
      const r = await rpc(app, "eth_chainId");
      expect(r.result).toBe("0x2105"); // 8453
    } finally {
      await app.close();
    }
  });
});

describe("paymasterServiceRoutes — paymaster-only surface", () => {
  it("eth_supportedEntryPoints returns the canonical v0.8 address", async () => {
    const app = await buildApp({ network: "LOCAL" });
    try {
      const r = await rpc(app, "eth_supportedEntryPoints");
      expect(r.result).toEqual([ENTRY_POINT_V08]);
    } finally {
      await app.close();
    }
  });

  it("pm_getPaymasterStubData routes to the factory and returns 77-byte paymasterData", async () => {
    const app = await buildApp({ network: "LOCAL" });
    try {
      const r = await rpc(app, "pm_getPaymasterStubData", [
        userOp,
        ENTRY_POINT_V08,
        "0x7a69",
        {},
      ]);
      expect(r.error).toBeUndefined();
      expect((r.result.paymasterData.length - 2) / 2).toBe(77);
    } finally {
      await app.close();
    }
  });

  it("pm_getPaymasterData routes to the factory", async () => {
    const app = await buildApp({ network: "LOCAL" });
    try {
      const r = await rpc(app, "pm_getPaymasterData", [
        userOp,
        ENTRY_POINT_V08,
        "0x7a69",
        {},
      ]);
      expect(r.error).toBeUndefined();
      expect(r.result.paymasterData).toMatch(/^0x/);
    } finally {
      await app.close();
    }
  });

  it("eth_sendUserOperation returns -32601 (Pimlico is the bundler)", async () => {
    const app = await buildApp({ network: "LOCAL" });
    try {
      const r = await rpc(app, "eth_sendUserOperation", [userOp, ENTRY_POINT_V08]);
      expect(r.error?.code).toBe(-32601);
      expect(r.error?.message).toMatch(/method not found/i);
    } finally {
      await app.close();
    }
  });

  it("eth_estimateUserOperationGas returns -32601", async () => {
    const app = await buildApp({ network: "LOCAL" });
    try {
      const r = await rpc(app, "eth_estimateUserOperationGas", [userOp]);
      expect(r.error?.code).toBe(-32601);
    } finally {
      await app.close();
    }
  });

  it("eth_getUserOperationReceipt returns -32601", async () => {
    const app = await buildApp({ network: "LOCAL" });
    try {
      const r = await rpc(app, "eth_getUserOperationReceipt", ["0xdeadbeef"]);
      expect(r.error?.code).toBe(-32601);
    } finally {
      await app.close();
    }
  });

  it("malformed JSON-RPC returns -32600", async () => {
    const app = await buildApp({ network: "LOCAL" });
    try {
      const res = await app.inject({
        method: "POST",
        url: "/api/paymaster/sof/",
        payload: { not: "jsonrpc" },
      });
      const body = res.json();
      expect(body.error?.code).toBe(-32600);
    } finally {
      await app.close();
    }
  });

  it("unknown method returns -32601", async () => {
    const app = await buildApp({ network: "LOCAL" });
    try {
      const r = await rpc(app, "totally_bogus");
      expect(r.error?.code).toBe(-32601);
    } finally {
      await app.close();
    }
  });
});

describe("paymasterServiceRoutes — paymaster address resolution", () => {
  it("returns 503 from pm_* methods when paymaster address is unknown for the network", async () => {
    // No PAYMASTER_ADDRESS env override. testnet.json doesn't currently
    // declare Paymaster, so resolution must fail gracefully — not crash the
    // process, not return a malformed sig.
    const app = await buildApp({ network: "TESTNET", paymasterOverride: null });
    try {
      const r = await rpc(app, "pm_getPaymasterData", [
        userOp,
        ENTRY_POINT_V08,
        "0x14a34",
        {},
      ]);
      expect(r.error?.code).toBe(-32603);
      expect(r.error?.message).toMatch(/paymaster.*not.*deployed/i);
      expect(r.error?.data?.reason).toBe("paymaster_not_deployed");
    } finally {
      await app.close();
    }
  });

  it("ignores a non-address PAYMASTER_ADDRESS env value (won't sign with garbage)", async () => {
    // M1: validate via isAddress so a typo / truncated value doesn't make
    // it to the verifying signer. testnet.json has no Paymaster, so the
    // route falls back to "not deployed".
    const app = await buildApp({
      network: "TESTNET",
      paymasterOverride: "0xnotanaddress",
    });
    try {
      const r = await rpc(app, "pm_getPaymasterData", [
        userOp,
        ENTRY_POINT_V08,
        "0x14a34",
        {},
      ]);
      expect(r.error?.code).toBe(-32603);
      expect(r.error?.data?.reason).toBe("paymaster_not_deployed");
    } finally {
      await app.close();
    }
  });

  it("eth_chainId still works even when paymaster is unresolved", async () => {
    // Liveness probes shouldn't depend on paymaster being deployed.
    const app = await buildApp({ network: "TESTNET" });
    try {
      const r = await rpc(app, "eth_chainId");
      expect(r.result).toBe("0x14a34");
    } finally {
      await app.close();
    }
  });
});

describe("paymasterServiceRoutes — userOp param validation (M2)", () => {
  it("pm_getPaymasterStubData with no userOp returns -32602", async () => {
    const app = await buildApp({ network: "LOCAL" });
    try {
      const r = await rpc(app, "pm_getPaymasterStubData", []);
      expect(r.error?.code).toBe(-32602);
      expect(r.error?.message).toMatch(/missing or invalid userOp/i);
    } finally {
      await app.close();
    }
  });

  it("pm_getPaymasterData with userOp missing sender returns -32602", async () => {
    const app = await buildApp({ network: "LOCAL" });
    try {
      const r = await rpc(app, "pm_getPaymasterData", [
        { ...userOp, sender: undefined },
        ENTRY_POINT_V08,
        "0x7a69",
        {},
      ]);
      expect(r.error?.code).toBe(-32602);
      expect(r.error?.message).toMatch(/missing sender/i);
    } finally {
      await app.close();
    }
  });

  it("pm_getPaymasterData with primitive (not object) userOp returns -32602", async () => {
    const app = await buildApp({ network: "LOCAL" });
    try {
      const r = await rpc(app, "pm_getPaymasterData", [null]);
      expect(r.error?.code).toBe(-32602);
    } finally {
      await app.close();
    }
  });
});

describe("paymasterServiceRoutes — production-config safety", () => {
  it("TESTNET refuses to mount when BASE_SEPOLIA_RPC_URL is missing (no public fallback)", async () => {
    // H1: silent public-RPC fallback would let us run but rate-limit under
    // load. Refuse to mount instead.
    delete process.env.BASE_SEPOLIA_RPC_URL;
    process.env.NETWORK = "TESTNET";
    process.env.PAYMASTER_ADDRESS = "0x4A679253410272dd5232B3Ff7cF5dbB88f295319";
    vi.resetModules();
    const { default: route } = await import("../../fastify/routes/paymasterServiceRoutes.js");
    const app = fastify({ logger: false });
    await app.register(route, { prefix: "/api/paymaster/sof" });
    await app.ready();
    try {
      // Route shouldn't have registered any handlers — a POST returns 404.
      const res = await app.inject({
        method: "POST",
        url: "/api/paymaster/sof/",
        payload: { jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] },
      });
      expect(res.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });

  it("TESTNET without BACKEND_WALLET_PRIVATE_KEY mounts a stub returning -32603 (M3)", async () => {
    // Misconfigured deploy on remote — surface loudly via JSON-RPC so
    // monitoring sees it; don't 404 like a missing route.
    const app = await buildApp({
      network: "TESTNET",
      paymasterOverride: "0x4A679253410272dd5232B3Ff7cF5dbB88f295319",
      relayKey: null,
    });
    try {
      const r = await rpc(app, "pm_getPaymasterData", [userOp]);
      expect(r.error?.code).toBe(-32603);
      expect(r.error?.message).toMatch(/BACKEND_WALLET_PRIVATE_KEY/);
      expect(r.error?.data?.reason).toBe("relay_key_missing");
    } finally {
      await app.close();
    }
  });
});
