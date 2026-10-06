-- Mirror of packages/backend/migrations/030_launch_liquidity_preset.sql

-- Migration: 030_launch_liquidity_preset
-- Description: A launch chooses how its liquidity is shaped (contracts 0.43.0):
-- TokenLaunched carries `uint8 liquidityPreset`, and the launch indexer stores it.
--
--   token_launches   + liquidity_preset   (0 Classic, 1 Steady start,
--                                          2 Thick middle, 3 Wide open)
--
-- Launches from before 0.43 all placed the single Classic range, so the default
-- 0 is their true value. Every newer launch stores the preset from its event:
-- the indexer treats a TokenLaunched without one as unusable rather than let
-- this default stand in for it.
--
-- RELEASE ORDER: ADDITIVE, with a default — push this migration BEFORE the
-- backend deploy from the same PR (`supabase db push --linked`). The new
-- backend writes liquidity_preset on every launch insert and selects it in the
-- launchpad routes, so deploying it first would fail both until the push. The
-- backend already running ignores the new column, and its inserts take the
-- default.
--
-- Mirrored by supabase/migrations/20261006000001_launch_liquidity_preset.sql
-- (same SQL). Idempotent: scripts/local-dev.sh re-applies every file in this
-- directory on each run, so the column is added only while it is missing.

ALTER TABLE token_launches
  ADD COLUMN IF NOT EXISTS liquidity_preset SMALLINT NOT NULL DEFAULT 0;

COMMENT ON COLUMN token_launches.liquidity_preset IS 'liquidity shape the launch chose: 0 Classic, 1 Steady start, 2 Thick middle, 3 Wide open (contracts 0.43.0); 0 for pre-0.43 launches, which all placed the single Classic range';
