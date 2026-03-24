// tests/services/infoFiMarketIds.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { listSeasonWinnerMarketsByEvents } from '../../src/services/onchainInfoFi';

// Mock viem
vi.mock('viem', async () => {
  const actual = await vi.importActual('viem');
  return {
    ...actual,
    createPublicClient: vi.fn(() => ({
      readContract: vi.fn(),
      getBlockNumber: vi.fn(() => Promise.resolve(1000n))
    })),
    http: vi.fn(),
    getAddress: (addr) => addr
  };
});

// Mock network config
vi.mock('../../src/config/networks', () => ({
  getNetworkByKey: vi.fn(() => ({
    id: 31337,
    rpcUrl: 'http://localhost:8545'
  }))
}));

// Mock contract config
vi.mock('../../src/config/contracts', () => ({
  getContractAddresses: vi.fn(() => ({
    INFOFI_FACTORY: '0xFactory',
    INFOFI_MARKET: '0xMarket'
  }))
}));

// Mock ABIs
vi.mock('../../src/contracts/abis/InfoFiMarketFactory.json', () => ({
  default: [
    {
      type: 'event',
      name: 'MarketCreated',
      inputs: [
        { name: 'seasonId', type: 'uint256', indexed: true },
        { name: 'player', type: 'address', indexed: true },
        { name: 'marketType', type: 'bytes32', indexed: true },
        { name: 'probabilityBps', type: 'uint256' },
        { name: 'marketAddress', type: 'address' }
      ]
    }
  ]
}));

vi.mock('../../src/contracts/abis/InfoFiPriceOracle.json', () => ({ default: [] }));
vi.mock('../../src/contracts/abis/InfoFiMarket.json', () => ({ default: [] }));
vi.mock('../../src/contracts/abis/ERC20.json', () => ({ default: { abi: [] } }));

// Mock block range query
vi.mock('../../src/utils/blockRangeQuery', () => ({
  queryLogsInChunks: vi.fn(),
  estimateBlockFromTimestamp: vi.fn(() => Promise.resolve(100n))
}));

import { createPublicClient } from 'viem';
import { queryLogsInChunks } from '../../src/utils/blockRangeQuery';

describe('InfoFi Market ID Uniqueness', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return unique market IDs for different players', async () => {
    // Mock event logs for two different players
    const mockLogs = [
      {
        args: {
          seasonId: 1n,
          player: '0xPlayer1',
          marketType: 'WINNER_PREDICTION',
          probabilityBps: 100n,
          marketAddress: '0xMarket'
        }
      },
      {
        args: {
          seasonId: 1n,
          player: '0xPlayer2',
          marketType: 'WINNER_PREDICTION',
          probabilityBps: 150n,
          marketAddress: '0xMarket'
        }
      }
    ];

    queryLogsInChunks.mockResolvedValue(mockLogs);

    // Mock the readContract calls to return different market IDs based on player
    const mockReadContract = vi.fn((params) => {
      if (params.args && params.args[1] === '0xPlayer1') {
        return Promise.resolve(5n); // Player1's market ID
      }
      if (params.args && params.args[1] === '0xPlayer2') {
        return Promise.resolve(7n); // Player2's market ID
      }
      return Promise.resolve(0n);
    });

    createPublicClient.mockReturnValue({
      readContract: mockReadContract,
      getBlockNumber: vi.fn(() => Promise.resolve(1000n))
    });

    // Call the function
    const markets = await listSeasonWinnerMarketsByEvents({ 
      seasonId: 1, 
      networkKey: 'LOCAL' 
    });

    // Verify we got two markets with different IDs
    expect(markets).toHaveLength(2);
    expect(markets[0].id).toBe('5');
    expect(markets[1].id).toBe('7');
    expect(markets[0].player).toBe('0xPlayer1');
    expect(markets[1].player).toBe('0xPlayer2');
    
    // Most importantly: verify IDs are different (the bug was they were the same)
    expect(markets[0].id).not.toBe(markets[1].id);
  });

  it('should handle the case where all markets would have derived the same ID (bug scenario)', async () => {
    // This test verifies the bug is fixed
    // Before the fix, all markets would derive effectiveMarketId = nextMarketId - 1
    // After the fix, each market gets its unique ID from the mapping

    const mockLogs = [
      {
        args: {
          seasonId: 1n,
          player: '0xPlayer1',
          marketType: 'WINNER_PREDICTION',
          probabilityBps: 100n,
          marketAddress: '0xMarket'
        }
      },
      {
        args: {
          seasonId: 1n,
          player: '0xPlayer2',
          marketType: 'WINNER_PREDICTION',
          probabilityBps: 150n,
          marketAddress: '0xMarket'
        }
      }
    ];

    queryLogsInChunks.mockResolvedValue(mockLogs);

    // Mock different market IDs from the mapping based on player
    const mockReadContract = vi.fn((params) => {
      if (params.args && params.args[1] === '0xPlayer1') {
        return Promise.resolve(5n);
      }
      if (params.args && params.args[1] === '0xPlayer2') {
        return Promise.resolve(7n);
      }
      return Promise.resolve(0n);
    });

    createPublicClient.mockReturnValue({
      readContract: mockReadContract,
      getBlockNumber: vi.fn(() => Promise.resolve(1000n))
    });

    const markets = await listSeasonWinnerMarketsByEvents({ 
      seasonId: 1, 
      networkKey: 'LOCAL' 
    });

    // Each market should have its unique ID, not the same derived ID
    expect(markets[0].id).toBe('5');
    expect(markets[1].id).toBe('7');
    expect(markets[0].id).not.toBe(markets[1].id);
  });

  it('should fallback to event args if mapping read fails', async () => {
    const mockLogs = [
      {
        args: {
          seasonId: 1n,
          player: '0xPlayer1',
          marketType: 'WINNER_PREDICTION',
          probabilityBps: 100n,
          marketAddress: '0xMarket',
          marketId: 42n // Event includes marketId (future contract version)
        }
      }
    ];

    queryLogsInChunks.mockResolvedValue(mockLogs);

    // Mock readContract to fail
    const mockReadContract = vi.fn().mockRejectedValue(new Error('Mapping not found'));

    createPublicClient.mockReturnValue({
      readContract: mockReadContract,
      getBlockNumber: vi.fn(() => Promise.resolve(1000n))
    });

    const markets = await listSeasonWinnerMarketsByEvents({ 
      seasonId: 1, 
      networkKey: 'LOCAL' 
    });

    // Should fallback to marketId from event args
    expect(markets).toHaveLength(1);
    expect(markets[0].id).toBe('42');
  });
});
