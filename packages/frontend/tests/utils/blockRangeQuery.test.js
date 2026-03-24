// tests/utils/blockRangeQuery.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { queryLogsInChunks, estimateBlockFromTimestamp } from '@/utils/blockRangeQuery';

describe('blockRangeQuery', () => {
  describe('queryLogsInChunks', () => {
    let mockClient;

    beforeEach(() => {
      mockClient = {
        getBlockNumber: vi.fn(),
        getLogs: vi.fn(),
      };
    });

    it('should query directly if range is within limit', async () => {
      mockClient.getBlockNumber.mockResolvedValue(20000n);
      mockClient.getLogs.mockResolvedValue([
        { blockNumber: 15000n, data: 'log1' },
        { blockNumber: 16000n, data: 'log2' },
      ]);

      const logs = await queryLogsInChunks(
        mockClient,
        {
          address: '0x123',
          event: {},
          fromBlock: 15000n,
          toBlock: 20000n,
        },
        10000n // Max range
      );

      expect(mockClient.getLogs).toHaveBeenCalledTimes(1);
      expect(logs).toHaveLength(2);
    });

    it('should chunk queries when range exceeds limit', async () => {
      mockClient.getBlockNumber.mockResolvedValue(30000n);
      mockClient.getLogs
        .mockResolvedValueOnce([{ blockNumber: 10000n, data: 'log1' }])
        .mockResolvedValueOnce([{ blockNumber: 20000n, data: 'log2' }])
        .mockResolvedValueOnce([{ blockNumber: 30000n, data: 'log3' }]);

      const logs = await queryLogsInChunks(
        mockClient,
        {
          address: '0x123',
          event: {},
          fromBlock: 10000n,
          toBlock: 30000n,
        },
        10000n // Max range
      );

      expect(mockClient.getLogs).toHaveBeenCalledTimes(3);
      expect(logs).toHaveLength(3);
      expect(logs[0].blockNumber).toBe(10000n);
      expect(logs[2].blockNumber).toBe(30000n);
    });

    it('should handle "latest" as toBlock', async () => {
      mockClient.getBlockNumber.mockResolvedValue(25000n);
      mockClient.getLogs.mockResolvedValue([]);

      await queryLogsInChunks(
        mockClient,
        {
          address: '0x123',
          event: {},
          fromBlock: 20000n,
          toBlock: 'latest',
        },
        10000n
      );

      expect(mockClient.getBlockNumber).toHaveBeenCalled();
      expect(mockClient.getLogs).toHaveBeenCalledWith(
        expect.objectContaining({
          fromBlock: 20000n,
          toBlock: 25000n,
        })
      );
    });

    it('should retry with smaller chunks on block range error', async () => {
      mockClient.getBlockNumber.mockResolvedValue(30000n);
      
      // Simulate: first chunk fails, retry with half size succeeds for remaining range
      let callCount = 0;
      mockClient.getLogs.mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          // First call fails
          throw new Error('query returned more than 10000 results');
        }
        // Subsequent calls succeed
        return [{ blockNumber: 10000n + BigInt(callCount * 1000), data: `log${callCount}` }];
      });

      const logs = await queryLogsInChunks(
        mockClient,
        {
          address: '0x123',
          event: {},
          fromBlock: 10000n,
          toBlock: 20000n,
        },
        5000n // Smaller initial chunk to trigger chunking logic
      );

      // Should have retried and made multiple calls
      expect(callCount).toBeGreaterThan(1);
      expect(logs.length).toBeGreaterThan(0);
    });

    it('should throw error if chunks become too small', async () => {
      mockClient.getBlockNumber.mockResolvedValue(30000n);
      mockClient.getLogs.mockRejectedValue(
        new Error('block range exceeded')
      );

      await expect(
        queryLogsInChunks(
          mockClient,
          {
            address: '0x123',
            event: {},
            fromBlock: 10000n,
            toBlock: 20000n,
          },
          500n // Very small initial chunk
        )
      ).rejects.toThrow();
    });
  });

  describe('estimateBlockFromTimestamp', () => {
    let mockClient;

    beforeEach(() => {
      mockClient = {
        getBlockNumber: vi.fn(),
        getBlock: vi.fn(),
      };
    });

    it('should estimate block number from timestamp', async () => {
      const currentTime = Math.floor(Date.now() / 1000);
      const targetTime = currentTime - 3600; // 1 hour ago

      mockClient.getBlockNumber.mockResolvedValue(1000000n);
      mockClient.getBlock.mockResolvedValue({
        timestamp: BigInt(currentTime),
      });

      const estimatedBlock = await estimateBlockFromTimestamp(
        mockClient,
        targetTime,
        2 // 2 second block time (Base)
      );

      // 1 hour = 3600 seconds, at 2s/block = 1800 blocks
      expect(estimatedBlock).toBe(1000000n - 1800n);
    });

    it('should not return negative block numbers', async () => {
      const currentTime = Math.floor(Date.now() / 1000);
      const veryOldTime = currentTime - 1000000; // Very old timestamp

      mockClient.getBlockNumber.mockResolvedValue(100n);
      mockClient.getBlock.mockResolvedValue({
        timestamp: BigInt(currentTime),
      });

      const estimatedBlock = await estimateBlockFromTimestamp(
        mockClient,
        veryOldTime,
        2
      );

      expect(estimatedBlock).toBeGreaterThanOrEqual(0n);
    });

    it('should handle different block times', async () => {
      const currentTime = Math.floor(Date.now() / 1000);
      const targetTime = currentTime - 1200; // 20 minutes ago

      mockClient.getBlockNumber.mockResolvedValue(100000n);
      mockClient.getBlock.mockResolvedValue({
        timestamp: BigInt(currentTime),
      });

      // Test with Ethereum block time (12s)
      const ethBlock = await estimateBlockFromTimestamp(
        mockClient,
        targetTime,
        12
      );

      // 1200 seconds / 12s per block = 100 blocks
      expect(ethBlock).toBe(100000n - 100n);

      // Test with Base block time (2s)
      const baseBlock = await estimateBlockFromTimestamp(
        mockClient,
        targetTime,
        2
      );

      // 1200 seconds / 2s per block = 600 blocks
      expect(baseBlock).toBe(100000n - 600n);
    });
  });
});
