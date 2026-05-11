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
