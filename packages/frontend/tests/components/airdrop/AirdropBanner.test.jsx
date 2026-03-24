/*
  @vitest-environment jsdom
*/
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { useState, useEffect } from 'react';

// ---------- Realistic useToast mock ----------
// The real useToast (useToast.js) has a global listener pattern where calling
// toast() → dispatch() → setState on all subscribers → re-renders.
// The `toast` function is an inline arrow (line 117), so it's a NEW reference
// each render. Any useEffect with `toast` in its deps re-fires on every render.
// The real TOAST_LIMIT = 3, so the loop caps at 3 toasts.
const TOAST_LIMIT = 3;
let allToastCalls = [];
let toastListeners = [];

function useToastRealistic() {
  const [, setTick] = useState(0);

  useEffect(() => {
    const listener = () => setTick((t) => t + 1);
    toastListeners.push(listener);
    return () => {
      toastListeners = toastListeners.filter((l) => l !== listener);
    };
  }, []);

  // New arrow each render — mirrors real useToast.js:117
  const toast = (args) => {
    allToastCalls.push(args);
    // Only propagate if under limit (prevents OOM in tests)
    if (allToastCalls.length < TOAST_LIMIT) {
      toastListeners.forEach((l) => l());
    }
    return { id: String(allToastCalls.length), dismiss: vi.fn(), update: vi.fn() };
  };

  return { toast, toasts: [] };
}

vi.mock('@/hooks/useToast', () => ({
  useToast: () => useToastRealistic(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key, params) => (params ? `${key}:${JSON.stringify(params)}` : key),
    i18n: { language: 'en' },
  }),
}));

let airdropState = {};
vi.mock('@/hooks/useAirdrop', () => ({
  useAirdrop: () => airdropState,
}));

vi.mock('wagmi', () => ({
  useAccount: () => ({ isConnected: true, address: '0xabc' }),
}));

vi.mock('@/hooks/useAppIdentity', () => ({
  useAppIdentity: () => ({ fid: 12345 }),
}));

function defaultAirdropState(overrides = {}) {
  return {
    hasClaimed: false,
    initialAmount: 1000,
    basicAmount: 500,
    claimInitial: vi.fn(),
    claimInitialBasic: vi.fn(),
    claimInitialState: {
      isPending: false,
      isSuccess: false,
      isError: false,
      error: null,
    },
    resetInitialState: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  allToastCalls = [];
  toastListeners = [];
  airdropState = defaultAirdropState();
});

describe('AirdropBanner', () => {
  it('renders claim button with correct amount for Farcaster user', async () => {
    const { default: AirdropBanner } = await import(
      '@/components/airdrop/AirdropBanner'
    );

    await act(async () => {
      render(<AirdropBanner />);
    });

    const btn = screen.getByRole('button', { name: /claimInitial/i });
    expect(btn.textContent).toContain('1,000');
  });

  it('does not render when user has already claimed', async () => {
    airdropState = defaultAirdropState({ hasClaimed: true });
    const { default: AirdropBanner } = await import(
      '@/components/airdrop/AirdropBanner'
    );

    const { container } = render(<AirdropBanner />);
    expect(container.innerHTML).toBe('');
  });

  it('fires exactly ONE error toast on claim failure', async () => {
    airdropState = defaultAirdropState({
      claimInitialState: {
        isPending: false,
        isSuccess: false,
        isError: true,
        error: 'Attestation request failed: 500',
      },
    });

    const { default: AirdropBanner } = await import(
      '@/components/airdrop/AirdropBanner'
    );

    await act(async () => {
      render(<AirdropBanner />);
    });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 100));
    });

    const errorToasts = allToastCalls.filter((c) => c.variant === 'destructive');
    expect(errorToasts).toHaveLength(1);
  });

  it('fires exactly ONE success toast on successful claim', async () => {
    airdropState = defaultAirdropState({
      claimInitialState: {
        isPending: false,
        isSuccess: true,
        isError: false,
        error: null,
      },
    });

    const { default: AirdropBanner } = await import(
      '@/components/airdrop/AirdropBanner'
    );

    await act(async () => {
      render(<AirdropBanner />);
    });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 100));
    });

    expect(allToastCalls).toHaveLength(1);
  });

  it('error toast includes actual error message, not just generic key', async () => {
    airdropState = defaultAirdropState({
      claimInitialState: {
        isPending: false,
        isSuccess: false,
        isError: true,
        error: 'Cooldown not elapsed',
      },
    });

    const { default: AirdropBanner } = await import(
      '@/components/airdrop/AirdropBanner'
    );

    await act(async () => {
      render(<AirdropBanner />);
    });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 100));
    });

    const errorToasts = allToastCalls.filter((c) => c.variant === 'destructive');
    expect(errorToasts).toHaveLength(1);
    // The toast should include the actual error message, not just a generic i18n key
    const toastContent = JSON.stringify(errorToasts[0]);
    expect(toastContent).toContain('Cooldown not elapsed');
  });

  it('does not fire any toast when state is idle', async () => {
    const { default: AirdropBanner } = await import(
      '@/components/airdrop/AirdropBanner'
    );

    await act(async () => {
      render(<AirdropBanner />);
    });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 100));
    });

    expect(allToastCalls).toHaveLength(0);
  });
});
