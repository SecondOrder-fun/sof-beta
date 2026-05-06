-- Migration: 016_smart_accounts
-- Description: EOA -> Smart Account (SMA) mapping with deploy + funding tracking.
-- Per gasless-rewrite spec §5.4. SMA addresses are deterministic via
-- SOFSmartAccountFactory.getAddress(eoa); the factory + airdrop pipelines
-- read/write this table during SIWE auth.

CREATE TABLE IF NOT EXISTS smart_accounts (
    eoa             TEXT        PRIMARY KEY,        -- lowercased
    sma             TEXT        NOT NULL UNIQUE,    -- lowercased
    deployed_at     TIMESTAMPTZ,                    -- set by accountCreatedListener
    funded_at       TIMESTAMPTZ,                    -- set by airdropService.transferToSma
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
