import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { getSeasonGroup } from '../RaffleList';
import RaffleList from '../RaffleList';

describe('getSeasonGroup', () => {
  it('maps NotStarted (0) to upcoming', () => {
    expect(getSeasonGroup(0)).toBe('upcoming');
  });
  it('maps Active (1) to active', () => {
    expect(getSeasonGroup(1)).toBe('active');
  });
  it('maps EndRequested (2) to settling', () => {
    expect(getSeasonGroup(2)).toBe('settling');
  });
  it('maps VRFPending (3) to settling', () => {
    expect(getSeasonGroup(3)).toBe('settling');
  });
  it('maps Distributing (4) to settling', () => {
    expect(getSeasonGroup(4)).toBe('settling');
  });
  it('maps Completed (5) to complete', () => {
    expect(getSeasonGroup(5)).toBe('complete');
  });
  it('maps Cancelled (6) to complete', () => {
    expect(getSeasonGroup(6)).toBe('complete');
  });
  it('falls back to active for unknown values', () => {
    expect(getSeasonGroup(99)).toBe('active');
  });
});

// Stub heavy descendants — this test exercises tabs only.
vi.mock('@/components/raffles/SeasonCard', () => ({
  SeasonCard: ({ season }) => <div data-testid={`season-card-${season.id}`} />,
}));
vi.mock('@/components/mobile/MobileRafflesList', () => ({
  default: () => <div data-testid="mobile-list" />,
}));
vi.mock('@/components/mobile/BuySellSheet', () => ({
  default: () => null,
}));
vi.mock('@/components/gating/PasswordGateModal', () => ({
  default: () => null,
}));
vi.mock('@/components/gating/SignatureGateModal', () => ({
  default: () => null,
}));
vi.mock('@/components/common/skeletons/SeasonCardSkeleton', () => ({
  default: () => <div data-testid="skeleton" />,
}));

vi.mock('@/hooks/useAllSeasons', () => ({
  useAllSeasons: () => ({
    data: [
      { id: 1, status: 0, totalTickets: 0n, config: { name: 'Up', startTime: 0n, endTime: 0n, bondingCurve: '0xa' } },
      { id: 2, status: 1, totalTickets: 0n, config: { name: 'Act', startTime: 0n, endTime: 0n, bondingCurve: '0xb' } },
      { id: 3, status: 3, totalTickets: 0n, config: { name: 'Set', startTime: 0n, endTime: 0n, bondingCurve: '0xc' } },
      { id: 4, status: 5, totalTickets: 0n, config: { name: 'Done', startTime: 0n, endTime: 0n, bondingCurve: '0xd' } },
      { id: 5, status: 5, totalTickets: 0n, config: { name: 'Done2', startTime: 0n, endTime: 0n, bondingCurve: '0xe' } },
    ],
    isLoading: false,
    error: null,
  }),
}));
vi.mock('@/hooks/useSeasonWinnerSummaries', () => ({
  useSeasonWinnerSummaries: () => ({ data: {} }),
}));
vi.mock('@/hooks/usePlatform', () => ({ usePlatform: () => ({ isMobile: false, isFarcaster: false }) }));
vi.mock('wagmi', () => ({
  useAccount: () => ({ address: undefined, isConnected: false, chainId: 84532 }),
  useChains: () => [],
}));
vi.mock('@/hooks/useLoginModal', () => ({ useLoginModal: () => ({ openLoginModal: () => {} }) }));
vi.mock('@/hooks/useRaffleAccount', () => ({ useRaffleAccount: () => ({ sma: undefined }) }));
vi.mock('@/hooks/useProfileData', () => ({ useProfileData: () => ({ seasonBalancesQuery: { data: undefined } }) }));
vi.mock('@/hooks/useSeasonGating', () => ({
  useSeasonGating: () => ({ isVerified: undefined, verifyPassword: () => {}, verifySignature: () => {}, gates: [], refetch: () => {} }),
  GateType: { PASSWORD: 0, SIGNATURE: 1 },
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k) => k }),
}));

describe('RaffleList tabs', () => {
  it('renders 4 tabs with correct counts', () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <RaffleList />
        </MemoryRouter>
      </QueryClientProvider>
    );
    // Tab labels (translation key falls through as the value due to mock)
    expect(screen.getByRole('tab', { name: /tabs.upcoming/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /tabs.active/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /tabs.settling/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /tabs.complete/ })).toBeInTheDocument();
    // Counts: 1 upcoming, 1 active, 1 settling, 2 complete
    const upcomingTab = screen.getByRole('tab', { name: /tabs.upcoming/ });
    expect(upcomingTab.textContent).toMatch(/1/);
    const completeTab = screen.getByRole('tab', { name: /tabs.complete/ });
    expect(completeTab.textContent).toMatch(/2/);
  });

  it('Active tab is active by default', () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <RaffleList />
        </MemoryRouter>
      </QueryClientProvider>
    );
    const activeTab = screen.getByRole('tab', { name: /tabs.active/ });
    expect(activeTab).toHaveAttribute('data-state', 'active');
  });
});
