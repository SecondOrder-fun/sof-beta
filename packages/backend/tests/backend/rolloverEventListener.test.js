/**
 * @file rolloverEventListener.test.js
 * @description Unit tests for the RolloverEscrow event listener — covers
 * graceful skip when contract is unconfigured, watcher registration, per-event
 * upsert shape (idempotency via onConflict), error containment, and the
 * combined unwatch wiring.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

const viemMocks = vi.hoisted(() => ({
  mockWatchEvent: vi.fn(),
  mockHttp: vi.fn(() => "http-transport-stub"),
  mockCreatePublicClient: vi.fn(),
}));

const chainMocks = vi.hoisted(() => ({
  mockGetChainByKey: vi.fn(),
}));

const dbMocks = vi.hoisted(() => ({
  mockUpsert: vi.fn(),
  mockFrom: vi.fn(),
}));

vi.mock("viem", async () => {
  const actual = await vi.importActual("viem");
  return {
    ...actual,
    createPublicClient: (...args) => viemMocks.mockCreatePublicClient(...args),
    http: (...args) => viemMocks.mockHttp(...args),
  };
});

vi.mock("../../src/config/chain.js", () => ({
  getChainByKey: (...args) => chainMocks.mockGetChainByKey(...args),
}));

vi.mock("../../shared/supabaseClient.js", () => ({
  db: {
    client: {
      from: (...args) => dbMocks.mockFrom(...args),
    },
  },
}));

import { startRolloverEventListener } from "../../src/listeners/rolloverEventListener.js";

const ESCROW_ADDR = "0xB377a2EeD7566Ac9fCb0BA673604F9BF875e2Bab";
const RPC_URL = "http://127.0.0.1:8545";
const USER_ADDR_CHECKSUMMED = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const USER_ADDR_LOWER = USER_ADDR_CHECKSUMMED.toLowerCase();

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

/**
 * Each call to publicClient.watchEvent registers one watcher and returns
 * its unwatch fn. We capture the onLogs handler so tests can fire log
 * events synthetically. Returns { handlers, unwatches } indexed by call order.
 */
function setupWatchEventCapture() {
  const handlers = [];
  const unwatches = [];
  viemMocks.mockWatchEvent.mockImplementation(({ onLogs, onError }) => {
    handlers.push({ onLogs, onError });
    const unwatch = vi.fn();
    unwatches.push(unwatch);
    return unwatch;
  });
  viemMocks.mockCreatePublicClient.mockReturnValue({
    watchEvent: (...args) => viemMocks.mockWatchEvent(...args),
  });
  return { handlers, unwatches };
}

describe("startRolloverEventListener", () => {
  let logger;

  beforeEach(() => {
    logger = makeLogger();
    viemMocks.mockWatchEvent.mockReset();
    viemMocks.mockHttp.mockClear();
    viemMocks.mockCreatePublicClient.mockReset();
    chainMocks.mockGetChainByKey.mockReset();
    dbMocks.mockFrom.mockReset();
    dbMocks.mockUpsert.mockReset();

    // Default: db.client.from(table).upsert(...) returns { error: null }
    dbMocks.mockFrom.mockImplementation(() => ({
      upsert: (...args) => dbMocks.mockUpsert(...args),
    }));
    dbMocks.mockUpsert.mockResolvedValue({ error: null });
  });

  describe("startup gating", () => {
    it("returns undefined and warns when rolloverEscrow is empty", () => {
      chainMocks.mockGetChainByKey.mockReturnValue({
        rolloverEscrow: "",
        rpcUrl: RPC_URL,
      });

      const result = startRolloverEventListener("LOCAL", logger);

      expect(result).toBeUndefined();
      expect(logger.warn).toHaveBeenCalledOnce();
      expect(logger.warn.mock.calls[0][0]).toMatch(/not configured/);
      expect(viemMocks.mockCreatePublicClient).not.toHaveBeenCalled();
    });

    it("returns undefined when rolloverEscrow is undefined", () => {
      chainMocks.mockGetChainByKey.mockReturnValue({
        rolloverEscrow: undefined,
        rpcUrl: RPC_URL,
      });

      expect(startRolloverEventListener("LOCAL", logger)).toBeUndefined();
      expect(viemMocks.mockCreatePublicClient).not.toHaveBeenCalled();
    });

    it("registers exactly three watchers when rolloverEscrow is set", () => {
      chainMocks.mockGetChainByKey.mockReturnValue({
        rolloverEscrow: ESCROW_ADDR,
        rpcUrl: RPC_URL,
      });
      const { handlers } = setupWatchEventCapture();

      const unwatchAll = startRolloverEventListener("LOCAL", logger);

      expect(handlers).toHaveLength(3);
      expect(typeof unwatchAll).toBe("function");
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining(ESCROW_ADDR),
      );
    });
  });

  describe("event handlers", () => {
    let handlers;

    beforeEach(() => {
      chainMocks.mockGetChainByKey.mockReturnValue({
        rolloverEscrow: ESCROW_ADDR,
        rpcUrl: RPC_URL,
      });
      ({ handlers } = setupWatchEventCapture());
      startRolloverEventListener("LOCAL", logger);
    });

    it("RolloverDeposit upserts with lowercased user, stringified amount, and idempotency key", async () => {
      const depositHandler = handlers[0].onLogs;

      await depositHandler([
        {
          args: {
            user: USER_ADDR_CHECKSUMMED,
            seasonId: 1n,
            amount: 5_000_000_000_000_000_000n,
          },
          transactionHash: "0xabc",
          blockNumber: 100n,
        },
      ]);

      expect(dbMocks.mockFrom).toHaveBeenCalledWith("rollover_events");
      expect(dbMocks.mockUpsert).toHaveBeenCalledWith(
        {
          event_type: "DEPOSIT",
          season_id: 1,
          user_address: USER_ADDR_LOWER,
          amount: "5000000000000000000",
          tx_hash: "0xabc",
          block_number: 100,
        },
        { onConflict: "tx_hash,event_type" },
      );
    });

    it("RolloverSpend upserts with baseAmount, bonusAmount, and nextSeasonId", async () => {
      const spendHandler = handlers[1].onLogs;

      await spendHandler([
        {
          args: {
            user: USER_ADDR_CHECKSUMMED,
            seasonId: 1n,
            nextSeasonId: 2n,
            baseAmount: 1_000n,
            bonusAmount: 100n,
          },
          transactionHash: "0xdef",
          blockNumber: 200n,
        },
      ]);

      expect(dbMocks.mockUpsert).toHaveBeenCalledWith(
        {
          event_type: "SPEND",
          season_id: 1,
          user_address: USER_ADDR_LOWER,
          amount: "1000",
          bonus_amount: "100",
          next_season_id: 2,
          tx_hash: "0xdef",
          block_number: 200,
        },
        { onConflict: "tx_hash,event_type" },
      );
    });

    it("RolloverRefund upserts with REFUND event_type", async () => {
      const refundHandler = handlers[2].onLogs;

      await refundHandler([
        {
          args: {
            user: USER_ADDR_CHECKSUMMED,
            seasonId: 1n,
            amount: 250n,
          },
          transactionHash: "0xfeed",
          blockNumber: 300n,
        },
      ]);

      expect(dbMocks.mockUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          event_type: "REFUND",
          season_id: 1,
          user_address: USER_ADDR_LOWER,
          amount: "250",
          tx_hash: "0xfeed",
          block_number: 300,
        }),
        { onConflict: "tx_hash,event_type" },
      );
    });

    it("processes a batch of multiple logs in one onLogs call", async () => {
      const depositHandler = handlers[0].onLogs;

      await depositHandler([
        {
          args: { user: USER_ADDR_CHECKSUMMED, seasonId: 1n, amount: 100n },
          transactionHash: "0x1",
          blockNumber: 10n,
        },
        {
          args: { user: USER_ADDR_CHECKSUMMED, seasonId: 1n, amount: 200n },
          transactionHash: "0x2",
          blockNumber: 11n,
        },
      ]);

      expect(dbMocks.mockUpsert).toHaveBeenCalledTimes(2);
    });
  });

  describe("error containment", () => {
    let handlers;

    beforeEach(() => {
      chainMocks.mockGetChainByKey.mockReturnValue({
        rolloverEscrow: ESCROW_ADDR,
        rpcUrl: RPC_URL,
      });
      ({ handlers } = setupWatchEventCapture());
      startRolloverEventListener("LOCAL", logger);
    });

    it("logs and continues when supabase upsert returns an error", async () => {
      dbMocks.mockUpsert.mockResolvedValueOnce({
        error: { message: "duplicate key" },
      });

      const depositHandler = handlers[0].onLogs;

      await expect(
        depositHandler([
          {
            args: { user: USER_ADDR_CHECKSUMMED, seasonId: 1n, amount: 100n },
            transactionHash: "0xbad",
            blockNumber: 50n,
          },
        ]),
      ).resolves.not.toThrow();

      expect(logger.error).toHaveBeenCalled();
    });

    it("logs and continues when one log in a batch fails — siblings still processed", async () => {
      dbMocks.mockUpsert
        .mockResolvedValueOnce({ error: { message: "boom" } })
        .mockResolvedValueOnce({ error: null });

      const depositHandler = handlers[0].onLogs;

      await depositHandler([
        {
          args: { user: USER_ADDR_CHECKSUMMED, seasonId: 1n, amount: 1n },
          transactionHash: "0xfail",
          blockNumber: 1n,
        },
        {
          args: { user: USER_ADDR_CHECKSUMMED, seasonId: 1n, amount: 2n },
          transactionHash: "0xok",
          blockNumber: 2n,
        },
      ]);

      expect(dbMocks.mockUpsert).toHaveBeenCalledTimes(2);
      expect(logger.error).toHaveBeenCalledOnce();
    });

    it("invokes onError when the underlying watcher errors", () => {
      const onError = handlers[0].onError;
      onError(new Error("rpc reset"));
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe("unwatchAll", () => {
    it("invokes every child unwatch when called", () => {
      chainMocks.mockGetChainByKey.mockReturnValue({
        rolloverEscrow: ESCROW_ADDR,
        rpcUrl: RPC_URL,
      });
      const { unwatches } = setupWatchEventCapture();

      const unwatchAll = startRolloverEventListener("LOCAL", logger);
      unwatchAll();

      for (const u of unwatches) expect(u).toHaveBeenCalledOnce();
    });
  });
});
