-- Mirror of packages/backend/migrations/017_allowlist_is_admin.sql

ALTER TABLE allowlist_entries
    ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_allowlist_entries_is_admin
    ON allowlist_entries(is_admin)
    WHERE is_admin = true;

COMMENT ON COLUMN allowlist_entries.is_admin IS
    'Backend-enforced admin flag, seeded from ADMIN_EOAS env var on first SIWE auth.';
