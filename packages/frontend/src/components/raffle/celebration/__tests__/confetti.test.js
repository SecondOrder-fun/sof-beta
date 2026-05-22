import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('canvas-confetti', () => {
  const mockConfetti = vi.fn();
  mockConfetti.reset = vi.fn();
  return {
    default: mockConfetti,
  };
});

import { fireWinBurst, reset } from '../confetti';
import confetti from 'canvas-confetti';

describe('confetti wrapper', () => {
  beforeEach(() => {
    confetti.mockClear();
    confetti.reset.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fires two angled bursts by default', () => {
    fireWinBurst();
    expect(confetti).toHaveBeenCalledTimes(2);
    const [call1, call2] = confetti.mock.calls;
    expect(call1[0].angle).toBeLessThan(90);
    expect(call2[0].angle).toBeGreaterThan(90);
  });

  it('scales particle count when scaled=true (mini-app context)', () => {
    fireWinBurst({ scaled: true });
    const [call] = confetti.mock.calls;
    expect(call[0].particleCount).toBeLessThanOrEqual(60);
  });

  it('uses full particle count when scaled=false', () => {
    fireWinBurst({ scaled: false });
    const totalParticles = confetti.mock.calls.reduce(
      (n, c) => n + c[0].particleCount,
      0,
    );
    expect(totalParticles).toBeGreaterThanOrEqual(100);
  });

  it('bails out under prefers-reduced-motion', () => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true }));
    fireWinBurst();
    expect(confetti).not.toHaveBeenCalled();
  });

  it('reset() proxies to canvas-confetti.reset', () => {
    reset();
    expect(confetti.reset).toHaveBeenCalledTimes(1);
  });
});
