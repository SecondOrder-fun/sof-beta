-- Migration: 027_drop_smart_accounts
-- Description: Remove the smart-account layer from the schema. Users
-- transact from the wallet they connect, and the user identity is that
-- wallet address, so the EOA -> SOFSmartAccount mapping is no longer read
-- or written.
--
--   smart_accounts            DROPPED (migration 016), with its sma index.
--                             Its deployed_at / funded_at columns were the
--                             only record of the AccountCreated listener and
--                             the first-login SOF airdrop; both are gone.
--   listener_block_cursors    the AccountCreated listener's cursor row
--                             ("<factory>:AccountCreated") is DELETED.
--
-- RELEASE ORDER: deploy the backend that no longer reads smart_accounts
-- FIRST, then push this migration (`supabase db push --linked`). Pushing it
-- before the deploy would break sign-in on the running backend.
--
-- Mirrored by supabase/migrations/20261002000000_drop_smart_accounts.sql
-- (same SQL). Idempotent: scripts/local-dev.sh re-applies every file in this
-- directory on each run (016 re-creates the table, this drops it again), so
-- every statement is IF EXISTS / repeatable.

BEGIN;

-- ── smart_accounts ───────────────────────────────────────────────────────
DROP INDEX IF EXISTS idx_smart_accounts_sma;
DROP TABLE IF EXISTS smart_accounts;

-- ── listener_block_cursors ───────────────────────────────────────────────
DELETE FROM listener_block_cursors WHERE listener_key LIKE '%:AccountCreated';

COMMIT;
