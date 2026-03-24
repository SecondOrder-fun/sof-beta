import { publicClient } from "../lib/viemClient.js";
import {
  startContractEventPolling,
} from "../lib/contractEventPolling.js";
import { createBlockCursor } from "../lib/blockCursor.js";
import {
  createSponsorPrize,
  saveTierConfigs,
} from "../../shared/sponsorPrizeService.js";

const TAG = "[SPONSOR_PRIZE_LISTENER]";

/**
 * Process an ERC20Sponsored event log.
 */
async function processERC20Sponsored(log, logger) {
  const { seasonId, sponsor, token, amount } = log.args;

  try {
    const seasonIdNum = typeof seasonId === "bigint" ? Number(seasonId) : seasonId;
    const amountStr = typeof amount === "bigint" ? amount.toString() : String(amount);

    // Resolve token metadata on-chain
    let tokenName = null;
    let tokenSymbol = null;
    let tokenDecimals = null;

    try {
      [tokenName, tokenSymbol, tokenDecimals] = await Promise.all([
        publicClient.readContract({ address: token, abi: [{ name: "name", type: "function", inputs: [], outputs: [{ type: "string" }] }], functionName: "name" }),
        publicClient.readContract({ address: token, abi: [{ name: "symbol", type: "function", inputs: [], outputs: [{ type: "string" }] }], functionName: "symbol" }),
        publicClient.readContract({ address: token, abi: [{ name: "decimals", type: "function", inputs: [], outputs: [{ type: "uint8" }] }], functionName: "decimals" }),
      ]);
    } catch (metaErr) {
      logger.warn(`${TAG} Could not resolve token metadata for ${token}: ${metaErr.message}`);
    }

    // Try to determine targetTier from the contract's getSponsoredERC20 (last entry)
    // For now, default to 0; the API route also accepts tier when creating off-chain prizes
    const targetTier = 0;

    await createSponsorPrize({
      seasonId: seasonIdNum,
      prizeType: "erc20",
      chainId: 8453,
      tokenAddress: token,
      tokenName,
      tokenSymbol,
      tokenDecimals: tokenDecimals != null ? Number(tokenDecimals) : null,
      amount: amountStr,
      sponsorAddress: sponsor,
      targetTier,
      isOnchain: true,
      txHash: log.transactionHash,
    });

    logger.info(`${TAG} Indexed ERC20 sponsorship: ${tokenSymbol || token} amount=${amountStr} for season ${seasonIdNum}`);
  } catch (error) {
    logger.error(`${TAG} Failed to process ERC20Sponsored: ${error.message}`);
  }
}

/**
 * Process an ERC721Sponsored event log.
 */
async function processERC721Sponsored(log, logger) {
  const { seasonId, sponsor, token, tokenId } = log.args;

  try {
    const seasonIdNum = typeof seasonId === "bigint" ? Number(seasonId) : seasonId;
    const tokenIdStr = typeof tokenId === "bigint" ? tokenId.toString() : String(tokenId);

    // Resolve NFT metadata
    let tokenName = null;
    let tokenUri = null;
    let imageUrl = null;

    try {
      [tokenName, tokenUri] = await Promise.all([
        publicClient.readContract({ address: token, abi: [{ name: "name", type: "function", inputs: [], outputs: [{ type: "string" }] }], functionName: "name" }),
        publicClient.readContract({ address: token, abi: [{ name: "tokenURI", type: "function", inputs: [{ type: "uint256" }], outputs: [{ type: "string" }] }], functionName: "tokenURI", args: [BigInt(tokenIdStr)] }),
      ]);
    } catch (metaErr) {
      logger.warn(`${TAG} Could not resolve NFT metadata for ${token}#${tokenIdStr}: ${metaErr.message}`);
    }

    await createSponsorPrize({
      seasonId: seasonIdNum,
      prizeType: "erc721",
      chainId: 8453,
      tokenAddress: token,
      tokenName,
      tokenId: tokenIdStr,
      tokenUri,
      imageUrl,
      sponsorAddress: sponsor,
      targetTier: 0,
      isOnchain: true,
      txHash: log.transactionHash,
    });

    logger.info(`${TAG} Indexed ERC721 sponsorship: ${tokenName || token}#${tokenIdStr} for season ${seasonIdNum}`);
  } catch (error) {
    logger.error(`${TAG} Failed to process ERC721Sponsored: ${error.message}`);
  }
}

/**
 * Process a TiersConfigured event log.
 */
async function processTiersConfigured(log, distributorAddress, distributorAbi, logger) {
  const { seasonId, tierCount } = log.args;

  try {
    const seasonIdNum = typeof seasonId === "bigint" ? Number(seasonId) : seasonId;
    const tierCountNum = typeof tierCount === "bigint" ? Number(tierCount) : tierCount;

    // Read tier configs from chain
    const tiers = await publicClient.readContract({
      address: distributorAddress,
      abi: distributorAbi,
      functionName: "getTierConfigs",
      args: [BigInt(seasonIdNum)],
    });

    const tierData = tiers.map((t, i) => ({
      tierIndex: i,
      winnerCount: Number(t.winnerCount),
    }));

    await saveTierConfigs(seasonIdNum, tierData);
    logger.info(`${TAG} Saved ${tierCountNum} tier configs for season ${seasonIdNum}`);
  } catch (error) {
    logger.error(`${TAG} Failed to process TiersConfigured: ${error.message}`);
  }
}

/**
 * Start listening for sponsor prize events on the RafflePrizeDistributor contract.
 * @param {string} distributorAddress - RafflePrizeDistributor contract address
 * @param {object} distributorAbi - Distributor ABI
 * @param {object} logger - Logger instance
 * @returns {Array<function>} Array of unwatch functions
 */
export async function startSponsorPrizeListener(distributorAddress, distributorAbi, logger) {
  if (!distributorAddress || !distributorAbi) {
    throw new Error("distributorAddress and distributorAbi are required");
  }
  if (!logger) {
    throw new Error("logger instance is required");
  }

  const unwatchers = [];

  // Listen for ERC20Sponsored events
  const erc20Cursor = await createBlockCursor(`${distributorAddress}:ERC20Sponsored`);
  const unwatchERC20 = await startContractEventPolling({
    client: publicClient,
    address: distributorAddress,
    abi: distributorAbi,
    eventName: "ERC20Sponsored",
    pollingIntervalMs: 5_000,
    maxBlockRange: 2_000n,
    blockCursor: erc20Cursor,
    onLogs: async (logs) => {
      for (const log of logs) {
        await processERC20Sponsored(log, logger);
      }
    },
    onError: (error) => {
      logger.error(`${TAG} ERC20Sponsored listener error: ${error?.message || error}`);
    },
  });
  unwatchers.push(unwatchERC20);

  // Listen for ERC721Sponsored events
  const erc721Cursor = await createBlockCursor(`${distributorAddress}:ERC721Sponsored`);
  const unwatchERC721 = await startContractEventPolling({
    client: publicClient,
    address: distributorAddress,
    abi: distributorAbi,
    eventName: "ERC721Sponsored",
    pollingIntervalMs: 5_000,
    maxBlockRange: 2_000n,
    blockCursor: erc721Cursor,
    onLogs: async (logs) => {
      for (const log of logs) {
        await processERC721Sponsored(log, logger);
      }
    },
    onError: (error) => {
      logger.error(`${TAG} ERC721Sponsored listener error: ${error?.message || error}`);
    },
  });
  unwatchers.push(unwatchERC721);

  // Listen for TiersConfigured events
  const tiersCursor = await createBlockCursor(`${distributorAddress}:TiersConfigured`);
  const unwatchTiers = await startContractEventPolling({
    client: publicClient,
    address: distributorAddress,
    abi: distributorAbi,
    eventName: "TiersConfigured",
    pollingIntervalMs: 5_000,
    maxBlockRange: 2_000n,
    blockCursor: tiersCursor,
    onLogs: async (logs) => {
      for (const log of logs) {
        await processTiersConfigured(log, distributorAddress, distributorAbi, logger);
      }
    },
    onError: (error) => {
      logger.error(`${TAG} TiersConfigured listener error: ${error?.message || error}`);
    },
  });
  unwatchers.push(unwatchTiers);

  logger.info(`${TAG} Listening for sponsor prize events on ${distributorAddress}`);
  return unwatchers;
}
