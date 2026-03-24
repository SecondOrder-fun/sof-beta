// src/utils/blockRangeQuery.js

/**
 * Query logs in chunks to handle RPC provider block range limitations
 * Base/Ethereum RPCs typically limit eth_getLogs to 5k-10k blocks
 * 
 * @param {object} client - Viem public client
 * @param {object} params - getLogs parameters (address, event, fromBlock, toBlock)
 * @param {bigint} maxBlockRange - Maximum blocks per chunk (default 10000n for paid plans)
 * @returns {Promise<Array>} Combined logs from all chunks
 */
export async function queryLogsInChunks(client, params, maxBlockRange = 10000n) {
  const { fromBlock, toBlock, ...restParams } = params;
  
  // Convert toBlock to number if it's 'latest'
  const endBlock = toBlock === 'latest' 
    ? await client.getBlockNumber() 
    : BigInt(toBlock);
  
  const startBlock = BigInt(fromBlock);
  
  // If range is within limit, query directly
  if (endBlock - startBlock <= maxBlockRange) {
    return await client.getLogs({
      ...restParams,
      fromBlock: startBlock,
      toBlock: endBlock,
    });
  }
  
  // Otherwise, chunk the queries
  const allLogs = [];
  let currentFrom = startBlock;
  
  while (currentFrom <= endBlock) {
    const currentTo = currentFrom + maxBlockRange - 1n > endBlock 
      ? endBlock 
      : currentFrom + maxBlockRange - 1n;
    
    try {
      const logs = await client.getLogs({
        ...restParams,
        fromBlock: currentFrom,
        toBlock: currentTo,
      });
      
      allLogs.push(...logs);
      
      // Move to next chunk
      currentFrom = currentTo + 1n;
    } catch (error) {
      // If we still hit a limit, try with smaller chunks
      const errorMsg = error.message?.toLowerCase() || '';
      if (errorMsg.includes('block range') || errorMsg.includes('exceed') || errorMsg.includes('returned more than')) {
        // Retry with half the chunk size
        const smallerChunkSize = maxBlockRange / 2n;
        if (smallerChunkSize < 1000n) {
          throw new Error('Block range too small, cannot chunk further');
        }
        
        const remainingLogs = await queryLogsInChunks(
          client,
          { ...restParams, fromBlock: currentFrom, toBlock: endBlock },
          smallerChunkSize
        );
        
        allLogs.push(...remainingLogs);
        break;
      } else {
        throw error;
      }
    }
  }
  
  return allLogs;
}

/**
 * Estimate the block number from a timestamp
 * Useful when you have a season startTime but no startBlock
 * 
 * @param {object} client - Viem public client
 * @param {number} targetTimestamp - Unix timestamp to find block for
 * @param {number} avgBlockTime - Average block time in seconds (default 2 for Base)
 * @returns {Promise<bigint>} Estimated block number
 */
export async function estimateBlockFromTimestamp(client, targetTimestamp, avgBlockTime = 2) {
  const currentBlock = await client.getBlockNumber();
  const currentBlockData = await client.getBlock({ blockNumber: currentBlock });
  const currentTimestamp = Number(currentBlockData.timestamp);
  
  // Calculate blocks back from current
  const timeDiff = currentTimestamp - targetTimestamp;
  const blocksDiff = Math.floor(timeDiff / avgBlockTime);
  
  // Ensure we don't go below block 0
  const estimatedBlock = blocksDiff > 0 
    ? currentBlock - BigInt(blocksDiff)
    : currentBlock;
  
  return estimatedBlock > 0n ? estimatedBlock : 0n;
}
