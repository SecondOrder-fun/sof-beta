import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi } from 'vitest';
import { SeasonCard } from '../SeasonCard';

// Mock hooks the card depends on
vi.mock('@/hooks/useCurveState', () => ({
  useCurveState: () => ({ curveSupply: 0n, curveStep: { price: 0n }, allBondSteps: [] }),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k) => k }),
}));
vi.mock('@/components/curve/CurveGraph', () => ({
  default: () => <div data-testid="curve-mini" />,
}));
vi.mock('@/components/common/CountdownTimer', () => ({
  default: ({ targetTimestamp }) => <span data-testid="countdown">{String(targetTimestamp)}</span>,
}));
vi.mock('@/components/user/UsernameDisplay', () => ({
  default: ({ address }) => <span>{address}</span>,
}));
vi.mock('@/components/common/TimeElapsed', () => ({
  default: () => <span data-testid="time-elapsed">elapsed</span>,
}));
// SeasonCard also reads trading-lock status and builds a viem public client
// against the stored network. Other comparable tests in the suite (see
// tests/routes/RaffleDetails.toastsAndFallback.test.jsx and
// tests/routes/RaffleList.winnerDisplay.test.jsx) stub these to keep unit
// tests off the network. Without them this test passes only because
// useTradingLockStatus silently swallows its read error.
vi.mock('@/hooks/buysell', () => ({
  useTradingLockStatus: () => ({ tradingLocked: false, buyFeeBps: 0, sellFeeBps: 0 }),
}));
vi.mock('@/lib/viemClient', () => ({
  buildPublicClient: () => null,
}));
vi.mock('@/lib/wagmi', () => ({
  getStoredNetworkKey: () => 'LOCAL',
}));
vi.mock('@/config/networks', () => ({
  getNetworkByKey: () => ({
    id: 31337,
    name: 'Local',
    rpcUrl: 'http://127.0.0.1:8545',
  }),
}));

const noopBadge = (status) => <span data-testid="badge">{status}</span>;

describe('SeasonCard', () => {
  it('renders id, name, and status badge in the header', () => {
    const season = {
      id: 1,
      status: 1,
      totalTickets: 0n,
      config: { name: 'Test', startTime: 1000n, endTime: 2000n, bondingCurve: '0xabc' },
    };
    render(
      <MemoryRouter>
        <SeasonCard season={season} renderBadge={noopBadge} winnerSummary={null} />
      </MemoryRouter>
    );
    expect(screen.getByText(/Test/)).toBeInTheDocument();
    expect(screen.getByText(/#1/)).toBeInTheDocument();
    expect(screen.getByTestId('badge')).toHaveTextContent('1');
  });
});

describe('SeasonCard variants', () => {
  // Use a far-future endTime so seasonEndedByTime is false; otherwise the
  // existing tradingOpen gate (Task 1) hides the Buy/Sell buttons on Active.
  const FUTURE = BigInt(Math.floor(Date.now() / 1000) + 86400);
  const baseSeason = (status) => ({
    id: 1,
    status,
    totalTickets: 0n,
    config: { name: 'T', startTime: 0n, endTime: FUTURE, bondingCurve: '0xa' },
  });

  it('Active status renders curve + Current Price + Buy/Sell', () => {
    render(
      <MemoryRouter>
        <SeasonCard season={baseSeason(1)} renderBadge={noopBadge} winnerSummary={null} />
      </MemoryRouter>
    );
    expect(screen.getByTestId('curve-mini')).toBeInTheDocument();
    expect(screen.getByText(/currentPrice/i)).toBeInTheDocument();
    expect(screen.getByText(/common:buy/i)).toBeInTheDocument();
  });

  it('Settling status (3 = VRFPending) hides curve and price, shows time-elapsed', () => {
    render(
      <MemoryRouter>
        <SeasonCard season={baseSeason(3)} renderBadge={noopBadge} winnerSummary={null} />
      </MemoryRouter>
    );
    expect(screen.queryByTestId('curve-mini')).not.toBeInTheDocument();
    expect(screen.queryByText(/currentPrice/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/common:buy/i)).not.toBeInTheDocument();
    expect(screen.getByText(/tradingLocked/i)).toBeInTheDocument();
  });

  it('Settling status 2 hides curve and price', () => {
    render(
      <MemoryRouter>
        <SeasonCard season={baseSeason(2)} renderBadge={noopBadge} winnerSummary={null} />
      </MemoryRouter>
    );
    expect(screen.queryByTestId('curve-mini')).not.toBeInTheDocument();
    expect(screen.getByText('settlingAwaitingEnd')).toBeInTheDocument();
  });

  it('Settling status 4 hides curve and price', () => {
    render(
      <MemoryRouter>
        <SeasonCard season={baseSeason(4)} renderBadge={noopBadge} winnerSummary={null} />
      </MemoryRouter>
    );
    expect(screen.queryByTestId('curve-mini')).not.toBeInTheDocument();
    expect(screen.getByText('settlingDistributing')).toBeInTheDocument();
  });

  it('Completed status (5) with winner shows winner box, no curve, no price', () => {
    render(
      <MemoryRouter>
        <SeasonCard
          season={baseSeason(5)}
          renderBadge={noopBadge}
          winnerSummary={{ winnerAddress: '0xwinner', grandPrizeWei: 1000000000000000000n }}
        />
      </MemoryRouter>
    );
    expect(screen.queryByTestId('curve-mini')).not.toBeInTheDocument();
    // The winner-label translation key is rendered (translation mock returns the key),
    // alongside the rendered winner address. Both match /winner/i, so check the label
    // via the exact translation-key text.
    expect(screen.getByText('winner')).toBeInTheDocument();
  });

  it('Cancelled status (6) shows cancelled indicator, no curve, no winner', () => {
    render(
      <MemoryRouter>
        <SeasonCard season={baseSeason(6)} renderBadge={noopBadge} winnerSummary={null} />
      </MemoryRouter>
    );
    expect(screen.queryByTestId('curve-mini')).not.toBeInTheDocument();
    expect(screen.queryByText(/winner/i)).not.toBeInTheDocument();
    expect(screen.getByText(/seasonCancelled/i)).toBeInTheDocument();
  });

  it('Cancelled status (6) with tickets still shows cancelled indicator, not no-participants', () => {
    const s = { ...baseSeason(6), totalTickets: 10n };
    render(
      <MemoryRouter>
        <SeasonCard season={s} renderBadge={noopBadge} winnerSummary={null} />
      </MemoryRouter>
    );
    expect(screen.getByText(/seasonCancelled/i)).toBeInTheDocument();
    expect(screen.queryByText(/noParticipants/i)).not.toBeInTheDocument();
  });
});
