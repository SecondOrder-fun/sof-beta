import { render, screen, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import TimeElapsed from '../TimeElapsed';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key, opts) => {
      if (key === 'timeElapsed.justNow') return 'just now';
      if (key === 'timeElapsed.minsAgo') return `${opts.count} min ago`;
      if (key === 'timeElapsed.hrsAgo') return `${opts.count} hr ago`;
      if (
        key === 'timeElapsed.daysAgo_one' ||
        (key === 'timeElapsed.daysAgo' && opts && opts.count === 1)
      ) {
        return `${opts.count} day ago`;
      }
      return `${opts.count} days ago`;
    },
  }),
}));

describe('TimeElapsed', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-10T12:00:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('renders "just now" within first minute', () => {
    const t = Math.floor(new Date('2026-05-10T11:59:30Z').getTime() / 1000);
    render(<TimeElapsed targetTimestamp={t} />);
    expect(screen.getByText(/just now/i)).toBeInTheDocument();
  });

  it('renders "X min ago" between 1 and 60 minutes', () => {
    const t = Math.floor(new Date('2026-05-10T11:55:00Z').getTime() / 1000);
    render(<TimeElapsed targetTimestamp={t} />);
    expect(screen.getByText(/5 min ago/i)).toBeInTheDocument();
  });

  it('renders "X hr ago" between 1 and 24 hours', () => {
    const t = Math.floor(new Date('2026-05-10T09:00:00Z').getTime() / 1000);
    render(<TimeElapsed targetTimestamp={t} />);
    expect(screen.getByText(/3 hr ago/i)).toBeInTheDocument();
  });

  it('renders "X day ago" beyond 24 hours', () => {
    const t = Math.floor(new Date('2026-05-08T12:00:00Z').getTime() / 1000);
    render(<TimeElapsed targetTimestamp={t} />);
    expect(screen.getByText(/2 days ago/i)).toBeInTheDocument();
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['0', 0],
    ['-1', -1],
    ['NaN', NaN],
  ])('returns null for invalid timestamp: %s', (_label, val) => {
    const { container } = render(<TimeElapsed targetTimestamp={val} />);
    expect(container.firstChild).toBeNull();
  });

  it('refreshes every 30s', () => {
    const t = Math.floor(new Date('2026-05-10T11:59:30Z').getTime() / 1000);
    render(<TimeElapsed targetTimestamp={t} />);
    expect(screen.getByText(/just now/i)).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(screen.getByText(/1 min ago/i)).toBeInTheDocument();
  });
});
