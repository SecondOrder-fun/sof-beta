-- Local Supabase seed — runs automatically on `supabase db reset`.
-- Anvil-only: this file is consumed only by the local supabase CLI.
--
-- Grants access_level=4 (admin) to Anvil Account[0] (the deployer) so that
-- contract admin actions remain available even after a DB reset wipes the
-- allowlist seeded by scripts/local-dev.sh.

INSERT INTO allowlist_entries (wallet_address, source, access_level, is_active)
VALUES ('0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266', 'manual', 4, true)
ON CONFLICT ((lower(wallet_address::text))) WHERE wallet_address IS NOT NULL
DO UPDATE SET
  access_level = EXCLUDED.access_level,
  is_active    = true,
  source       = 'manual';
