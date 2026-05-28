-- Add bonding_curve_address discriminator to raffle_transactions
-- Fixes #144 (transaction log) and #147 (token holders) cross-season bleed.
-- Mirror of packages/backend/migrations/020_add_bonding_curve_to_raffle_tx.sql
-- (backend/migrations is applied locally by local-dev.sh; this file is the copy
-- pushed to the remote project via `supabase db push --linked`).
--
-- raffle_transactions is PARTITIONED BY season_id, and season_id is the on-chain
-- seasonId which RESTARTS at 1 when the Raffle contract is redeployed. So
-- partition raffle_transactions_season_N accumulates rows from EVERY deployment's
-- season N, and a season-scoped read (.eq season_id) returns all of them — the
-- cross-deployment bleed seen in the Transaction Log and Token Holders panels.
--
-- Fix: tag each row with its bonding curve address (unique per season per
-- deployment) and scope reads by it.

ALTER TABLE raffle_transactions
  ADD COLUMN IF NOT EXISTS bonding_curve_address VARCHAR(42);

-- Backfill current-deployment rows only. season_contracts is upserted by
-- season_id (onConflict: season_id), so it holds the LIVE deployment's curve
-- address and creation block. Current-deployment rows are those at/after the
-- season's creation block; prior deployments' rows have strictly lower block
-- numbers on the same chain, so they keep NULL and are excluded by scoped reads.
UPDATE raffle_transactions rt
   SET bonding_curve_address = sc.bonding_curve_address
  FROM season_contracts sc
 WHERE rt.season_id = sc.season_id
   AND rt.bonding_curve_address IS NULL
   AND sc.bonding_curve_address IS NOT NULL
   AND sc.created_block IS NOT NULL
   AND rt.block_number >= sc.created_block;

CREATE INDEX IF NOT EXISTS idx_raffle_tx_season_curve
  ON raffle_transactions (season_id, bonding_curve_address);
