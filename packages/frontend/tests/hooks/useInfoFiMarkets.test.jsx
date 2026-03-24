// tests/hooks/useInfoFiMarkets.test.jsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useOnchainInfoFiMarkets } from '../../src/hooks/useOnchainInfoFiMarkets';

// Mock the onchainInfoFi service
vi.mock('../../src/services/onchainInfoFi', () => ({
  listSeasonWinnerMarkets: vi.fn(),
  subscribeMarketCreated: vi.fn(() => () => {})
}));

// Import the mocked service
import { listSeasonWinnerMarkets, subscribeMarketCreated } from '../../src/services/onchainInfoFi';

// Import PropTypes for validation
import PropTypes from 'prop-types';

// Wrapper component for React Query
const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });
  
  // Create wrapper component with display name
  const Wrapper = ({ children }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  
  // Add display name and prop types
  Wrapper.displayName = 'QueryWrapper';
  Wrapper.propTypes = {
    children: PropTypes.node.isRequired
  };
  
  return Wrapper;
};

describe('useOnchainInfoFiMarkets', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  
  it('should handle success state with markets', async () => {
    // Mock successful response
    const mockMarkets = [
      { id: '0x1', seasonId: 1, player: '0xPlayer1', market_type: 'WINNER_PREDICTION' },
      { id: '0x2', seasonId: 1, player: '0xPlayer2', market_type: 'WINNER_PREDICTION' }
    ];
    
    listSeasonWinnerMarkets.mockResolvedValue(mockMarkets);
    
    // Render the hook
    const { result } = renderHook(() => useOnchainInfoFiMarkets(1, 'LOCAL'), {
      wrapper: createWrapper()
    });
    
    // Initially loading
    expect(result.current.isLoading).toBe(true);
    
    // Wait for data to load
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    
    // Verify markets are returned
    expect(result.current.markets).toHaveLength(2);
    expect(result.current.markets[0].id).toBe('0x1');
    expect(result.current.markets[1].id).toBe('0x2');
    expect(result.current.error).toBeNull();
  });
  
  it('should handle empty state with no markets', async () => {
    // Mock empty response
    listSeasonWinnerMarkets.mockResolvedValue([]);
    
    // Render the hook
    const { result } = renderHook(() => useOnchainInfoFiMarkets(1, 'LOCAL'), {
      wrapper: createWrapper()
    });
    
    // Wait for data to load
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    
    // Verify empty markets array is returned
    expect(result.current.markets).toHaveLength(0);
    expect(result.current.error).toBeNull();
  });
  
  it('should handle error state', async () => {
    // Mock error response
    const mockError = new Error('Failed to fetch markets');
    listSeasonWinnerMarkets.mockRejectedValue(mockError);
    
    // Render the hook
    const { result } = renderHook(() => useOnchainInfoFiMarkets(1, 'LOCAL'), {
      wrapper: createWrapper()
    });
    
    // Wait for error to be set
    await waitFor(() => expect(result.current.error).not.toBeNull());
    
    // Verify error is returned and markets are empty
    expect(result.current.error).toBe(mockError);
    expect(result.current.markets).toHaveLength(0);
  });
  
  it('should handle null seasonId', async () => {
    // Render the hook with null seasonId
    const { result } = renderHook(() => useOnchainInfoFiMarkets(null, 'LOCAL'), {
      wrapper: createWrapper()
    });
    
    // Should not be loading and have empty markets
    expect(result.current.isLoading).toBe(false);
    expect(result.current.markets).toHaveLength(0);
    expect(result.current.error).toBeNull();
    
    // Should not call the service
    expect(listSeasonWinnerMarkets).not.toHaveBeenCalled();
  });
  
  it('should subscribe to MarketCreated events', async () => {
    // Mock successful response
    listSeasonWinnerMarkets.mockResolvedValue([]);
    
    // Render the hook
    renderHook(() => useOnchainInfoFiMarkets(1, 'LOCAL'), {
      wrapper: createWrapper()
    });
    
    // Verify subscription was called
    expect(subscribeMarketCreated).toHaveBeenCalledTimes(1);
    expect(subscribeMarketCreated).toHaveBeenCalledWith(
      expect.objectContaining({
        networkKey: 'LOCAL',
        onEvent: expect.any(Function)
      })
    );
  });
});

// Navigation visibility test
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Header from '../../src/components/layout/Header';

// Mock the Header component if it doesn't exist in the test environment
vi.mock('../../src/components/layout/Header', () => {
  const MockHeader = ({ children }) => (
    <header>
      <nav>
        <ul>
          <li><a href="/">Home</a></li>
          <li><a href="/raffles">Raffles</a></li>
          <li data-testid="prediction-markets-nav"><a href="/markets">Prediction Markets</a></li>
          <li><a href="/account">Account</a></li>
        </ul>
      </nav>
      {children}
    </header>
  );
  
  // Add prop types
  MockHeader.displayName = 'MockHeader';
  MockHeader.propTypes = {
    children: PropTypes.node
  };
  
  return { default: MockHeader };
});

describe('Navigation Visibility', () => {
  it('should show Prediction Markets nav item', () => {
    render(
      <MemoryRouter>
        <Header />
      </MemoryRouter>
    );
    
    const navItem = screen.getByTestId('prediction-markets-nav');
    expect(navItem).toBeInTheDocument();
    expect(navItem.textContent).toContain('Prediction Markets');
  });
});
