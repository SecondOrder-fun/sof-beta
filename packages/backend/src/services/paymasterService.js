/**
 * @file paymasterService.js
 * @description Service for submitting gasless transactions via Base Paymaster
 * Uses viem wallet client for backend operations with Paymaster RPC
 * @author SecondOrder.fun
 */

import { createWalletClient, http, encodeFunctionData } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { publicClient } from "../lib/viemClient.js";
import { getChainByKey } from "../config/chain.js";

const NETWORK = (process.env.NETWORK || "LOCAL").toUpperCase();

/**
 * PaymasterService - Handles gasless transaction submission via Base Paymaster
 * @class
 */
export class PaymasterService {
  constructor(logger) {
    this.logger = logger;
    this.walletClient = null;
    this.account = null;
    this.initialized = false;
    // Serial queue to prevent nonce race conditions across concurrent calls
    this._txQueue = Promise.resolve();
  }

  /**
   * Initialize the Paymaster service with viem wallet client
   * @async
   * @returns {Promise<void>}
   * @throws {Error} If initialization fails
   */
  async initialize() {
    try {
      const {
        PAYMASTER_RPC_URL,
        BACKEND_WALLET_PRIVATE_KEY,
        BACKEND_WALLET_ADDRESS,
      } = process.env;

      const paymasterUrl = PAYMASTER_RPC_URL;

      // Validate required environment variables
      if (!paymasterUrl) {
        throw new Error(
          "PAYMASTER_RPC_URL not configured",
        );
      }

      if (!BACKEND_WALLET_PRIVATE_KEY) {
        throw new Error("BACKEND_WALLET_PRIVATE_KEY not configured");
      }

      if (!BACKEND_WALLET_ADDRESS) {
        throw new Error("BACKEND_WALLET_ADDRESS not configured");
      }

      // Create account from private key
      const normalizedKey = BACKEND_WALLET_PRIVATE_KEY.startsWith("0x")
        ? BACKEND_WALLET_PRIVATE_KEY
        : `0x${BACKEND_WALLET_PRIVATE_KEY}`;

      this.account = privateKeyToAccount(normalizedKey);

      if (
        this.account.address.toLowerCase() !==
        String(BACKEND_WALLET_ADDRESS).toLowerCase()
      ) {
        throw new Error(
          `BACKEND_WALLET_ADDRESS does not match BACKEND_WALLET_PRIVATE_KEY. Expected ${this.account.address}, got ${BACKEND_WALLET_ADDRESS}.`,
        );
      }

      // Build the viem chain object from our backend chain config so the
      // wallet client signs txs with the correct chainId. The hardcoded
      // baseSepolia/base from before broke LOCAL (Anvil rejects 84532-signed
      // txs) and would also be wrong for any future non-Base deployment.
      const chainConfig = getChainByKey(NETWORK);
      const chain = {
        id: chainConfig.id,
        name: chainConfig.name,
        nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
        rpcUrls: { default: { http: [paymasterUrl] } },
      };
      this.walletClient = createWalletClient({
        account: this.account,
        chain,
        transport: http(paymasterUrl),
      });

      this.initialized = true;

      this.logger.info(
        `PaymasterService initialized with viem wallet client`,
      );
      this.logger.info(`   Network: ${chainConfig.name} (chainId ${chainConfig.id})`);
      this.logger.info(`   Account: ${this.account.address}`);
    } catch (error) {
      this.logger.error(
        `PaymasterService initialization failed: ${error.message}`,
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
   * Create a market via gasless transaction using viem wallet client
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
        "PaymasterService not initialized. Call initialize() first.",
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
   * Claim airdrop on behalf of a user via gasless relay transaction.
   * Awaits receipt (frontend needs confirmation).
   * @async
   * @param {Object} params
   * @param {string} params.functionName - "claimInitialFor"|"claimInitialBasicFor"|"claimDailyFor"
   * @param {Array} params.args - Arguments for the function call
   * @param {string} params.airdropAddress - SOFAirdrop contract address
   * @param {Object} logger
   * @returns {Promise<Object>} { success, hash } or { success: false, error }
   */
  async claimAirdrop(params, logger) {
    if (!this.initialized) {
      throw new Error(
        "PaymasterService not initialized. Call initialize() first.",
      );
    }

    const { functionName, args, airdropAddress } = params;

    const AIRDROP_RELAY_ABI = [
      {
        name: "claimInitialFor",
        type: "function",
        stateMutability: "nonpayable",
        inputs: [
          { name: "user", type: "address" },
          { name: "fid", type: "uint256" },
          { name: "deadline", type: "uint256" },
          { name: "v", type: "uint8" },
          { name: "r", type: "bytes32" },
          { name: "s", type: "bytes32" },
        ],
        outputs: [],
      },
      {
        name: "claimInitialBasicFor",
        type: "function",
        stateMutability: "nonpayable",
        inputs: [{ name: "user", type: "address" }],
        outputs: [],
      },
      {
        name: "claimDailyFor",
        type: "function",
        stateMutability: "nonpayable",
        inputs: [{ name: "user", type: "address" }],
        outputs: [],
      },
    ];

    const maxRetries = 3;
    const retryDelays = [3000, 10000, 30000];

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        logger.info(
          `Attempt ${attempt}/${maxRetries}: Airdrop relay ${functionName} for ${args[0]}`,
        );

        const data = encodeFunctionData({
          abi: AIRDROP_RELAY_ABI,
          functionName,
          args,
        });

        // Send transaction via serial queue to avoid nonce conflicts
        const hash = await this._enqueueSendTransaction({
          to: airdropAddress,
          data,
          value: 0n,
          gas: 200000n,
        }, logger);

        logger.info(`Airdrop relay tx submitted: ${hash}`);

        // Await receipt -- frontend needs confirmation
        const receipt = await publicClient.waitForTransactionReceipt({
          hash,
          timeout: 60000,
        });

        if (receipt.status === "success") {
          logger.info(`Airdrop relay confirmed: ${hash}`);
          return { success: true, hash };
        } else {
          throw new Error(`Transaction reverted: ${hash}`);
        }
      } catch (error) {
        logger.error(`Attempt ${attempt} failed: ${error.message}`);

        if (attempt < maxRetries) {
          const delayMs = retryDelays[attempt - 1];
          logger.info(`Retrying in ${delayMs / 1000}s...`);
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        } else {
          logger.error(
            `Airdrop relay failed after ${maxRetries} attempts`,
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
      throw new Error("PaymasterService not initialized");
    }
    return this.account.address;
  }
}

// Export singleton instance
let paymasterServiceInstance = null;

/**
 * Get or create PaymasterService singleton
 * @param {Object} logger - Logger instance
 * @returns {PaymasterService} PaymasterService instance
 */
export function getPaymasterService(logger) {
  if (!paymasterServiceInstance) {
    paymasterServiceInstance = new PaymasterService(logger);
  }
  return paymasterServiceInstance;
}
