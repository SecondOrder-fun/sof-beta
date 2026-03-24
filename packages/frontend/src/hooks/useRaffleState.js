// src/hooks/useRaffleState.js
// Consolidates raffle read-only state into a single hook.

import { useRaffleRead, useSeasonDetailsQuery } from './useRaffleRead';
import { useAccessControl } from './useAccessControl';

/**
 * @notice A unified hook to manage all read-only state for the raffle.
 * @returns {object} An object containing queries and role-checking functions.
 */
export function useRaffleState(overrideSeasonId) {
  // Read hooks
  const { currentSeasonQuery } = useRaffleRead();
  const effectiveSeasonId = overrideSeasonId ?? currentSeasonQuery.data;
  const rawSeasonDetailsQuery = useSeasonDetailsQuery(effectiveSeasonId);

  const seasonDetailsQuery = {
    ...rawSeasonDetailsQuery,
    data: rawSeasonDetailsQuery.data
      ? {
          config: rawSeasonDetailsQuery.data[0],
          status: rawSeasonDetailsQuery.data[1],
          totalParticipants: rawSeasonDetailsQuery.data[2],
          totalTickets: rawSeasonDetailsQuery.data[3],
          totalPrizePool: rawSeasonDetailsQuery.data[4],
        }
      : null,
  };

  // Access control
  const { hasRole } = useAccessControl();

  return {
    // Queries
    currentSeasonQuery,
    seasonDetailsQuery,

    // Functions
    hasRole,
  };
}
