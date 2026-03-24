// tests/components/InfoFiMarketsPanel.test.jsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import PropTypes from 'prop-types';
import InfoFiMarketsPanel from '../../src/components/admin/InfoFiMarketsPanel';

// Mock i18next
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key, params) => {
      // Simple mock translation function
      if (key === 'infoFiMarkets.title') return 'InfoFi Markets Status';
      if (key === 'infoFiMarkets.description') return 'View all InfoFi prediction markets grouped by season';
      if (key === 'infoFiMarkets.loading') return 'Loading markets...';
      if (key === 'infoFiMarkets.noMarkets') return 'No InfoFi markets found';
      if (key === 'infoFiMarkets.error') return 'Error loading markets';
      if (key === 'infoFiMarkets.seasonNumber') return `Season ${params?.number}`;
      if (key === 'infoFiMarkets.marketCount') return `${params?.count} markets (${params?.active} active)`;
      if (key === 'infoFiMarkets.summary') return `${params?.total} total markets (${params?.active} active)`;
      return key;
    },
  }),
}));

// Mock the hook
vi.mock('../../src/hooks/useInfoFiMarketsAdmin', () => ({
  useInfoFiMarketsAdmin: vi.fn(),
}));

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  
  const Wrapper = ({ children }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  
  Wrapper.displayName = 'QueryClientWrapper';
  Wrapper.propTypes = {
    children: PropTypes.node.isRequired,
  };
  
  return Wrapper;
};

describe('InfoFiMarketsPanel', () => {
  it('should display loading state', async () => {
    const { useInfoFiMarketsAdmin } = await import('../../src/hooks/useInfoFiMarketsAdmin');
    useInfoFiMarketsAdmin.mockReturnValue({
      data: null,
      isLoading: true,
      error: null,
    });

    render(<InfoFiMarketsPanel />, { wrapper: createWrapper() });

    expect(screen.getByText('InfoFi Markets Status')).toBeInTheDocument();
    expect(screen.getByText('Loading markets...')).toBeInTheDocument();
  });

  it('should display error state', async () => {
    const { useInfoFiMarketsAdmin } = await import('../../src/hooks/useInfoFiMarketsAdmin');
    useInfoFiMarketsAdmin.mockReturnValue({
      data: null,
      isLoading: false,
      error: { message: 'Failed to fetch' },
    });

    render(<InfoFiMarketsPanel />, { wrapper: createWrapper() });

    expect(screen.getByText('InfoFi Markets Status')).toBeInTheDocument();
    expect(screen.getByText(/Error loading markets/)).toBeInTheDocument();
    expect(screen.getByText(/Failed to fetch/)).toBeInTheDocument();
  });

  it('should display empty state when no markets exist', async () => {
    const { useInfoFiMarketsAdmin } = await import('../../src/hooks/useInfoFiMarketsAdmin');
    useInfoFiMarketsAdmin.mockReturnValue({
      data: {
        seasons: [],
        totalMarkets: 0,
        totalActiveMarkets: 0,
      },
      isLoading: false,
      error: null,
    });

    render(<InfoFiMarketsPanel />, { wrapper: createWrapper() });

    expect(screen.getByText('InfoFi Markets Status')).toBeInTheDocument();
    expect(screen.getByText('No InfoFi markets found')).toBeInTheDocument();
  });

  it('should display markets grouped by season', async () => {
    const { useInfoFiMarketsAdmin } = await import('../../src/hooks/useInfoFiMarketsAdmin');
    useInfoFiMarketsAdmin.mockReturnValue({
      data: {
        seasons: [
          {
            seasonId: 1,
            totalMarkets: 2,
            activeMarkets: 2,
            totalVolume: 150,
            markets: [
              {
                id: 1,
                seasonId: 1,
                marketType: 'WINNER_PREDICTION',
                playerAddress: '0x1234567890123456789012345678901234567890',
                volume24h: '10',
                priceChange24h: '2',
                totalVolume: '100',
                isActive: true,
              },
              {
                id: 2,
                seasonId: 1,
                marketType: 'POSITION_SIZE',
                playerAddress: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
                volume24h: '5',
                priceChange24h: '-1',
                totalVolume: '50',
                isActive: true,
              },
            ],
          },
        ],
        totalMarkets: 2,
        totalActiveMarkets: 2,
      },
      isLoading: false,
      error: null,
    });

    render(<InfoFiMarketsPanel />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText('InfoFi Markets Status')).toBeInTheDocument();
      expect(screen.getByText('Season 1')).toBeInTheDocument();
      expect(screen.getByText('2 markets (2 active)')).toBeInTheDocument();
    });
  });

  it('should format market names correctly', async () => {
    const { useInfoFiMarketsAdmin } = await import('../../src/hooks/useInfoFiMarketsAdmin');
    useInfoFiMarketsAdmin.mockReturnValue({
      data: {
        seasons: [
          {
            seasonId: 1,
            totalMarkets: 1,
            activeMarkets: 1,
            totalVolume: 100,
            markets: [
              {
                id: 1,
                seasonId: 1,
                marketType: 'WINNER_PREDICTION',
                playerAddress: '0x1234567890123456789012345678901234567890',
                volume24h: '10',
                priceChange24h: '0',
                totalVolume: '100',
                isActive: true,
              },
            ],
          },
        ],
        totalMarkets: 1,
        totalActiveMarkets: 1,
      },
      isLoading: false,
      error: null,
    });

    render(<InfoFiMarketsPanel />, { wrapper: createWrapper() });

    await waitFor(() => {
      // Market type should be formatted from WINNER_PREDICTION to "Winner Prediction"
      expect(screen.getByText(/Winner Prediction/)).toBeInTheDocument();
      // Address should be shortened to 0x1234...7890
      expect(screen.getByText(/0x1234...7890/)).toBeInTheDocument();
    });
  });
});
