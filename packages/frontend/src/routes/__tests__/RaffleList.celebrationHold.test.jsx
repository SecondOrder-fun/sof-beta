import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import RaffleList from '@/routes/RaffleList';

// ── Heavy child stubs ─────────────────────────────────────────────────────────
vi.mock('@/components/raffles/SeasonCard', () => ({
  SeasonCard: ({ season }) => (
    <div data-testid={`season-card-${season.id}`}>Season {Number(season.id)}</div>
  ),
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

// ── Hooks ─────────────────────────────────────────────────────────────────────
vi.mock('@/hooks/useAllSeasons', () => ({
  useAllSeasons: () => ({
    data: [
      // status 5 = Completed → getSeasonGroup maps to 'complete'
      { id: 1, status: 5, totalTickets: 0n, config: { name: 'Season 1', startTime: 0n, endTime: 0n, bondingCurve: '0xa' } },
      // status 6 = Cancelled → getSeasonGroup maps to 'complete'
      { id: 2, status: 6, totalTickets: 0n, config: { name: 'Season 2', startTime: 0n, endTime: 0n, bondingCurve: '0xb' } },
      // status 1 = Active
      { id: 3, status: 1, totalTickets: 0n, config: { name: 'Season 3', startTime: 0n, endTime: 0n, bondingCurve: '0xc' } },
      // status 2 = EndRequested → 'settling'
      { id: 4, status: 2, totalTickets: 0n, config: { name: 'Season 4', startTime: 0n, endTime: 0n, bondingCurve: '0xd' } },
    ],
    isLoading: false,
    error: null,
  }),
}));
vi.mock('@/hooks/useSeasonWinnerSummaries', () => ({
  useSeasonWinnerSummaries: () => ({ data: {} }),
}));
vi.mock('@/hooks/usePlatform', () => ({
  usePlatform: () => ({ isMobile: false, isFarcaster: false }),
}));
vi.mock('wagmi', () => ({
  useAccount: () => ({ address: undefined, isConnected: false, chainId: 84532 }),
  useChains: () => [],
}));
vi.mock('@/hooks/useLoginModal', () => ({
  useLoginModal: () => ({ openLoginModal: () => {} }),
}));
vi.mock('@/hooks/useRaffleAccount', () => ({
  useRaffleAccount: () => ({ sma: undefined }),
}));
vi.mock('@/hooks/useProfileData', () => ({
  useProfileData: () => ({ seasonBalancesQuery: { data: undefined } }),
}));
vi.mock('@/hooks/useSeasonGating', () => ({
  useSeasonGating: () => ({
    isVerified: undefined,
    verifyPassword: () => {},
    verifySignature: () => {},
    gates: [],
    refetch: () => {},
  }),
  GateType: { PASSWORD: 0, SIGNATURE: 1 },
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k) => k }),
}));

// ── useFirstViewGateBatch — reads real localStorage ───────────────────────────
// Returns a Set of string season ids that have been seen.
vi.mock('@/hooks/useFirstViewGate', () => ({
  useFirstViewGateBatch: (_scope, itemKeys) => {
    const seen = new Set();
    for (const id of itemKeys) {
      const key = `sof:firstview:celebrated:anon:${id}`;
      if (localStorage.getItem(key)) seen.add(String(id));
    }
    return seen;
  },
}));

// ── Helpers ───────────────────────────────────────────────────────────────────
const makeClient = () =>
  new QueryClient({ defaultOptions: { queries: { retry: false } } });

function renderList() {
  return render(
    <QueryClientProvider client={makeClient()}>
      <MemoryRouter>
        <RaffleList />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────
describe('RaffleList celebration hold', () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    localStorage.clear();
  });

  it('completed season with unseen gate appears in settling tab, not complete', async () => {
    const user = userEvent.setup();
    renderList();

    // Season 1 (status 5) has not been seen → should be demoted to settling
    await user.click(screen.getByRole('tab', { name: /tabs\.settling/ }));
    expect(screen.getByText('Season 1')).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: /tabs\.complete/ }));
    expect(screen.queryByText('Season 1')).toBeNull();
  });

  it('after markAsSeen, completed season appears in complete tab', async () => {
    const user = userEvent.setup();
    localStorage.setItem(
      'sof:firstview:celebrated:anon:1',
      new Date().toISOString(),
    );
    renderList();

    await user.click(screen.getByRole('tab', { name: /tabs\.complete/ }));
    expect(screen.getByText('Season 1')).toBeInTheDocument();
  });

  it('cancelled season with unseen gate also held in settling', async () => {
    const user = userEvent.setup();
    renderList();

    // Season 2 (status 6 = Cancelled) has not been seen → should be demoted to settling
    await user.click(screen.getByRole('tab', { name: /tabs\.settling/ }));
    expect(screen.getByText('Season 2')).toBeInTheDocument();
  });

  it('upcoming/active/settling-status buckets are unaffected', async () => {
    const user = userEvent.setup();
    renderList();

    // Season 3 (status 1 = Active) stays in active tab (active by default)
    expect(screen.getByText('Season 3')).toBeInTheDocument();

    // Season 4 (status 2 = EndRequested → settling) stays in settling tab
    await user.click(screen.getByRole('tab', { name: /tabs\.settling/ }));
    expect(screen.getByText('Season 4')).toBeInTheDocument();
  });
});
