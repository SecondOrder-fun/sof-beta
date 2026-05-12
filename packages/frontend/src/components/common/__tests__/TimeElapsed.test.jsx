import { render, screen, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import TimeElapsed from '../TimeElapsed';

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

  it('returns null for missing or invalid timestamps', () => {
    const { container } = render(<TimeElapsed targetTimestamp={undefined} />);
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
