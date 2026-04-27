import { describe, it, expect } from 'vitest';
import { computeStreak } from '../useAirdropStreak';

const DAY = 86_400n;
const HOUR = 3_600n;

describe('computeStreak', () => {
  it('returns 0 for an empty list', () => {
    expect(computeStreak([])).toBe(0);
  });

  it('returns 1 for a single claim', () => {
    expect(computeStreak([1700000000n])).toBe(1);
  });

  it('counts consecutive daily claims', () => {
    const t = [10n * DAY, 11n * DAY, 12n * DAY, 13n * DAY];
    expect(computeStreak(t)).toBe(4);
  });

  it('breaks the streak on a gap > 36 hours', () => {
    // Two-day skip between idx 1 and 2 → streak is just the trailing run of 2
    const t = [10n * DAY, 11n * DAY, 13n * DAY, 14n * DAY];
    expect(computeStreak(t)).toBe(2);
  });

  it('tolerates ~24-hour spacing with hour-level jitter (chain timestamp drift)', () => {
    const t = [
      10n * DAY,
      10n * DAY + DAY + HOUR, // ~25h gap
      10n * DAY + 2n * DAY - HOUR, // ~23h gap
    ];
    expect(computeStreak(t)).toBe(3);
  });

  it('treats sub-grace gaps as continuing the streak (cooldown prevents this on-chain)', () => {
    // Defensive test: any two timestamps closer than the 36h grace count as
    // consecutive streak entries. The on-chain cooldown prevents two claims
    // within the same window in practice, so this exact input never occurs;
    // the assertion documents the math, not a desired user-facing rule.
    const t = [10n * DAY, 10n * DAY + HOUR];
    expect(computeStreak(t)).toBe(2);
  });

  it('breaks the streak when the most recent gap is too large', () => {
    // Long historical streak but the user missed the most recent day → streak
    // is just the trailing single claim because we walk newest → oldest.
    const t = [10n * DAY, 11n * DAY, 12n * DAY, 12n * DAY + 5n * DAY];
    expect(computeStreak(t)).toBe(1);
  });
});
