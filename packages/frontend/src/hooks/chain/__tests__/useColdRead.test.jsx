import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useColdRead } from '../useColdRead';

function makeWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

describe('useColdRead', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('fetches from /api/blockscout/<endpoint>', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ items: [{ address: '0xa' }] }),
    });
    const { result } = renderHook(
      () =>
        useColdRead({
          endpoint: 'tokens/:address/holders',
          params: { address: '0xToken' },
        }),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data).toEqual({ items: [{ address: '0xa' }] });
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/blockscout/tokens/0xToken/holders'),
      expect.any(Object),
    );
  });

  it('respects enabled=false', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => ({}) });
    renderHook(
      () =>
        useColdRead({
          endpoint: 'tokens/:address/holders',
          params: { address: '0xT' },
          enabled: false,
        }),
      { wrapper: makeWrapper() },
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns normalized error on non-OK response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Server Error',
    });
    const { result } = renderHook(
      () => useColdRead({ endpoint: 'tokens/:address/holders', params: { address: '0xT' } }),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => expect(result.current.isError).toBe(true), { timeout: 5000 });
    expect(result.current.error).toMatchObject({ code: 500, retryable: true });
  });
});
