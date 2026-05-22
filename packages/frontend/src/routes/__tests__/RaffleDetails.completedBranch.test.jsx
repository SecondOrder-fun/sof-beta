import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import RaffleDetails from '@/routes/RaffleDetails';
import { useRaffleState } from '@/hooks/useRaffleState';

// Force desktop branch
vi.mock('@/hooks/usePlatform', () => ({
  usePlatform: () => ({ isMobile: false }),
}));

const NOW = Math.floor(Date.now() / 1000);

vi.mock('@/hooks/useChainTime', () => ({
  useChainTime: () => NOW + 100,
}));

vi.mock('@/hooks/useRaffleState', () => ({
  useRaffleState: vi.fn(),
}));

vi.mock('@/hooks/useCurveState', () => ({
  useCurveState: () => ({
    curveSupply: 0n, curveReserves: 0n, curveStep: {}, allBondSteps: [],
    debouncedRefresh: vi.fn(),
  }),
}));
vi.mock('@/hooks/useCurveEvents', () => ({ useCurveEvents: () => {} }));
vi.mock('@/hooks/useStaggeredRefresh', () => ({ useStaggeredRefresh: () => vi.fn() }));
vi.mock('@/hooks/usePlayerPosition', () => ({
  usePlayerPosition: () => ({
    position: null, isRefreshing: false, setIsRefreshing: vi.fn(),
    setPosition: vi.fn(), refreshNow: vi.fn(),
  }),
}));
vi.mock('@/hooks/useSeasonWinnerSummaries', () => ({
  useSeasonWinnerSummary: () => ({
    data: { winnerAddress: '0xA1B2C3D4E5F60718293A4B5C6D7E8F9012345678', grandPrizeWei: 1250n * 10n ** 18n },
  }),
}));
vi.mock('@/hooks/useSeasonGating', () => ({
  useSeasonGating: () => ({ isVerified: true, verifyPassword: vi.fn(), verifySignature: vi.fn(), gates: [], refetch: vi.fn() }),
  GateType: { SIGNATURE: 1 },
}));
vi.mock('@/hooks/useConsolationStatus', () => ({
  useConsolationStatus: () => ({
    totalPoolWei: 500n * 10n ** 18n,
    perLoserShareWei: (500n * 10n ** 18n) / 200n,
    viewerEligible: true, viewerClaimed: false, isLoading: false,
  }),
}));
vi.mock('wagmi', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    useAccount: () => ({ isConnected: false, address: undefined }),
  };
});
vi.mock('@/hooks/useSmartTransactions', () => ({
  useSmartTransactions: () => ({ executeBatch: vi.fn(), isSmartWallet: false }),
}));
vi.mock('@/hooks/useClaims', () => ({
  useClaims: () => ({
    claimRaffleConsolation: { mutate: vi.fn(), isPending: false },
    pendingClaims: new Set(),
    getClaimKey: (type, params) => `${type}-${params.seasonId}`,
  }),
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k) => k }) }));

// Stub heavy children so the test stays focused on layout structure
vi.mock('@/components/curve/CurveGraph', () => ({ default: () => <div data-testid="bonding-curve-panel" /> }));
vi.mock('@/components/curve/BuySellWidget', () => ({ default: () => <div data-testid="buy-sell-widget" /> }));
vi.mock('@/components/curve/TransactionsTab', () => ({ default: () => <div data-testid="transactions-tab" /> }));
vi.mock('@/components/curve/HoldersTab', () => ({ default: () => <div data-testid="holders-tab" /> }));
vi.mock('@/components/curve/TokenInfoTab', () => ({ default: () => <div data-testid="token-info-tab" /> }));
vi.mock('@/components/prizes/SponsoredPrizesDisplay', () => ({ SponsoredPrizesDisplay: () => <div data-testid="sponsored" /> }));
vi.mock('@/components/prizes/SponsorPrizeWidget', () => ({ SponsorPrizeWidget: () => <div data-testid="sponsor-widget" /> }));
vi.mock('@/components/prizes/ClaimPrizeWidget', () => ({ ClaimPrizeWidget: () => <div data-testid="claim-widget" /> }));
vi.mock('@/components/admin/RaffleAdminControls', () => ({ RaffleAdminControls: () => null }));
vi.mock('@/components/admin/TreasuryControls', () => ({ TreasuryControls: () => null }));
vi.mock('@/components/raffle/CompletedRaffleResults', () => ({ default: () => <div data-testid="completed-results" /> }));
vi.mock('@/components/common/ExplorerLink', () => ({ default: () => null }));
vi.mock('@/components/common/CountdownTimer', () => ({ default: () => null }));
vi.mock('@/components/gating/PasswordGateModal', () => ({ default: () => null }));
vi.mock('@/components/gating/SignatureGateModal', () => ({ default: () => null }));
vi.mock('@/components/common/SecondaryCard', () => ({ default: () => null }));

// ── Celebration modal deps ─────────────────────────────────────────────────────
vi.mock('@/hooks/useFirstViewGate', () => ({
  useFirstViewGate: (scope, itemKey) => {
    const key = `sof:firstview:${scope}:anon:${itemKey}`;
    const hasSeen = !!localStorage.getItem(key);
    return {
      hasSeen,
      markAsSeen: () => localStorage.setItem(key, new Date().toISOString()),
    };
  },
}));
vi.mock('@/hooks/useSponsoredPrizes', () => ({
  useSponsoredPrizes: () => ({
    sponsoredERC20: [],
    sponsoredERC721: [],
    tierConfigs: [],
    tierWinners: {},
    hasSponsoredPrizes: false,
    isLoading: false,
  }),
}));
// Stub WinnerCelebrationModal sub-deps so framer-motion, confetti, etc. don't blow up.
vi.mock('@/components/raffle/celebration/WinnerCelebrationModal', () => ({
  default: ({ variant, onDismiss }) => {
    // Record gate immediately, mirroring the real component's useEffect.
    onDismiss?.();
    return (
      <div data-testid="celebration-backdrop">
        {variant === 'cancelled' && <span>celebration.cancelledHeadline</span>}
      </div>
    );
  },
}));

const makeClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

const makeSeasonQuery = (status) => ({
  isLoading: false,
  data: {
    status,
    totalPrizePool: 0n,
    config: {
      name: 'Spring Cup',
      startTime: BigInt(NOW - 7200),
      endTime: BigInt(NOW - 60),
      bondingCurve: '0x000000000000000000000000000000000000aBcD',
    },
  },
});

const renderRoute = () =>
  render(
    <QueryClientProvider client={makeClient()}>
      <MemoryRouter initialEntries={['/raffles/7']}>
        <Routes>
          <Route path="/raffles/:seasonId" element={<RaffleDetails />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );

// Pre-seed the gate so the celebration modal does NOT mount during the original
// layout assertions (seasonId = 7, viewer = anon).
const GATE_KEY = 'sof:firstview:celebrated:anon:7';

describe('RaffleDetails completed branch', () => {
  beforeEach(() => {
    localStorage.setItem(GATE_KEY, new Date().toISOString());
    vi.mocked(useRaffleState).mockReturnValue({ seasonDetailsQuery: makeSeasonQuery(5) });
  });
  afterEach(() => {
    localStorage.removeItem(GATE_KEY);
  });

  it('renders CompletedRaffleResults, Transactions, Holders side-by-side, and hides BuySell/BondingCurve at status 5', () => {
    renderRoute();

    expect(screen.getByTestId('completed-results')).toBeInTheDocument();
    expect(screen.getByTestId('transactions-tab')).toBeInTheDocument();
    expect(screen.getByTestId('holders-tab')).toBeInTheDocument();
    expect(screen.queryByTestId('bonding-curve-panel')).not.toBeInTheDocument();
    expect(screen.queryByTestId('buy-sell-widget')).not.toBeInTheDocument();
    expect(screen.queryByTestId('sponsor-widget')).not.toBeInTheDocument();
  });

  it('routes to the completed branch at status 4 (VRF pending)', () => {
    vi.mocked(useRaffleState).mockReturnValue({ seasonDetailsQuery: makeSeasonQuery(4) });
    renderRoute();

    expect(screen.getByTestId('completed-results')).toBeInTheDocument();
    expect(screen.queryByTestId('bonding-curve-panel')).not.toBeInTheDocument();
  });

  it('routes to the completed branch at status 6 (cancelled) and hides ClaimPrizeWidget', () => {
    vi.mocked(useRaffleState).mockReturnValue({ seasonDetailsQuery: makeSeasonQuery(6) });
    renderRoute();

    expect(screen.getByTestId('completed-results')).toBeInTheDocument();
    expect(screen.queryByTestId('bonding-curve-panel')).not.toBeInTheDocument();
    expect(screen.queryByTestId('claim-widget')).not.toBeInTheDocument();
  });
});

describe('WinnerCelebrationModal integration', () => {
  beforeEach(() => { localStorage.clear(); });
  afterEach(() => { localStorage.clear(); });

  it('mounts modal on first view of completed season with winner', async () => {
    vi.mocked(useRaffleState).mockReturnValue({ seasonDetailsQuery: makeSeasonQuery(5) });
    renderRoute();
    expect(await screen.findByTestId('celebration-backdrop')).toBeInTheDocument();
  });

  it('does not mount modal after gate marked seen', () => {
    localStorage.setItem(GATE_KEY, new Date().toISOString());
    vi.mocked(useRaffleState).mockReturnValue({ seasonDetailsQuery: makeSeasonQuery(5) });
    renderRoute();
    expect(screen.queryByTestId('celebration-backdrop')).toBeNull();
  });

  it('mounts cancelled variant for status 6', async () => {
    vi.mocked(useRaffleState).mockReturnValue({ seasonDetailsQuery: makeSeasonQuery(6) });
    renderRoute();
    const modal = await screen.findByTestId('celebration-backdrop');
    expect(modal).toBeInTheDocument();
    expect(screen.getByText('celebration.cancelledHeadline')).toBeInTheDocument();
  });
});
