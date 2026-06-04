import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useCurveState } from '../useCurveState';

// useCurveState subscribes to SSE and (on warm-cache miss) reads the bond-step
// ladder straight from chain. Both are stubbed so the test only exercises the
// loading-signal logic, not the network.
vi.mock('@/hooks/chain/useLiveSubscription', () => ({
  useLiveSubscription: () => {},
}));
vi.mock('@/lib/wagmi', () => ({ getStoredNetworkKey: () => 'LOCAL' }));

let chainSteps = [];
vi.mock('@/lib/viemClient', () => ({
  buildPublicClient: () => ({ readContract: async () => chainSteps }),
}));

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

const ADDR = '0xCurve';

function mockFetch({ state, steps, stepsOk = true }) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
    if (String(url).includes('/steps')) {
      return { ok: stepsOk, status: stepsOk ? 200 : 404, json: async () => steps };
    }
    if (String(url).includes('/state')) {
      return { ok: true, json: async () => state };
    }
    return { ok: true, json: async () => ({}) };
  });
}

describe('useCurveState — isPriceLoading', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    chainSteps = [];
  });

  it('is true while the step ladder is still resolving, then clears', async () => {
    mockFetch({
      state: null,
      steps: [{ rangeTo: '100', price: '2000000000000000000' }],
    });
    const { result } = renderHook(() => useCurveState(ADDR), {
      wrapper: makeWrapper(),
    });
    // Both queries pending on first render → loading.
    expect(result.current.isPriceLoading).toBe(true);
    await waitFor(() => expect(result.current.isPriceLoading).toBe(false));
    expect(result.current.allBondSteps).toHaveLength(1);
  });

  it('clears via the on-chain fallback when the warm steps cache is empty', async () => {
    chainSteps = [{ rangeTo: 100n, price: 2n * 10n ** 18n }];
    mockFetch({ state: null, steps: [] }); // warm cache returns no steps
    const { result } = renderHook(() => useCurveState(ADDR), {
      wrapper: makeWrapper(),
    });
    expect(result.current.isPriceLoading).toBe(true);
    await waitFor(() => expect(result.current.allBondSteps).toHaveLength(1));
    expect(result.current.isPriceLoading).toBe(false);
  });

  it('stops loading once steps resolve genuinely empty (real zero not hidden forever)', async () => {
    chainSteps = []; // chain fallback also empty
    mockFetch({ state: null, steps: [] });
    const { result } = renderHook(() => useCurveState(ADDR), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.isPriceLoading).toBe(false));
    expect(result.current.allBondSteps).toHaveLength(0);
  });

  it('is not loading when no bonding curve address is provided', () => {
    mockFetch({ state: null, steps: [] });
    const { result } = renderHook(() => useCurveState(undefined), {
      wrapper: makeWrapper(),
    });
    expect(result.current.isPriceLoading).toBe(false);
  });
});
