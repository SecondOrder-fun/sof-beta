import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi } from 'vitest';
import RaffleDetails from '@/routes/RaffleDetails';

// Force desktop branch
vi.mock('@/hooks/usePlatform', () => ({
  usePlatform: () => ({ isMobile: false }),
}));

const NOW = Math.floor(Date.now() / 1000);

vi.mock('@/hooks/useChainTime', () => ({
  useChainTime: () => NOW + 100,
}));

vi.mock('@/hooks/useRaffleState', () => ({
  useRaffleState: () => ({
    seasonDetailsQuery: {
      isLoading: false,
      data: {
        status: 5,
        totalPrizePool: 0n,
        config: {
          name: 'Spring Cup',
          startTime: BigInt(NOW - 7200),
          endTime: BigInt(NOW - 60),
          bondingCurve: '0x000000000000000000000000000000000000aBcD',
        },
      },
    },
  }),
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
vi.mock('@/components/user/UsernameDisplay', () => ({ default: ({ address }) => <span>{address}</span> }));
vi.mock('@/components/common/ExplorerLink', () => ({ default: () => null }));
vi.mock('@/components/common/CountdownTimer', () => ({ default: () => null }));
vi.mock('@/components/gating/PasswordGateModal', () => ({ default: () => null }));
vi.mock('@/components/gating/SignatureGateModal', () => ({ default: () => null }));
vi.mock('@/components/common/SecondaryCard', () => ({ default: () => null }));

const makeClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

describe('RaffleDetails completed branch', () => {
  it('renders CompletedRaffleResults, Transactions, Holders side-by-side, and hides BuySell/BondingCurve at status 5', () => {
    render(
      <QueryClientProvider client={makeClient()}>
        <MemoryRouter initialEntries={['/raffles/7']}>
          <Routes>
            <Route path="/raffles/:seasonId" element={<RaffleDetails />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );

    expect(screen.getByTestId('completed-results')).toBeInTheDocument();
    expect(screen.getByTestId('transactions-tab')).toBeInTheDocument();
    expect(screen.getByTestId('holders-tab')).toBeInTheDocument();
    expect(screen.queryByTestId('bonding-curve-panel')).not.toBeInTheDocument();
    expect(screen.queryByTestId('buy-sell-widget')).not.toBeInTheDocument();
    expect(screen.queryByTestId('sponsor-widget')).not.toBeInTheDocument();
  });
});
