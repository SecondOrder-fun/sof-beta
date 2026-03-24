// tests/lib/marketTitle.test.js
import { describe, it, expect } from 'vitest';
import { buildMarketTitleParts } from '@/lib/marketTitle';

describe('buildMarketTitleParts', () => {
  it('returns descriptive parts for WINNER_PREDICTION', () => {
    const market = { market_type: 'WINNER_PREDICTION', player: '0x1234567890abcdef1234567890abcdef12345678', raffle_id: 2 };
    const parts = buildMarketTitleParts(market);
    expect(parts.prefix).toBe('Will');
    expect(parts.userAddr).toMatch(/^0x[0-9a-fA-F]{4}\.\.\.[0-9a-fA-F]{4}$/);
    expect(parts.seasonLabel).toBe('win Raffle Season 2?');
  });

  it('falls back to question if provided', () => {
    const market = { question: 'Custom question?', market_type: 'OTHER' };
    const parts = buildMarketTitleParts(market);
    expect(parts.prefix).toBe('Custom question?');
  });
});
