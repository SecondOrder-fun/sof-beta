// tests/api/authRoutes.quickAuthBinding.test.js
// @vitest-environment node
//
// Issue #156: the Quick Auth JWT proves FID ownership but not that the FID owns
// the supplied wallet address. /verify must cross-check the address against the
// FID's verified addresses and reject mismatches, else an attacker rotates
// addresses to farm repeated airdrops.

import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  vi,
} from "vitest";
import process from "node:process";
import fastify from "fastify";

const FID = 424242;
const VERIFIED = "0xaaaa000000000000000000000000000000000001";
const UNVERIFIED = "0xbbbb000000000000000000000000000000000002";

const mocks = vi.hoisted(() => ({
  resolveFidVerifiedAddresses: vi.fn(),
  resolveFidToWallet: vi.fn(),
}));

vi.mock("@farcaster/quick-auth", () => ({
  createClient: () => ({
    verifyJwt: vi.fn(async () => ({ sub: String(FID) })),
  }),
}));

vi.mock("../../shared/fidResolverService.js", () => ({
  resolveFidVerifiedAddresses: mocks.resolveFidVerifiedAddresses,
  resolveFidToWallet: mocks.resolveFidToWallet,
}));

vi.mock("../../shared/allowlistService.js", () => ({
  addToAllowlist: vi.fn(async () => ({ success: true })),
}));

vi.mock("../../shared/accessService.js", () => ({
  getUserAccess: vi.fn(async () => ({ level: 1, entry: { id: "e1" } })),
  ACCESS_LEVEL_NAMES: { 1: "user" },
}));

vi.mock("../../shared/accessCache.js", () => ({
  invalidateUserAccessCache: vi.fn(async () => {}),
}));

vi.mock("../../shared/usernameService.js", () => ({
  usernameService: { syncFarcasterUsername: vi.fn(async () => {}) },
}));

vi.mock("../../shared/services/smartAccountService.js", () => ({
  ensureSmartAccount: vi.fn(async () => ({ sma: VERIFIED })),
}));

vi.mock("../../shared/services/smartAccountsDb.js", () => ({
  smartAccountsDb: {},
}));

vi.mock("../../shared/services/adminEoaService.js", () => ({
  ensureAdminFlag: vi.fn(async () => false),
}));

vi.mock("../../shared/services/airdropService.js", () => ({
  getAirdropService: vi.fn(() => ({})),
}));

vi.mock("../../src/lib/viemClient.js", () => ({ publicClient: {} }));

vi.mock("../../shared/auth.js", () => ({
  AuthService: { generateToken: vi.fn(async () => "jwt-token") },
}));

vi.mock("../../shared/redisClient.js", () => ({
  redisClient: { getClient: () => ({ set: vi.fn(async () => {}) }) },
}));

vi.mock("../../shared/farcasterLinkService.js", () => ({
  getLinkedFidForWallet: vi.fn(async () => null),
}));

let app;

beforeAll(async () => {
  process.env.QUICK_AUTH_DOMAINS = "secondorder.fun";
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
  mocks.resolveFidToWallet.mockResolvedValue({
    username: "tester",
    displayName: "Tester",
    pfpUrl: null,
  });
});

describe("POST /verify — farcaster-quick-auth address binding (#156)", () => {
  it("rejects an address not among the FID's verified addresses", async () => {
    mocks.resolveFidVerifiedAddresses.mockResolvedValue([VERIFIED]);

    const res = await app.inject({
      method: "POST",
      url: "/verify",
      payload: {
        method: "farcaster-quick-auth",
        quickAuthToken: "valid.jwt.token",
        address: UNVERIFIED,
      },
    });

    expect(res.statusCode).toBe(403);
    expect(mocks.resolveFidVerifiedAddresses).toHaveBeenCalledWith(FID);
  });

  it("accepts an address that is among the FID's verified addresses", async () => {
    mocks.resolveFidVerifiedAddresses.mockResolvedValue([VERIFIED]);

    const res = await app.inject({
      method: "POST",
      url: "/verify",
      payload: {
        method: "farcaster-quick-auth",
        quickAuthToken: "valid.jwt.token",
        address: VERIFIED,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.token).toBe("jwt-token");
    expect(body.user.address).toBe(VERIFIED);
  });

  it("matches the supplied address case-insensitively", async () => {
    mocks.resolveFidVerifiedAddresses.mockResolvedValue([VERIFIED]);

    const res = await app.inject({
      method: "POST",
      url: "/verify",
      payload: {
        method: "farcaster-quick-auth",
        quickAuthToken: "valid.jwt.token",
        address: VERIFIED.toUpperCase().replace("0X", "0x"),
      },
    });

    expect(res.statusCode).toBe(200);
  });

  it("rejects (fails closed) when the FID has no resolvable verified addresses", async () => {
    mocks.resolveFidVerifiedAddresses.mockResolvedValue([]);

    const res = await app.inject({
      method: "POST",
      url: "/verify",
      payload: {
        method: "farcaster-quick-auth",
        quickAuthToken: "valid.jwt.token",
        address: VERIFIED,
      },
    });

    expect(res.statusCode).toBe(403);
  });
});
