// tests/api/rolloverRoutes.test.js
// @vitest-environment node
import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  vi,
} from "vitest";
import fastify from "fastify";

const mockFrom = vi.fn();

vi.mock("../../shared/supabaseClient.js", () => ({
  db: {
    client: {
      from: (...args) => mockFrom(...args),
    },
  },
}));

let app;

/**
 * The route runs db.client.from("rollover_events").select(...).eq(...).eq(...).order(...)
 * Build a thennable chain that records every call so tests can assert filters.
 */
function makeQueryChain(result) {
  const chain = {};
  const calls = [];
  for (const method of ["select", "eq", "order"]) {
    chain[method] = vi.fn((...args) => {
      calls.push({ method, args });
      return chain;
    });
  }
  // The route awaits the final builder — give it a then() so it resolves.
  chain.then = (resolve, reject) => Promise.resolve(result).then(resolve, reject);
  chain._calls = calls;
  return chain;
}

beforeAll(async () => {
  const mod = await import("../../fastify/routes/rolloverRoutes.js");
  const rolloverRoutes = mod.default || mod;
  app = fastify({ logger: false });
  await app.register(rolloverRoutes);
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  mockFrom.mockReset();
});

describe("GET /positions", () => {
  it("returns 400 when wallet query param is missing", async () => {
    const res = await app.inject({ method: "GET", url: "/positions" });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "Invalid wallet address" });
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("returns 400 when wallet is malformed (wrong length)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/positions?wallet=0x1234",
    });
    expect(res.statusCode).toBe(400);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("returns 400 when wallet has no 0x prefix", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/positions?wallet=70997970C51812dc3A010C7d01b50e0d17dc79C8",
    });
    expect(res.statusCode).toBe(400);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("returns 400 when wallet contains non-hex chars", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/positions?wallet=0xZZZZ970C51812dc3A010C7d01b50e0d17dc79C8",
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 200 with empty array when no rollover deposits exist", async () => {
    const chain = makeQueryChain({ data: [], error: null });
    mockFrom.mockReturnValue(chain);

    const res = await app.inject({
      method: "GET",
      url: "/positions?wallet=0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ positions: [] });
  });

  it("maps rows to {seasonId, deposited, depositedAt} shape", async () => {
    const chain = makeQueryChain({
      data: [
        {
          season_id: 2,
          amount: "5000000000000000000",
          created_at: "2026-04-26T10:08:27+00:00",
        },
        {
          season_id: 1,
          amount: "1000000000000000000",
          created_at: "2026-04-25T22:00:00+00:00",
        },
      ],
      error: null,
    });
    mockFrom.mockReturnValue(chain);

    const res = await app.inject({
      method: "GET",
      url: "/positions?wallet=0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      positions: [
        {
          seasonId: 2,
          deposited: "5000000000000000000",
          depositedAt: "2026-04-26T10:08:27+00:00",
        },
        {
          seasonId: 1,
          deposited: "1000000000000000000",
          depositedAt: "2026-04-25T22:00:00+00:00",
        },
      ],
    });
  });

  it("queries rollover_events with lowercased wallet and DEPOSIT filter only", async () => {
    const chain = makeQueryChain({ data: [], error: null });
    mockFrom.mockReturnValue(chain);

    await app.inject({
      method: "GET",
      url: "/positions?wallet=0x70997970C51812DC3A010C7D01B50E0D17DC79C8",
    });

    expect(mockFrom).toHaveBeenCalledWith("rollover_events");
    expect(chain._calls).toEqual([
      { method: "select", args: ["season_id, amount, created_at"] },
      {
        method: "eq",
        args: ["user_address", "0x70997970c51812dc3a010c7d01b50e0d17dc79c8"],
      },
      { method: "eq", args: ["event_type", "DEPOSIT"] },
      { method: "order", args: ["created_at", { ascending: false }] },
    ]);
  });

  it("filters out SPEND/REFUND rows even when supabase returns mixed data", async () => {
    // The eq("event_type", "DEPOSIT") filter is enforced server-side, but
    // we double-check that if the supabase mock surfaces a SPEND row anyway,
    // its bonus_amount / next_season_id don't leak into the response shape.
    const chain = makeQueryChain({
      data: [
        {
          season_id: 1,
          amount: "1000",
          created_at: "2026-04-25T22:00:00+00:00",
          // simulated leak — SPEND fields the route should never return
          bonus_amount: "100",
          next_season_id: 2,
          event_type: "SPEND",
        },
      ],
      error: null,
    });
    mockFrom.mockReturnValue(chain);

    const res = await app.inject({
      method: "GET",
      url: "/positions?wallet=0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.positions[0]).toEqual({
      seasonId: 1,
      deposited: "1000",
      depositedAt: "2026-04-25T22:00:00+00:00",
    });
    // Route shape should not bleed SPEND-only fields
    expect(body.positions[0]).not.toHaveProperty("bonus_amount");
    expect(body.positions[0]).not.toHaveProperty("next_season_id");
    expect(body.positions[0]).not.toHaveProperty("event_type");
  });

  it("returns 500 when supabase returns an error", async () => {
    const chain = makeQueryChain({
      data: null,
      error: { message: "connection lost" },
    });
    mockFrom.mockReturnValue(chain);

    const res = await app.inject({
      method: "GET",
      url: "/positions?wallet=0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
    });

    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: "Internal server error" });
  });
});
