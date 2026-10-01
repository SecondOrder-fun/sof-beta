-- Mirror of packages/backend/migrations/024_season_quote_token_and_winner.sql

ALTER TABLE season_contracts
  ADD COLUMN IF NOT EXISTS quote_token_address TEXT,
  ADD COLUMN IF NOT EXISTS winner_address TEXT;

CREATE INDEX IF NOT EXISTS idx_season_contracts_quote_token
  ON season_contracts (quote_token_address);
