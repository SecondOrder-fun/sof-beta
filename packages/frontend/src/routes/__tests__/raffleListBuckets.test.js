import { describe, it, expect } from 'vitest';
import { getSeasonGroup } from '../RaffleList';

describe('getSeasonGroup', () => {
  it('maps NotStarted (0) to upcoming', () => {
    expect(getSeasonGroup(0)).toBe('upcoming');
  });
  it('maps Active (1) to active', () => {
    expect(getSeasonGroup(1)).toBe('active');
  });
  it('maps EndRequested (2) to settling', () => {
    expect(getSeasonGroup(2)).toBe('settling');
  });
  it('maps VRFPending (3) to settling', () => {
    expect(getSeasonGroup(3)).toBe('settling');
  });
  it('maps Distributing (4) to settling', () => {
    expect(getSeasonGroup(4)).toBe('settling');
  });
  it('maps Completed (5) to complete', () => {
    expect(getSeasonGroup(5)).toBe('complete');
  });
  it('maps Cancelled (6) to complete', () => {
    expect(getSeasonGroup(6)).toBe('complete');
  });
  it('falls back to active for unknown values', () => {
    expect(getSeasonGroup(99)).toBe('active');
  });
});
