import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

let mockAddress = null;
vi.mock('wagmi', () => ({
  useAccount: () => ({ address: mockAddress }),
}));

import {
  useFirstViewGate,
  useFirstViewGateBatch,
} from '../useFirstViewGate';

describe('useFirstViewGate', () => {
  beforeEach(() => {
    localStorage.clear();
    mockAddress = null;
  });
  afterEach(() => {
    localStorage.clear();
  });

  it('hasSeen is false initially', () => {
    const { result } = renderHook(() => useFirstViewGate('celebrated', 42));
    expect(result.current.hasSeen).toBe(false);
  });

  it('markAsSeen flips hasSeen to true', () => {
    const { result } = renderHook(() => useFirstViewGate('celebrated', 42));
    act(() => result.current.markAsSeen());
    expect(result.current.hasSeen).toBe(true);
  });

  it('writes ISO timestamp under the expected key (anon viewer)', () => {
    const { result } = renderHook(() => useFirstViewGate('celebrated', 42));
    act(() => result.current.markAsSeen());
    const raw = localStorage.getItem('sof:firstview:celebrated:anon:42');
    expect(raw).toBeTruthy();
    expect(() => new Date(raw)).not.toThrow();
  });

  it('uses connected wallet address (lower-cased) in key', () => {
    mockAddress = '0xABCDEF0000000000000000000000000000000001';
    const { result } = renderHook(() => useFirstViewGate('celebrated', 42));
    act(() => result.current.markAsSeen());
    expect(
      localStorage.getItem(
        'sof:firstview:celebrated:0xabcdef0000000000000000000000000000000001:42',
      ),
    ).toBeTruthy();
  });

  it('BigInt and Number itemKeys produce the same storage key', () => {
    const { result: r1 } = renderHook(() => useFirstViewGate('celebrated', 42));
    act(() => r1.current.markAsSeen());
    const { result: r2 } = renderHook(() => useFirstViewGate('celebrated', 42n));
    expect(r2.current.hasSeen).toBe(true);
  });

  it('different itemKeys are independent', () => {
    const { result: r1 } = renderHook(() => useFirstViewGate('celebrated', 1));
    const { result: r2 } = renderHook(() => useFirstViewGate('celebrated', 2));
    act(() => r1.current.markAsSeen());
    expect(r2.current.hasSeen).toBe(false);
  });

  it('different viewers are independent', () => {
    mockAddress = '0xaaa0000000000000000000000000000000000001';
    const { result: r1 } = renderHook(() => useFirstViewGate('celebrated', 42));
    act(() => r1.current.markAsSeen());

    mockAddress = '0xbbb0000000000000000000000000000000000002';
    const { result: r2 } = renderHook(() => useFirstViewGate('celebrated', 42));
    expect(r2.current.hasSeen).toBe(false);
  });

  it('storage event from another tab updates hasSeen', () => {
    const { result } = renderHook(() => useFirstViewGate('celebrated', 42));
    expect(result.current.hasSeen).toBe(false);

    act(() => {
      localStorage.setItem(
        'sof:firstview:celebrated:anon:42',
        new Date().toISOString(),
      );
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: 'sof:firstview:celebrated:anon:42',
          newValue: 'x',
        }),
      );
    });
    expect(result.current.hasSeen).toBe(true);
  });

  it('localStorage throw on set is swallowed (hasSeen stays false)', () => {
    const orig = Storage.prototype.setItem;
    Storage.prototype.setItem = vi.fn(() => {
      throw new DOMException('QuotaExceeded');
    });
    const { result } = renderHook(() => useFirstViewGate('celebrated', 42));
    expect(() => act(() => result.current.markAsSeen())).not.toThrow();
    expect(result.current.hasSeen).toBe(false);
    Storage.prototype.setItem = orig;
  });
});

describe('useFirstViewGateBatch', () => {
  beforeEach(() => {
    localStorage.clear();
    mockAddress = null;
  });

  it('returns Set of seen item keys (anon)', () => {
    localStorage.setItem(
      'sof:firstview:celebrated:anon:1',
      new Date().toISOString(),
    );
    localStorage.setItem(
      'sof:firstview:celebrated:anon:3',
      new Date().toISOString(),
    );
    const { result } = renderHook(() =>
      useFirstViewGateBatch('celebrated', [1, 2, 3]),
    );
    expect(result.current.has('1')).toBe(true);
    expect(result.current.has('2')).toBe(false);
    expect(result.current.has('3')).toBe(true);
  });

  it('normalises BigInt itemKeys to strings', () => {
    localStorage.setItem(
      'sof:firstview:celebrated:anon:5',
      new Date().toISOString(),
    );
    const { result } = renderHook(() =>
      useFirstViewGateBatch('celebrated', [5n, 6n]),
    );
    expect(result.current.has('5')).toBe(true);
    expect(result.current.has('6')).toBe(false);
  });

  it('returns referentially-stable Set when nothing changed across re-renders', () => {
    const { result, rerender } = renderHook(
      ({ ids }) => useFirstViewGateBatch('celebrated', ids),
      { initialProps: { ids: [1, 2] } },
    );
    const first = result.current;
    rerender({ ids: [1, 2] });
    expect(result.current).toBe(first);
  });
});
