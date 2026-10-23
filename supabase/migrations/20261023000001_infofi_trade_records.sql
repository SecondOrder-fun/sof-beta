-- Mirror of packages/backend/migrations/032_infofi_trade_records.sql

-- Migration: 032_infofi_trade_records
-- Description: Make infofi_positions a real trade log, one row per FPMM Trade event.
--
-- The trade listener has always checked and written a tx_hash the table never
-- had, so every insert failed and no InfoFi trade was stored. And the pre-0.44
-- Trade event did not say whether a trade was a buy or a sell. Contracts 0.44
-- emit Trade(trader, isBuy, yes, collateral, shares, fee); this stores it:
--
--   infofi_positions  + tx_hash, log_index    the event's identity (unique pair)
--                     + block_number, block_time
--                     + side                  'BUY' | 'SELL'
--                     + shares                outcome tokens bought or sold
--                     + fee                   collateral taken as fee
--   amount            collateral paid (buy, fee included) or received (sell),
--                     always positive, as before
--   user_market_positions   total_amount is now net collateral: sells subtract
--
-- RELEASE ORDER: ADDITIVE — push this migration BEFORE the backend deploy from
-- the same PR (`supabase db push --linked`). The new backend writes the new
-- columns on every trade; the backend running now writes none (its inserts
-- fail on tx_hash today), so pushing first changes nothing for it.
--
-- Mirrored by supabase/migrations/20261023000001_infofi_trade_records.sql
-- (same SQL). Idempotent: scripts/local-dev.sh re-applies every file in this
-- directory on each run.

ALTER TABLE infofi_positions
  ADD COLUMN IF NOT EXISTS tx_hash      TEXT,
  ADD COLUMN IF NOT EXISTS log_index    INTEGER,
  ADD COLUMN IF NOT EXISTS block_number BIGINT,
  ADD COLUMN IF NOT EXISTS block_time   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS side         VARCHAR(4) NOT NULL DEFAULT 'BUY',
  ADD COLUMN IF NOT EXISTS shares       NUMERIC(38,18),
  ADD COLUMN IF NOT EXISTS fee          NUMERIC(38,18);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'infofi_positions_side_check'
  ) THEN
    ALTER TABLE infofi_positions
      ADD CONSTRAINT infofi_positions_side_check CHECK (side IN ('BUY', 'SELL'));
  END IF;
END $$;

-- One row per Trade log. Rows from before this migration have no tx_hash and
-- stay out of the index's way (NULLs are distinct).
CREATE UNIQUE INDEX IF NOT EXISTS infofi_positions_tx_log_key
  ON infofi_positions (tx_hash, log_index);
CREATE INDEX IF NOT EXISTS idx_infofi_positions_block_time
  ON infofi_positions (block_time);

COMMENT ON COLUMN infofi_positions.amount IS 'collateral, human units: paid on a BUY (fee included), received on a SELL (net of fee); always positive';
COMMENT ON COLUMN infofi_positions.side IS 'BUY or SELL, from Trade.isBuy (contracts 0.44.0)';
COMMENT ON COLUMN infofi_positions.shares IS 'outcome tokens bought (BUY) or sold (SELL), human units';

CREATE OR REPLACE VIEW user_market_positions
WITH (security_invoker = true) AS
SELECT
    user_address,
    market_id,
    outcome,
    COUNT(*)          AS position_count,
    SUM(CASE WHEN side = 'SELL' THEN -amount ELSE amount END) AS total_amount,
    AVG(price)        AS avg_price,
    MIN(created_at)   AS first_position_at,
    MAX(created_at)   AS last_position_at
FROM infofi_positions
GROUP BY user_address, market_id, outcome;
