import { publicClient } from "../lib/viemClient.js";
import { db } from "../../shared/supabaseClient.js";
import { SimpleFPMMABI as simpleFpmmAbi } from '@sof/contracts';
import { queryLogsInChunks } from "../utils/blockRangeQuery.js";
import {
  cacheRead,
  cacheInvalidate,
  cacheInvalidatePattern,
  POSITIONS_KEY_PREFIX,
  MARKET_INFO_KEY_PREFIX,
} from "../../shared/redisCache.js";

const POSITION_CACHE_TTL_SECONDS = 20;

/**
 * Service for managing InfoFi positions
 * Handles recording trades, historical sync, and position queries
 */
class InfoFiPositionService {
  /**
   * Record a position from a Trade event (idempotent via tx_hash)
   * @param {Object} params
   * @param {string} params.fpmmAddress - FPMM contract address
   * @param {string} params.trader - User address
   * @param {boolean} params.buyYes - true for YES, false for NO
   * @param {bigint} params.amountIn - SOF amount spent
   * @param {bigint} params.amountOut - Shares received
   * @param {string} params.txHash - Transaction hash
   * @returns {Promise<Object>} Result with success status
   */
  async recordPosition({
    fpmmAddress,
    trader,
    buyYes,
    amountIn,
    amountOut,
    txHash,
  }) {
    try {
      console.log(`[recordPosition] Starting for tx: ${txHash}`);
      console.log(`[recordPosition] FPMM: ${fpmmAddress}, Trader: ${trader}`);

      // 1. Check if already recorded (idempotency)
      console.log(`[recordPosition] Checking if tx already recorded...`);
      const { data: existing, error: checkError } = await db.client
        .from("infofi_positions")
        .select("id")
        .eq("tx_hash", txHash)
        .maybeSingle();

      if (checkError) {
        console.error(
          `[recordPosition] Error checking existing position:`,
          checkError
        );
        throw checkError;
      }

      if (existing) {
        console.log(
          `[recordPosition] Position already recorded with id: ${existing.id}`
        );
        return { alreadyRecorded: true, id: existing.id };
      }

      // 2. Get market_id from FPMM address
      console.log(
        `[recordPosition] Looking up market_id for FPMM: ${fpmmAddress}`
      );
      const marketId = await this.getMarketIdFromFpmm(fpmmAddress);
      console.log(`[recordPosition] Market ID: ${marketId}`);

      if (!marketId) {
        console.error(
          `[recordPosition] No market found for FPMM: ${fpmmAddress}`
        );
        throw new Error(`No market found for FPMM: ${fpmmAddress}`);
      }

      // 3. Convert from wei to human-readable units (divide by 10^18)
      const amountInNum = Number(amountIn) / 1e18;
      const amountOutNum = Number(amountOut) / 1e18;
      const price = amountOutNum > 0 ? amountInNum / amountOutNum : 0;

      console.log(
        `[recordPosition] Converted amounts - In: ${amountInNum}, Out: ${amountOutNum}, Price: ${price}`
      );

      // 4. Map outcome
      const outcome = buyYes ? "YES" : "NO";
      console.log(`[recordPosition] Outcome: ${outcome}`);

      // 5. Insert position (player_id auto-populated by trigger)
      const insertData = {
        market_id: marketId,
        user_address: trader.toLowerCase(),
        outcome,
        amount: amountInNum.toString(),
        price: price.toString(),
        tx_hash: txHash,
        created_at: new Date().toISOString(),
      };

      console.log(`[recordPosition] Inserting position:`, insertData);

      const { data, error } = await db.client
        .from("infofi_positions")
        .insert(insertData)
        .select()
        .single();

      if (error) {
        console.error(`[recordPosition] Database insert error:`, error);
        console.error(`[recordPosition] Error details:`, {
          message: error.message,
          details: error.details,
          hint: error.hint,
          code: error.code,
        });
        throw error;
      }

      console.log(
        `[recordPosition] Successfully inserted position with id: ${data.id}`
      );

      // Trade just landed — bust this market's cached positions and market_info
      // volume so a trader sees their own update within one poll, not after TTL.
      await cacheInvalidatePattern(`${POSITIONS_KEY_PREFIX}net:${marketId}:*`);
      await cacheInvalidate(`${MARKET_INFO_KEY_PREFIX}${marketId}`);

      return { success: true, data };
    } catch (error) {
      console.error("[recordPosition] Fatal error:", error);
      console.error("[recordPosition] Error stack:", error.stack);
      throw error;
    }
  }

  /**
   * Sync historical trades for a market from blockchain
   * @param {string} fpmmAddress - FPMM contract address
   * @param {bigint} [fromBlock] - Starting block (optional, uses last_synced_block if not provided)
   * @returns {Promise<Object>} Sync results
   */
  async syncMarketPositions(fpmmAddress, fromBlock = null) {
    try {
      const marketId = await this.getMarketIdFromFpmm(fpmmAddress);
      if (!marketId) {
        return { error: "Market not found", fpmmAddress };
      }

      // Get market's last synced block
      const { data: market } = await db.client
        .from("infofi_markets")
        .select("last_synced_block, contract_address")
        .eq("id", marketId)
        .single();

      const startBlock =
        fromBlock !== null ? fromBlock : BigInt(market?.last_synced_block || 0);

      const latestBlock = await publicClient.getBlockNumber();

      // Skip event scan if already synced, but still refresh on-chain probability
      if (startBlock >= latestBlock) {
        let currentProbabilityBps = null;
        try {
          const [yesPrice] = await publicClient.readContract({
            address: fpmmAddress,
            abi: simpleFpmmAbi,
            functionName: "getPrices",
          });
          currentProbabilityBps = Number(yesPrice);

          // Update DB probability even if no new events
          await db.client
            .from("infofi_markets")
            .update({
              current_probability_bps: currentProbabilityBps,
              updated_at: new Date().toISOString(),
            })
            .eq("id", marketId);
        } catch (priceError) {
          console.error(
            `Failed to refresh probability for ${fpmmAddress}:`,
            priceError.message
          );
        }

        return {
          success: true,
          recorded: 0,
          skipped: 0,
          totalEvents: 0,
          message: "Already up to date",
          currentProbabilityBps,
        };
      }

      // Get all Trade events from contract using chunked queries
      const tradeEvent = simpleFpmmAbi.find(
        (item) => item.type === "event" && item.name === "Trade"
      );

      const logs = await queryLogsInChunks(
        publicClient,
        {
          address: fpmmAddress,
          event: {
            type: "event",
            name: "Trade",
            inputs: tradeEvent.inputs,
          },
          fromBlock: startBlock,
          toBlock: latestBlock,
        },
        10000n // 10k block chunks
      );

      let recorded = 0;
      let skipped = 0;
      let errors = 0;

      for (const log of logs) {
        const { trader, buyYes, amountIn, amountOut } = log.args;

        try {
          const result = await this.recordPosition({
            fpmmAddress,
            trader,
            buyYes,
            amountIn,
            amountOut,
            txHash: log.transactionHash,
            blockNumber: log.blockNumber,
          });

          if (result.alreadyRecorded) {
            skipped++;
          } else {
            recorded++;
          }
        } catch (error) {
          console.error(
            `Failed to record trade ${log.transactionHash}:`,
            error.message,
            "\nFull error:",
            error,
            "\nLog args:",
            log.args
          );
          errors++;
        }
      }

      // Update last synced block AND current probability from on-chain
      let currentProbabilityBps = null;
      try {
        const [yesPrice] = await publicClient.readContract({
          address: fpmmAddress,
          abi: simpleFpmmAbi,
          functionName: "getPrices",
        });
        currentProbabilityBps = Number(yesPrice);
      } catch (priceError) {
        console.error(
          `Failed to read FPMM prices for ${fpmmAddress}:`,
          priceError.message
        );
      }

      const updateData = {
        last_synced_block: latestBlock.toString(),
        last_synced_at: new Date().toISOString(),
      };

      if (currentProbabilityBps !== null) {
        updateData.current_probability_bps = currentProbabilityBps;
        updateData.updated_at = new Date().toISOString();
      }

      await db.client
        .from("infofi_markets")
        .update(updateData)
        .eq("id", marketId);

      return {
        success: true,
        recorded,
        skipped,
        errors,
        totalEvents: logs.length,
        fromBlock: startBlock.toString(),
        toBlock: latestBlock.toString(),
        currentProbabilityBps,
      };
    } catch (error) {
      console.error("Error syncing market positions:", error);
      throw error;
    }
  }

  /**
   * Get market_id from FPMM contract address
   * @param {string} fpmmAddress - FPMM contract address
   * @returns {Promise<number|null>} Market ID or null
   */
  async getMarketIdFromFpmm(fpmmAddress) {
    console.log(
      `[getMarketIdFromFpmm] Looking up market for FPMM: ${fpmmAddress}`
    );
    console.log(
      `[getMarketIdFromFpmm] Normalized address: ${fpmmAddress.toLowerCase()}`
    );

    const { data, error } = await db.client
      .from("infofi_markets")
      .select("id, contract_address, player_id, is_active")
      .eq("contract_address", fpmmAddress.toLowerCase())
      .maybeSingle();

    if (error) {
      console.error(`[getMarketIdFromFpmm] Database query error:`, error);
      return null;
    }

    if (data) {
      console.log(`[getMarketIdFromFpmm] Found market:`, data);
    } else {
      console.warn(
        `[getMarketIdFromFpmm] No market found for address: ${fpmmAddress.toLowerCase()}`
      );
    }

    return data?.id || null;
  }

  /**
   * Get all positions for a user
   * @param {string} userAddress - User wallet address
   * @param {number} [marketId] - Optional market filter
   * @returns {Promise<Array>} Array of positions
   */
  async getUserPositions(userAddress, marketId = null) {
    let query = db.client
      .from("infofi_positions")
      // select * — full rows returned to the frontend via /infofi positions
      // endpoint; consumed column set varies, keep the whole row.
      .select("*")
      .eq("user_address", userAddress.toLowerCase());

    if (marketId) {
      query = query.eq("market_id", marketId);
    }

    const { data, error } = await query.order("created_at", {
      ascending: false,
    });

    if (error) throw error;
    return data || [];
  }

  /**
   * Get aggregated position for user in a market
   * Uses the user_market_positions view for efficient aggregation
   * @param {string} userAddress - User wallet address
   * @param {number} marketId - Market ID
   * @returns {Promise<Array>} Array of aggregated positions by outcome
   */
  async getAggregatedPosition(userAddress, marketId) {
    const { data, error } = await db.client
      .from("user_market_positions")
      // select * — full aggregated rows returned to the frontend via the
      // /infofi aggregated-position endpoint, and read here by getNetPosition
      // (outcome/total_amount/num_trades). Columns vary, keep the whole row.
      .select("*")
      .eq("user_address", userAddress.toLowerCase())
      .eq("market_id", marketId);

    if (error) throw error;

    // Returns array of positions grouped by outcome
    // Example: [{ outcome: 'YES', total_amount: 125, ... }, { outcome: 'NO', total_amount: 50, ... }]
    return data || [];
  }

  /**
   * Get user's net position for binary markets
   * @param {string} userAddress - User wallet address
   * @param {number} marketId - Market ID
   * @returns {Promise<Object>} Net position with YES/NO totals
   */
  async getNetPosition(userAddress, marketId) {
    const cacheKey = `${POSITIONS_KEY_PREFIX}net:${marketId}:${userAddress.toLowerCase()}`;
    return cacheRead(
      cacheKey,
      async () => {
        const positions = await this.getAggregatedPosition(
          userAddress,
          marketId
        );

        const yesPosition = positions.find((p) => p.outcome === "YES");
        const noPosition = positions.find((p) => p.outcome === "NO");

        const yesAmount = parseFloat(yesPosition?.total_amount || 0);
        const noAmount = parseFloat(noPosition?.total_amount || 0);

        return {
          yes: yesPosition?.total_amount || "0",
          no: noPosition?.total_amount || "0",
          net: (yesAmount - noAmount).toString(),
          isHedged: !!(yesPosition && noPosition),
          numTradesYes: yesPosition?.num_trades || 0,
          numTradesNo: noPosition?.num_trades || 0,
        };
      },
      { ttlSeconds: POSITION_CACHE_TTL_SECONDS }
    );
  }

  /**
   * Get market pool info (reserves and volume), cached.
   *
   * Returns all values in WEI (raw 18-decimal BigInt strings) for frontend
   * compatibility. Frontend uses formatUnits(value, 18) to display.
   *
   * @param {number|string} marketId - Market ID
   * @returns {Promise<{totalYesPool: string, totalNoPool: string, volume: string}>}
   * @throws {Error} with code "MARKET_NOT_FOUND" when the market does not exist
   */
  async getMarketInfo(marketId) {
    return cacheRead(
      `${MARKET_INFO_KEY_PREFIX}${marketId}`,
      async () => {
        // Get market to find FPMM contract address
        const { data: market, error: marketError } = await db.client
          .from("infofi_markets")
          .select("id, contract_address")
          .eq("id", marketId)
          .single();

        if (marketError || !market) {
          const err = new Error("Market not found");
          err.code = "MARKET_NOT_FOUND";
          throw err;
        }

        // If no FPMM contract yet, return zeros
        if (!market.contract_address) {
          return { totalYesPool: "0", totalNoPool: "0", volume: "0" };
        }

        // Read on-chain FPMM reserves
        let totalYesPool = "0";
        let totalNoPool = "0";
        try {
          const [yesReserve, noReserve] = await Promise.all([
            publicClient.readContract({
              address: market.contract_address,
              abi: simpleFpmmAbi,
              functionName: "yesReserve",
            }),
            publicClient.readContract({
              address: market.contract_address,
              abi: simpleFpmmAbi,
              functionName: "noReserve",
            }),
          ]);
          totalYesPool = yesReserve.toString();
          totalNoPool = noReserve.toString();
        } catch (chainError) {
          console.warn(
            "Failed to read FPMM reserves from chain:",
            chainError.message,
            market.contract_address
          );
        }

        // Get volume from positions table (sum of all SOF amounts traded).
        // Amounts are stored as human-readable (e.g. "10" = 10 SOF);
        // convert to wei for frontend compatibility.
        const { data: volumeData, error: volumeError } = await db.client
          .from("infofi_positions")
          .select("amount")
          .eq("market_id", marketId);

        let volumeWei = 0n;
        const WEI = 10n ** 18n;
        if (!volumeError && volumeData) {
          for (const pos of volumeData) {
            try {
              const humanAmount = parseFloat(pos.amount || "0");
              if (humanAmount > 0) {
                // Integer math to avoid floating point issues: split whole
                // and fractional parts.
                const wholePart = BigInt(Math.floor(humanAmount));
                const fracPart = BigInt(
                  Math.round((humanAmount - Math.floor(humanAmount)) * 1e18)
                );
                volumeWei += wholePart * WEI + fracPart;
              }
            } catch {
              // Skip invalid amounts
            }
          }
        }

        return {
          totalYesPool,
          totalNoPool,
          volume: volumeWei.toString(),
        };
      },
      { ttlSeconds: 20 }
    );
  }

  /**
   * Check if user has positions on multiple outcomes (hedging detection)
   * @param {string} userAddress - User wallet address
   * @param {number} marketId - Market ID
   * @returns {Promise<boolean>} True if user is hedging
   */
  async isUserHedging(userAddress, marketId) {
    const positions = await this.getAggregatedPosition(userAddress, marketId);
    return positions.length > 1; // More than one outcome = hedging
  }

  /**
   * Sync all active markets
   * @returns {Promise<Object>} Summary of sync results
   */
  async syncAllActiveMarkets() {
    try {
      const { data: markets } = await db.client
        .from("infofi_markets")
        .select("id, contract_address")
        .eq("is_active", true);

      if (!markets || markets.length === 0) {
        return { success: true, message: "No active markets to sync" };
      }

      const results = [];

      for (const market of markets) {
        try {
          const result = await this.syncMarketPositions(
            market.contract_address
          );
          results.push({
            marketId: market.id,
            address: market.contract_address,
            ...result,
          });
        } catch (error) {
          results.push({
            marketId: market.id,
            address: market.contract_address,
            error: error.message,
          });
        }
      }

      const totalRecorded = results.reduce(
        (sum, r) => sum + (r.recorded || 0),
        0
      );
      const totalSkipped = results.reduce(
        (sum, r) => sum + (r.skipped || 0),
        0
      );
      const totalErrors = results.reduce((sum, r) => sum + (r.errors || 0), 0);

      return {
        success: true,
        markets: results.length,
        totalRecorded,
        totalSkipped,
        totalErrors,
        details: results,
      };
    } catch (error) {
      console.error("Error syncing all markets:", error);
      throw error;
    }
  }
}

export const infoFiPositionService = new InfoFiPositionService();
