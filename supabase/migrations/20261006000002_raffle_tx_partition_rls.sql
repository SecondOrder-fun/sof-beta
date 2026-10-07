-- Mirror of packages/backend/migrations/031_raffle_tx_partition_rls.sql

-- Migration: 031_raffle_tx_partition_rls
-- Description: Close raffle history and season rows to the public API.
--
-- raffle_transactions is partitioned by season (raffle_transactions_season_N,
-- created on demand by create_raffle_tx_partition). Row level security is
-- per table: enabling it on the parent does not cover its partitions, and
-- PostgREST serves each partition as a table of its own. The partitions had no
-- RLS while anon and authenticated hold every table privilege, so anyone with
-- the project's anon key could read, insert, update, delete or truncate raffle
-- history (Supabase advisor 0013 rls_disabled_in_public).
--
--   raffle_transactions + every partition    RLS on, no policies
--   create_raffle_tx_partition               enables RLS on each new partition
--   create_raffle_tx_partition,              EXECUTE revoked from PUBLIC, anon
--   auto_create_raffle_tx_partition,         and authenticated (advisors 0028 /
--   rls_auto_enable                          0029: SECURITY DEFINER over RPC)
--   populate_raffle_tx_player_id,            search_path pinned (advisor 0011)
--   refresh_user_positions,
--   curve_state_touch_updated_at
--   season_contracts_write / _update         dropped: they let anyone INSERT
--                                            and UPDATE season rows (curve,
--                                            winner) with the anon key; the
--                                            public read policy stays
--
-- No new policies on purpose: the backend is the only client and connects with
-- the service role key (shared/supabaseClient.js), which bypasses RLS. Reads
-- through the parent are checked against the parent's RLS only, so nothing the
-- backend does changes.
--
-- RELEASE ORDER: independent of any deploy; push whenever
-- (`supabase db push --linked`).
--
-- Mirrored by supabase/migrations/20261006000002_raffle_tx_partition_rls.sql
-- (same SQL). Idempotent: scripts/local-dev.sh re-applies every file in this
-- directory on each run.

ALTER TABLE raffle_transactions ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
    part regclass;
BEGIN
    FOR part IN
        SELECT inhrelid::regclass FROM pg_inherits
        WHERE inhparent = 'raffle_transactions'::regclass
    LOOP
        EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', part);
    END LOOP;
END $$;

CREATE OR REPLACE FUNCTION create_raffle_tx_partition(season_num BIGINT)
RETURNS VOID
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    partition_name TEXT;
BEGIN
    partition_name := 'raffle_transactions_season_' || season_num;
    IF NOT EXISTS (
        SELECT 1 FROM pg_tables
        WHERE schemaname = 'public' AND tablename = partition_name
    ) THEN
        EXECUTE format(
            'CREATE TABLE %I PARTITION OF raffle_transactions
             FOR VALUES FROM (%L) TO (%L)',
            partition_name,
            season_num,
            season_num + 1
        );
        -- A partition is a table of its own to PostgREST: RLS on the parent
        -- does not cover it.
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', partition_name);
        RAISE NOTICE 'Created partition: %', partition_name;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- Functions are executable by PUBLIC by default. Only the backend (service
-- role) calls create_raffle_tx_partition, over RPC; the trigger function runs
-- as its owner whoever fires the trigger. rls_auto_enable is the project's
-- event-trigger function (created in the dashboard, so absent locally).
DO $$
DECLARE
    fn TEXT;
BEGIN
    FOREACH fn IN ARRAY ARRAY[
        'public.create_raffle_tx_partition(bigint)',
        'public.auto_create_raffle_tx_partition()',
        'public.rls_auto_enable()'
    ] LOOP
        IF to_regprocedure(fn) IS NOT NULL THEN
            EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn);
            EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
        END IF;
    END LOOP;

    FOREACH fn IN ARRAY ARRAY[
        'public.populate_raffle_tx_player_id()',
        'public.refresh_user_positions(bigint)',
        'public.curve_state_touch_updated_at()'
    ] LOOP
        IF to_regprocedure(fn) IS NOT NULL THEN
            EXECUTE format('ALTER FUNCTION %s SET search_path = public, pg_temp', fn);
        END IF;
    END LOOP;
END $$;

DROP POLICY IF EXISTS season_contracts_write ON season_contracts;
DROP POLICY IF EXISTS season_contracts_update ON season_contracts;
