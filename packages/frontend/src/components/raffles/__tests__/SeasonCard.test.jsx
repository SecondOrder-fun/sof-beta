import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { SeasonCard } from '../SeasonCard';

// Per-test override surface for useCurveState. Default = empty / starting-state
// so existing variant tests keep working. Reset in afterEach so a test that
// throws before its own cleanup can't leak the mock into later tests.
const DEFAULT_CURVE_STATE = { curveSupply: 0n, curveStep: null, allBondSteps: [], isPriceLoading: false };
let curveStateMock = { ...DEFAULT_CURVE_STATE };
vi.mock('@/hooks/useCurveState', () => ({
  useCurveState: () => curveStateMock,
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

afterEach(() => {
  curveStateMock = { ...DEFAULT_CURVE_STATE };
});

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

  // Bug 2 regression: when RaffleList demotes a status=5 raffle to the
  // Settling tab (viewer hasn't seen the celebration yet), SeasonCard MUST
  // NOT leak the winner or the grand prize.
  it('Completed (5) with suppressWinner hides winner address and grand prize', () => {
    render(
      <MemoryRouter>
        <SeasonCard
          season={baseSeason(5)}
          renderBadge={noopBadge}
          winnerSummary={{ winnerAddress: '0xleak', grandPrizeWei: 940n * 10n ** 18n }}
          suppressWinner
        />
      </MemoryRouter>
    );
    expect(screen.queryByText('0xleak')).not.toBeInTheDocument();
    expect(screen.queryByText('winner')).not.toBeInTheDocument();
    expect(screen.queryByText(/grandPrize/i)).not.toBeInTheDocument();
    // The "940" amount must not leak through.
    expect(screen.queryByText(/940/)).not.toBeInTheDocument();
  });

  it('Completed (5) with suppressWinner renders a settling-style placeholder', () => {
    render(
      <MemoryRouter>
        <SeasonCard
          season={baseSeason(5)}
          renderBadge={noopBadge}
          winnerSummary={{ winnerAddress: '0xleak', grandPrizeWei: 1n }}
          suppressWinner
        />
      </MemoryRouter>
    );
    // Label appears in both the override badge and the placeholder body.
    expect(screen.getAllByText('settlingResultsInside').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/tradingLocked/i)).toBeInTheDocument();
  });

  it('Completed (5) with suppressWinner overrides the badge to a settling label', () => {
    // renderBadge would have stamped the raw status (5). With suppressWinner,
    // SeasonCard renders its own badge instead, so the noopBadge's "5" must
    // NOT be in the document.
    render(
      <MemoryRouter>
        <SeasonCard
          season={baseSeason(5)}
          renderBadge={noopBadge}
          winnerSummary={{ winnerAddress: '0xleak', grandPrizeWei: 1n }}
          suppressWinner
        />
      </MemoryRouter>
    );
    expect(screen.queryByTestId('badge')).not.toBeInTheDocument();
    // The override badge uses the same Settling label as the card body.
    const labels = screen.getAllByText('settlingResultsInside');
    expect(labels.length).toBeGreaterThanOrEqual(1);
  });

  // Bug #142 regression: Upcoming (status 0) must derive Starting Price from
  // the immutable bond-step ladder (allBondSteps[0].price), NOT from the
  // dynamic curveStep — which is null/zero for any season that has not yet
  // traded. Reading curveStep.price made the card render "0.0000 SOF" even
  // when the underlying curve had a real starting price configured.
  it('Upcoming (0) renders Starting Price from allBondSteps[0], not curveStep', () => {
    curveStateMock = {
      curveSupply: 0n,
      curveStep: null, // backend cache hasn't seen a trade yet
      allBondSteps: [
        { rangeTo: 100n, price: 2n * 10n ** 18n }, // 2.0000 SOF
        { rangeTo: 200n, price: 3n * 10n ** 18n },
      ],
    };
    // Upcoming means startTime is in the future.
    const FAR_FUTURE = BigInt(Math.floor(Date.now() / 1000) + 3600);
    const season = {
      id: 3,
      status: 0,
      totalTickets: 0n,
      config: {
        name: 'Tokyo Vol.23',
        startTime: FAR_FUTURE,
        endTime: FAR_FUTURE + 86400n,
        bondingCurve: '0xa',
      },
    };
    render(
      <MemoryRouter>
        <SeasonCard season={season} renderBadge={noopBadge} winnerSummary={null} />
      </MemoryRouter>
    );
    // Graph still renders (panel reads allBondSteps).
    expect(screen.getByTestId('curve-mini')).toBeInTheDocument();
    // Starting Price reads step 0's price, not curveStep.
    expect(screen.getByText(/^2\.0000/)).toBeInTheDocument();
    // And does NOT silently fall through to 0.0000.
    expect(screen.queryByText(/^0\.0000/)).not.toBeInTheDocument();
  });

  // Folded into #145: an Active season before its first trade has curveStep
  // === null (backend cache unseeded). The current price is the starting
  // tier, so it must fall back to allBondSteps[0] rather than show 0.0000.
  it('Active (1) with null curveStep falls back to the starting tier for Current Price', () => {
    curveStateMock = {
      curveSupply: 0n,
      curveStep: null,
      allBondSteps: [
        { rangeTo: 100n, price: 2n * 10n ** 18n }, // 2.0000 SOF
        { rangeTo: 200n, price: 3n * 10n ** 18n },
      ],
    };
    render(
      <MemoryRouter>
        <SeasonCard season={baseSeason(1)} renderBadge={noopBadge} winnerSummary={null} />
      </MemoryRouter>
    );
    expect(screen.getByText(/currentPrice/i)).toBeInTheDocument();
    expect(screen.getByText(/^2\.0000/)).toBeInTheDocument();
    expect(screen.queryByText(/^0\.0000/)).not.toBeInTheDocument();
  });

  // Issue #150: while the curve data is still loading, the price value must
  // render a Skeleton — never a premature "0.0000" that then snaps to the real
  // price.
  it('Active (1) shows a price Skeleton while loading, not a 0.0000 flash', () => {
    curveStateMock = {
      curveSupply: 0n,
      curveStep: null,
      allBondSteps: [],
      isPriceLoading: true,
    };
    render(
      <MemoryRouter>
        <SeasonCard season={baseSeason(1)} renderBadge={noopBadge} winnerSummary={null} />
      </MemoryRouter>
    );
    expect(screen.getByTestId('price-skeleton')).toBeInTheDocument();
    expect(screen.queryByText(/^0\.0000/)).not.toBeInTheDocument();
  });

  it('Upcoming (0) shows a price Skeleton while loading, not a 0.0000 flash', () => {
    curveStateMock = {
      curveSupply: 0n,
      curveStep: null,
      allBondSteps: [],
      isPriceLoading: true,
    };
    const FAR_FUTURE = BigInt(Math.floor(Date.now() / 1000) + 3600);
    const season = {
      id: 7,
      status: 0,
      totalTickets: 0n,
      config: {
        name: 'Loading Vol.1',
        startTime: FAR_FUTURE,
        endTime: FAR_FUTURE + 86400n,
        bondingCurve: '0xa',
      },
    };
    render(
      <MemoryRouter>
        <SeasonCard season={season} renderBadge={noopBadge} winnerSummary={null} />
      </MemoryRouter>
    );
    expect(screen.getByTestId('price-skeleton')).toBeInTheDocument();
    expect(screen.queryByText(/^0\.0000/)).not.toBeInTheDocument();
  });

  it('Active (1) shows 0.0000 once loading resolves genuinely empty (real zero, not Skeleton)', () => {
    curveStateMock = {
      curveSupply: 0n,
      curveStep: null,
      allBondSteps: [],
      isPriceLoading: false,
    };
    render(
      <MemoryRouter>
        <SeasonCard season={baseSeason(1)} renderBadge={noopBadge} winnerSummary={null} />
      </MemoryRouter>
    );
    expect(screen.queryByTestId('price-skeleton')).not.toBeInTheDocument();
    expect(screen.getByText(/^0\.0000/)).toBeInTheDocument();
  });

  it('Completed (5) without suppressWinner still shows the winner (unchanged)', () => {
    render(
      <MemoryRouter>
        <SeasonCard
          season={baseSeason(5)}
          renderBadge={noopBadge}
          winnerSummary={{ winnerAddress: '0xshown', grandPrizeWei: 1n }}
        />
      </MemoryRouter>
    );
    expect(screen.getByText('0xshown')).toBeInTheDocument();
    expect(screen.getByText('winner')).toBeInTheDocument();
  });
});
