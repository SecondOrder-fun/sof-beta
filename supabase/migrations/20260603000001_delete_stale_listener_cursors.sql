-- Delete stale listener_block_cursors from old deployments (#163)
-- Mirror of packages/backend/migrations/022_delete_stale_listener_cursors.sql
-- (backend/migrations is applied locally by local-dev.sh; this file is the copy
-- pushed to the remote project via `supabase db push --linked`).
--
-- WHAT: Removes orphaned rows from listener_block_cursors whose updated_at
--       predates the most recent contract redeploy (2026-05-22).
--
-- WHY:  The table accumulated ~47 cursor rows but only ~13 belong to the
--       current deployment's active listeners. The other ~30 are leftovers
--       from contract deployments that no longer exist (updated_at clustered
--       around May 3/10/15/21, 2026). Their listeners are gone, so they drive
--       no egress — they are pure dead weight.
--
-- CAUTION: This is gated purely on updated_at, NOT on liveness. If a currently
--          active-but-idle listener happens to have a cursor older than the
--          cutoff (it has processed no new blocks since 2026-05-22), its row is
--          also removed. That is acceptable: blockCursor.js `get()` returns
--          null for a missing row, so the listener falls back to its configured
--          start block and
--          listener simply re-initializes its cursor on the next event. No data
--          loss, only a one-time re-scan from the fallback start block.
--
-- IDEMPOTENT: Safe to re-run. A second execution matches zero rows (the stale
--             rows are gone) and any rows written after the cutoff are never
--             touched, since their updated_at >= the cutoff.

DELETE FROM listener_block_cursors
WHERE updated_at < TIMESTAMPTZ '2026-05-22 00:00:00+00';
