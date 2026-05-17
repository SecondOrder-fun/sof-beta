/*
  @vitest-environment jsdom
  Tests for useCurveState warm-read + SSE pattern.
  The old multicall/readContract path has been replaced by backend REST endpoints.
*/

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// --- minimal SSE registry mock so useLiveSubscription doesn't open real connections ---
vi.mock('@/hooks/chain/sseRegistry', () => ({
  subscribe: vi.fn(() => () => {}),
}));

const ADDR = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const LOWER = ADDR.toLowerCase();

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // eslint-disable-next-line react/display-name
  return ({ children }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

describe('useCurveState — warm-read + SSE pattern', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it('returns BigInt fields from /api/curve/:addr/state response', async () => {
    const statePayload = {
      currentSupply: '500',
      sofReserves: '1000',
      accumulatedFees: '50',
      currentStep: { index: '2', price: '1500000000000000000', rangeTo: '1000' },
    };
    const stepsPayload = [
      { rangeTo: '500', price: '1000000000000000000' },
      { rangeTo: '1000', price: '1500000000000000000' },
    ];

    global.fetch = vi.fn().mockImplementation((url) => {
      if (url.includes('/state')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(statePayload) });
      }
      if (url.includes('/steps')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(stepsPayload) });
      }
      return Promise.reject(new Error('unexpected fetch: ' + url));
    });

    const { useCurveState } = await import('@/hooks/useCurveState');

    const { result } = renderHook(
      () =>
        useCurveState(ADDR, {
          isActive: false,
          includeSteps: true,
          includeFees: true,
          enabled: true,
        }),
      { wrapper: makeWrapper() },
    );

    await waitFor(() => {
      expect(result.current.curveSupply).toBe(500n);
    });

    expect(result.current.curveReserves).toBe(1000n);
    expect(result.current.curveFees).toBe(50n);
    expect(result.current.curveStep?.step).toBe(2n);
    expect(result.current.curveStep?.price).toBe(1500000000000000000n);
    expect(result.current.curveStep?.rangeTo).toBe(1000n);
    expect(result.current.allBondSteps).toHaveLength(2);
    expect(result.current.allBondSteps[0].rangeTo).toBe(500n);
    expect(result.current.bondStepsPreview).toHaveLength(2);
  });

  it('returns zero defaults when state endpoint returns no data', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: () => Promise.resolve({}),
    });

    const { useCurveState } = await import('@/hooks/useCurveState');

    const { result } = renderHook(
      () => useCurveState(ADDR, { isActive: false, enabled: true }),
      { wrapper: makeWrapper() },
    );

    // Before data resolves, defaults are returned
    expect(result.current.curveSupply).toBe(0n);
    expect(result.current.curveReserves).toBe(0n);
    expect(result.current.curveFees).toBe(0n);
    expect(result.current.curveStep).toBeNull();
    expect(result.current.allBondSteps).toHaveLength(0);
  });

  it('exposes refreshCurveState and debouncedRefresh as functions', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    });

    const { useCurveState } = await import('@/hooks/useCurveState');

    const { result } = renderHook(
      () => useCurveState(ADDR, { enabled: true }),
      { wrapper: makeWrapper() },
    );

    expect(typeof result.current.refreshCurveState).toBe('function');
    expect(typeof result.current.debouncedRefresh).toBe('function');
  });

  it('respects enabled=false and skips fetch', async () => {
    global.fetch = vi.fn();

    const { useCurveState } = await import('@/hooks/useCurveState');

    renderHook(
      () => useCurveState(ADDR, { enabled: false }),
      { wrapper: makeWrapper() },
    );

    // Allow any pending microtasks
    await new Promise((r) => setTimeout(r, 50));
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('uses lowerAddr for query key so cache is address-normalised', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          currentSupply: '42',
          sofReserves: '0',
          accumulatedFees: '0',
          currentStep: { index: '0', price: '0', rangeTo: '0' },
        }),
    });

    const { useCurveState } = await import('@/hooks/useCurveState');
    const MIXED = '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

    const { result } = renderHook(
      () => useCurveState(MIXED, { isActive: false, enabled: true, includeSteps: false }),
      { wrapper: makeWrapper() },
    );

    await waitFor(() => {
      expect(result.current.curveSupply).toBe(42n);
    });

    // The fetch URL should contain the lowercase address
    const calledUrl = global.fetch.mock.calls[0][0];
    expect(calledUrl).toContain(MIXED.toLowerCase());
  });
});
