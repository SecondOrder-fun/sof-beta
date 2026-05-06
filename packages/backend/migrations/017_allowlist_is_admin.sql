-- Migration: 017_allowlist_is_admin
-- Description: Add is_admin boolean to allowlist_entries.
--
-- Per gasless-rewrite spec §2 backend-enforced admin gating. The codebase
-- has no `users` table — user records live in `allowlist_entries`. The
-- existing `access_level=4` convention captured admin status, but the new
-- ADMIN_EOAS env-var seeded flag wants an explicit boolean it can flip
-- false -> true on first SIWE auth without disturbing access_level.

ALTER TABLE allowlist_entries
    ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_allowlist_entries_is_admin
    ON allowlist_entries(is_admin)
    WHERE is_admin = true;

COMMENT ON COLUMN allowlist_entries.is_admin IS
    'Backend-enforced admin flag, seeded from ADMIN_EOAS env var on first SIWE auth.';
