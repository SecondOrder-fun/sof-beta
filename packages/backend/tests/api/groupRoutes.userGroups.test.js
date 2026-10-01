// tests/api/groupRoutes.userGroups.test.js
// @vitest-environment node
//
// GET /user-groups is wallet-keyed: the admin UI (useUserGroups) calls
// /user-groups?wallet=0x…; the old path-param lookup is gone.

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import fastify from "fastify";

const WALLET = "0x1111111111111111111111111111111111111111";

const mocks = vi.hoisted(() => ({
  getUserGroups: vi.fn(),
}));

vi.mock("../../shared/groupService.js", () => ({
  createGroup: vi.fn(),
  getAllGroups: vi.fn(),
  getGroupBySlug: vi.fn(),
  updateGroup: vi.fn(),
  deleteGroup: vi.fn(),
  addUserToGroup: vi.fn(),
  removeUserFromGroup: vi.fn(),
  getUserGroups: mocks.getUserGroups,
  getGroupMembers: vi.fn(),
  isUserInGroup: vi.fn(),
}));

vi.mock("../../shared/adminGuard.js", () => ({
  createRequireAdmin: () => async () => {},
}));

let app;

beforeAll(async () => {
  const mod = await import("../../fastify/routes/groupRoutes.js");
  app = fastify({ logger: false });
  await app.register(mod.default);
  await app.ready();
});

afterAll(async () => {
  if (app) await app.close();
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /user-groups", () => {
  it("returns the wallet's groups", async () => {
    mocks.getUserGroups.mockResolvedValueOnce({
      groups: [{ slug: "vip", name: "VIP" }],
    });

    const res = await app.inject({ method: "GET", url: `/user-groups?wallet=${WALLET}` });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ groups: [{ slug: "vip", name: "VIP" }] });
    expect(mocks.getUserGroups).toHaveBeenCalledWith({ wallet: WALLET });
  });

  it("rejects a request without a wallet", async () => {
    const res = await app.inject({ method: "GET", url: "/user-groups" });
    expect(res.statusCode).toBe(400);
    expect(mocks.getUserGroups).not.toHaveBeenCalled();
  });

  it("no longer serves the path-param lookup", async () => {
    const res = await app.inject({ method: "GET", url: "/user-groups/12345" });
    expect(res.statusCode).toBe(404);
  });
});
