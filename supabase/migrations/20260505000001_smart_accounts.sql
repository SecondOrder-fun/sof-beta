-- Mirror of packages/backend/migrations/016_smart_accounts.sql
-- This file is what supabase CLI applies on `supabase start`. The numbered
-- backend/migrations/*.sql files are the application-side authoritative
-- record; supabase migrations replay them in timestamp order.

CREATE TABLE IF NOT EXISTS smart_accounts (
    eoa             TEXT        PRIMARY KEY,
    sma             TEXT        NOT NULL UNIQUE,
    deployed_at     TIMESTAMPTZ,
    funded_at       TIMESTAMPTZ,
    last_active_at  TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_smart_accounts_sma ON smart_accounts(sma);

COMMENT ON TABLE smart_accounts IS
    'Maps each user EOA to its counterfactual SOFSmartAccount address.';
COMMENT ON COLUMN smart_accounts.eoa IS
    'Owner EOA, lowercased. Primary key.';
COMMENT ON COLUMN smart_accounts.sma IS
    'SOFSmartAccount address derived from factory.getAddress(eoa), lowercased.';
COMMENT ON COLUMN smart_accounts.deployed_at IS
    'Set when SOFSmartAccountFactory.AccountCreated fires for this EOA.';
COMMENT ON COLUMN smart_accounts.funded_at IS
    'Set after the backend airdrop relayer transfers SOF to the SMA.';
