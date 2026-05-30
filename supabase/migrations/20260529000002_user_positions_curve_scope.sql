-- Scope user_raffle_positions matview by bonding curve (#152)
-- Mirror of packages/backend/migrations/021_user_positions_curve_scope.sql
-- (backend/migrations is applied locally by local-dev.sh; this file is the copy
-- pushed to the remote project via `supabase db push --linked`).
--
-- The matview aggregated by season_id only. season_id is the on-chain seasonId,
-- which restarts when the Raffle contract is redeployed, so a single season_id
-- can hold rows from multiple deployments. Aggregating by season_id alone summed
-- prior-deployment positions into the current one — the "Your Positions"
-- cross-deployment bleed (same root cause as #144 / #147).
--
-- Redefine the matview to also key on bonding_curve_address and exclude
-- unstamped residue rows (bonding_curve_address IS NULL). Reads scope to the
-- season's current curve (raffleTransactionService.getUserPosition /
-- getAllUserPositions).

DROP MATERIALIZED VIEW IF EXISTS user_raffle_positions;

CREATE MATERIALIZED VIEW user_raffle_positions AS
SELECT
    user_address,
    player_id,
    season_id,
    bonding_curve_address,
    COUNT(*)                                                                   AS transaction_count,
    SUM(CASE WHEN transaction_type = 'BUY'  THEN ticket_amount ELSE 0 END)      AS total_bought,
    SUM(CASE WHEN transaction_type = 'SELL' THEN ABS(ticket_amount) ELSE 0 END) AS total_sold,
    SUM(ticket_amount)                                                         AS current_tickets,
    SUM(sof_amount)                                                            AS total_sof_spent,
    AVG(CASE WHEN transaction_type = 'BUY' THEN price_per_ticket ELSE NULL END) AS avg_buy_price,
    MIN(block_timestamp)                                                       AS first_transaction_at,
    MAX(block_timestamp)                                                       AS last_transaction_at,
    ARRAY_AGG(tx_hash ORDER BY block_timestamp)                                AS transaction_hashes
FROM raffle_transactions
WHERE bonding_curve_address IS NOT NULL
GROUP BY user_address, player_id, season_id, bonding_curve_address;

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_raffle_pos_unique
    ON user_raffle_positions (user_address, season_id, bonding_curve_address);
CREATE INDEX IF NOT EXISTS idx_user_raffle_pos_player
    ON user_raffle_positions (player_id, season_id);

REVOKE SELECT ON user_raffle_positions FROM anon, authenticated;
