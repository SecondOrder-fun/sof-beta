// src/hooks/useRaffleState.js
// Consolidates raffle read-only state into a single hook.

import { useAllSeasons } from './useAllSeasons';
import { useWarmRead } from '@/hooks/chain/useWarmRead';

/**
 * @notice A unified hook to manage all read-only state for the raffle.
 * @returns {object} An object containing queries.
 */
export function useRaffleState(overrideSeasonId) {
  // currentSeasonId — newest season from the warm /seasons/all cache
  const allSeasonsQuery = useAllSeasons();
  const latestSeasonId = allSeasonsQuery.data?.[0]?.id ?? null;
  const effectiveSeasonId = overrideSeasonId ?? latestSeasonId;

  // currentSeasonQuery shim — callers expect { data: seasonId }
  const currentSeasonQuery = {
    ...allSeasonsQuery,
    data: latestSeasonId,
  };

  // Season details — warm read of backend /seasons/:seasonId
  const rawSeasonDetailsQuery = useWarmRead({
    path: '/seasons/:seasonId',
    params: { seasonId: effectiveSeasonId },
    staleTime: 20_000,
    refetchInterval: 30_000,
    enabled: effectiveSeasonId != null,
  });

  // Normalize raw DB row into the same shape callers expect
  const row = rawSeasonDetailsQuery.data;
  const seasonDetailsQuery = {
    ...rawSeasonDetailsQuery,
    data: row
      ? {
          config: {
            bondingCurve: row.bonding_curve_address ?? null,
            raffleToken: row.raffle_token_address ?? null,
            name: row.name ?? null,
            startTime: row.start_time != null ? BigInt(row.start_time) : 0n,
            endTime: row.end_time != null ? BigInt(row.end_time) : 0n,
            winnerCount: row.winner_count ?? 0,
            grandPrizeBps: row.grand_prize_bps ?? 0,
            isActive: row.is_active ?? false,
            isCompleted: (row.status ?? 0) === 5,
          },
          status: row.status ?? 0,
          totalParticipants: row.total_participants != null ? BigInt(row.total_participants) : 0n,
          totalTickets: row.total_tickets != null ? BigInt(row.total_tickets) : 0n,
          totalPrizePool: row.total_prize_pool != null ? BigInt(row.total_prize_pool) : 0n,
        }
      : null,
  };

  return {
    // Queries
    currentSeasonQuery,
    seasonDetailsQuery,
  };
}
