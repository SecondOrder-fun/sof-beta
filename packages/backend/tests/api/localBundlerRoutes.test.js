// @vitest-environment node
// Hits the JSON-RPC dispatcher without a live Anvil; only covers methods that
// don't require chain interaction (chainId, supportedEntryPoints, paymaster
// signing). Full UserOp submission + receipt is exercised by the E2E run
// against a live local stack.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import fastify from "fastify";

process.env.NETWORK = "LOCAL";
process.env.BACKEND_WALLET_PRIVATE_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
process.env.PAYMASTER_ADDRESS = "0x4A679253410272dd5232B3Ff7cF5dbB88f295319";
process.env.LOCAL_RPC_URL = "http://127.0.0.1:8545";

let app;

beforeAll(async () => {
  app = fastify({ logger: false });
  const { default: route } = await import("../../fastify/routes/localBundlerRoutes.js");
  await app.register(route, { prefix: "/api/paymaster/local" });
  await app.ready();
});

afterAll(async () => {
  await app?.close();
});

async function rpc(method, params = []) {
  const res = await app.inject({
    method: "POST",
    url: "/api/paymaster/local/",
    payload: { jsonrpc: "2.0", id: 1, method, params },
  });
  return res.json();
}

describe("local bundler JSON-RPC", () => {
  it("eth_chainId returns 31337", async () => {
    const r = await rpc("eth_chainId");
    expect(r.result).toBe("0x7a69"); // 31337
  });

  it("eth_supportedEntryPoints returns canonical v0.8 address", async () => {
    const r = await rpc("eth_supportedEntryPoints");
    expect(r.result).toEqual(["0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108"]);
  });

  it("unknown method returns JSON-RPC -32601", async () => {
    const r = await rpc("totally_bogus");
    expect(r.error?.code).toBe(-32601);
  });

  it("malformed request returns JSON-RPC -32600", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/paymaster/local/",
      payload: { not: "jsonrpc" },
    });
    const body = res.json();
    expect(body.error?.code).toBe(-32600);
  });

  it("pm_getPaymasterStubData returns 77-byte paymasterData + paymaster address", async () => {
    const userOp = {
      sender: "0x90F79bf6EB2c4f870365E785982E1f101E93b906",
      nonce: "0x0",
      callData: "0x",
      callGasLimit: "0x186a0",
      verificationGasLimit: "0x249f0",
      preVerificationGas: "0xc350",
      maxFeePerGas: "0x3b9aca00",
      maxPriorityFeePerGas: "0x3b9aca00",
      signature: "0x",
    };
    const r = await rpc("pm_getPaymasterStubData", [
      userOp,
      "0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108",
      "0x7a69",
      {},
    ]);
    expect(r.error).toBeUndefined();
    expect(r.result.paymaster.toLowerCase()).toBe(process.env.PAYMASTER_ADDRESS.toLowerCase());
    expect((r.result.paymasterData.length - 2) / 2).toBe(77);
  });

  it("on local (NETWORK=LOCAL) the validity bounds are unbounded (validUntil=0)", async () => {
    // Bundle module reads NETWORK at construction time. Anvil-style local
    // dev sticks with the unbounded sigs the headless E2E expects.
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
    const r = await rpc("pm_getPaymasterData", [
      userOp,
      "0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108",
      "0x7a69",
      {},
    ]);
    expect(r.error).toBeUndefined();
    // validUntil = first 6 bytes of paymasterData; validAfter = next 6.
    expect(r.result.paymasterData.slice(2, 14)).toBe("000000000000");
    expect(r.result.paymasterData.slice(14, 26)).toBe("000000000000");
  });
});

describe("createBundlerService — bounded validity window", () => {
  // The local-bundler route is gated on NETWORK=LOCAL and won't register
  // in testnet/mainnet mode, so we exercise the service factory directly to
  // assert what bundler.getPaymasterData produces under each NETWORK setting.
  // Picks PAYMASTER_VALIDITY_WINDOW_SEC up at module-load time.

  async function buildService({ network, validityWindowSec }) {
    process.env.NETWORK = network;
    if (validityWindowSec != null) {
      process.env.PAYMASTER_VALIDITY_WINDOW_SEC = String(validityWindowSec);
    } else {
      delete process.env.PAYMASTER_VALIDITY_WINDOW_SEC;
    }
    // Drop the cached module so the next import re-runs the top-level env
    // reads inside createBundlerService.
    vi.resetModules();
    const mod = await import("../../shared/aa/bundler.js");
    const { defineChain } = await import("viem");
    const chain = defineChain({
      id: 31337,
      name: "anvil",
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: { default: { http: ["http://127.0.0.1:8545"] } },
    });
    return mod.createBundlerService({
      rpcUrl: "http://127.0.0.1:8545",
      chain,
      relayKey: process.env.BACKEND_WALLET_PRIVATE_KEY,
      paymasterAddress: process.env.PAYMASTER_ADDRESS,
    });
  }

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

  afterAll(() => {
    process.env.NETWORK = "LOCAL";
    delete process.env.PAYMASTER_VALIDITY_WINDOW_SEC;
  });

  it("LOCAL → unbounded (validUntil=0, validAfter=0)", async () => {
    const svc = await buildService({ network: "LOCAL" });
    const res = await svc.pm_getPaymasterData(userOp);
    expect(res.paymasterData.slice(2, 14)).toBe("000000000000");
    expect(res.paymasterData.slice(14, 26)).toBe("000000000000");
  });

  it("TESTNET → 10 min default window: validUntil ≈ now+600s, validAfter ≈ now−30s", async () => {
    const svc = await buildService({ network: "TESTNET" });
    const before = Math.floor(Date.now() / 1000);
    const res = await svc.pm_getPaymasterData(userOp);
    const after = Math.floor(Date.now() / 1000);

    const validUntil = parseInt(res.paymasterData.slice(2, 14), 16);
    const validAfter = parseInt(res.paymasterData.slice(14, 26), 16);

    expect(validUntil).toBeGreaterThanOrEqual(before + 600);
    expect(validUntil).toBeLessThanOrEqual(after + 600);
    expect(validAfter).toBeGreaterThanOrEqual(before - 30);
    expect(validAfter).toBeLessThanOrEqual(after - 30);
    expect(validAfter).toBeLessThan(validUntil);
  });

  it("PAYMASTER_VALIDITY_WINDOW_SEC overrides default — set to 60s", async () => {
    const svc = await buildService({ network: "TESTNET", validityWindowSec: 60 });
    const before = Math.floor(Date.now() / 1000);
    const res = await svc.pm_getPaymasterData(userOp);
    const after = Math.floor(Date.now() / 1000);

    const validUntil = parseInt(res.paymasterData.slice(2, 14), 16);
    expect(validUntil).toBeGreaterThanOrEqual(before + 60);
    expect(validUntil).toBeLessThanOrEqual(after + 60);
  });

  it("PAYMASTER_VALIDITY_WINDOW_SEC=0 → unbounded even on testnet (with loud warn)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const svc = await buildService({ network: "TESTNET", validityWindowSec: 0 });
      const res = await svc.pm_getPaymasterData(userOp);
      expect(res.paymasterData.slice(2, 14)).toBe("000000000000");
      expect(res.paymasterData.slice(14, 26)).toBe("000000000000");
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("UNBOUNDED"),
      );
    } finally {
      warn.mockRestore();
    }
  });

  it("rejects non-numeric PAYMASTER_VALIDITY_WINDOW_SEC", async () => {
    await expect(
      buildService({ network: "TESTNET", validityWindowSec: "abc" }),
    ).rejects.toThrow(/non-negative integer/);
  });

  it("rejects negative PAYMASTER_VALIDITY_WINDOW_SEC", async () => {
    await expect(
      buildService({ network: "TESTNET", validityWindowSec: "-1" }),
    ).rejects.toThrow(/non-negative integer/);
  });

  it("rejects PAYMASTER_VALIDITY_WINDOW_SEC over the daily max", async () => {
    await expect(
      buildService({ network: "TESTNET", validityWindowSec: 86_401 }),
    ).rejects.toThrow(/exceeds max/);
  });
});
