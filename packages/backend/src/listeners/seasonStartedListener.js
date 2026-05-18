import { publicClient } from "../lib/viemClient.js";
import { db } from "../../shared/supabaseClient.js";
import { getChainByKey } from "../config/chain.js";
import {
  getContractEventsInChunks,
  startContractEventPolling,
} from "../lib/contractEventPolling.js";
import { createBlockCursor } from "../lib/blockCursor.js";
import { getSSEChannelService } from "../services/sseChannelService.js";

/**
 * Process a SeasonStarted event log
 * @param {object} log - Event log from Viem
 * @param {string} raffleAddress - Raffle contract address
 * @param {object} raffleAbi - Raffle contract ABI
 * @param {object} logger - Logger instance
 * @param {function} onSeasonCreated - Callback for new season
 * @param {object} sseService - SSE channel service instance
 */
async function processSeasonStartedLog(
  log,
  raffleAddress,
  raffleAbi,
  logger,
  onSeasonCreated,
  sseService,
) {
  const { seasonId } = log.args;

  try {
    // Skip only if the row is already at Active or beyond. seasonStatusListener
    // may have written a NotStarted (status=0) row from SeasonCreated; we still
    // need to advance it to Active here.
    const existing = await db.getSeasonContracts(Number(seasonId));
    if (existing && Number(existing.status ?? 0) >= 1) {
      logger.debug(`Season ${seasonId} already at status ${existing.status}, skipping`);
      return;
    }

    // 1. Retrieve season details from contract
    const result = await publicClient.readContract({
      address: raffleAddress,
      abi: raffleAbi,
      functionName: "getSeasonDetails",
      args: [seasonId],
    });

    // Viem returns tuple: [config, status, totalParticipants, totalTickets, totalPrizePool]
    // config is a struct with NAMED properties (not array indices)
    const config = result[0];

    // Extract addresses using named properties
    const { raffleToken, bondingCurve } = config;

    // 2. Store in database
    // Convert seasonId from BigInt to number for database storage
    const seasonIdNum =
      typeof seasonId === "bigint" ? Number(seasonId) : seasonId;
    const createdBlock =
      typeof log.blockNumber === "bigint"
        ? Number(log.blockNumber)
        : log.blockNumber;

    // result tuple: [config, status, totalParticipants, totalTickets, totalPrizePool]
    const statusFromChain = result[1];
    const totalParticipants = result[2];
    const totalTickets = result[3];
    const totalPrizePool = result[4];

    await db.upsertSeasonContractRow(seasonIdNum, {
      bonding_curve_address: bondingCurve?.toLowerCase() ?? null,
      raffle_token_address: raffleToken?.toLowerCase() ?? null,
      raffle_address: raffleAddress?.toLowerCase() ?? null,
      is_active: true,
      created_block: createdBlock,
      // Full season config (available from getSeasonDetails)
      name: config.name ?? null,
      start_time: config.startTime != null ? Number(config.startTime) : null,
      end_time: config.endTime != null ? Number(config.endTime) : null,
      winner_count: config.winnerCount != null ? Number(config.winnerCount) : null,
      grand_prize_bps: config.grandPrizeBps != null ? Number(config.grandPrizeBps) : null,
      // On-chain status (SeasonStatus enum: 1 = Active)
      status: statusFromChain != null ? Number(statusFromChain) : 1,
      total_participants: totalParticipants != null ? totalParticipants.toString() : '0',
      total_tickets: totalTickets != null ? totalTickets.toString() : '0',
      total_prize_pool: totalPrizePool != null ? totalPrizePool.toString() : '0',
    });

    // 3. Log success
    logger.info(`✅ SeasonStarted Event: Season ${seasonId} has started`);
    logger.info(`   BondingCurve: ${bondingCurve}`);
    logger.info(`   RaffleToken: ${raffleToken}`);

    // 4. Seed bond steps into curve_state (immutable per season — cache once)
    if (bondingCurve) {
      try {
        const { SOFBondingCurveABI } = await import('@sof/contracts');
        const [steps, treasuryAddr] = await Promise.all([
          publicClient.readContract({
            address: bondingCurve,
            abi: SOFBondingCurveABI,
            functionName: 'getBondSteps',
          }),
          publicClient.readContract({
            address: bondingCurve,
            abi: SOFBondingCurveABI,
            functionName: 'treasuryAddress',
          }),
        ]);
        const stepsJson = (steps || []).map((s) => ({
          rangeTo: s.rangeTo?.toString?.() ?? s[0]?.toString?.() ?? '0',
          price: s.price?.toString?.() ?? s[1]?.toString?.() ?? '0',
        }));
        await db.setCurveBondSteps(bondingCurve, stepsJson, treasuryAddr);
        logger.info(`   ✅ Bond steps seeded for bonding curve ${bondingCurve}`);
      } catch (e) {
        logger.warn(`[SEASON_STARTED_LISTENER] bond_steps seed failed: ${e.message}`);
      }
    }

    // 5. Broadcast SeasonStarted to raffle SSE channel (after all DB writes)
    if (sseService) {
      sseService.broadcast('raffle', {
        type: 'SeasonStarted',
        seasonId: seasonIdNum,
        blockNumber: Number(log.blockNumber),
        txHash: log.transactionHash,
      });
    }

    // 6. Dynamically start PositionUpdate listener for this season
    if (typeof onSeasonCreated === "function") {
      try {
        await onSeasonCreated({
          seasonId: seasonIdNum,
          bondingCurveAddress: bondingCurve,
          raffleTokenAddress: raffleToken,
        });
      } catch (listenerError) {
        logger.error(
          `❌ Failed to start PositionUpdate listener for season ${seasonIdNum}`,
        );
        logger.error(`   Error: ${listenerError.message}`);
      }
    }
  } catch (error) {
    logger.error(`❌ Failed to process SeasonStarted for season ${seasonId}`);
    logger.error(`   Error: ${error.message}`);
    // Continue listening; don't crash on individual failures
  }
}

/**
 * Scan for historical SeasonStarted events that may have been missed
 * @param {string} raffleAddress - Raffle contract address
 * @param {object} raffleAbi - Raffle contract ABI
 * @param {object} logger - Logger instance
 * @param {function} onSeasonCreated - Callback for new season
 * @param {object} sseService - SSE channel service instance
 */
async function scanHistoricalSeasonEvents(
  raffleAddress,
  raffleAbi,
  logger,
  onSeasonCreated,
  sseService,
) {
  try {
    logger.info("🔍 Scanning for historical SeasonStarted events...");

    // Get current block
    const currentBlock = await publicClient.getBlockNumber();

    // Scan using network-specific lookback blocks
    const chain = getChainByKey(process.env.NETWORK);
    const lookbackBlocks = chain.lookbackBlocks;
    const fromBlock =
      currentBlock > lookbackBlocks ? currentBlock - lookbackBlocks : 0n;

    logger.info(`   Scanning from block ${fromBlock} to ${currentBlock}`);

    // Fetch historical events (chunked + retry/backoff for public RPC stability)
    const logs = await getContractEventsInChunks({
      client: publicClient,
      address: raffleAddress,
      abi: raffleAbi,
      eventName: "SeasonStarted",
      fromBlock,
      toBlock: currentBlock,
      maxBlockRange: 2_000n,
      maxRetries: 5,
    });

    if (logs.length > 0) {
      logger.info(`   Found ${logs.length} historical SeasonStarted event(s)`);

      for (const log of logs) {
        await processSeasonStartedLog(
          log,
          raffleAddress,
          raffleAbi,
          logger,
          onSeasonCreated,
          sseService,
        );
      }
    } else {
      logger.info("   No historical events found");
    }
  } catch (error) {
    logger.error(
      `❌ Failed to scan historical SeasonStarted events: ${error.message}`,
    );
    // Don't throw - continue with real-time listener
  }
}

/**
 * Starts listening for SeasonStarted events from the Raffle contract
 * Retrieves season contract addresses and stores them in the database
 * Dynamically starts PositionUpdate listeners for new seasons
 * @param {string} raffleAddress - Raffle contract address
 * @param {object} raffleAbi - Raffle contract ABI
 * @param {object} logger - Fastify logger instance (app.log)
 * @param {function} onSeasonCreated - Callback to start PositionUpdate listener for new season
 * @returns {function} Unwatch function to stop listening
 */
export async function startSeasonStartedListener(
  raffleAddress,
  raffleAbi,
  logger,
  onSeasonCreated,
) {
  // Validate inputs
  if (!raffleAddress || !raffleAbi) {
    throw new Error("raffleAddress and raffleAbi are required");
  }

  if (!logger) {
    throw new Error("logger instance is required");
  }

  const sseService = getSSEChannelService(logger);

  // First, scan for any historical events we may have missed
  await scanHistoricalSeasonEvents(
    raffleAddress,
    raffleAbi,
    logger,
    onSeasonCreated,
    sseService,
  );

  // Create persistent block cursor for this listener
  const blockCursor = await createBlockCursor(`${raffleAddress}:SeasonStarted`);

  const unwatch = await startContractEventPolling({
    client: publicClient,
    address: raffleAddress,
    abi: raffleAbi,
    eventName: "SeasonStarted",
    pollingIntervalMs: 3_000,
    maxBlockRange: 2_000n,
    blockCursor,
    onLogs: async (logs) => {
      for (const log of logs) {
        await processSeasonStartedLog(
          log,
          raffleAddress,
          raffleAbi,
          logger,
          onSeasonCreated,
          sseService,
        );
      }
    },
    onError: (error) => {
      try {
        const errorDetails = {
          type:
            error && typeof error === "object" && "name" in error
              ? String(error.name)
              : "Unknown",
          message:
            error && typeof error === "object" && "message" in error
              ? String(error.message)
              : String(error),
        };
        logger.error({ errorDetails }, "❌ SeasonStarted Listener Error");
      } catch (logError) {
        logger.error(`❌ SeasonStarted Listener Error: ${String(logError)}`);
      }
    },
  });

  logger.info(`🎧 Listening for SeasonStarted events on ${raffleAddress}`);
  return unwatch;
}
