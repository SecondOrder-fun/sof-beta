// tests/api/delegationRoutes.test.js
// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import fastify from "fastify";

// Set env vars BEFORE route imports
process.env.NETWORK = "TESTNET";
process.env.BACKEND_WALLET_PRIVATE_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
process.env.BACKEND_WALLET_ADDRESS = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

// --- Mock constants ---
const MOCK_SOF_SMART_ACCOUNT = "0xSOFSmartAccount";
const MOCK_USER_ADDRESS = "0xUserEOA";
const MOCK_TX_HASH = "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";

// --- Redis mock ---
const mockRedisClient = {
  incr: vi.fn().mockResolvedValue(1),
  expire: vi.fn().mockResolvedValue(1),
  get: vi.fn().mockResolvedValue(null),
  set: vi.fn().mockResolvedValue("OK"),
};

vi.mock("../../shared/redisClient.js", () => ({
  redisClient: { getClient: () => mockRedisClient },
}));

// --- Auth mock ---
vi.mock("../../shared/auth.js", () => ({
  AuthService: {
    authenticateRequest: vi.fn().mockResolvedValue({ id: "user1", fid: 13837 }),
  },
}));

// --- Chain config mock ---
vi.mock("../../src/config/chain.js", () => ({
  getChainByKey: vi.fn().mockReturnValue({
    sofSmartAccount: MOCK_SOF_SMART_ACCOUNT,
    rpcUrl: "http://mock-rpc",
  }),
}));

// --- viem mocks ---
const mockSendTransaction = vi.fn().mockResolvedValue(MOCK_TX_HASH);
const mockWaitForTransactionReceipt = vi
  .fn()
  .mockResolvedValue({ status: "success" });

vi.mock("viem", () => ({
  createWalletClient: vi.fn().mockReturnValue({
    sendTransaction: mockSendTransaction,
  }),
  createPublicClient: vi.fn().mockReturnValue({
    waitForTransactionReceipt: mockWaitForTransactionReceipt,
  }),
  http: vi.fn(),
}));

vi.mock("viem/experimental", () => ({
  recoverAuthorizationAddress: vi.fn().mockResolvedValue(MOCK_USER_ADDRESS),
}));

vi.mock("viem/accounts", () => ({
  privateKeyToAccount: vi.fn().mockReturnValue({
    address: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
  }),
}));

vi.mock("viem/chains", () => ({
  baseSepolia: { id: 84532, name: "Base Sepolia" },
  base: { id: 8453, name: "Base" },
}));

// --- Helpers ---
const validBody = {
  authorization: {
    address: MOCK_SOF_SMART_ACCOUNT,
    chainId: "0x14a34", // 84532 in hex
    nonce: "0x01",
    yParity: "0x01",
    r: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
    s: "0x5678901234abcdef5678901234abcdef5678901234abcdef5678901234abcdef",
  },
  userAddress: MOCK_USER_ADDRESS,
};

let app;
let AuthService;
let recoverAuthorizationAddress;

beforeAll(async () => {
  const authMod = await import("../../shared/auth.js");
  AuthService = authMod.AuthService;

  const viemExp = await import("viem/experimental");
  recoverAuthorizationAddress = viemExp.recoverAuthorizationAddress;

  const mod = await import("../../fastify/routes/delegationRoutes.js");
  const delegationRoutes = mod.default;

  app = fastify({ logger: false });
  await app.register(delegationRoutes);
  await app.ready();
});

afterAll(async () => {
  if (app) await app.close();
});

beforeEach(() => {
  vi.clearAllMocks();
  // Restore default mock behaviour after clearAllMocks
  AuthService.authenticateRequest.mockResolvedValue({ id: "user1", fid: 13837 });
  recoverAuthorizationAddress.mockResolvedValue(MOCK_USER_ADDRESS);
  mockSendTransaction.mockResolvedValue(MOCK_TX_HASH);
  mockWaitForTransactionReceipt.mockResolvedValue({ status: "success" });
  mockRedisClient.incr.mockResolvedValue(1);
  mockRedisClient.expire.mockResolvedValue(1);
});

describe("POST /delegate", () => {
  it("returns 401 when not authenticated", async () => {
    AuthService.authenticateRequest.mockResolvedValueOnce(null);

    const res = await app.inject({
      method: "POST",
      url: "/delegate",
      payload: validBody,
    });

    expect(res.statusCode).toBe(401);
    const body = JSON.parse(res.body);
    expect(body.error).toBe("Unauthorized");
  });

  it("returns 400 when authorization is missing", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/delegate",
      payload: { userAddress: MOCK_USER_ADDRESS },
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error).toMatch(/Missing authorization/);
  });

  it("returns 400 when userAddress is missing", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/delegate",
      payload: { authorization: validBody.authorization },
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error).toMatch(/Missing authorization/);
  });

  it("returns 400 when authorization target doesn't match SOFSmartAccount", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/delegate",
      payload: {
        authorization: { ...validBody.authorization, address: "0xWrongAddress" },
        userAddress: MOCK_USER_ADDRESS,
      },
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error).toMatch(/Invalid authorization target/);
  });

  it("returns 400 when chainId is 0", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/delegate",
      payload: {
        authorization: { ...validBody.authorization, chainId: "0x0" },
        userAddress: MOCK_USER_ADDRESS,
      },
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error).toMatch(/chainId=0 not allowed/);
  });

  it("returns 400 when chainId doesn't match expected chain", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/delegate",
      payload: {
        authorization: { ...validBody.authorization, chainId: "0x1" }, // chainId 1 = mainnet ETH
        userAddress: MOCK_USER_ADDRESS,
      },
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error).toMatch(/does not match expected chain/);
  });

  it("returns 400 when signature recovery doesn't match userAddress", async () => {
    recoverAuthorizationAddress.mockResolvedValueOnce("0xSomeOtherAddress");

    const res = await app.inject({
      method: "POST",
      url: "/delegate",
      payload: validBody,
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error).toMatch(/does not match userAddress/);
  });

  it("returns 400 when signature recovery throws", async () => {
    recoverAuthorizationAddress.mockRejectedValueOnce(new Error("bad sig"));

    const res = await app.inject({
      method: "POST",
      url: "/delegate",
      payload: validBody,
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error).toMatch(/Invalid authorization signature/);
  });

  it("returns 429 when rate limit exceeded", async () => {
    mockRedisClient.incr.mockResolvedValueOnce(3); // exceeds RATE_LIMIT_MAX=2

    const res = await app.inject({
      method: "POST",
      url: "/delegate",
      payload: validBody,
    });

    expect(res.statusCode).toBe(429);
    const body = JSON.parse(res.body);
    expect(body.error).toMatch(/Rate limit exceeded/);
  });

  it("returns 200 with txHash on successful submission", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/delegate",
      payload: validBody,
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.txHash).toBe(MOCK_TX_HASH);
    expect(body.status).toBe("submitted");

    // Verify sendTransaction was called with the authorization list
    expect(mockSendTransaction).toHaveBeenCalledOnce();
    expect(mockSendTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        authorizationList: [validBody.authorization],
        to: MOCK_USER_ADDRESS,
        data: "0x",
        value: 0n,
      }),
    );
  });

  it("returns 500 when all tx attempts fail", async () => {
    vi.useFakeTimers();
    mockSendTransaction.mockRejectedValue(new Error("tx failed"));

    const resPromise = app.inject({
      method: "POST",
      url: "/delegate",
      payload: validBody,
    });

    // Advance past each retry delay (2000, 5000, 10000)
    await vi.advanceTimersByTimeAsync(2000);
    await vi.advanceTimersByTimeAsync(5000);
    await vi.advanceTimersByTimeAsync(10000);

    const res = await resPromise;

    expect(res.statusCode).toBe(500);
    const body = JSON.parse(res.body);
    expect(body.error).toMatch(/Failed to submit delegation transaction/);
    // Should have retried 3 times
    expect(mockSendTransaction).toHaveBeenCalledTimes(3);

    vi.useRealTimers();
  });
});
