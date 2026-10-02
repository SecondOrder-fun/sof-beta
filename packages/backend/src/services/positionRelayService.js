/**
 * @file positionRelayService.js
 * @description Relays InfoFiMarketFactory.onPositionUpdate from the backend
 * wallet. The factory gates onPositionUpdate on PAYMASTER_ROLE, which the
 * deploy grants to BACKEND_WALLET_ADDRESS; the backend wallet pays its own
 * gas over the network's RPC_URL.
 * @author SecondOrder.fun
 */

import { encodeFunctionData } from "viem";
import { publicClient, getWalletClient } from "../lib/viemClient.js";
import { getChainByKey } from "../config/chain.js";

const NETWORK = (process.env.NETWORK || "LOCAL").toUpperCase();

/**
 * PositionRelayService - submits onPositionUpdate transactions from the
 * backend wallet, one at a time.
 * @class
 */
export class PositionRelayService {
  constructor(logger) {
    this.logger = logger;
    this.walletClient = null;
    this.account = null;
    this.initialized = false;
    // Serial queue to prevent nonce race conditions across concurrent calls
    this._txQueue = Promise.resolve();
  }

  /**
   * Build the backend wallet client for the configured NETWORK.
   * getWalletClient checks that BACKEND_WALLET_PRIVATE_KEY and
   * BACKEND_WALLET_ADDRESS are set and agree, and signs for the chain's id
   * over its RPC_URL.
   * @async
   * @returns {Promise<void>}
   * @throws {Error} If initialization fails
   */
  async initialize() {
    try {
      const chainConfig = getChainByKey(NETWORK);
      this.walletClient = getWalletClient(NETWORK);
      this.account = this.walletClient.account;

      this.initialized = true;

      this.logger.info(`PositionRelayService initialized`);
      this.logger.info(`   Network: ${chainConfig.name} (chainId ${chainConfig.id})`);
      this.logger.info(`   Account: ${this.account.address}`);
    } catch (error) {
      this.logger.error(
        `PositionRelayService initialization failed: ${error.message}`,
      );
      throw error;
    }
  }

  /**
   * Enqueue a sendTransaction call to serialize nonce usage.
   * Prevents concurrent calls from reading the same pending nonce.
   * @private
   * @param {Object} txParams - Parameters for walletClient.sendTransaction
   * @param {Object} logger - Logger instance
   * @returns {Promise<string>} Transaction hash
   */
  _enqueueSendTransaction(txParams, logger) {
    return new Promise((resolve, reject) => {
      this._txQueue = this._txQueue
        .then(async () => {
          logger.info("Sending transaction (queued)...");
          const hash = await this.walletClient.sendTransaction(txParams);
          resolve(hash);
        })
        .catch((err) => {
          reject(err);
        })
        // Ensure the tail of `_txQueue` is always a resolved promise.
        // Without this, a chained handler that itself throws (e.g. logger
        // exception inside a future caller's then) could leave the queue
        // permanently rejected and stall every subsequent enqueue.
        .then(() => undefined);
    });
  }

  /**
   * Relay onPositionUpdate to the InfoFi factory, which creates the
   * player's market once they cross the threshold.
   * @async
   * @param {Object} params - Market creation parameters
   * @param {number} params.seasonId - Season identifier
   * @param {string} params.player - Player address
   * @param {number} params.oldTickets - Previous ticket count
   * @param {number} params.newTickets - New ticket count
   * @param {number} params.totalTickets - Total tickets in season
   * @param {string} params.infoFiFactoryAddress - InfoFi factory contract address
   * @param {Object} logger - Logger instance
   * @returns {Promise<Object>} Transaction result with hash and status
   * @throws {Error} If transaction fails after retries
   */
  async createMarket(params, logger) {
    if (!this.initialized) {
      throw new Error(
        "PositionRelayService not initialized. Call initialize() first.",
      );
    }

    const {
      seasonId,
      player,
      oldTickets,
      newTickets,
      totalTickets,
      infoFiFactoryAddress,
    } = params;

    const maxRetries = 3;
    const retryDelays = [5000, 15000, 45000]; // 5s, 15s, 45s

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        logger.info(
          `Attempt ${attempt}/${maxRetries}: Creating market for player ${player}`,
        );

        // Encode the onPositionUpdate function call
        const data = encodeFunctionData({
          abi: [
            {
              name: "onPositionUpdate",
              type: "function",
              stateMutability: "nonpayable",
              inputs: [
                { name: "seasonId", type: "uint256" },
                { name: "player", type: "address" },
                { name: "oldTickets", type: "uint256" },
                { name: "newTickets", type: "uint256" },
                { name: "totalTickets", type: "uint256" },
              ],
              outputs: [],
            },
          ],
          functionName: "onPositionUpdate",
          args: [
            BigInt(seasonId),
            player,
            BigInt(oldTickets),
            BigInt(newTickets),
            BigInt(totalTickets),
          ],
        });

        // Send transaction via serial queue to avoid nonce conflicts
        const hash = await this._enqueueSendTransaction({
          to: infoFiFactoryAddress,
          data,
          value: 0n,
          gas: 5000000n, // Increased gas limit for market creation (FPMM deployment needs ~3M gas)
        }, logger);

        logger.info(`Market creation transaction submitted: ${hash}`);

        // Wait for transaction confirmation (don't block the listener)
        publicClient
          .waitForTransactionReceipt({ hash, timeout: 60000 })
          .then((receipt) => {
            if (receipt.status === "success") {
              logger.info(`Market creation confirmed: ${hash}`);
              logger.info(`   Block: ${receipt.blockNumber}`);
              logger.info(`   Gas used: ${receipt.gasUsed}`);
            } else {
              logger.error(`Market creation transaction reverted: ${hash}`);
            }
          })
          .catch((error) => {
            logger.error(
              `Failed to wait for market creation receipt: ${error.message}`,
            );
          });

        return {
          success: true,
          hash,
          attempts: attempt,
        };
      } catch (error) {
        logger.error(`Attempt ${attempt} failed: ${error.message}`);

        try {
          logger.error({
            msg: "Full error object from sendTransaction",
            error,
          });
        } catch (serializationError) {
          logger.error(
            `Failed to serialize full error object: ${String(
              serializationError,
            )}`,
          );
        }

        if (error && error.cause) {
          try {
            logger.error({
              msg: "Nested error.cause",
              cause: error.cause,
            });
          } catch (causeSerializationError) {
            logger.error(
              `Failed to serialize error.cause: ${String(
                causeSerializationError,
              )}`,
            );
          }
        }

        if (attempt < maxRetries) {
          const delayMs = retryDelays[attempt - 1];
          logger.info(`Retrying in ${delayMs / 1000}s...`);
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        } else {
          logger.error(
            `Market creation failed after ${maxRetries} attempts`,
          );
          return {
            success: false,
            error: error.message,
            attempts: attempt,
          };
        }
      }
    }
  }

  /**
   * Get the backend wallet address
   * @returns {string} Wallet address
   */
  getWalletAddress() {
    if (!this.initialized) {
      throw new Error("PositionRelayService not initialized");
    }
    return this.account.address;
  }
}

// Export singleton instance
let positionRelayServiceInstance = null;

/**
 * Get or create PositionRelayService singleton
 * @param {Object} logger - Logger instance
 * @returns {PositionRelayService} PositionRelayService instance
 */
export function getPositionRelayService(logger) {
  if (!positionRelayServiceInstance) {
    positionRelayServiceInstance = new PositionRelayService(logger);
  }
  return positionRelayServiceInstance;
}
