import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';

vi.mock('framer-motion', async () => {
  const actual = await vi.importActual('framer-motion');
  return {
    ...actual,
    AnimatePresence: ({ children }) => children,
  };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key, opts) => {
      if (opts && opts.amount) return `${opts.amount} SOF`;
      if (opts && opts.prizeName) return `+ ${opts.prizeName}`;
      return key;
    },
  }),
  initReactI18next: { type: '3rdParty', init: vi.fn() },
}));
vi.mock('@/i18n/config', () => ({ default: { t: (k) => k, language: 'en' } }));

const mockFireWinBurst = vi.fn();
const mockReset = vi.fn();
vi.mock('../confetti', () => ({
  fireWinBurst: (...args) => {
    if (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    mockFireWinBurst(...args);
  },
  reset: () => mockReset(),
}));

vi.mock('@/components/user/UsernameDisplay', () => ({
  default: ({ address }) => <span data-testid="username">{address}</span>,
}));

vi.mock('@/components/prizes/ClaimPrizeWidget', () => ({
  ClaimPrizeWidget: ({ seasonId }) => <div data-testid="claim-widget">{String(seasonId)}</div>,
}));

import WinnerCelebrationModal from '../WinnerCelebrationModal';

describe('WinnerCelebrationModal', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockFireWinBurst.mockClear();
    mockReset.mockClear();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('celebrate variant renders winner name, amount, and sponsored line', () => {
    render(
      <WinnerCelebrationModal
        variant="celebrate"
        winnerAddress="0xaaa"
        grandPrizeWei={1250n * 10n ** 18n}
        sponsoredPrizeLabel="Punk #4242"
        seasonId={42n}
        onDismiss={() => {}}
      />,
    );
    expect(screen.getByTestId('username')).toHaveTextContent('0xaaa');
    expect(screen.getByText(/1250 SOF/)).toBeInTheDocument();
    expect(screen.getByText(/Punk #4242/)).toBeInTheDocument();
  });

  it('win variant renders You won! headline and Claim widget', () => {
    render(
      <WinnerCelebrationModal
        variant="win"
        winnerAddress="0xbbb"
        grandPrizeWei={100n * 10n ** 18n}
        seasonId={7n}
        onDismiss={() => {}}
      />,
    );
    expect(screen.getByText('celebration.youWonHeadline')).toBeInTheDocument();
    expect(screen.getByTestId('claim-widget')).toHaveTextContent('7');
  });

  it('cancelled variant renders cancelled copy, no claim widget, no confetti', () => {
    render(
      <WinnerCelebrationModal
        variant="cancelled"
        seasonId={1n}
        onDismiss={() => {}}
      />,
    );
    expect(screen.getByText('celebration.cancelledHeadline')).toBeInTheDocument();
    expect(screen.queryByTestId('claim-widget')).toBeNull();
    expect(mockFireWinBurst).not.toHaveBeenCalled();
  });

  it('fires confetti on mount for celebrate/win', () => {
    render(
      <WinnerCelebrationModal
        variant="celebrate"
        winnerAddress="0xaaa"
        grandPrizeWei={1n}
        seasonId={1n}
        onDismiss={() => {}}
      />,
    );
    expect(mockFireWinBurst).toHaveBeenCalledTimes(1);
  });

  it('calls onDismiss on mount (gate auto-record)', () => {
    const onDismiss = vi.fn();
    render(
      <WinnerCelebrationModal
        variant="celebrate"
        winnerAddress="0xaaa"
        grandPrizeWei={1n}
        seasonId={1n}
        onDismiss={onDismiss}
      />,
    );
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('tap-anywhere on backdrop hides the modal', () => {
    render(
      <WinnerCelebrationModal
        variant="celebrate"
        winnerAddress="0xaaa"
        grandPrizeWei={1n}
        seasonId={1n}
        onDismiss={() => {}}
      />,
    );
    const backdrop = screen.getByTestId('celebration-backdrop');
    fireEvent.click(backdrop);
    expect(screen.queryByTestId('celebration-backdrop')).toBeNull();
  });

  it('auto-dismisses after 6 seconds for celebrate', () => {
    render(
      <WinnerCelebrationModal
        variant="celebrate"
        winnerAddress="0xaaa"
        grandPrizeWei={1n}
        seasonId={1n}
        onDismiss={() => {}}
      />,
    );
    expect(screen.getByTestId('celebration-backdrop')).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(6000); });
    expect(screen.queryByTestId('celebration-backdrop')).toBeNull();
  });

  it('auto-dismisses after 4 seconds for cancelled', () => {
    render(
      <WinnerCelebrationModal
        variant="cancelled"
        seasonId={1n}
        onDismiss={() => {}}
      />,
    );
    act(() => { vi.advanceTimersByTime(4000); });
    expect(screen.queryByTestId('celebration-backdrop')).toBeNull();
  });

  it('calls confetti.reset on unmount', () => {
    const { unmount } = render(
      <WinnerCelebrationModal
        variant="celebrate"
        winnerAddress="0xaaa"
        grandPrizeWei={1n}
        seasonId={1n}
        onDismiss={() => {}}
      />,
    );
    unmount();
    expect(mockReset).toHaveBeenCalled();
  });

  it('does not fire confetti when prefers-reduced-motion is set', () => {
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = vi.fn().mockReturnValue({
      matches: true,
      addEventListener: () => {},
      removeEventListener: () => {},
    });
    render(
      <WinnerCelebrationModal
        variant="celebrate"
        winnerAddress="0xaaa"
        grandPrizeWei={1n}
        seasonId={1n}
        onDismiss={() => {}}
      />,
    );
    expect(mockFireWinBurst).not.toHaveBeenCalled();
    window.matchMedia = originalMatchMedia;
  });

  it('onDismiss is idempotent across mount, tap, and auto-dismiss', () => {
    const onDismiss = vi.fn();
    render(
      <WinnerCelebrationModal
        variant="celebrate"
        winnerAddress="0xaaa"
        grandPrizeWei={1n}
        seasonId={1n}
        onDismiss={onDismiss}
      />,
    );
    // mount: called once
    expect(onDismiss).toHaveBeenCalledTimes(1);
    // tap dismiss: should not call onDismiss again
    fireEvent.click(screen.getByTestId('celebration-backdrop'));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    // auto-dismiss timer fires: should not call onDismiss again
    act(() => { vi.advanceTimersByTime(6000); });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('dismisses on Escape key', () => {
    render(
      <WinnerCelebrationModal
        variant="celebrate"
        winnerAddress="0xaaa"
        grandPrizeWei={1n}
        seasonId={1n}
        onDismiss={() => {}}
      />,
    );
    expect(screen.getByTestId('celebration-backdrop')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByTestId('celebration-backdrop')).toBeNull();
  });

  it('backdrop has dialog a11y attributes', () => {
    render(
      <WinnerCelebrationModal
        variant="celebrate"
        winnerAddress="0xaaa"
        grandPrizeWei={1n}
        seasonId={1n}
        onDismiss={() => {}}
      />,
    );
    const backdrop = screen.getByTestId('celebration-backdrop');
    expect(backdrop.getAttribute('role')).toBe('dialog');
    expect(backdrop.getAttribute('aria-modal')).toBe('true');
    expect(backdrop.getAttribute('aria-labelledby')).toBe('celebration-headline');
  });
});
