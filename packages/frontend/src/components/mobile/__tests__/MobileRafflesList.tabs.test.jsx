import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import MobileRafflesList from '../MobileRafflesList';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key) => {
      const map = {
        raffles: 'Raffles',
        'tabs.upcoming': 'Upcoming',
        'tabs.active': 'Active',
        'tabs.settling': 'Settling',
        'tabs.complete': 'Complete',
        'emptyTab.upcoming': 'No upcoming raffles right now.',
        'emptyTab.active': 'No active raffles right now.',
        'emptyTab.settling': 'No settling raffles right now.',
        'emptyTab.complete': 'No completed raffles yet.',
        'navigation:myRaffles': 'Mine',
        noActiveSeasons: 'No raffles',
      };
      return map[key] ?? key;
    },
  }),
}));

vi.mock('@/hooks/useCurveState', () => ({
  useCurveState: () => ({ curveSupply: 0n, curveStep: 0, allBondSteps: [] }),
}));
vi.mock('@/components/mobile/SeasonCard', () => ({
  default: ({ seasonId }) => <div data-testid={`mobile-card-${seasonId}`} />,
}));
vi.mock('@/components/common/skeletons/MobileCardSkeleton', () => ({
  default: () => <div data-testid="mobile-skel" />,
}));
vi.mock('@/components/common/Carousel', () => ({
  default: ({ items, renderItem, currentIndex }) =>
    items.length > 0 ? <div data-testid="carousel">{renderItem(items[currentIndex])}</div> : null,
}));

const mkSeason = (id, status) => ({
  id,
  status,
  config: { name: `S${id}`, bondingCurve: `0x${id}` },
});

const grouped = {
  upcoming: [{ season: mkSeason(1, 0), suppressWinner: false }],
  active: [
    { season: mkSeason(2, 1), suppressWinner: false },
    { season: mkSeason(3, 1), suppressWinner: false },
    { season: mkSeason(4, 1), suppressWinner: false },
  ],
  settling: [{ season: mkSeason(5, 3), suppressWinner: false }],
  complete: [
    { season: mkSeason(6, 5), suppressWinner: false },
    { season: mkSeason(7, 5), suppressWinner: false },
  ],
};

const renderList = (overrides = {}) =>
  render(
    <MemoryRouter>
      <MobileRafflesList
        grouped={grouped}
        activeTab="active"
        onTabChange={vi.fn()}
        onActiveSeasonChange={vi.fn()}
        isLoading={false}
        {...overrides}
      />
    </MemoryRouter>,
  );

describe('MobileRafflesList tabs', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders 4 tab triggers with count chips reflecting grouped lengths', () => {
    renderList();
    expect(screen.getByRole('tab', { name: /upcoming/i })).toHaveTextContent('1');
    expect(screen.getByRole('tab', { name: /active/i })).toHaveTextContent('3');
    expect(screen.getByRole('tab', { name: /settling/i })).toHaveTextContent('1');
    expect(screen.getByRole('tab', { name: /complete/i })).toHaveTextContent('2');
  });

  it('renders the carousel with seasons from the active group', () => {
    renderList({ activeTab: 'active' });
    expect(screen.getByTestId('mobile-card-2')).toBeInTheDocument();
  });

  it('renders the emptyTab message when the active group has zero seasons', () => {
    const emptyGrouped = { ...grouped, upcoming: [] };
    renderList({ grouped: emptyGrouped, activeTab: 'upcoming' });
    expect(screen.getByText('No upcoming raffles right now.')).toBeInTheDocument();
    expect(screen.queryByTestId('carousel')).not.toBeInTheDocument();
  });

  it('clicking a tab fires onTabChange with the new group key', async () => {
    const user = userEvent.setup();
    const onTabChange = vi.fn();
    renderList({ onTabChange });
    await user.click(screen.getByRole('tab', { name: /settling/i }));
    expect(onTabChange).toHaveBeenCalledWith('settling');
  });

  it('onActiveSeasonChange fires with the first season of the active group on mount', () => {
    const onActiveSeasonChange = vi.fn();
    renderList({ onActiveSeasonChange });
    expect(onActiveSeasonChange).toHaveBeenCalledWith(grouped.active[0].season);
  });
});
