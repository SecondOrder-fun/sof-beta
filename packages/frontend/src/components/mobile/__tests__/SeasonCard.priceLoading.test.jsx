import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { SeasonCard } from '../SeasonCard';

// Per-test override surface for useCurveState. Default = empty/loading-cleared
// so the price renders normally unless a test opts into the loading state.
const DEFAULT_CURVE_STATE = {
  curveSupply: 0n,
  curveStep: null,
  allBondSteps: [],
  curveReserves: 0n,
  isPriceLoading: false,
};
let curveStateMock = { ...DEFAULT_CURVE_STATE };
vi.mock('@/hooks/useCurveState', () => ({
  useCurveState: () => curveStateMock,
}));
vi.mock('@/hooks/useSeasonWinnerSummaries', () => ({
  useSeasonWinnerSummary: () => ({ data: null }),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k, o) => o?.defaultValue ?? k }),
}));
vi.mock('@/components/curve/MiniCurveChart', () => ({
  default: () => <div data-testid="mini-curve" />,
}));
vi.mock('@/components/common/CountdownTimer', () => ({
  default: ({ targetTimestamp }) => <span data-testid="countdown">{String(targetTimestamp)}</span>,
}));
vi.mock('@/components/user/UsernameDisplay', () => ({
  default: ({ address }) => <span>{address}</span>,
}));

afterEach(() => {
  curveStateMock = { ...DEFAULT_CURVE_STATE };
});

const FUTURE = BigInt(Math.floor(Date.now() / 1000) + 86400);

describe('mobile SeasonCard — price loading', () => {
  it('shows a price Skeleton while the curve is loading, not a 0.0000 flash', () => {
    curveStateMock = { ...DEFAULT_CURVE_STATE, isPriceLoading: true };
    render(
      <SeasonCard
        seasonId={1}
        seasonConfig={{ name: 'T', endTime: FUTURE, bondingCurve: '0xa' }}
        status={1}
        isConnected
      />
    );
    expect(screen.getByTestId('price-skeleton')).toBeInTheDocument();
    expect(screen.queryByText(/^0 SOF/)).not.toBeInTheDocument();
  });

  it('shows the price (not a Skeleton) once the curve has resolved with data', () => {
    curveStateMock = {
      ...DEFAULT_CURVE_STATE,
      isPriceLoading: false,
      allBondSteps: [{ rangeTo: 100n, price: 2n * 10n ** 18n }],
    };
    render(
      <SeasonCard
        seasonId={1}
        seasonConfig={{ name: 'T', endTime: FUTURE, bondingCurve: '0xa' }}
        status={1}
        isConnected
      />
    );
    expect(screen.queryByTestId('price-skeleton')).not.toBeInTheDocument();
    expect(screen.getByText(/2 SOF/)).toBeInTheDocument();
  });
});
