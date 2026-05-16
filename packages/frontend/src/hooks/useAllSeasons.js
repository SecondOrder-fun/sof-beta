// src/hooks/useAllSeasons.js
import { useWarmRead } from '@/hooks/chain/useWarmRead';

/**
 * Returns every season (active + completed). Reads from /api/seasons/all
 * which is populated by season listeners — no per-season RPC fan-out.
 *
 * Backend row shape (season_contracts table):
 *   { id, season_id, bonding_curve_address, raffle_token_address,
 *     raffle_address, is_active, created_block, created_at, updated_at }
 *
 * Normalized output shape (for consumer compatibility):
 *   { id, season_id, status, config, totalParticipants, totalTickets, totalPrizePool }
 *   where config = { bondingCurve, raffleToken, name?, startTime?, endTime? }
 *   and status is derived from is_active: active → 1, inactive → 5
 *
 * NOTE: config.name, config.startTime, config.endTime are not stored in the
 * backend yet. They will be undefined until backend Phase A is extended.
 * totalTickets / totalParticipants / totalPrizePool default to 0n.
 */
function normalizeRow(row) {
  return {
    id: row.season_id,
    season_id: row.season_id,
    // Derive a numeric status from is_active:
    //   true  → 1 (Active)
    //   false → 5 (Completed)
    // Finer-grained status (EndRequested, VRFPending, Distributing, Cancelled)
    // will be available once the backend listener stores the on-chain enum.
    status: row.is_active ? 1 : 5,
    config: {
      bondingCurve: row.bonding_curve_address,
      raffleToken: row.raffle_token_address,
      // name / startTime / endTime not yet stored in season_contracts
    },
    totalParticipants: 0n,
    totalTickets: 0n,
    totalPrizePool: 0n,
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

  const normalized = (query.data || []).map(normalizeRow);

  return {
    ...query,
    data: normalized,
  };
}
