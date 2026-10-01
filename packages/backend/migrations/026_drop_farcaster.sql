-- Migration: 026_drop_farcaster
-- Description: Remove Farcaster identity from the schema. Sign-in is
-- wallet-only (POST /api/auth/verify method "wallet"), so allowlist and
-- access-group rows are keyed by wallet address alone.
--
--   allowlist_entries     rows with no wallet_address are DELETED; the fid
--                         column and its indexes are dropped, plus the
--                         Farcaster profile/resolution columns nothing reads
--                         any more (display_name, wallet_resolved_at).
--                         `username` stays: the admin UIs display it.
--                         wallet_address becomes NOT NULL.
--   user_access_groups    rows with no wallet_address are DELETED; the fid
--                         column, its CHECK (fid OR wallet), its (fid,
--                         group_id) unique index and its fid index are
--                         dropped. wallet_address becomes NOT NULL and the
--                         unique (wallet_address, group_id) index is ensured.
--   farcaster_notification_tokens   DROPPED.
--
-- ADMINS: admins that existed only as FIDs are dropped by this migration.
-- Migration 009 seeded FIDs 13837 and 1047382 as access_level 4 with no
-- wallet_address; those rows are deleted here. Admin access for wallets
-- comes from ADMIN_EOAS (adminEoaService flips allowlist_entries.is_admin
-- on sign-in) and from wallet-keyed allowlist rows with access_level = 4.
-- Insert the replacement admin wallets in the marked section below BEFORE
-- pushing this migration to a remote database.
--
-- Mirrored by supabase/migrations/20261001000001_drop_farcaster.sql (same
-- SQL). Idempotent: scripts/local-dev.sh re-applies every file in this
-- directory on each run, so every statement is IF EXISTS / repeatable.

BEGIN;

-- ── allowlist_entries ────────────────────────────────────────────────────
DELETE FROM allowlist_entries WHERE wallet_address IS NULL;

DROP INDEX IF EXISTS uq_allowlist_entries_fid_not_null;
DROP INDEX IF EXISTS idx_allowlist_entries_fid;
DROP INDEX IF EXISTS idx_allowlist_entries_pending_resolution;
-- 004 created fid as `UNIQUE`; 007 dropped that constraint by lookup, but
-- drop it by its default name too in case an environment skipped 007.
ALTER TABLE allowlist_entries DROP CONSTRAINT IF EXISTS allowlist_entries_fid_key;

ALTER TABLE allowlist_entries DROP COLUMN IF EXISTS fid;
ALTER TABLE allowlist_entries DROP COLUMN IF EXISTS display_name;
ALTER TABLE allowlist_entries DROP COLUMN IF EXISTS wallet_resolved_at;

ALTER TABLE allowlist_entries ALTER COLUMN wallet_address SET NOT NULL;
-- 'webhook' meant the Farcaster MiniApp webhook; rows are now added by an
-- admin ('manual') or a bulk import ('import').
ALTER TABLE allowlist_entries ALTER COLUMN source SET DEFAULT 'manual';

COMMENT ON TABLE  allowlist_entries                IS 'Allowlisted wallets and their access level';
COMMENT ON COLUMN allowlist_entries.wallet_address IS 'Lowercased wallet address (the user identity)';
COMMENT ON COLUMN allowlist_entries.source         IS 'How the wallet was added: manual (admin), import (bulk)';

-- ── user_access_groups ───────────────────────────────────────────────────
DELETE FROM user_access_groups WHERE wallet_address IS NULL;

ALTER TABLE user_access_groups DROP CONSTRAINT IF EXISTS chk_user_access_groups_identifier;
-- 006 created UNIQUE(fid, group_id) as a table constraint; 012 / init.sql
-- replaced it with the partial index below. Drop both forms.
ALTER TABLE user_access_groups DROP CONSTRAINT IF EXISTS user_access_groups_fid_group_id_key;
DROP INDEX IF EXISTS uq_user_access_groups_fid_group;
DROP INDEX IF EXISTS idx_user_access_groups_fid;

ALTER TABLE user_access_groups DROP COLUMN IF EXISTS fid;

ALTER TABLE user_access_groups ALTER COLUMN wallet_address SET NOT NULL;

-- Same definition as 012 / init.sql, so this is a no-op where it exists.
-- The WHERE clause is now always true; it is kept so the definition matches
-- the existing index.
CREATE UNIQUE INDEX IF NOT EXISTS uq_user_access_groups_wallet_group
    ON user_access_groups (wallet_address, group_id)
    WHERE wallet_address IS NOT NULL;

COMMENT ON TABLE user_access_groups IS 'Links wallets to access groups';

-- ── farcaster_notification_tokens ────────────────────────────────────────
DROP TABLE IF EXISTS farcaster_notification_tokens;

-- ── ADMIN WALLETS: insert wallet-keyed admin rows here before pushing ────
-- One row per admin wallet (lowercase). access_level 4 = ADMIN; is_admin is
-- the flag adminEoaService reads (migration 017). Upsert so a re-run or an
-- existing non-admin row is corrected. Example:
--
-- INSERT INTO allowlist_entries
--     (wallet_address, source, is_active, added_at, access_level, is_admin, created_at, updated_at)
-- VALUES
--     ('0x0000000000000000000000000000000000000000', 'manual', true, NOW(), 4, true, NOW(), NOW())
-- ON CONFLICT ((lower(wallet_address::text))) WHERE wallet_address IS NOT NULL
-- DO UPDATE SET access_level = 4, is_admin = true, is_active = true, updated_at = NOW();

COMMIT;
