import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockReadContract = vi.fn();
vi.mock('wagmi', () => ({
  usePublicClient: () => ({ readContract: (...args) => mockReadContract(...args) }),
}));

import { useUltraFreshRead } from '../useUltraFreshRead';

function makeWrapper(client) {
  return ({ children }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

describe('useUltraFreshRead', () => {
  beforeEach(() => vi.clearAllMocks());

  it('calls publicClient.readContract and returns data', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    mockReadContract.mockResolvedValue(123n);
    const { result } = renderHook(
      () =>
        useUltraFreshRead({
          contract: { address: '0xSOF', abi: [] },
          fn: 'balanceOf',
          args: ['0xUser'],
          touches: ['0xSOF'],
        }),
      { wrapper: makeWrapper(client) },
    );
    await waitFor(() => expect(result.current.data).toBe(123n));
    expect(mockReadContract).toHaveBeenCalledWith({
      address: '0xSOF',
      abi: [],
      functionName: 'balanceOf',
      args: ['0xUser'],
    });
  });

  it('respects enabled=false', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderHook(
      () =>
        useUltraFreshRead({
          contract: { address: '0xSOF', abi: [] },
          fn: 'balanceOf',
          args: ['0xU'],
          enabled: false,
        }),
      { wrapper: makeWrapper(client) },
    );
    expect(mockReadContract).not.toHaveBeenCalled();
  });

  it('attaches meta.tier and meta.touches to the query', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    mockReadContract.mockResolvedValue(0n);
    renderHook(
      () =>
        useUltraFreshRead({
          contract: { address: '0xSOF', abi: [] },
          fn: 'balanceOf',
          args: ['0xU'],
          touches: ['0xSOF', '0xCURVE'],
        }),
      { wrapper: makeWrapper(client) },
    );
    await waitFor(() => {
      const queries = client.getQueryCache().getAll();
      expect(queries.length).toBeGreaterThan(0);
      expect(queries[0].meta).toEqual({ tier: 'ultraFresh', touches: ['0xSOF', '0xCURVE'] });
    });
  });
});
