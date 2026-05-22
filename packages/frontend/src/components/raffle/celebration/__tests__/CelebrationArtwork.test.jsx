import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import CelebrationArtwork from '../CelebrationArtwork';

describe('CelebrationArtwork', () => {
  it('renders rays + ticket + box for celebrate variant', () => {
    const { container } = render(<CelebrationArtwork variant="celebrate" label="WINNER" />);
    expect(container.querySelector('[data-element="rays"]')).not.toBeNull();
    expect(container.querySelector('[data-element="ticket"]')).not.toBeNull();
    expect(container.querySelector('[data-element="box"]')).not.toBeNull();
  });

  it('renders rays + ticket + box for win variant', () => {
    const { container } = render(<CelebrationArtwork variant="win" label="WINNER" />);
    expect(container.querySelector('[data-element="rays"]')).not.toBeNull();
    expect(container.querySelector('[data-element="ticket"]')).not.toBeNull();
  });

  it('cancelled variant hides rays and shows shrinking ticket', () => {
    const { container } = render(<CelebrationArtwork variant="cancelled" label="WINNER" />);
    expect(container.querySelector('[data-element="rays"]')).toBeNull();
    expect(container.querySelector('[data-element="ticket"]')).not.toBeNull();
  });

  it('respects prefers-reduced-motion (no animation classes)', () => {
    const mediaSpy = window.matchMedia;
    window.matchMedia = () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} });
    const { container } = render(<CelebrationArtwork variant="celebrate" label="WINNER" />);
    const rays = container.querySelector('[data-element="rays"]');
    expect(rays).not.toBeNull();
    expect(rays.getAttribute('data-animated')).toBe('false');
    window.matchMedia = mediaSpy;
  });
});
