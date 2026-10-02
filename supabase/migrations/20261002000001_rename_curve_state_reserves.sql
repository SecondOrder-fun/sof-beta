-- Mirror of packages/backend/migrations/028_rename_curve_state_reserves.sql

-- Migration: 028_rename_curve_state_reserves
-- Description: Rename curve_state.sof_reserves to reserves, matching the
-- contract's CurveConfig.reserves. Seasons are priced in per-season quote
-- tokens; $SOF no longer exists. The values (quote-token wei, as text) are
-- kept as they are.
--
-- RELEASE ORDER: in lockstep with the backend from the same PR, which reads
-- and writes `reserves` only. Merge, wait for its Railway deploy to go live,
-- then push this migration at once (`supabase db push --linked`). Until the
-- push:
--   - every /api/curve/:address route, and the launchpad seasons and
--     raffles routes while a season is live, return 500 on the missing column
--     (the frontend falls back to RPC for curve state and bond steps);
--   - curve_state writes that include reserves are skipped (each is logged);
--     the next trade on a curve rewrites its row, and a season created in
--     the window is re-seeded by scripts/reconcile-seasons.js (packages/backend;
--     usage in its header).
-- Frontend skew is covered for one release: the curve routes also return the
-- old `sofReserves` key, and the frontend reads `reserves ?? sofReserves`.
--
-- Mirrored by supabase/migrations/20261002000001_rename_curve_state_reserves.sql
-- (same SQL). Idempotent: scripts/local-dev.sh re-applies every file in this
-- directory on each run, so the rename only happens while the old column is
-- still there.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'curve_state' AND column_name = 'sof_reserves'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'curve_state' AND column_name = 'reserves'
  ) THEN
    ALTER TABLE curve_state RENAME COLUMN sof_reserves TO reserves;
  END IF;
END $$;
