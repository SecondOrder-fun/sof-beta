// @vitest-environment node
// season_contracts.quote_token_address and winner_address (migration 024):
// a replay whose on-chain read fails must never write null over a stored
// value, and a row missing its quote token gets it filled.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/lib/viemClient.js", () => ({
  publicClient: { readContract: vi.fn(), multicall: vi.fn() },
  getWalletClient: vi.fn(),
}));
vi.mock("../../src/config/chain.js", () => ({ getChainByKey: vi.fn() }));
vi.mock("../../shared/supabaseClient.js", () => ({
  supabase: { from: vi.fn() },
  db: {
    getSeasonContracts: vi.fn(),
    upsertSeasonContractRow: vi.fn(),
    updateSeasonStatus: vi.fn(),
    setCurveBondSteps: vi.fn(),
    getInfoFiMarketsBySeasonId: vi.fn(async () => []),
    invalidateMarketsCache: vi.fn(),
  },
}));
vi.mock("../../src/services/pokeConsolationEligible.js", () => ({ pokeConsolationEligibleChunked: vi.fn() }));
vi.mock("../../src/services/sseChannelService.js", () => ({ getSSEChannelService: vi.fn() }));
vi.mock("../../src/lib/blockCursor.js", () => ({ createBlockCursor: vi.fn() }));

const { publicClient } = await import("../../src/lib/viemClient.js");
const { db } = await import("../../shared/supabaseClient.js");
const { processSeasonCreated } = await import("../../src/listeners/seasonStatusListener.js");
const { processSeasonCompletedLog } = await import("../../src/listeners/seasonCompletedListener.js");
const { processSeasonStartedLog } = await import("../../src/listeners/seasonStartedListener.js");

const RAFFLE = "0x5000000000000000000000000000000000000005";
const QUOTE = "0xAbC0000000000000000000000000000000000001";
const WINNER = "0xDeF0000000000000000000000000000000000002";
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

const details = (config = {}) => [
  { name: "S1", winnerCount: 3, grandPrizeBps: 6500, quoteToken: QUOTE, ...config },
  1n, 10n, 100n, 1000n,
];

/** readContract by function name; a value that is an Error is thrown. */
function chain(byFn) {
  publicClient.readContract.mockImplementation(async ({ functionName }) => {
    const v = byFn[functionName];
    if (v instanceof Error) throw v;
    return v;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  db.getInfoFiMarketsBySeasonId.mockResolvedValue([]);
});

describe("SeasonCreated (seasonStatusListener)", () => {
  const log = { args: { seasonId: 1n, name: "S1" }, blockNumber: 10n, transactionHash: "0x1" };

  it("writes the quote token, lowercased, when the read succeeds", async () => {
    chain({ getSeasonDetails: details() });
    await processSeasonCreated(log, RAFFLE, [], logger, undefined);
    expect(db.upsertSeasonContractRow.mock.calls[0][1]).toMatchObject({ quote_token_address: QUOTE.toLowerCase() });
  });

  it("does not write null over a stored quote token when the read fails on replay", async () => {
    chain({ getSeasonDetails: new Error("rpc down") });
    db.getSeasonContracts.mockResolvedValue({ status: 1, quote_token_address: QUOTE.toLowerCase() });
    await processSeasonCreated(log, RAFFLE, [], logger, undefined);
    const patch = db.upsertSeasonContractRow.mock.calls[0][1];
    expect(patch).not.toHaveProperty("quote_token_address");
    expect(patch).not.toHaveProperty("winner_count");
    expect(patch).not.toHaveProperty("grand_prize_bps");
  });
});

describe("SeasonCompleted (seasonCompletedListener)", () => {
  const log = { args: { seasonId: 1n }, blockNumber: 20n, transactionHash: "0x2" };

  it("records the winner, lowercased", async () => {
    chain({ getSeasonDetails: details(), getWinners: [WINNER] });
    db.getSeasonContracts.mockResolvedValue({ status: 4, quote_token_address: QUOTE.toLowerCase() });
    await processSeasonCompletedLog(log, RAFFLE, [], logger, undefined, undefined);
    expect(db.updateSeasonStatus.mock.calls[0][1]).toMatchObject({ status: 5, winner_address: WINNER.toLowerCase() });
  });

  it("does not write null over a stored winner when getWinners fails on replay", async () => {
    chain({ getSeasonDetails: details(), getWinners: new Error("rpc down") });
    db.getSeasonContracts.mockResolvedValue({ status: 5, winner_address: WINNER.toLowerCase(), quote_token_address: QUOTE.toLowerCase() });
    await processSeasonCompletedLog(log, RAFFLE, [], logger, undefined, undefined);
    const patch = db.updateSeasonStatus.mock.calls[0][1];
    expect(patch.status).toBe(5);
    expect(patch).not.toHaveProperty("winner_address");
    expect(patch).not.toHaveProperty("quote_token_address"); // already stored
  });

  it("backfills a missing quote token", async () => {
    chain({ getSeasonDetails: details(), getWinners: [WINNER] });
    db.getSeasonContracts.mockResolvedValue({ status: 4, quote_token_address: null });
    await processSeasonCompletedLog(log, RAFFLE, [], logger, undefined, undefined);
    expect(db.updateSeasonStatus.mock.calls[0][1]).toMatchObject({ quote_token_address: QUOTE.toLowerCase() });
  });
});

describe("SeasonStarted (seasonStartedListener)", () => {
  const log = { args: { seasonId: 1n }, blockNumber: 15n, transactionHash: "0x3" };

  it("backfills a missing quote token on a row it otherwise skips", async () => {
    chain({ getSeasonDetails: details() });
    db.getSeasonContracts.mockResolvedValue({ status: 1, quote_token_address: null });
    await processSeasonStartedLog(log, RAFFLE, [], logger, undefined, undefined);
    expect(db.updateSeasonStatus).toHaveBeenCalledWith(1, { quote_token_address: QUOTE.toLowerCase() });
    expect(db.upsertSeasonContractRow).not.toHaveBeenCalled();
  });

  it("leaves a row that already has its quote token alone", async () => {
    db.getSeasonContracts.mockResolvedValue({ status: 1, quote_token_address: QUOTE.toLowerCase() });
    await processSeasonStartedLog(log, RAFFLE, [], logger, undefined, undefined);
    expect(publicClient.readContract).not.toHaveBeenCalled();
    expect(db.updateSeasonStatus).not.toHaveBeenCalled();
  });

  it("omits, rather than nulls, a quote token the config does not carry", async () => {
    chain({ getSeasonDetails: details({ quoteToken: undefined }), getBondSteps: [], treasuryAddress: RAFFLE });
    db.getSeasonContracts.mockResolvedValue(null);
    await processSeasonStartedLog(log, RAFFLE, [], logger, undefined, undefined);
    expect(db.upsertSeasonContractRow.mock.calls[0][1]).not.toHaveProperty("quote_token_address");
  });
});
