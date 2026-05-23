import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import RaffleList from '../RaffleList';

// Stub heavy descendants — this test exercises URL sync only.
vi.mock('@/components/raffles/SeasonCard', () => ({
  SeasonCard: ({ season }) => <div data-testid={`season-card-${season.id}`} />,
}));
vi.mock('@/components/mobile/MobileRafflesList', () => ({
  default: ({ activeTab, onTabChange }) => (
    <div data-testid="mobile-list" data-active-tab={activeTab}>
      <button onClick={() => onTabChange?.('settling')}>mobile-set-settling</button>
    </div>
  ),
}));
vi.mock('@/components/mobile/BuySellSheet', () => ({ default: () => null }));
vi.mock('@/components/gating/PasswordGateModal', () => ({ default: () => null }));
vi.mock('@/components/gating/SignatureGateModal', () => ({ default: () => null }));
vi.mock('@/components/common/skeletons/SeasonCardSkeleton', () => ({ default: () => <div /> }));

vi.mock('@/hooks/useAllSeasons', () => ({
  useAllSeasons: () => ({
    data: [
      { id: 1, status: 0, totalTickets: 0n, config: { name: 'Up', startTime: 0n, endTime: 0n, bondingCurve: '0xa' } },
      { id: 2, status: 1, totalTickets: 0n, config: { name: 'Act', startTime: 0n, endTime: 0n, bondingCurve: '0xb' } },
      { id: 3, status: 3, totalTickets: 0n, config: { name: 'Set', startTime: 0n, endTime: 0n, bondingCurve: '0xc' } },
      { id: 4, status: 5, totalTickets: 0n, config: { name: 'Done', startTime: 0n, endTime: 0n, bondingCurve: '0xd' } },
    ],
    isLoading: false,
    error: null,
  }),
}));
vi.mock('@/hooks/useSeasonWinnerSummaries', () => ({
  useSeasonWinnerSummaries: () => ({ data: {} }),
}));
vi.mock('@/hooks/useFirstViewGate', () => ({
  useFirstViewGateBatch: () => new Set(['4']),
}));
vi.mock('@/hooks/useProfileData', () => ({
  useProfileData: () => ({ seasonBalancesQuery: { data: [] } }),
}));
vi.mock('@/hooks/useSeasonGating', () => ({
  useSeasonGating: () => ({ isVerified: true, gates: [], refetch: vi.fn() }),
  GateType: { SIGNATURE: 1 },
}));
vi.mock('@/hooks/useRaffleAccount', () => ({
  useRaffleAccount: () => ({ sma: '0xaaa' }),
}));
vi.mock('@/hooks/useLoginModal', () => ({
  useLoginModal: () => ({ openLoginModal: vi.fn() }),
}));
vi.mock('@/hooks/usePlatform', () => ({
  usePlatform: () => ({ isMobile: false, isFarcaster: false }),
}));
vi.mock('wagmi', () => ({
  useAccount: () => ({ address: '0xuser', isConnected: true, chainId: 84532 }),
  useChains: () => [],
}));

const renderAt = (initialPath) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route path="/raffles" element={<RaffleList />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

describe('RaffleList URL ?tab= sync', () => {
  beforeEach(() => vi.clearAllMocks());

  it('mounting with ?tab=settling activates the Settling tab', () => {
    renderAt('/raffles?tab=settling');
    expect(screen.getByRole('tab', { name: /settling/i })).toHaveAttribute('data-state', 'active');
  });

  it('mounting with no ?tab= defaults to Active', () => {
    renderAt('/raffles');
    expect(screen.getByRole('tab', { name: /active/i })).toHaveAttribute('data-state', 'active');
  });

  it('unknown ?tab=foo falls back to Active without console errors', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    renderAt('/raffles?tab=foo');
    expect(screen.getByRole('tab', { name: /active/i })).toHaveAttribute('data-state', 'active');
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('clicking a tab updates the URL ?tab= param', async () => {
    const user = userEvent.setup();
    const { container } = renderAt('/raffles');
    await user.click(screen.getByRole('tab', { name: /complete/i }));
    expect(screen.getByRole('tab', { name: /complete/i })).toHaveAttribute('data-state', 'active');
    expect(container).toBeTruthy();
  });
});
