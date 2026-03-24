// tests/hooks/useRaffleTransactions.test.jsx
/* eslint-disable no-undef */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useRaffleTransactions } from '@/hooks/useRaffleTransactions';

describe('useRaffleTransactions', () => {
  let queryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });
    vi.clearAllMocks();
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const wrapper = ({ children }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  it('should return empty transactions when seasonId is missing', () => {
    const { result } = renderHook(
      () => useRaffleTransactions('0x123', null),
      { wrapper }
    );

    expect(result.current.transactions).toEqual([]);
    expect(result.current.isLoading).toBe(false);
  });

  it('should return empty transactions when bondingCurveAddress is missing', () => {
    const { result } = renderHook(
      () => useRaffleTransactions(null, 1),
      { wrapper }
    );

    expect(result.current.transactions).toEqual([]);
    expect(result.current.isLoading).toBe(false);
  });

  it('should fetch and map transactions from API', async () => {
    const apiResponse = {
      transactions: [
        {
          tx_hash: '0xabc123',
          block_number: 100,
          block_timestamp: '2024-01-15T10:00:00.000Z',
          user_address: '0x1234567890123456789012345678901234567890',
          transaction_type: 'BUY',
          ticket_amount: 50,
          tickets_before: 0,
          tickets_after: 50,
        },
        {
          tx_hash: '0xdef456',
          block_number: 200,
          block_timestamp: '2024-01-15T11:00:00.000Z',
          user_address: '0x1234567890123456789012345678901234567890',
          transaction_type: 'SELL',
          ticket_amount: 10,
          tickets_before: 50,
          tickets_after: 40,
        },
      ],
    };

    globalThis.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(apiResponse),
      })
    );

    const { result } = renderHook(
      () => useRaffleTransactions('0x123', 1),
      { wrapper }
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.transactions).toHaveLength(2);

    // Check BUY mapping
    const buy = result.current.transactions[0];
    expect(buy.txHash).toBe('0xabc123');
    expect(buy.blockNumber).toBe(100);
    expect(buy.player).toBe('0x1234567890123456789012345678901234567890');
    expect(buy.type).toBe('buy');
    expect(buy.ticketsDelta).toBe(50n);
    expect(buy.oldTickets).toBe(0n);
    expect(buy.newTickets).toBe(50n);
    expect(buy.timestamp).toBe(Math.floor(new Date('2024-01-15T10:00:00.000Z').getTime() / 1000));

    // Check SELL mapping
    const sell = result.current.transactions[1];
    expect(sell.type).toBe('sell');
    expect(sell.ticketsDelta).toBe(-10n);
  });

  it('should handle API errors', async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({
        ok: false,
        status: 500,
      })
    );

    const { result } = renderHook(
      () => useRaffleTransactions('0x123', 1),
      { wrapper }
    );

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(result.current.error.message).toContain('500');
  });

  it('should handle empty API response', async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ transactions: [] }),
      })
    );

    const { result } = renderHook(
      () => useRaffleTransactions('0x123', 1),
      { wrapper }
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.transactions).toEqual([]);
  });

  it('should provide refetch function', async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ transactions: [] }),
      })
    );

    const { result } = renderHook(
      () => useRaffleTransactions('0x123', 1),
      { wrapper }
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(typeof result.current.refetch).toBe('function');
  });
});
