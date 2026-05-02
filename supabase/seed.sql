-- Local-only seed. NEVER applied to testnet/mainnet — those run init.sql alone.
--
-- Consumed by:
--   - `supabase db reset` (auto-runs after migrations) for local Supabase Studio
--   - docker-compose, which mounts this file as 02-seed.sql in the postgres
--     entrypoint dir so it runs after 01-init.sql
--
-- Seeds access_level=4 (admin) for Anvil Account[0]. Always-needed admins
-- (e.g. the deployer wallet) belong in init.sql since they apply to every
-- environment; this file is exclusively for local-dev convenience.

INSERT INTO allowlist_entries (wallet_address, source, access_level, is_active)
VALUES ('0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266', 'manual', 4, true)
ON CONFLICT ((lower(wallet_address::text))) WHERE wallet_address IS NOT NULL
DO UPDATE SET
  access_level = EXCLUDED.access_level,
  is_active    = true,
  source       = 'manual';
