/**
 * AccountCreatedListener
 *
 * Watches SOFSmartAccountFactory.AccountCreated(owner, account) events.
 * When a UserOp deploys an SMA via initCode, this listener stamps
 * smart_accounts.deployed_at so the frontend / admin tools can tell
 * which SMAs are still counterfactual vs. on-chain.
 *
 * Pattern mirrors seasonStartedListener.js:
 *   1. scan for missed historical events on boot
 *   2. start a polling watcher with a persistent block cursor
 *   3. process logs idempotently (markDeployed only flips NULL→now())
 */

import { SOFSmartAccountFactoryABI } from "@sof/contracts";
import { publicClient } from "../lib/viemClient.js";
import { getChainByKey } from "../config/chain.js";
import {
  getContractEventsInChunks,
  startContractEventPolling,
} from "../lib/contractEventPolling.js";
import { createBlockCursor } from "../lib/blockCursor.js";
import { smartAccountsDb } from "../../shared/services/smartAccountsDb.js";

/**
 * Process a single AccountCreated event log.
 */
async function processAccountCreatedLog(log, logger) {
  try {
    const owner = log.args?.owner;
    const account = log.args?.account;

    if (!owner || !account) {
      logger.warn(
        { topics: log.topics },
        "AccountCreated log missing owner/account args — skipping",
      );
      return;
    }

    const eoaLc = String(owner).toLowerCase();
    const smaLc = String(account).toLowerCase();

    // Idempotent: markDeployed flips deployed_at only if currently NULL.
    // We also try to ensure the row exists — for the rare case where the
    // listener sees AccountCreated before SIWE auth has run (e.g. user
    // submits a UserOp from an alt session). upsertSmartAccount is a
    // no-op if the row's already there with the same SMA.
    await smartAccountsDb.upsertSmartAccount({ eoa: eoaLc, sma: smaLc });
    await smartAccountsDb.markDeployed(smaLc);

    logger.info(
      `🪪 AccountCreated: eoa=${eoaLc} sma=${smaLc} (block ${log.blockNumber})`,
    );
  } catch (error) {
    logger.error(
      `❌ Failed to process AccountCreated for ${log?.args?.owner}/${log?.args?.account}: ${error.message}`,
    );
    // Continue — don't crash the listener on individual failures.
  }
}

/**
 * Backfill missed AccountCreated events since `chain.lookbackBlocks`.
 */
async function scanHistoricalAccountCreated(factoryAddress, logger) {
  try {
    logger.info("🔍 Scanning for historical AccountCreated events...");
    const currentBlock = await publicClient.getBlockNumber();
    const chain = getChainByKey(process.env.NETWORK);
    const lookbackBlocks = chain.lookbackBlocks;
    const fromBlock =
      currentBlock > lookbackBlocks ? currentBlock - lookbackBlocks : 0n;

    logger.info(`   Scanning from block ${fromBlock} to ${currentBlock}`);

    const logs = await getContractEventsInChunks({
      client: publicClient,
      address: factoryAddress,
      abi: SOFSmartAccountFactoryABI,
      eventName: "AccountCreated",
      fromBlock,
      toBlock: currentBlock,
      maxBlockRange: 2_000n,
      maxRetries: 5,
    });

    if (logs.length > 0) {
      logger.info(`   Found ${logs.length} historical AccountCreated event(s)`);
      for (const log of logs) {
        await processAccountCreatedLog(log, logger);
      }
    } else {
      logger.info("   No historical AccountCreated events found");
    }
  } catch (error) {
    logger.error(
      `❌ Failed to scan historical AccountCreated events: ${error.message}`,
    );
    // Don't throw — continue with the real-time listener.
  }
}

/**
 * Start watching SOFSmartAccountFactory.AccountCreated.
 *
 * @param {string} factoryAddress - SOFSmartAccountFactory address
 * @param {object} logger - Fastify logger (app.log)
 * @returns {Promise<() => void>} unwatch
 */
export async function startAccountCreatedListener(factoryAddress, logger) {
  if (!factoryAddress) {
    throw new Error("factoryAddress is required");
  }
  if (!logger) {
    throw new Error("logger instance is required");
  }

  await scanHistoricalAccountCreated(factoryAddress, logger);

  const blockCursor = await createBlockCursor(
    `${factoryAddress}:AccountCreated`,
  );

  const unwatch = await startContractEventPolling({
    client: publicClient,
    address: factoryAddress,
    abi: SOFSmartAccountFactoryABI,
    eventName: "AccountCreated",
    pollingIntervalMs: 3_000,
    maxBlockRange: 2_000n,
    blockCursor,
    onLogs: async (logs) => {
      for (const log of logs) {
        await processAccountCreatedLog(log, logger);
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
        logger.error({ errorDetails }, "❌ AccountCreated Listener Error");
      } catch (logError) {
        logger.error(`❌ AccountCreated Listener Error: ${String(logError)}`);
      }
    },
  });

  logger.info(
    `🎧 Listening for AccountCreated events on factory ${factoryAddress}`,
  );
  return unwatch;
}
