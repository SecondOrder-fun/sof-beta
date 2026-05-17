// src/hooks/useAllSeasons.js
import { useWarmRead } from '@/hooks/chain/useWarmRead';

/**
 * Returns every season (active + completed). Reads from /api/seasons/all
 * which is populated by season listeners — no per-season RPC fan-out.
 *
 * Backend row shape (season_contracts after migration 019):
 *   season_id, bonding_curve_address, raffle_token_address, raffle_address,
 *   is_active, created_block, name, start_time, end_time, winner_count,
 *   grand_prize_bps, status, trading_locked, total_participants,
 *   total_tickets, total_prize_pool, vrf_request_id, created_at, updated_at
 *
 * SeasonStatus enum (matches RaffleStorage.sol):
 *   0 NotStarted | 1 Active | 2 EndRequested | 3 VRFPending
 *   4 Distributing | 5 Completed | 6 Cancelled
 *
 * Normalized output shape (for consumer compatibility):
 *   { id, season_id, status, trading_locked,
 *     config: { name, startTime, endTime, winnerCount, grandPrizeBps,
 *               bondingCurve, raffleToken, isActive, isCompleted },
 *     totalParticipants, totalTickets, totalPrizePool }
 */
function normalizeSeasonRow(row) {
  if (!row) return null;
  return {
    id: row.season_id,
    season_id: row.season_id,
    status: row.status ?? (row.is_active ? 1 : 5),
    trading_locked: row.trading_locked ?? false,
    config: {
      name: row.name ?? null,
      startTime: row.start_time != null ? BigInt(row.start_time) : 0n,
      endTime: row.end_time != null ? BigInt(row.end_time) : 0n,
      winnerCount: row.winner_count ?? 0,
      grandPrizeBps: row.grand_prize_bps ?? 0,
      bondingCurve: row.bonding_curve_address ?? null,
      raffleToken: row.raffle_token_address ?? null,
      isActive: row.is_active ?? false,
      isCompleted: (row.status ?? 0) === 5,
    },
    totalParticipants: row.total_participants != null ? BigInt(row.total_participants) : 0n,
    totalTickets: row.total_tickets != null ? BigInt(row.total_tickets) : 0n,
    totalPrizePool: row.total_prize_pool != null ? BigInt(row.total_prize_pool) : 0n,
    // Pass through raw backend fields for callers that prefer snake_case
    bonding_curve_address: row.bonding_curve_address,
    raffle_token_address: row.raffle_token_address,
    raffle_address: row.raffle_address,
    is_active: row.is_active,
    created_block: row.created_block,
  };
}

export function useAllSeasons() {
  const query = useWarmRead({
    path: '/seasons/all',
    refetchInterval: 30_000,
    staleTime: 20_000,
  });

  const data = (query.data || []).map(normalizeSeasonRow);

  return { ...query, data };
}
