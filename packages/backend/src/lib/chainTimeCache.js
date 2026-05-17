// In-memory cache for the latest chain block timestamp. Lives in its own
// module so consumers can import it without triggering viemClient.js's
// NETWORK env check at module-load time (contractEventPolling tests, for
// example, run without a configured NETWORK).
export const chainTimeCache = {
  blockNumber: null,
  timestamp: null,
  updatedAt: null,
};

export function updateChainTimeCache(blockNumber, timestamp) {
  chainTimeCache.blockNumber = blockNumber;
  chainTimeCache.timestamp = timestamp;
  chainTimeCache.updatedAt = Date.now();
}
