import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';

// framer-motion's useReducedMotion uses a module-level singleton that is
// initialised once and not re-evaluated when matchMedia is patched in tests.
// Mock the hook directly so we control the returned value per test.
let mockReducedMotion = false;
vi.mock('framer-motion', async () => {
  const actual = await vi.importActual('framer-motion');
  return {
    ...actual,
    useReducedMotion: () => mockReducedMotion,
  };
});

import CelebrationArtwork from '../CelebrationArtwork';

describe('CelebrationArtwork', () => {
  it('renders rays + ticket + box for celebrate variant', () => {
    mockReducedMotion = false;
    const { container } = render(<CelebrationArtwork variant="celebrate" label="WINNER" />);
    expect(container.querySelector('[data-element="rays"]')).not.toBeNull();
    expect(container.querySelector('[data-element="ticket"]')).not.toBeNull();
    expect(container.querySelector('[data-element="box"]')).not.toBeNull();
  });

  it('renders rays + ticket + box for win variant', () => {
    mockReducedMotion = false;
    const { container } = render(<CelebrationArtwork variant="win" label="WINNER" />);
    expect(container.querySelector('[data-element="rays"]')).not.toBeNull();
    expect(container.querySelector('[data-element="ticket"]')).not.toBeNull();
  });

  it('cancelled variant hides rays and shows shrinking ticket', () => {
    mockReducedMotion = false;
    const { container } = render(<CelebrationArtwork variant="cancelled" label="WINNER" />);
    expect(container.querySelector('[data-element="rays"]')).toBeNull();
    expect(container.querySelector('[data-element="ticket"]')).not.toBeNull();
  });

  it('respects prefers-reduced-motion (no animation classes)', () => {
    mockReducedMotion = true;
    const { container } = render(<CelebrationArtwork variant="celebrate" label="WINNER" />);
    const rays = container.querySelector('[data-element="rays"]');
    expect(rays).not.toBeNull();
    expect(rays.getAttribute('data-animated')).toBe('false');
    mockReducedMotion = false;
  });
});
