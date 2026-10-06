-- Migration: 029_launch_quote_tokens
-- Description: Launches pair with native ETH or an allowlisted ERC-20 (contracts
-- 0.41.0), so the launch indexer's amounts are no longer always wei of ETH.
--
--   token_launches   start_price_wei -> start_price_e18  (quote raw units per whole
--                                                        token × 1e18)
--                    implied_fdv_wei -> start_fdv        (quote raw units; the launch now
--                                                        takes its opening valuation directly)
--                    + quote_token    (lowercase; 0x000…000 = native ETH)
--                    + quote_symbol   (null when the token's symbol cannot be read)
--                    + quote_decimals
--   launch_trades    eth_amount -> quote_amount, price_wei -> price_e18
--
-- and for the per-launch trade fee (contracts 0.42.0):
--
--   token_launches   + trade_fee      (pips, 10000 = 1%; the creator's choice)
--   launch_trades    + fee_amount     (quote raw units; NULL on older rows)
--
-- Prices are scaled by 1e18 (WAD fixed point) because a 6-decimal quote has
-- too few raw units per token to chart: a 2,500 USDC valuation of 1e9 tokens is
-- 2.5 raw USDC units per token, which an integer column floors to 2. The columns
-- stay TEXT (023): ~1e27 for a 1 ETH launch is past BIGINT and any JS number.
--
-- Existing rows were all ETH launches, so the new columns' defaults (ETH, 18) are
-- their true values. start_fdv and quote_amount keep their numbers; the two
-- price columns are multiplied by 1e18 in the same step that renames them, so
-- the rescale happens exactly once.
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
-- on each run, so each rename — and each price rescale, which shares its guard
-- and its transaction — happens only while the old column is still there.

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      -- scale: multiply existing values by this before renaming (NULL = keep them)
      ('token_launches', 'start_price_wei', 'start_price_e18', 1000000000000000000::numeric),
      ('token_launches', 'implied_fdv_wei', 'start_fdv', NULL),
      ('launch_trades', 'eth_amount', 'quote_amount', NULL),
      ('launch_trades', 'price_wei', 'price_e18', 1000000000000000000::numeric),
      -- A local database that ran an earlier draft of this migration has the
      -- prices as start_price / price, still in unscaled raw units.
      ('token_launches', 'start_price', 'start_price_e18', 1000000000000000000::numeric),
      ('launch_trades', 'price', 'price_e18', 1000000000000000000::numeric)
    ) AS t(tbl, old_name, new_name, scale)
  LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = r.tbl AND column_name = r.old_name
    ) AND NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = r.tbl AND column_name = r.new_name
    ) THEN
      IF r.scale IS NOT NULL THEN
        -- TEXT integer strings; NUMERIC is exact at any size, and an integer
        -- NUMERIC prints back without a decimal point.
        EXECUTE format(
          'UPDATE public.%I SET %I = (%I::numeric * %s)::text WHERE %I IS NOT NULL',
          r.tbl, r.old_name, r.old_name, r.scale, r.old_name
        );
      END IF;
      EXECUTE format('ALTER TABLE public.%I RENAME COLUMN %I TO %I', r.tbl, r.old_name, r.new_name);
    END IF;
  END LOOP;
END $$;

ALTER TABLE token_launches
  ADD COLUMN IF NOT EXISTS quote_token TEXT NOT NULL DEFAULT '0x0000000000000000000000000000000000000000',
  ADD COLUMN IF NOT EXISTS quote_symbol TEXT DEFAULT 'ETH',
  ADD COLUMN IF NOT EXISTS quote_decimals INTEGER NOT NULL DEFAULT 18;

-- Launch pools have a zero LP fee since contracts 0.42.0: the placer, as the
-- pool's v4 hook, takes the creator's trade fee (0.5%-10%, fixed per pool) in
-- the quote token. Launches from before 0.42 paid a 1% LP fee, so the default
-- 10000 is their true rate; every newer launch stores the rate from its event.
ALTER TABLE token_launches
  ADD COLUMN IF NOT EXISTS trade_fee INTEGER NOT NULL DEFAULT 10000;

-- The trade fee taken on each swap. From 0.42 quote_amount is what the trader
-- paid (buy: pool amount + fee) or received (sell: pool amount - fee). Rows
-- indexed before this column, and trades on pre-0.42 pools (whose LP fee is
-- inside the pool amounts), have no separate fee: NULL.
ALTER TABLE launch_trades
  ADD COLUMN IF NOT EXISTS fee_amount TEXT;

COMMENT ON COLUMN token_launches.start_price_e18 IS 'quote raw units per whole token, x 1e18 (WAD fixed point)';
COMMENT ON COLUMN token_launches.start_fdv IS 'opening fully-diluted valuation, quote raw units';
COMMENT ON COLUMN token_launches.trade_fee IS 'trade fee on every buy and sell, pips (10000 = 1%), in the quote token; 10000 for pre-0.42 launches, whose pools charged a 1% LP fee';
COMMENT ON COLUMN launch_trades.quote_amount IS 'quote raw units, unsigned; what the trader paid (buy) or received (sell), trade fee included';
COMMENT ON COLUMN launch_trades.fee_amount IS 'trade fee taken by the pool hook, quote raw units; NULL when not recorded (older rows, pre-0.42 LP-fee pools)';
COMMENT ON COLUMN launch_trades.price_e18 IS 'quote raw units per whole token, x 1e18 (WAD fixed point), from sqrtPriceX96 after the swap';
