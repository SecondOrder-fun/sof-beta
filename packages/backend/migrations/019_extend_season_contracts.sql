-- packages/backend/migrations/019_extend_season_contracts.sql
-- Extends season_contracts with the full season metadata the frontend
-- needs, so useAllSeasons can serve completely from warm cache instead
-- of falling back to on-chain reads.

ALTER TABLE season_contracts
  ADD COLUMN IF NOT EXISTS name TEXT,
  ADD COLUMN IF NOT EXISTS start_time BIGINT,
  ADD COLUMN IF NOT EXISTS end_time BIGINT,
  ADD COLUMN IF NOT EXISTS winner_count INTEGER,
  ADD COLUMN IF NOT EXISTS grand_prize_bps INTEGER,
  ADD COLUMN IF NOT EXISTS status INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS trading_locked BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS total_participants TEXT NOT NULL DEFAULT '0',
  ADD COLUMN IF NOT EXISTS total_tickets TEXT NOT NULL DEFAULT '0',
  ADD COLUMN IF NOT EXISTS total_prize_pool TEXT NOT NULL DEFAULT '0',
  ADD COLUMN IF NOT EXISTS vrf_request_id TEXT;

CREATE INDEX IF NOT EXISTS idx_season_contracts_status ON season_contracts(status);
