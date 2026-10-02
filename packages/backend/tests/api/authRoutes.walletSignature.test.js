// tests/api/authRoutes.walletSignature.test.js
// @vitest-environment node
//
// The wallet sign-in signature is checked with publicClient.verifyMessage, which
// verifies smart-wallet signatures (ERC-1271 / ERC-6492, e.g. Coinbase Smart
// Wallet) as well as plain EOA ones. viem's standalone verifyMessage only does
// ECDSA recovery, so it rejected every smart-wallet sign-in.

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import fastify from "fastify";

const WALLET = "0xb7278a61aa25c888815afc32ad3cc52ff24fe575";
const NONCE = "abc123";

const mocks = vi.hoisted(() => ({
  verifyMessage: vi.fn(),
  generateToken: vi.fn(async () => "jwt-token"),
  redis: { get: vi.fn(), del: vi.fn(), set: vi.fn() },
}));

vi.mock("../../shared/accessService.js", () => ({
  getUserAccess: vi.fn(async () => ({ level: 1, entry: { id: "e1" } })),
  ACCESS_LEVEL_NAMES: { 1: "user" },
}));
vi.mock("../../shared/usernameService.js", () => ({
  usernameService: { getUsernameByAddress: vi.fn(async () => null) },
}));
vi.mock("../../shared/services/adminEoaService.js", () => ({
  ensureAdminFlag: vi.fn(async () => false),
}));
vi.mock("../../src/lib/viemClient.js", () => ({
  publicClient: { verifyMessage: mocks.verifyMessage },
}));
vi.mock("../../shared/auth.js", () => ({
  AuthService: { generateToken: mocks.generateToken },
}));
vi.mock("../../shared/redisClient.js", () => ({
  redisClient: { getClient: () => mocks.redis },
}));

let app;

beforeAll(async () => {
  const mod = await import("../../fastify/routes/authRoutes.js");
  app = fastify({ logger: false });
  await app.register(mod.default);
  await app.ready();
});

afterAll(async () => {
  if (app) await app.close();
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.redis.get.mockResolvedValue("1");
});

const signIn = () =>
  app.inject({
    method: "POST",
    url: "/verify",
    payload: { method: "wallet", address: WALLET, nonce: NONCE, signature: "0xsig" },
  });

describe("POST /verify — wallet signature", () => {
  it("verifies through the public client, so smart-wallet signatures are accepted", async () => {
    mocks.verifyMessage.mockResolvedValue(true);

    const res = await signIn();

    expect(res.statusCode).toBe(200);
    expect(res.json().token).toBe("jwt-token");
    expect(mocks.verifyMessage).toHaveBeenCalledWith({
      address: WALLET,
      message: `Sign in to SecondOrder.fun\nNonce: ${NONCE}`,
      signature: "0xsig",
    });
  });

  it("rejects a signature the wallet did not make", async () => {
    mocks.verifyMessage.mockResolvedValue(false);
    const res = await signIn();
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe("Invalid signature");
  });

  it("rejects when verification itself fails", async () => {
    mocks.verifyMessage.mockRejectedValue(new Error("rpc down"));
    const res = await signIn();
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe("Signature verification failed");
  });

  it("returns the wallet user shape the frontend stores", async () => {
    mocks.verifyMessage.mockResolvedValue(true);

    const res = await signIn();

    expect(res.statusCode).toBe(200);
    expect(res.json().user).toEqual({
      address: WALLET,
      username: null,
      accessLevel: 1,
      role: "user",
      isAdmin: false,
    });
  });

  it("signs a token keyed by the wallet address alone", async () => {
    mocks.verifyMessage.mockResolvedValue(true);

    await signIn();

    expect(mocks.generateToken).toHaveBeenCalledWith({
      id: "e1",
      wallet_address: WALLET,
      role: "user",
    });
  });

  it("rejects any method other than wallet", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/verify",
      payload: { method: "email", nonce: NONCE, signature: "0xsig" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("method must be one of: wallet");
    expect(mocks.verifyMessage).not.toHaveBeenCalled();
  });

  it("does not verify without a live nonce", async () => {
    mocks.redis.get.mockResolvedValue(null);
    const res = await signIn();
    expect(res.statusCode).toBe(401);
    expect(mocks.verifyMessage).not.toHaveBeenCalled();
  });
});
