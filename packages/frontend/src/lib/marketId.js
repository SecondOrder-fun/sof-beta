// src/lib/marketId.js
// Canonical marketId format: `${seasonId}:${marketType}:${subject}`
// - seasonId: integer-like string
// - marketType: UPPER_SNAKE_CASE from an allowlist
// - subject: player address (0x..) lowercased or '-' for global

const ALLOWED_TYPES = new Set([
  'WINNER_PREDICTION',
  'POSITION_SIZE',
  'BEHAVIORAL',
  'TOTAL_TICKETS',
]);

/**
 * Format a canonical marketId from parts
 */
export function formatMarketId({ seasonId, marketType, subject }) {
  if (seasonId == null || seasonId === '') throw new Error('seasonId required');
  const sid = String(seasonId);
  const type = String(marketType || '').toUpperCase();
  const subj = subject === '-' ? '-' : String(subject || '').toLowerCase();
  return `${sid}:${type}:${subj}`;
}

/**
 * Parse a canonical marketId to parts
 */
export function parseMarketId(marketId) {
  if (!marketId || typeof marketId !== 'string') throw new Error('marketId must be string');
  const parts = marketId.split(':');
  if (parts.length !== 3) throw new Error('invalid marketId format');
  const [seasonId, marketType, subjectRaw] = parts;
  return {
    seasonId,
    marketType,
    subject: subjectRaw === '-' ? '-' : subjectRaw.toLowerCase(),
  };
}

/**
 * Validate a canonical marketId string
 */
export function isValidMarketId(marketId) {
  try {
    const { seasonId, marketType, subject } = parseMarketId(marketId);
    if (!/^\d+$/.test(String(seasonId))) return false;
    if (!ALLOWED_TYPES.has(String(marketType).toUpperCase())) return false;
    if (subject !== '-' && !/^0x[a-f0-9]{40}$/.test(subject)) return false;
    return true;
  } catch {
    return false;
  }
}

export const MARKET_ID_TYPES = Array.from(ALLOWED_TYPES);
