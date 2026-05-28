// tests/listeners/positionUpdateListener.scoping.test.js
// @vitest-environment node
//
// Regression for #144 / #147 follow-through: the scoped reads exclude any
// raffle_transactions row whose bonding_curve_address is NULL. So EVERY write
// path that records a transaction must stamp the curve address — including the
// PositionUpdate listener's historical scan (and its real-time path, which
// shares the same recordTransaction call shape). This test pins the historical
// scan; if it stops passing bondingCurveAddress, live trades would silently
// vanish from the Transaction Log and Token Holders panels.
import { describe, it, expect, beforeEach, vi } from "vitest";

const recordTransaction = vi.fn(() => Promise.resolve({ success: true }));
const getContractEventsInChunks = vi.fn();

vi.mock("../../shared/supabaseClient.js", () => ({ db: {} }));
vi.mock("../../src/lib/viemClient.js", () => ({
  publicClient: {
    getBlockNumber: vi.fn(() => Promise.resolve(5000n)),
    getBlock: vi.fn(() => Promise.resolve({ timestamp: 1700000000n })),
  },
}));
vi.mock("../../src/config/chain.js", () => ({
  getChainByKey: () => ({ lookbackBlocks: 1000n }),
}));
vi.mock("../../src/services/oracleCallService.js", () => ({
  oracleCallService: {},
}));
vi.mock("../../src/services/paymasterService.js", () => ({
  getPaymasterService: () => ({ initialized: false }),
}));
vi.mock("../../src/services/sseChannelService.js", () => ({
  getSSEChannelService: () => ({ broadcast: vi.fn() }),
}));
vi.mock("../../src/services/raffleTransactionService.js", () => ({
  raffleTransactionService: { recordTransaction },
}));
vi.mock("../../src/lib/contractEventPolling.js", () => ({
  getContractEventsInChunks: (...a) => getContractEventsInChunks(...a),
  startContractEventPolling: vi.fn(),
}));
vi.mock("../../src/lib/blockCursor.js", () => ({ createBlockCursor: vi.fn() }));
vi.mock("../../shared/historicalOddsService.js", () => ({
  historicalOddsService: {},
}));

const { scanHistoricalPositionUpdateEvents } = await import(
  "../../src/listeners/positionUpdateListener.js"
);

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

beforeEach(() => {
  recordTransaction.mockClear();
  getContractEventsInChunks.mockReset();
});

describe("scanHistoricalPositionUpdateEvents stamps bonding_curve_address", () => {
  it("passes bondingCurveAddress to recordTransaction for each event", async () => {
    // Sub-threshold log (10 tickets of 1,000,000 supply) so market-creation is
    // skipped and only the recordTransaction path runs.
    getContractEventsInChunks.mockResolvedValue([
      {
        args: {
          seasonId: 3n,
          player: "0xPlayer",
          oldTickets: 0n,
          newTickets: 10n,
          totalTickets: 10n,
        },
        transactionHash: "0xhash",
        blockNumber: 123n,
      },
    ]);

    await scanHistoricalPositionUpdateEvents(
      "0xCurveABC",
      {}, // bondingCurveAbi
      "0xRaffle",
      {}, // raffleAbi
      "0xFactory",
      1_000_000, // maxSupply
      { initialized: false }, // paymasterService
      { broadcast: vi.fn() }, // sseService
      logger,
    );

    expect(recordTransaction).toHaveBeenCalledTimes(1);
    expect(recordTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        seasonId: 3,
        bondingCurveAddress: "0xCurveABC",
      }),
    );
  });
});
