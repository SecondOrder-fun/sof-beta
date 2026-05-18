/**
 * seasonStatusListener.js
 *
 * Listens for 5 season status-transition events that are not handled by
 * seasonStartedListener or seasonCompletedListener:
 *
 *   SeasonCreated         → status 0 (NotStarted), write full config row
 *   SeasonLocked          → trading_locked = true
 *   SeasonEndRequested    → status 2 (EndRequested), store vrf_request_id
 *   SeasonReadyToFinalize → status 4 (Distributing)
 *   SeasonCancelled       → status 6 (Cancelled), trading_locked = true
 *
 * SeasonStatus enum (RaffleStorage.sol):
 *   0 NotStarted | 1 Active | 2 EndRequested | 3 VRFPending
 *   4 Distributing | 5 Completed | 6 Cancelled
 *
 * Each event gets its own block cursor and polling loop so they can advance
 * independently. All follow the same startContractEventPolling pattern used
 * by other listeners in this directory.
 */

import { publicClient } from "../lib/viemClient.js";
import { db } from "../../shared/supabaseClient.js";
import { getChainByKey } from "../config/chain.js";
import {
  getContractEventsInChunks,
  startContractEventPolling,
} from "../lib/contractEventPolling.js";
import { createBlockCursor } from "../lib/blockCursor.js";
import { getSSEChannelService } from "../services/sseChannelService.js";

// SeasonStatus enum values (matches RaffleStorage.sol)
const STATUS = {
  NOT_STARTED: 0,
  ACTIVE: 1,
  END_REQUESTED: 2,
  VRF_PENDING: 3,
  DISTRIBUTING: 4,
  COMPLETED: 5,
  CANCELLED: 6,
};

// ---------------------------------------------------------------------------
// Per-event log processors
// ---------------------------------------------------------------------------

async function processSeasonCreated(log, raffleAddress, raffleAbi, logger, sseService) {
  const { seasonId, name, startTime, endTime, raffleToken, bondingCurve } = log.args;
  const seasonIdNum = Number(seasonId);

  try {
    // Read full details so we can populate every column in one shot
    let status = STATUS.NOT_STARTED;
    let totalParticipants = '0';
    let totalTickets = '0';
    let totalPrizePool = '0';
    let winnerCount = null;
    let grandPrizeBps = null;

    try {
      const { RaffleABI } = await import('@sof/contracts');
      const details = await publicClient.readContract({
        address: raffleAddress,
        abi: RaffleABI,
        functionName: 'getSeasonDetails',
        args: [BigInt(seasonIdNum)],
      });
      // [config, status, totalParticipants, totalTickets, totalPrizePool]
      const cfg = details?.[0] ?? {};
      if (details?.[1] != null) status = Number(details[1]);
      if (details?.[2] != null) totalParticipants = details[2].toString();
      if (details?.[3] != null) totalTickets = details[3].toString();
      if (details?.[4] != null) totalPrizePool = details[4].toString();
      winnerCount = cfg.winnerCount != null ? Number(cfg.winnerCount) : null;
      grandPrizeBps = cfg.grandPrizeBps != null ? Number(cfg.grandPrizeBps) : null;
    } catch (readErr) {
      logger.warn(`[SEASON_STATUS_LISTENER] getSeasonDetails failed for SeasonCreated ${seasonIdNum}: ${readErr.message}`);
    }

    await db.upsertSeasonContractRow(seasonIdNum, {
      bonding_curve_address: bondingCurve?.toLowerCase() ?? null,
      raffle_token_address: raffleToken?.toLowerCase() ?? null,
      raffle_address: raffleAddress?.toLowerCase() ?? null,
      is_active: false,
      created_block: Number(log.blockNumber),
      name: name ?? null,
      start_time: startTime != null ? Number(startTime) : null,
      end_time: endTime != null ? Number(endTime) : null,
      winner_count: winnerCount,
      grand_prize_bps: grandPrizeBps,
      status,
      total_participants: totalParticipants,
      total_tickets: totalTickets,
      total_prize_pool: totalPrizePool,
    });

    logger.info(`[SEASON_STATUS_LISTENER] SeasonCreated: season ${seasonIdNum} written to DB`);

    // Seed curve_state for the freshly-deployed bonding curve. Without this
    // the frontend's useCurveState would 404 on every Upcoming/NotStarted
    // season until a Trade or SeasonStarted event fires.
    if (bondingCurve && bondingCurve !== '0x0000000000000000000000000000000000000000') {
      try {
        const { SOFBondingCurveABI } = await import('@sof/contracts');
        const results = await publicClient.multicall({
          contracts: [
            { address: bondingCurve, abi: SOFBondingCurveABI, functionName: 'curveConfig' },
            { address: bondingCurve, abi: SOFBondingCurveABI, functionName: 'getCurrentStep' },
            { address: bondingCurve, abi: SOFBondingCurveABI, functionName: 'accumulatedFees' },
            { address: bondingCurve, abi: SOFBondingCurveABI, functionName: 'getBondSteps' },
            { address: bondingCurve, abi: SOFBondingCurveABI, functionName: 'treasuryAddress' },
          ],
          allowFailure: true,
        });
        const curveCfg = results[0]?.status === 'success' ? results[0].result : null;
        const currentStep = results[1]?.status === 'success' ? results[1].result : null;
        const accumulatedFees = results[2]?.status === 'success' ? results[2].result : null;
        const bondSteps = results[3]?.status === 'success' ? results[3].result : null;
        const treasuryAddr = results[4]?.status === 'success' ? results[4].result : null;

        const stepsJson = Array.isArray(bondSteps)
          ? bondSteps.map((s) => ({
              rangeTo: s.rangeTo?.toString?.() ?? s[0]?.toString?.() ?? '0',
              price: s.price?.toString?.() ?? s[1]?.toString?.() ?? '0',
            }))
          : null;

        await db.upsertCurveState(bondingCurve, {
          current_supply: curveCfg ? (curveCfg[0]?.toString?.() ?? '0') : '0',
          sof_reserves: curveCfg ? (curveCfg[1]?.toString?.() ?? '0') : '0',
          accumulated_fees: accumulatedFees != null ? accumulatedFees.toString() : '0',
          current_step_index: currentStep ? Number(currentStep[0]) : null,
          current_step_price: currentStep ? currentStep[1].toString() : null,
          current_step_range_to: currentStep ? currentStep[2].toString() : null,
          bond_steps: stepsJson,
          treasury_address: treasuryAddr?.toLowerCase() ?? null,
          last_updated_block: Number(log.blockNumber),
        });
        logger.info(`[SEASON_STATUS_LISTENER] curve_state seeded for ${bondingCurve}`);
      } catch (curveErr) {
        logger.warn(`[SEASON_STATUS_LISTENER] curve_state seed failed for season ${seasonIdNum}: ${curveErr.message}`);
      }
    }

    if (sseService) {
      sseService.broadcast('raffle', {
        type: 'SeasonStatusChanged',
        event: 'SeasonCreated',
        seasonId: seasonIdNum,
        status,
        tradingLocked: false,
        blockNumber: Number(log.blockNumber),
        txHash: log.transactionHash,
      });
    }
  } catch (err) {
    logger.error(`[SEASON_STATUS_LISTENER] SeasonCreated handler failed for season ${seasonIdNum}: ${err.message}`);
  }
}

async function processSeasonLocked(log, _raffleAddress, _raffleAbi, logger, sseService) {
  const { seasonId } = log.args;
  const seasonIdNum = Number(seasonId);

  try {
    await db.updateSeasonStatus(seasonIdNum, { trading_locked: true });

    logger.info(`[SEASON_STATUS_LISTENER] SeasonLocked: season ${seasonIdNum} trading_locked=true`);

    if (sseService) {
      sseService.broadcast('raffle', {
        type: 'SeasonStatusChanged',
        event: 'SeasonLocked',
        seasonId: seasonIdNum,
        status: null, // status unchanged — still Active
        tradingLocked: true,
        blockNumber: Number(log.blockNumber),
        txHash: log.transactionHash,
      });
    }
  } catch (err) {
    logger.error(`[SEASON_STATUS_LISTENER] SeasonLocked handler failed for season ${seasonIdNum}: ${err.message}`);
  }
}

async function processSeasonEndRequested(log, _raffleAddress, _raffleAbi, logger, sseService) {
  const { seasonId, vrfRequestId } = log.args;
  const seasonIdNum = Number(seasonId);

  try {
    await db.updateSeasonStatus(seasonIdNum, {
      status: STATUS.END_REQUESTED,
      vrf_request_id: vrfRequestId != null ? vrfRequestId.toString() : null,
    });

    logger.info(`[SEASON_STATUS_LISTENER] SeasonEndRequested: season ${seasonIdNum} status=EndRequested vrfRequestId=${vrfRequestId}`);

    if (sseService) {
      sseService.broadcast('raffle', {
        type: 'SeasonStatusChanged',
        event: 'SeasonEndRequested',
        seasonId: seasonIdNum,
        status: STATUS.END_REQUESTED,
        vrfRequestId: vrfRequestId != null ? vrfRequestId.toString() : null,
        blockNumber: Number(log.blockNumber),
        txHash: log.transactionHash,
      });
    }
  } catch (err) {
    logger.error(`[SEASON_STATUS_LISTENER] SeasonEndRequested handler failed for season ${seasonIdNum}: ${err.message}`);
  }
}

async function processSeasonReadyToFinalize(log, _raffleAddress, _raffleAbi, logger, sseService) {
  const { seasonId } = log.args;
  const seasonIdNum = Number(seasonId);

  try {
    await db.updateSeasonStatus(seasonIdNum, { status: STATUS.DISTRIBUTING });

    logger.info(`[SEASON_STATUS_LISTENER] SeasonReadyToFinalize: season ${seasonIdNum} status=Distributing`);

    if (sseService) {
      sseService.broadcast('raffle', {
        type: 'SeasonStatusChanged',
        event: 'SeasonReadyToFinalize',
        seasonId: seasonIdNum,
        status: STATUS.DISTRIBUTING,
        blockNumber: Number(log.blockNumber),
        txHash: log.transactionHash,
      });
    }
  } catch (err) {
    logger.error(`[SEASON_STATUS_LISTENER] SeasonReadyToFinalize handler failed for season ${seasonIdNum}: ${err.message}`);
  }
}

async function processSeasonCancelled(log, _raffleAddress, _raffleAbi, logger, sseService) {
  const { seasonId } = log.args;
  const seasonIdNum = Number(seasonId);

  try {
    await db.updateSeasonStatus(seasonIdNum, {
      status: STATUS.CANCELLED,
      trading_locked: true,
      is_active: false,
    });

    logger.info(`[SEASON_STATUS_LISTENER] SeasonCancelled: season ${seasonIdNum} status=Cancelled`);

    if (sseService) {
      sseService.broadcast('raffle', {
        type: 'SeasonStatusChanged',
        event: 'SeasonCancelled',
        seasonId: seasonIdNum,
        status: STATUS.CANCELLED,
        tradingLocked: true,
        blockNumber: Number(log.blockNumber),
        txHash: log.transactionHash,
      });
    }
  } catch (err) {
    logger.error(`[SEASON_STATUS_LISTENER] SeasonCancelled handler failed for season ${seasonIdNum}: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// Event → handler mapping
// ---------------------------------------------------------------------------

const EVENT_HANDLERS = [
  { eventName: 'SeasonCreated',         process: processSeasonCreated },
  { eventName: 'SeasonLocked',          process: processSeasonLocked },
  { eventName: 'SeasonEndRequested',    process: processSeasonEndRequested },
  { eventName: 'SeasonReadyToFinalize', process: processSeasonReadyToFinalize },
  { eventName: 'SeasonCancelled',       process: processSeasonCancelled },
];

// ---------------------------------------------------------------------------
// Historical scan (shared helper)
// ---------------------------------------------------------------------------

async function scanHistoricalEvents(raffleAddress, raffleAbi, eventName, handler, logger, _sseService) {
  try {
    const currentBlock = await publicClient.getBlockNumber();
    const chain = getChainByKey(process.env.NETWORK);
    const lookbackBlocks = chain.lookbackBlocks;
    const fromBlock = currentBlock > lookbackBlocks ? currentBlock - lookbackBlocks : 0n;

    logger.info(`[SEASON_STATUS_LISTENER] Scanning historical ${eventName} from block ${fromBlock}...`);

    const logs = await getContractEventsInChunks({
      client: publicClient,
      address: raffleAddress,
      abi: raffleAbi,
      eventName,
      fromBlock,
      toBlock: currentBlock,
      maxBlockRange: 2_000n,
      maxRetries: 5,
    });

    if (logs.length > 0) {
      logger.info(`[SEASON_STATUS_LISTENER] Found ${logs.length} historical ${eventName} event(s)`);
      for (const log of logs) {
        // No SSE broadcast for historical events — no clients connected yet
        await handler(log, raffleAddress, raffleAbi, logger, null);
      }
    }
  } catch (err) {
    logger.error(`[SEASON_STATUS_LISTENER] Historical scan for ${eventName} failed: ${err.message}`);
    // Don't throw — continue with real-time listener
  }
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Start polling for 5 season status-transition events.
 * Returns an array of unwatch functions (one per event).
 *
 * @param {string} raffleAddress - Raffle contract address
 * @param {object} raffleAbi - Raffle contract ABI
 * @param {object} logger - Fastify logger instance
 * @returns {Promise<Array<() => void>>} Array of unwatch functions
 */
export async function startSeasonStatusListener(raffleAddress, raffleAbi, logger) {
  if (!raffleAddress || !raffleAbi) {
    throw new Error('raffleAddress and raffleAbi are required');
  }
  if (!logger) {
    throw new Error('logger instance is required');
  }

  const sseService = getSSEChannelService(logger);
  const unwatches = [];

  for (const { eventName, process: handler } of EVENT_HANDLERS) {
    // Historical backfill first
    await scanHistoricalEvents(raffleAddress, raffleAbi, eventName, handler, logger, sseService);

    // Persistent block cursor per event
    const blockCursor = await createBlockCursor(`${raffleAddress}:${eventName}`);

    const unwatch = await startContractEventPolling({
      client: publicClient,
      address: raffleAddress,
      abi: raffleAbi,
      eventName,
      pollingIntervalMs: 3_000,
      maxBlockRange: 2_000n,
      blockCursor,
      onLogs: async (logs) => {
        for (const log of logs) {
          await handler(log, raffleAddress, raffleAbi, logger, sseService);
        }
      },
      onError: (error) => {
        try {
          logger.error(
            {
              errorDetails: {
                type: error?.name ?? 'Unknown',
                message: error?.message ?? String(error),
              },
            },
            `[SEASON_STATUS_LISTENER] ${eventName} polling error`,
          );
        } catch {
          logger.error(`[SEASON_STATUS_LISTENER] ${eventName} polling error: ${String(error)}`);
        }
      },
    });

    unwatches.push(unwatch);
    logger.info(`🎧 [SEASON_STATUS_LISTENER] Listening for ${eventName} on ${raffleAddress}`);
  }

  return unwatches;
}
