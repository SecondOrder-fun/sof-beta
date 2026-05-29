-- Migration 021: Scope user_raffle_positions matview by bonding curve (#152)
--
-- The matview aggregated by season_id only. season_id is the on-chain seasonId,
-- which restarts when the Raffle contract is redeployed, so a single season_id
-- can hold rows from multiple deployments. Aggregating by season_id alone summed
-- prior-deployment positions into the current one — the "Your Positions"
-- cross-deployment bleed (same root cause as #144 / #147).
--
-- Redefine the matview to also key on bonding_curve_address (unique per season
-- per deployment) and exclude unstamped residue rows (bonding_curve_address IS
-- NULL). Reads scope to the season's current curve — see
-- raffleTransactionService.getUserPosition / getAllUserPositions.

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

-- Unique index (required for REFRESH ... CONCURRENTLY) now includes the curve.
-- The WHERE filter above keeps it NULL-free.
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_raffle_pos_unique
    ON user_raffle_positions (user_address, season_id, bonding_curve_address);
CREATE INDEX IF NOT EXISTS idx_user_raffle_pos_player
    ON user_raffle_positions (player_id, season_id);

-- Matviews bypass RLS; the backend reads via service_role. Re-revoke from
-- anon/authenticated (DROP cleared the prior grant) to keep the lockdown.
REVOKE SELECT ON user_raffle_positions FROM anon, authenticated;
