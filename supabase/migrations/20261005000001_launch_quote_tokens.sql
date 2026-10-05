-- Mirror of packages/backend/migrations/029_launch_quote_tokens.sql

-- Migration: 029_launch_quote_tokens
-- Description: Launches pair with native ETH or an allowlisted ERC-20 (contracts
-- 0.41.0), so the launch indexer's amounts are no longer always wei of ETH.
--
--   token_launches   start_price_wei -> start_price  (quote raw units per whole token)
--                    implied_fdv_wei -> start_fdv    (quote raw units; the launch now
--                                                     takes its opening valuation directly)
--                    + quote_token    (lowercase; 0x000…000 = native ETH)
--                    + quote_symbol   (null when the token's symbol cannot be read)
--                    + quote_decimals
--   launch_trades    eth_amount -> quote_amount, price_wei -> price
--
-- Existing rows were all ETH launches, so the new columns' defaults (ETH, 18) are
-- their true values and the renamed columns keep their numbers.
--
-- RELEASE ORDER: in lockstep with the backend from the same PR, which reads and
-- writes only the new names. Merge, wait for its Railway deploy, then push this
-- migration at once (`supabase db push --linked`). Until then the launchpad
-- routes fail on the missing columns and the launch indexers' inserts fail —
-- they throw, so their cursors stay put and the missed range is indexed after
-- the push.
--
-- Mirrored by supabase/migrations/20261005000001_launch_quote_tokens.sql (same
-- SQL). Idempotent: scripts/local-dev.sh re-applies every file in this directory
-- on each run, so each rename happens only while the old column is still there.

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('token_launches', 'start_price_wei', 'start_price'),
      ('token_launches', 'implied_fdv_wei', 'start_fdv'),
      ('launch_trades', 'eth_amount', 'quote_amount'),
      ('launch_trades', 'price_wei', 'price')
    ) AS t(tbl, old_name, new_name)
  LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = r.tbl AND column_name = r.old_name
    ) AND NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = r.tbl AND column_name = r.new_name
    ) THEN
      EXECUTE format('ALTER TABLE public.%I RENAME COLUMN %I TO %I', r.tbl, r.old_name, r.new_name);
    END IF;
  END LOOP;
END $$;

ALTER TABLE token_launches
  ADD COLUMN IF NOT EXISTS quote_token TEXT NOT NULL DEFAULT '0x0000000000000000000000000000000000000000',
  ADD COLUMN IF NOT EXISTS quote_symbol TEXT DEFAULT 'ETH',
  ADD COLUMN IF NOT EXISTS quote_decimals INTEGER NOT NULL DEFAULT 18;

COMMENT ON COLUMN token_launches.start_price IS 'quote raw units per whole token';
COMMENT ON COLUMN token_launches.start_fdv IS 'opening fully-diluted valuation, quote raw units';
COMMENT ON COLUMN launch_trades.quote_amount IS 'quote raw units, unsigned';
COMMENT ON COLUMN launch_trades.price IS 'quote raw units per whole token, from sqrtPriceX96 after the swap';
