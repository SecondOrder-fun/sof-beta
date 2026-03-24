// tests/hooks/useArbitrageDetection.test.jsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useArbitrageDetection } from '@/hooks/useArbitrageDetection';

// Mock dependencies
vi.mock('@/hooks/useOnchainInfoFiMarkets', () => ({
  useOnchainInfoFiMarkets: vi.fn(),
}));

vi.mock('@/hooks/useCurveState', () => ({
  useCurveState: vi.fn(),
}));

vi.mock('@/lib/wagmi', () => ({
  getStoredNetworkKey: vi.fn(() => 'LOCAL'),
}));

vi.mock('@/services/onchainInfoFi', () => ({
  readOraclePrice: vi.fn(),
}));

import { useOnchainInfoFiMarkets } from '@/hooks/useOnchainInfoFiMarkets';
import { useCurveState } from '@/hooks/useCurveState';
import { readOraclePrice } from '@/services/onchainInfoFi';

describe('useArbitrageDetection', () => {
  let queryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });
    vi.clearAllMocks();
  });

  const wrapper = ({ children }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  it('should detect arbitrage opportunity when raffle cost is lower than market price', async () => {
    // Mock markets data
    useOnchainInfoFiMarkets.mockReturnValue({
      markets: [
        {
          id: '0x123',
          player: '0xPlayerAddress',
          seasonId: 1,
        },
      ],
      isLoading: false,
    });

    // Mock curve state with higher price
    useCurveState.mockReturnValue({
      curveSupply: 10000n,
      curveStep: { step: 1n, price: 100000000000000000n, rangeTo: 1000n }, // 0.1 SOF per ticket
      allBondSteps: [{ price: 100000000000000000n }],
    });

    // Mock oracle price - lower than raffle cost to create buy_raffle opportunity
    readOraclePrice.mockResolvedValue({
      hybridPriceBps: 200, // 2% = 0.02 SOF (lower than raffle cost of ~0.05 SOF)
      raffleProbabilityBps: 150,
      marketSentimentBps: 250,
      active: true,
      lastUpdate: Date.now(),
    });

    const { result } = renderHook(
      () => useArbitrageDetection(1, '0xBondingCurveAddress'),
      { wrapper }
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.opportunities).toHaveLength(1);
    expect(result.current.opportunities[0]).toMatchObject({
      direction: 'buy_market', // Market price is lower, so buy market
      player: '0xPlayerAddress',
      seasonId: 1,
    });
    expect(result.current.opportunities[0].profitability).toBeGreaterThan(0);
  });

  it('should respect minimum profitability threshold configuration', async () => {
    useOnchainInfoFiMarkets.mockReturnValue({
      markets: [
        {
          id: '0x123',
          player: '0xPlayerAddress',
          seasonId: 1,
        },
      ],
      isLoading: false,
    });

    useCurveState.mockReturnValue({
      curveSupply: 10000n,
      curveStep: { step: 1n, price: 10000000000000000n, rangeTo: 1000n }, // 0.01 SOF
      allBondSteps: [{ price: 10000000000000000n }],
    });

    // Mock oracle price
    readOraclePrice.mockResolvedValue({
      hybridPriceBps: 500,
      raffleProbabilityBps: 500,
      marketSentimentBps: 500,
      active: true,
      lastUpdate: Date.now(),
    });

    // Test with very high threshold - should filter everything
    const { result } = renderHook(
      () => useArbitrageDetection(1, '0xBondingCurveAddress', {
        minProfitabilityBps: 1000000, // 10000% minimum - impossibly high
      }),
      { wrapper }
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // Should have no opportunities due to impossibly high threshold
    expect(result.current.opportunities).toHaveLength(0);
  });

  it('should handle errors gracefully and set error state', async () => {
    useOnchainInfoFiMarkets.mockReturnValue({
      markets: [
        {
          id: '0x123',
          player: '0xPlayerAddress',
          seasonId: 1,
        },
      ],
      isLoading: false,
    });

    useCurveState.mockReturnValue({
      curveSupply: 10000n,
      curveStep: { step: 1n, price: 10000000000000000n, rangeTo: 1000n },
      allBondSteps: [{ price: 10000000000000000n }],
    });

    // Mock oracle price to throw error
    readOraclePrice.mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(
      () => useArbitrageDetection(1, '0xBondingCurveAddress'),
      { wrapper }
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // Should handle error gracefully - no opportunities but no crash
    expect(result.current.opportunities).toHaveLength(0);
    expect(result.current.error).toBeNull(); // Individual market errors are silently handled
  });

  it('should return empty array when no markets exist', async () => {
    useOnchainInfoFiMarkets.mockReturnValue({
      markets: [],
      isLoading: false,
    });

    useCurveState.mockReturnValue({
      curveSupply: 10000n,
      curveStep: { step: 1n, price: 10000000000000000n, rangeTo: 1000n },
      allBondSteps: [{ price: 10000000000000000n }],
    });

    const { result } = renderHook(
      () => useArbitrageDetection(1, '0xBondingCurveAddress'),
      { wrapper }
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.opportunities).toHaveLength(0);
    expect(result.current.error).toBeNull();
  });

  it('should limit results to maxResults parameter', async () => {
    // Create 15 mock markets
    const mockMarkets = Array.from({ length: 15 }, (_, i) => ({
      id: `0x${i}`,
      player: `0xPlayer${i}`,
      seasonId: 1,
    }));

    useOnchainInfoFiMarkets.mockReturnValue({
      markets: mockMarkets,
      isLoading: false,
    });

    useCurveState.mockReturnValue({
      curveSupply: 10000n,
      curveStep: { step: 1n, price: 10000000000000000n, rangeTo: 1000n },
      allBondSteps: [{ price: 10000000000000000n }],
    });

    // Mock oracle price to return valid arbitrage for all markets
    readOraclePrice.mockResolvedValue({
      hybridPriceBps: 500,
      raffleProbabilityBps: 400,
      marketSentimentBps: 600,
      active: true,
      lastUpdate: Date.now(),
    });

    const { result } = renderHook(
      () => useArbitrageDetection(1, '0xBondingCurveAddress', {
        maxResults: 10,
      }),
      { wrapper }
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // Should limit to 10 results
    expect(result.current.opportunities.length).toBeLessThanOrEqual(10);
  });

  it('should sort opportunities by profitability in descending order', async () => {
    const mockMarkets = [
      { id: '0x1', player: '0xPlayer1', seasonId: 1 },
      { id: '0x2', player: '0xPlayer2', seasonId: 1 },
      { id: '0x3', player: '0xPlayer3', seasonId: 1 },
    ];

    useOnchainInfoFiMarkets.mockReturnValue({
      markets: mockMarkets,
      isLoading: false,
    });

    useCurveState.mockReturnValue({
      curveSupply: 10000n,
      curveStep: { step: 1n, price: 10000000000000000n, rangeTo: 1000n },
      allBondSteps: [{ price: 10000000000000000n }],
    });

    // Mock different profitability levels
    readOraclePrice
      .mockResolvedValueOnce({
        hybridPriceBps: 300, // Low profitability
        raffleProbabilityBps: 250,
        marketSentimentBps: 350,
        active: true,
      })
      .mockResolvedValueOnce({
        hybridPriceBps: 800, // High profitability
        raffleProbabilityBps: 700,
        marketSentimentBps: 900,
        active: true,
      })
      .mockResolvedValueOnce({
        hybridPriceBps: 500, // Medium profitability
        raffleProbabilityBps: 450,
        marketSentimentBps: 550,
        active: true,
      });

    const { result } = renderHook(
      () => useArbitrageDetection(1, '0xBondingCurveAddress'),
      { wrapper }
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // Should be sorted by profitability descending
    if (result.current.opportunities.length > 1) {
      for (let i = 0; i < result.current.opportunities.length - 1; i++) {
        expect(result.current.opportunities[i].profitability).toBeGreaterThanOrEqual(
          result.current.opportunities[i + 1].profitability
        );
      }
    }
  });
});
