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

  // Plan task 5.11 — merged EOA + SMA history.
  describe('merged EOA + SMA queries', () => {
    // Hook normalizes input to lower-case + sorted; mocks compare against
    // the post-normalization values.
    const eoa = '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266';
    const sma = '0xaaaa000000000000000000000000000000000001';

    it('tags rows with the origin address they came from', async () => {
      // queryLogsInChunks(client, params, maxBlockRange) — positional args.
      queryLogsInChunks.mockImplementation(async (_client, params) => {
        const args = params?.args;
        if (args?.to === eoa) {
          return [{
            transactionHash: '0xeoatx',
            blockNumber: 100n,
            logIndex: 0,
            args: { from: '0xfrom1', to: eoa, value: 1000000000000000000n },
          }];
        }
        if (args?.to === sma) {
          return [{
            transactionHash: '0xsmatx',
            blockNumber: 200n,
            logIndex: 0,
            args: { from: '0xfrom2', to: sma, value: 2000000000000000000n },
          }];
        }
        return [];
      });
      mockPublicClient.getBlock.mockResolvedValue({ timestamp: 1234567890n });

      const wrapper = ({ children }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      );

      const { result } = renderHook(
        () => useSOFTransactions([eoa, sma]),
        { wrapper },
      );

      await waitFor(
        () => {
          expect(result.current.isLoading).toBe(false);
          expect(result.current.data).toBeDefined();
          expect(result.current.data.length).toBeGreaterThan(0);
        },
        { timeout: 3000 },
      );

      const data = result.current.data || [];
      const eoaRow = data.find((r) => r.hash === '0xeoatx');
      const smaRow = data.find((r) => r.hash === '0xsmatx');
      expect(eoaRow?.origin).toBe(eoa.toLowerCase());
      expect(smaRow?.origin).toBe(sma.toLowerCase());
      // Every returned row carries an origin (no untagged rows leak through).
      expect(data.every((r) => typeof r.origin === 'string')).toBe(true);
    });

    it('dedupes (txHash, logIndex) pairs across EOA + SMA queries', async () => {
      // Same Transfer event surfaces from both queries — keep one.
      queryLogsInChunks.mockImplementation(async (_client, params) => {
        const args = params?.args;
        if (args?.to) {
          return [{
            transactionHash: '0xshared',
            blockNumber: 50n,
            logIndex: 3,
            args: { from: '0xfrom', to: args.to, value: 1n },
          }];
        }
        return [];
      });
      mockPublicClient.getBlock.mockResolvedValue({ timestamp: 1n });

      const wrapper = ({ children }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      );

      const { result } = renderHook(
        () => useSOFTransactions([eoa, sma]),
        { wrapper },
      );

      await waitFor(
        () => {
          expect(result.current.isLoading).toBe(false);
          expect(result.current.data).toBeDefined();
          expect(result.current.data.length).toBeGreaterThan(0);
        },
        { timeout: 3000 },
      );

      const data = result.current.data || [];
      // Without dedup we'd get 2 rows for the same shared (hash, logIndex);
      // we expect exactly one, with origin set to whichever query won.
      const sharedRows = data.filter((r) => r.hash === '0xshared' && r.logIndex === 3);
      expect(sharedRows.length).toBe(1);
    });

    it('sorts merged rows by blockNumber desc then logIndex desc', async () => {
      queryLogsInChunks.mockImplementation(async (_client, params) => {
        const args = params?.args;
        if (args?.to === eoa) {
          return [
            { transactionHash: '0xa', blockNumber: 100n, logIndex: 0, args: { from: '0x0', to: eoa, value: 1n } },
            { transactionHash: '0xb', blockNumber: 100n, logIndex: 5, args: { from: '0x0', to: eoa, value: 1n } },
          ];
        }
        if (args?.to === sma) {
          return [
            { transactionHash: '0xc', blockNumber: 200n, logIndex: 1, args: { from: '0x0', to: sma, value: 1n } },
            { transactionHash: '0xd', blockNumber: 50n, logIndex: 0, args: { from: '0x0', to: sma, value: 1n } },
          ];
        }
        return [];
      });
      mockPublicClient.getBlock.mockResolvedValue({ timestamp: 1n });

      const wrapper = ({ children }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      );

      const { result } = renderHook(
        () => useSOFTransactions([eoa, sma]),
        { wrapper },
      );

      await waitFor(
        () => {
          expect(result.current.isLoading).toBe(false);
          expect(result.current.data).toBeDefined();
          expect(result.current.data.length).toBeGreaterThan(0);
        },
        { timeout: 3000 },
      );

      const data = result.current.data || [];
      // Expected order: 0xc (200/1), 0xb (100/5), 0xa (100/0), 0xd (50/0)
      const hashesInOrder = data.map((r) => r.hash);
      expect(hashesInOrder).toEqual(['0xc', '0xb', '0xa', '0xd']);
    });
  });
});
