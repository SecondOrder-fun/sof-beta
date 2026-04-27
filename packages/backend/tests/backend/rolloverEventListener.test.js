/**
 * @file rolloverEventListener.test.js
 * @description Unit tests for the RolloverEscrow event listener (cursor-backed
 * polling pattern). Covers: skip when escrow address unconfigured, three
 * pollers + three cursors registered, historical-scan backfill on startup,
 * per-event upsert shape (idempotency via onConflict), error containment,
 * and the combined unwatchAll wiring.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

const viemMocks = vi.hoisted(() => ({
  publicClient: {
    getBlockNumber: vi.fn(async () => 1000n),
  },
}));

const chainMocks = vi.hoisted(() => ({
  mockGetChainByKey: vi.fn(),
}));

const dbMocks = vi.hoisted(() => ({
  mockUpsert: vi.fn(),
  mockFrom: vi.fn(),
}));

const pollingMocks = vi.hoisted(() => ({
  mockGetContractEventsInChunks: vi.fn(),
  mockStartContractEventPolling: vi.fn(),
}));

const cursorMocks = vi.hoisted(() => ({
  mockCreateBlockCursor: vi.fn(),
}));

vi.mock("../../src/lib/viemClient.js", () => ({
  publicClient: viemMocks.publicClient,
}));

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

vi.mock("../../src/lib/contractEventPolling.js", () => ({
  getContractEventsInChunks: (...args) =>
    pollingMocks.mockGetContractEventsInChunks(...args),
  startContractEventPolling: (...args) =>
    pollingMocks.mockStartContractEventPolling(...args),
}));

vi.mock("../../src/lib/blockCursor.js", () => ({
  createBlockCursor: (...args) => cursorMocks.mockCreateBlockCursor(...args),
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
 * Each call to startContractEventPolling registers one poller. Capture the
 * onLogs handlers + return a unique unwatch fn per registration.
 */
function setupPollingCapture() {
  const pollers = [];
  const unwatches = [];
  pollingMocks.mockStartContractEventPolling.mockImplementation(
    async ({ onLogs, onError, blockCursor, eventName }) => {
      pollers.push({ onLogs, onError, blockCursor, eventName });
      const unwatch = vi.fn();
      unwatches.push(unwatch);
      return unwatch;
    },
  );
  return { pollers, unwatches };
}

beforeEach(() => {
  pollingMocks.mockGetContractEventsInChunks.mockReset().mockResolvedValue([]);
  pollingMocks.mockStartContractEventPolling.mockReset();
  cursorMocks.mockCreateBlockCursor
    .mockReset()
    .mockResolvedValue({ get: vi.fn(async () => null), set: vi.fn() });
  chainMocks.mockGetChainByKey.mockReset();
  dbMocks.mockFrom.mockReset();
  dbMocks.mockUpsert.mockReset();
  viemMocks.publicClient.getBlockNumber.mockResolvedValue(1000n);

  // Default: db.client.from(table).upsert(...) succeeds.
  dbMocks.mockFrom.mockImplementation(() => ({
    upsert: (...args) => dbMocks.mockUpsert(...args),
  }));
  dbMocks.mockUpsert.mockResolvedValue({ error: null });
});

describe("startRolloverEventListener", () => {
  describe("startup gating", () => {
    it("returns undefined and warns when rolloverEscrow is empty", async () => {
      chainMocks.mockGetChainByKey.mockReturnValue({
        rolloverEscrow: "",
        rpcUrl: RPC_URL,
      });
      const logger = makeLogger();

      const result = await startRolloverEventListener("LOCAL", logger);

      expect(result).toBeUndefined();
      expect(logger.warn).toHaveBeenCalledOnce();
      expect(logger.warn.mock.calls[0][0]).toMatch(/not configured/);
      expect(pollingMocks.mockStartContractEventPolling).not.toHaveBeenCalled();
    });

    it("registers exactly three pollers + three cursors when rolloverEscrow is set", async () => {
      chainMocks.mockGetChainByKey.mockReturnValue({
        rolloverEscrow: ESCROW_ADDR,
        rpcUrl: RPC_URL,
        lookbackBlocks: 10_000n,
      });
      const { pollers } = setupPollingCapture();
      const logger = makeLogger();

      const unwatchAll = await startRolloverEventListener("LOCAL", logger);

      expect(typeof unwatchAll).toBe("function");
      expect(pollers).toHaveLength(3);
      expect(cursorMocks.mockCreateBlockCursor).toHaveBeenCalledTimes(3);

      // Distinct cursor keys per event so they advance independently.
      const cursorKeys = cursorMocks.mockCreateBlockCursor.mock.calls.map(
        (c) => c[0],
      );
      expect(new Set(cursorKeys).size).toBe(3);
      for (const key of cursorKeys) {
        expect(key).toContain(ESCROW_ADDR);
      }
    });
  });

  describe("historical scan", () => {
    it("scans from currentBlock - lookbackBlocks for each event type", async () => {
      chainMocks.mockGetChainByKey.mockReturnValue({
        rolloverEscrow: ESCROW_ADDR,
        rpcUrl: RPC_URL,
        lookbackBlocks: 10_000n,
      });
      viemMocks.publicClient.getBlockNumber.mockResolvedValue(15_000n);
      setupPollingCapture();
      const logger = makeLogger();

      await startRolloverEventListener("LOCAL", logger);

      // 3 historical scans, one per event type.
      expect(pollingMocks.mockGetContractEventsInChunks).toHaveBeenCalledTimes(
        3,
      );
      const firstCall =
        pollingMocks.mockGetContractEventsInChunks.mock.calls[0][0];
      // 15_000 - 10_000 = 5_000
      expect(firstCall.fromBlock).toBe(5_000n);
      expect(firstCall.toBlock).toBe(15_000n);
      expect(firstCall.address).toBe(ESCROW_ADDR);
    });

    it("clamps fromBlock to 0 when currentBlock < lookbackBlocks", async () => {
      chainMocks.mockGetChainByKey.mockReturnValue({
        rolloverEscrow: ESCROW_ADDR,
        rpcUrl: RPC_URL,
        lookbackBlocks: 10_000n,
      });
      viemMocks.publicClient.getBlockNumber.mockResolvedValue(500n);
      setupPollingCapture();

      await startRolloverEventListener("LOCAL", makeLogger());

      const firstCall =
        pollingMocks.mockGetContractEventsInChunks.mock.calls[0][0];
      expect(firstCall.fromBlock).toBe(0n);
    });

    it("persists historical events found by the scan", async () => {
      chainMocks.mockGetChainByKey.mockReturnValue({
        rolloverEscrow: ESCROW_ADDR,
        rpcUrl: RPC_URL,
        lookbackBlocks: 10_000n,
      });
      // Return one DepositEvent for the first scan call (DEPOSIT).
      pollingMocks.mockGetContractEventsInChunks.mockResolvedValueOnce([
        {
          args: {
            user: USER_ADDR_CHECKSUMMED,
            seasonId: 1n,
            amount: 5_000_000_000_000_000_000n,
          },
          transactionHash: "0xhist1",
          blockNumber: 100n,
        },
      ]);
      setupPollingCapture();

      await startRolloverEventListener("LOCAL", makeLogger());

      expect(dbMocks.mockUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          event_type: "DEPOSIT",
          season_id: 1,
          user_address: USER_ADDR_LOWER,
          amount: "5000000000000000000",
          tx_hash: "0xhist1",
          block_number: 100,
        }),
        { onConflict: "tx_hash,event_type" },
      );
    });
  });

  describe("live event handlers", () => {
    let pollers;

    beforeEach(async () => {
      chainMocks.mockGetChainByKey.mockReturnValue({
        rolloverEscrow: ESCROW_ADDR,
        rpcUrl: RPC_URL,
        lookbackBlocks: 10_000n,
      });
      ({ pollers } = setupPollingCapture());
      await startRolloverEventListener("LOCAL", makeLogger());
    });

    it("RolloverDeposit poller upserts with idempotency key", async () => {
      const depositPoller = pollers.find((p) => p.eventName === "RolloverDeposit");
      expect(depositPoller).toBeDefined();

      await depositPoller.onLogs([
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

    it("RolloverSpend poller upserts with bonus_amount + next_season_id", async () => {
      const spendPoller = pollers.find((p) => p.eventName === "RolloverSpend");
      expect(spendPoller).toBeDefined();

      await spendPoller.onLogs([
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

    it("RolloverRefund poller upserts with REFUND event_type", async () => {
      const refundPoller = pollers.find((p) => p.eventName === "RolloverRefund");
      expect(refundPoller).toBeDefined();

      await refundPoller.onLogs([
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
          amount: "250",
          tx_hash: "0xfeed",
        }),
        { onConflict: "tx_hash,event_type" },
      );
    });

    it("processes a batch of multiple logs in one onLogs call", async () => {
      const depositPoller = pollers.find((p) => p.eventName === "RolloverDeposit");

      await depositPoller.onLogs([
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
    let pollers;

    beforeEach(async () => {
      chainMocks.mockGetChainByKey.mockReturnValue({
        rolloverEscrow: ESCROW_ADDR,
        rpcUrl: RPC_URL,
        lookbackBlocks: 10_000n,
      });
      ({ pollers } = setupPollingCapture());
    });

    it("logs and continues when supabase upsert returns an error", async () => {
      const logger = makeLogger();
      await startRolloverEventListener("LOCAL", logger);

      dbMocks.mockUpsert.mockResolvedValueOnce({
        error: { message: "duplicate key" },
      });

      const depositPoller = pollers.find((p) => p.eventName === "RolloverDeposit");

      await expect(
        depositPoller.onLogs([
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
      const logger = makeLogger();
      await startRolloverEventListener("LOCAL", logger);

      dbMocks.mockUpsert
        .mockResolvedValueOnce({ error: { message: "boom" } })
        .mockResolvedValueOnce({ error: null });

      const depositPoller = pollers.find((p) => p.eventName === "RolloverDeposit");

      await depositPoller.onLogs([
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

    it("invokes onError when the underlying poller errors", async () => {
      const logger = makeLogger();
      await startRolloverEventListener("LOCAL", logger);

      const depositPoller = pollers.find((p) => p.eventName === "RolloverDeposit");
      depositPoller.onError(new Error("rpc reset"));
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe("unwatchAll", () => {
    it("invokes every child unwatch when called", async () => {
      chainMocks.mockGetChainByKey.mockReturnValue({
        rolloverEscrow: ESCROW_ADDR,
        rpcUrl: RPC_URL,
        lookbackBlocks: 10_000n,
      });
      const { unwatches } = setupPollingCapture();

      const unwatchAll = await startRolloverEventListener("LOCAL", makeLogger());
      unwatchAll();

      for (const u of unwatches) expect(u).toHaveBeenCalledOnce();
    });
  });
});
