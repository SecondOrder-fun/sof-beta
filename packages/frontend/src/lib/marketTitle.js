// src/lib/marketTitle.js
// Utilities to build human-friendly market titles.
import { formatAddress } from '@/lib/utils';

/**
 * Build human-friendly title parts for a market.
 * - For WINNER_PREDICTION: returns { prefix, userAddr, seasonLabel }
 * - Otherwise: returns { prefix: question || market_type || 'Market' }
 */
export function buildMarketTitleParts(market) {
  if (!market) return { prefix: 'Market', userAddr: '', seasonLabel: '' };
  const seasonId = market?.raffle_id ?? market?.seasonId;
  if (market.market_type === 'WINNER_PREDICTION' && market.player && seasonId != null) {
    return {
      prefix: 'Will',
      userAddr: formatAddress(market.player),
      seasonLabel: `win Raffle Season ${seasonId}?`,
    };
  }
  return { prefix: market.question || market.market_type || 'Market', userAddr: '', seasonLabel: '' };
}
