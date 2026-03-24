// src/lib/seasonTime.js
// Helpers for computing season timing fields derived from UI state.

/**
 * Buffer applied when auto-starting a season so the on-chain check
 * `startTime > block.timestamp` in `Raffle.createSeason()` is satisfied.
 * Increased to 120 seconds to account for transaction mining delays.
 * @type {number}
 */
export const AUTO_START_BUFFER_SECONDS = 120;

/**
 * Derive the unix timestamp (seconds) for a season start.
 *
 * @param {Object} params
 * @param {boolean} params.autoStart - Whether the admin requested auto-start.
 * @param {number | null | undefined} params.chainTimeSec - Latest chain timestamp (seconds).
 * @param {number | null | undefined} params.manualStartSec - Start time selected via datetime input.
 * @returns {number} Unix timestamp in seconds suitable for conversion to `BigInt`.
 */
export function computeSeasonStartTimestamp({ autoStart, chainTimeSec, manualStartSec }) {
  const fallbackNow = Math.floor(Date.now() / 1000);
  const baseChainTime = typeof chainTimeSec === 'number' && Number.isFinite(chainTimeSec)
    ? chainTimeSec
    : fallbackNow;

  if (autoStart) {
    // Reason: contract requires strictly future start timestamp; add buffer to avoid race.
    return baseChainTime + AUTO_START_BUFFER_SECONDS;
  }

  if (typeof manualStartSec === 'number' && Number.isFinite(manualStartSec)) {
    const comparisonTime = baseChainTime;
    if (manualStartSec <= comparisonTime + AUTO_START_BUFFER_SECONDS) {
      throw new Error(`Manual start time must be at least ${AUTO_START_BUFFER_SECONDS} seconds in the future`);
    }
    return manualStartSec;
  }

  throw new Error('Season start time is required');
}
