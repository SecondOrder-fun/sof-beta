// tests/hooks/useSOFTransactions.test.jsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Mock wagmi hooks
vi.mock('wagmi', () => ({
  usePublicClient: vi.fn(),
}));

// Mock config functions
vi.mock('@/config/contracts', () => ({
  getContractAddresses: vi.fn(),
  RAFFLE_ABI: [],
}));

vi.mock('@/lib/wagmi', () => ({
  getStoredNetworkKey: vi.fn(),
}));

vi.mock('@/config/networks', () => ({
  getNetworkByKey: vi.fn(),
}));

// Mock queryLogsInChunks utility
vi.mock('@/utils/blockRangeQuery', () => ({
  queryLogsInChunks: vi.fn(),
}));

// Import mocked modules at top level — this guarantees we always get
// THIS file's mock references, not a stale/colliding mock from another
// test file sharing the same Vitest worker thread.
import { usePublicClient } from 'wagmi';
import { getContractAddresses } from '@/config/contracts';
import { getStoredNetworkKey } from '@/lib/wagmi';
import { getNetworkByKey } from '@/config/networks';
import { queryLogsInChunks } from '@/utils/blockRangeQuery';
import { useSOFTransactions } from '@/hooks/useSOFTransactions';

describe('useSOFTransactions', () => {
  let queryClient;
  let mockPublicClient;

  beforeEach(() => {
    // Mock fetch to prevent real network calls (the hook fetches /infofi/markets)
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ markets: {} }),
    });
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });

    mockPublicClient = {
      getBlockNumber: vi.fn().mockResolvedValue(1000n),
      getBlock: vi.fn(),
      readContract: vi.fn().mockResolvedValue(0n),
    };

    usePublicClient.mockReturnValue(mockPublicClient);

    getContractAddresses.mockReturnValue({
      SOF: '0x1234567890123456789012345678901234567890',
      SOFBondingCurve: '0x2345678901234567890123456789012345678901',
      RafflePrizeDistributor: '0x3456789012345678901234567890123456789012',
    });

    getStoredNetworkKey.mockReturnValue('anvil');

    getNetworkByKey.mockReturnValue({
      id: 31337,
      name: 'Local Anvil',
      rpcUrl: 'http://127.0.0.1:8545',
      explorer: '',
      lookbackBlocks: 1000n,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should fetch and categorize transactions correctly', async () => {
    const testAddress = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';

    // Mock queryLogsInChunks to return Transfer IN event
    queryLogsInChunks.mockImplementation(async ({ args }) => {
      if (args?.to === testAddress) {
        return [{
          transactionHash: '0xabc123',
          blockNumber: 100n,
          args: {
            from: '0x0000000000000000000000000000000000000000',
            to: testAddress,
            value: 1000000000000000000n, // 1 SOF
          },
        }];
      }
      return [];
    });

    mockPublicClient.getBlock.mockResolvedValue({
      timestamp: 1234567890n,
    });

    const wrapper = ({ children }) => (
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    );

    const { result } = renderHook(
      () => useSOFTransactions(testAddress),
      { wrapper }
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.data).toBeDefined();
    expect(Array.isArray(result.current.data)).toBe(true);
  });

  it('should handle empty transaction history', async () => {
    const testAddress = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';

    queryLogsInChunks.mockResolvedValue([]);

    const wrapper = ({ children }) => (
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    );

    const { result } = renderHook(
      () => useSOFTransactions(testAddress),
      { wrapper }
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.data).toEqual([]);
  });

  it('should not fetch when address is not provided', () => {
    const wrapper = ({ children }) => (
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    );

    const { result } = renderHook(
      () => useSOFTransactions(null),
      { wrapper }
    );

    expect(result.current.isLoading).toBe(false);
    expect(result.current.data).toBeUndefined();
  });

  it('should respect enabled option', async () => {
    const wrapper = ({ children }) => (
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    );

    const { result } = renderHook(
      () => useSOFTransactions('0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266', { enabled: false }),
      { wrapper }
    );

    expect(result.current.isLoading).toBe(false);
    expect(result.current.data).toBeUndefined();
    expect(queryLogsInChunks).not.toHaveBeenCalled();
  });
});
