import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useWarmRead } from '../useWarmRead';

function makeWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

describe('useWarmRead', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('fetches from VITE_API_BASE_URL + path', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ id: 1 }),
    });
    const { result } = renderHook(
      () => useWarmRead({ path: '/seasons/all' }),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => expect(result.current.data).toEqual({ id: 1 }));
    expect(fetchSpy.mock.calls[0][0]).toContain('/seasons/all');
  });

  it('serializes params as query string', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ([]),
    });
    renderHook(
      () =>
        useWarmRead({
          path: '/transactions/positions/:user/:season',
          params: { user: '0xUser', season: 5 },
        }),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    expect(fetchSpy.mock.calls[0][0]).toMatch(/\/transactions\/positions\/0xUser\/5$/);
  });
});
