/**
 * Rollover Event Listener
 * Watches RolloverEscrow contract events and indexes them in rollover_events table.
 *
 * Required contract deployment:
 * - RolloverEscrow address in packages/contracts/deployments/{network}.json
 *
 * Silently skips startup if the contract is not yet deployed (address is empty).
 */

import { createPublicClient, http, parseAbiItem } from "viem";
import { getChainByKey } from "../config/chain.js";
import { db } from "../../shared/supabaseClient.js";

const ROLLOVER_DEPOSIT_EVENT = parseAbiItem(
  "event RolloverDeposit(address indexed user, uint256 indexed seasonId, uint256 amount)"
);

const ROLLOVER_SPEND_EVENT = parseAbiItem(
  "event RolloverSpend(address indexed user, uint256 indexed seasonId, uint256 indexed nextSeasonId, uint256 baseAmount, uint256 bonusAmount)"
);

const ROLLOVER_REFUND_EVENT = parseAbiItem(
  "event RolloverRefund(address indexed user, uint256 indexed seasonId, uint256 amount)"
);

/**
 * Start watching RolloverEscrow events and indexing them into the database.
 *
 * @param {string} network - "LOCAL" | "TESTNET" | "MAINNET"
 * @param {object} logger - Fastify-compatible logger with .info/.warn/.error
 * @returns {Function|undefined} Combined unwatch function, or undefined if skipped
 */
export function startRolloverEventListener(network, logger) {
  const chain = getChainByKey(network);
  const escrowAddress = chain.rolloverEscrow;

  if (!escrowAddress) {
    logger.warn(
      "[RolloverListener] RolloverEscrow address not configured — skipping rollover event listener"
    );
    return undefined;
  }

  const publicClient = createPublicClient({
    transport: http(chain.rpcUrl),
  });

  // Watch RolloverDeposit
  const unwatchDeposit = publicClient.watchEvent({
    address: escrowAddress,
    event: ROLLOVER_DEPOSIT_EVENT,
    onLogs: async (logs) => {
      for (const log of logs) {
        const { user, seasonId, amount } = log.args;
        try {
          const { error } = await db.client.from("rollover_events").upsert(
            {
              event_type: "DEPOSIT",
              season_id: Number(seasonId),
              user_address: user.toLowerCase(),
              amount: amount.toString(),
              tx_hash: log.transactionHash,
              block_number: Number(log.blockNumber),
            },
            { onConflict: "tx_hash,event_type" }
          );
          if (error) throw error;
          logger.info(
            `[RolloverListener] RolloverDeposit: ${user} deposited ${amount} for season ${seasonId} (tx: ${log.transactionHash})`
          );
        } catch (err) {
          logger.error(
            { err },
            `[RolloverListener] Failed to index RolloverDeposit: ${log.transactionHash}`
          );
        }
      }
    },
    onError: (err) => {
      logger.error({ err }, "[RolloverListener] RolloverDeposit watch error");
    },
  });

  // Watch RolloverSpend
  const unwatchSpend = publicClient.watchEvent({
    address: escrowAddress,
    event: ROLLOVER_SPEND_EVENT,
    onLogs: async (logs) => {
      for (const log of logs) {
        const { user, seasonId, nextSeasonId, baseAmount, bonusAmount } =
          log.args;
        try {
          const { error } = await db.client.from("rollover_events").upsert(
            {
              event_type: "SPEND",
              season_id: Number(seasonId),
              user_address: user.toLowerCase(),
              amount: baseAmount.toString(),
              bonus_amount: bonusAmount.toString(),
              next_season_id: Number(nextSeasonId),
              tx_hash: log.transactionHash,
              block_number: Number(log.blockNumber),
            },
            { onConflict: "tx_hash,event_type" }
          );
          if (error) throw error;
          logger.info(
            `[RolloverListener] RolloverSpend: ${user} spent ${baseAmount} (+${bonusAmount} bonus) from season ${seasonId} → ${nextSeasonId} (tx: ${log.transactionHash})`
          );
        } catch (err) {
          logger.error(
            { err },
            `[RolloverListener] Failed to index RolloverSpend: ${log.transactionHash}`
          );
        }
      }
    },
    onError: (err) => {
      logger.error({ err }, "[RolloverListener] RolloverSpend watch error");
    },
  });

  // Watch RolloverRefund
  const unwatchRefund = publicClient.watchEvent({
    address: escrowAddress,
    event: ROLLOVER_REFUND_EVENT,
    onLogs: async (logs) => {
      for (const log of logs) {
        const { user, seasonId, amount } = log.args;
        try {
          const { error } = await db.client.from("rollover_events").upsert(
            {
              event_type: "REFUND",
              season_id: Number(seasonId),
              user_address: user.toLowerCase(),
              amount: amount.toString(),
              tx_hash: log.transactionHash,
              block_number: Number(log.blockNumber),
            },
            { onConflict: "tx_hash,event_type" }
          );
          if (error) throw error;
          logger.info(
            `[RolloverListener] RolloverRefund: ${user} refunded ${amount} from season ${seasonId} (tx: ${log.transactionHash})`
          );
        } catch (err) {
          logger.error(
            { err },
            `[RolloverListener] Failed to index RolloverRefund: ${log.transactionHash}`
          );
        }
      }
    },
    onError: (err) => {
      logger.error({ err }, "[RolloverListener] RolloverRefund watch error");
    },
  });

  logger.info(
    `[RolloverListener] Watching RolloverDeposit, RolloverSpend, RolloverRefund at ${escrowAddress}`
  );

  // Return a single unwatch function that stops all three watchers
  return function unwatchAll() {
    unwatchDeposit();
    unwatchSpend();
    unwatchRefund();
  };
}
