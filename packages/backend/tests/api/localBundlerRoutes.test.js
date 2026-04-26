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

  async function buildService({ network, validityWindowSec, env = {}, redis = null }) {
    process.env.NETWORK = network;
    if (validityWindowSec != null) {
      process.env.PAYMASTER_VALIDITY_WINDOW_SEC = String(validityWindowSec);
    } else {
      delete process.env.PAYMASTER_VALIDITY_WINDOW_SEC;
    }
    // Apply additional env overrides (gas caps, quota). Track keys for cleanup
    // so successive buildService calls don't leak across tests.
    const ENV_KEYS_TO_CLEAN = [
      "PAYMASTER_MAX_CALL_GAS",
      "PAYMASTER_MAX_VERIFICATION_GAS",
      "PAYMASTER_MAX_PAYMASTER_VERIFICATION_GAS",
      "PAYMASTER_MAX_PAYMASTER_POSTOP_GAS",
      "PAYMASTER_QUOTA_PER_HOUR",
    ];
    for (const k of ENV_KEYS_TO_CLEAN) delete process.env[k];
    for (const [k, v] of Object.entries(env)) {
      if (v == null) delete process.env[k];
      else process.env[k] = String(v);
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
      redis,
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
    delete process.env.PAYMASTER_MAX_CALL_GAS;
    delete process.env.PAYMASTER_MAX_VERIFICATION_GAS;
    delete process.env.PAYMASTER_MAX_PAYMASTER_VERIFICATION_GAS;
    delete process.env.PAYMASTER_MAX_PAYMASTER_POSTOP_GAS;
    delete process.env.PAYMASTER_QUOTA_PER_HOUR;
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

describe("createBundlerService — gas caps", () => {
  // Same factory pattern as bounded-validity tests. Reaches into the bundler
  // service so we can exercise pm_getPaymasterData and eth_estimateUserOperationGas
  // under different cap settings without spinning a real Anvil.

  async function buildService({ network, env = {}, redis = null }) {
    process.env.NETWORK = network;
    delete process.env.PAYMASTER_VALIDITY_WINDOW_SEC;
    const ENV_KEYS_TO_CLEAN = [
      "PAYMASTER_MAX_CALL_GAS",
      "PAYMASTER_MAX_VERIFICATION_GAS",
      "PAYMASTER_MAX_PAYMASTER_VERIFICATION_GAS",
      "PAYMASTER_MAX_PAYMASTER_POSTOP_GAS",
      "PAYMASTER_QUOTA_PER_HOUR",
    ];
    for (const k of ENV_KEYS_TO_CLEAN) delete process.env[k];
    for (const [k, v] of Object.entries(env)) {
      if (v == null) delete process.env[k];
      else process.env[k] = String(v);
    }
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
      redis,
    });
  }

  const sender = "0x90F79bf6EB2c4f870365E785982E1f101E93b906";
  const baseOp = {
    sender,
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
  });

  it("TESTNET: rejects userOp claiming callGasLimit above the default 2M cap", async () => {
    const svc = await buildService({ network: "TESTNET" });
    const oversized = { ...baseOp, callGasLimit: "0x2faf080" }; // 50M
    await expect(svc.pm_getPaymasterData(oversized)).rejects.toMatchObject({
      message: expect.stringContaining("callGasLimit"),
      code: -32602,
    });
  });

  it("LOCAL: accepts the same 50M callGasLimit (cap is 8M but exceeding asserted)", async () => {
    // LOCAL default cap is 8M. 50M still exceeds it — but this proves the cap
    // is per-network: with PAYMASTER_MAX_CALL_GAS env override we can lift.
    const svc = await buildService({
      network: "LOCAL",
      env: { PAYMASTER_MAX_CALL_GAS: "100000000" },
    });
    const oversized = { ...baseOp, callGasLimit: "0x2faf080" };
    const res = await svc.pm_getPaymasterData(oversized);
    expect(res.paymasterData).toMatch(/^0x/);
  });

  it("eth_estimateUserOperationGas response is clamped to the cap", async () => {
    const svc = await buildService({
      network: "TESTNET",
      env: { PAYMASTER_MAX_CALL_GAS: "1000000" }, // 1M
    });
    const res = await svc.eth_estimateUserOperationGas(baseOp);
    // suggested 8M, cap 1M → returned 1M
    expect(BigInt(res.callGasLimit)).toBe(1_000_000n);
  });

  it("rejects non-numeric PAYMASTER_MAX_CALL_GAS env", async () => {
    await expect(
      buildService({ network: "TESTNET", env: { PAYMASTER_MAX_CALL_GAS: "lots" } }),
    ).rejects.toThrow(/non-negative integer/);
  });
});

describe("createBundlerService — per-EOA quota", () => {
  // Inject a stub Redis client that mimics ioredis' INCR/EXPIRE semantics so
  // we can drive the quota counter without a real Redis. INCR returns the
  // post-increment integer; EXPIRE is no-op for the test's purpose since we
  // aren't testing TTL behavior.
  // Mimics ioredis' .multi().incr().expire().exec() pipeline. exec returns
  // an array of [err, value] tuples, one per queued command. Plain async
  // .incr / .expire are also exposed in case anything calls them directly.
  function fakeRedis({ failOn } = {}) {
    const store = new Map();
    function makePipeline() {
      const ops = [];
      const pipe = {
        incr(key) {
          ops.push(["incr", key]);
          return pipe;
        },
        expire(key, sec) {
          ops.push(["expire", key, sec]);
          return pipe;
        },
        async exec() {
          return ops.map(([op, key]) => {
            if (failOn === op) return [new Error(`forced ${op} failure`), null];
            if (op === "incr") {
              const next = (store.get(key) ?? 0) + 1;
              store.set(key, next);
              return [null, next];
            }
            return [null, 1];
          });
        },
      };
      return pipe;
    }
    return {
      store,
      multi: makePipeline,
      async incr(key) {
        const next = (store.get(key) ?? 0) + 1;
        store.set(key, next);
        return next;
      },
      async expire() {
        return 1;
      },
    };
  }

  async function buildService({ network, env = {}, redis = null }) {
    process.env.NETWORK = network;
    delete process.env.PAYMASTER_VALIDITY_WINDOW_SEC;
    const ENV_KEYS_TO_CLEAN = [
      "PAYMASTER_MAX_CALL_GAS",
      "PAYMASTER_MAX_VERIFICATION_GAS",
      "PAYMASTER_MAX_PAYMASTER_VERIFICATION_GAS",
      "PAYMASTER_MAX_PAYMASTER_POSTOP_GAS",
      "PAYMASTER_QUOTA_PER_HOUR",
    ];
    for (const k of ENV_KEYS_TO_CLEAN) delete process.env[k];
    for (const [k, v] of Object.entries(env)) {
      if (v == null) delete process.env[k];
      else process.env[k] = String(v);
    }
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
      redis,
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
  });

  it("allows up to PAYMASTER_QUOTA_PER_HOUR sponsored ops, blocks N+1", async () => {
    const redis = fakeRedis();
    const svc = await buildService({
      network: "TESTNET",
      env: { PAYMASTER_QUOTA_PER_HOUR: "3" },
      redis,
    });
    await svc.pm_getPaymasterData(userOp);
    await svc.pm_getPaymasterData(userOp);
    await svc.pm_getPaymasterData(userOp);
    await expect(svc.pm_getPaymasterData(userOp)).rejects.toMatchObject({
      message: expect.stringContaining("quota exceeded"),
      code: -32603,
      data: { reason: "quota_exceeded" },
    });
  });

  it("stub data ALSO consumes quota — closes the free-signature oracle", async () => {
    const redis = fakeRedis();
    const svc = await buildService({
      network: "TESTNET",
      env: { PAYMASTER_QUOTA_PER_HOUR: "2" },
      redis,
    });
    // Stub burns budget too: 2 stub calls → real call rejected.
    await svc.pm_getPaymasterStubData(userOp);
    await svc.pm_getPaymasterStubData(userOp);
    await expect(svc.pm_getPaymasterData(userOp)).rejects.toMatchObject({
      code: -32603,
      data: { reason: "quota_exceeded" },
    });
  });

  it("LOCAL network skips quota entirely (no redis pipeline call)", async () => {
    let calls = 0;
    const redis = {
      multi() {
        calls += 1;
        return { incr() { return this; }, expire() { return this; }, async exec() { return []; } };
      },
    };
    const svc = await buildService({ network: "LOCAL", redis });
    for (let i = 0; i < 5; i++) {
      await svc.pm_getPaymasterData(userOp);
    }
    expect(calls).toBe(0);
  });

  it("fail-closed: redis pipeline INCR errors → -32000 (no silent unbounded)", async () => {
    const redis = fakeRedis({ failOn: "incr" });
    const svc = await buildService({
      network: "TESTNET",
      env: { PAYMASTER_QUOTA_PER_HOUR: "10" },
      redis,
    });
    await expect(svc.pm_getPaymasterData(userOp)).rejects.toMatchObject({
      message: expect.stringContaining("quota check failed"),
      code: -32000,
    });
  });

  it("fail-closed: redis pipeline EXPIRE errors → -32000 (catches the H2 lockout race)", async () => {
    const redis = fakeRedis({ failOn: "expire" });
    const svc = await buildService({
      network: "TESTNET",
      env: { PAYMASTER_QUOTA_PER_HOUR: "10" },
      redis,
    });
    await expect(svc.pm_getPaymasterData(userOp)).rejects.toMatchObject({
      code: -32000,
    });
  });

  it("rejects malformed sender addresses before hitting redis", async () => {
    let multiCalls = 0;
    const redis = {
      multi() {
        multiCalls += 1;
        return { incr() { return this; }, expire() { return this; }, async exec() { return []; } };
      },
    };
    const svc = await buildService({
      network: "TESTNET",
      env: { PAYMASTER_QUOTA_PER_HOUR: "10" },
      redis,
    });
    const garbage = { ...userOp, sender: "not-an-address" };
    await expect(svc.pm_getPaymasterData(garbage)).rejects.toMatchObject({
      message: expect.stringContaining("invalid sender"),
      code: -32602,
    });
    expect(multiCalls).toBe(0);
  });

  it("rejects non-numeric PAYMASTER_QUOTA_PER_HOUR", async () => {
    await expect(
      buildService({ network: "TESTNET", env: { PAYMASTER_QUOTA_PER_HOUR: "many" } }),
    ).rejects.toThrow(/non-negative integer/);
  });

  it("PAYMASTER_QUOTA_PER_HOUR=0 disables quota even on testnet (no redis pipeline calls)", async () => {
    let multiCalls = 0;
    const redis = {
      multi() {
        multiCalls += 1;
        return { incr() { return this; }, expire() { return this; }, async exec() { return []; } };
      },
    };
    const svc = await buildService({
      network: "TESTNET",
      env: { PAYMASTER_QUOTA_PER_HOUR: "0" },
      redis,
    });
    await svc.pm_getPaymasterData(userOp);
    await svc.pm_getPaymasterData(userOp);
    expect(multiCalls).toBe(0);
  });

  it("quota is keyed by chainId — same sender on a different chain has its own counter", async () => {
    // Build an EXTRA service factory that overrides chainId so we exercise
    // the multi-tenant key isolation. Both instances share one Redis store
    // (they would in production behind a shared upstash); each chainId
    // should burn its own bucket independently.
    const redis = fakeRedis();
    process.env.NETWORK = "TESTNET";
    process.env.PAYMASTER_QUOTA_PER_HOUR = "2";
    vi.resetModules();
    const mod = await import("../../shared/aa/bundler.js");
    const { defineChain } = await import("viem");
    const chainBase = defineChain({
      id: 31337,
      name: "anvil",
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: { default: { http: ["http://127.0.0.1:8545"] } },
    });
    const chainOther = defineChain({
      id: 84532,
      name: "base-sepolia",
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: { default: { http: ["http://127.0.0.1:8545"] } },
    });
    const svcA = mod.createBundlerService({
      rpcUrl: "http://127.0.0.1:8545",
      chain: chainBase,
      relayKey: process.env.BACKEND_WALLET_PRIVATE_KEY,
      paymasterAddress: process.env.PAYMASTER_ADDRESS,
      redis,
    });
    const svcB = mod.createBundlerService({
      rpcUrl: "http://127.0.0.1:8545",
      chain: chainOther,
      relayKey: process.env.BACKEND_WALLET_PRIVATE_KEY,
      paymasterAddress: process.env.PAYMASTER_ADDRESS,
      redis,
    });
    // Burn full budget on chain A
    await svcA.pm_getPaymasterData(userOp);
    await svcA.pm_getPaymasterData(userOp);
    await expect(svcA.pm_getPaymasterData(userOp)).rejects.toMatchObject({
      code: -32603,
    });
    // Chain B should still be wide open for the same sender.
    await svcB.pm_getPaymasterData(userOp);
    await svcB.pm_getPaymasterData(userOp);
    // And the keys really are different.
    expect([...redis.store.keys()].sort()).toEqual([
      "paymaster:quota:31337:0x90f79bf6eb2c4f870365e785982e1f101e93b906",
      "paymaster:quota:84532:0x90f79bf6eb2c4f870365e785982e1f101e93b906",
    ]);
    delete process.env.PAYMASTER_QUOTA_PER_HOUR;
  });
});

describe("createBundlerService — default-cap parity", () => {
  // Pin both the LOCAL and REMOTE default cap maps so a future refactor that
  // quietly weakens REMOTE caps gets caught here, not silently in prod.

  it("LOCAL defaults are the documented values", async () => {
    vi.resetModules();
    const mod = await import("../../shared/aa/bundler.js");
    expect(mod._internals.DEFAULT_GAS_CAPS.LOCAL).toEqual({
      callGasLimit: 8_000_000n,
      verificationGasLimit: 1_000_000n,
      paymasterVerificationGasLimit: 500_000n,
      paymasterPostOpGasLimit: 100_000n,
    });
  });

  it("REMOTE defaults are tighter than LOCAL on every field", async () => {
    vi.resetModules();
    const mod = await import("../../shared/aa/bundler.js");
    const { LOCAL, REMOTE } = mod._internals.DEFAULT_GAS_CAPS;
    for (const k of Object.keys(LOCAL)) {
      expect(REMOTE[k]).toBeLessThanOrEqual(LOCAL[k]);
    }
    expect(REMOTE.callGasLimit).toBe(2_000_000n);
    expect(REMOTE.verificationGasLimit).toBe(500_000n);
    expect(REMOTE.paymasterVerificationGasLimit).toBe(200_000n);
    expect(REMOTE.paymasterPostOpGasLimit).toBe(60_000n);
  });
});
