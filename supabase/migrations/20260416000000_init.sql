-- ==========================================================================
-- SecondOrder.fun — Local Docker Postgres Init
-- ==========================================================================
-- Consolidated from migrations 001-015 and src/db/migrations/*.
-- Represents the FINAL schema after all migrations have been applied.
-- Intended for local development with plain Postgres (not Supabase).
--
-- Tables (23):
--   1.  players
--   2.  infofi_markets
--   3.  infofi_positions
--   4.  infofi_winnings
--   5.  infofi_odds_history
--   6.  infofi_failed_markets
--   7.  season_contracts
--   8.  raffle_transactions          (partitioned)
--   9.  farcaster_notification_tokens
--  10.  allowlist_entries
--  11.  allowlist_config
--  12.  access_groups
--  13.  user_access_groups
--  14.  route_access_config
--  15.  access_settings
--  16.  nft_drops
--  17.  listener_block_cursors
--  18.  gating_signatures
--  19.  sponsor_prizes
--  20.  season_tier_configs
--  21.  rollover_events
--
-- Materialized views (2):
--  22.  user_raffle_positions
--  23.  user_market_positions
-- ==========================================================================

-- ==========================================================================
-- 0. ROLES & PERMISSIONS
-- ==========================================================================
-- Supabase uses service_role, authenticated, anon. For local Docker Postgres
-- we create these roles so the app code (and RLS policies) work identically.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role LOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOINHERIT;
  END IF;
END $$;

-- Schema-level grants
GRANT USAGE  ON SCHEMA public TO service_role;
GRANT CREATE ON SCHEMA public TO service_role;
GRANT USAGE  ON SCHEMA public TO authenticated;
GRANT USAGE  ON SCHEMA public TO anon;

-- Default privileges so future objects are also accessible
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL PRIVILEGES ON TABLES    TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL PRIVILEGES ON SEQUENCES TO service_role;

-- ==========================================================================
-- 1. players — Centralised player metadata
-- ==========================================================================
CREATE TABLE IF NOT EXISTS players (
    id         BIGSERIAL    PRIMARY KEY,
    address    VARCHAR(42)  NOT NULL UNIQUE,
    created_at TIMESTAMPTZ  DEFAULT NOW(),
    updated_at TIMESTAMPTZ  DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_players_address ON players (address);

ALTER TABLE players ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'players_read' AND tablename = 'players') THEN
    CREATE POLICY players_read ON players FOR SELECT USING (true);
  END IF;
END $$;

COMMENT ON TABLE players IS 'Centralised player metadata keyed by Ethereum address';

-- ==========================================================================
-- 2. infofi_markets — InfoFi prediction markets per season/player
-- ==========================================================================
CREATE TABLE IF NOT EXISTS infofi_markets (
    id                      BIGSERIAL    PRIMARY KEY,
    season_id               BIGINT       NOT NULL,
    player_address          VARCHAR(42)  NOT NULL,
    player_id               BIGINT       REFERENCES players(id) ON DELETE SET NULL,
    market_type             VARCHAR(50)  NOT NULL,        -- 'WINNER_PREDICTION', 'POSITION_SIZE', 'BEHAVIORAL'
    contract_address        VARCHAR(42),                  -- FPMM contract address
    current_probability_bps INTEGER      DEFAULT 0,       -- Basis points 0-10000
    is_active               BOOLEAN      DEFAULT true,
    is_settled              BOOLEAN      DEFAULT false,
    settlement_time         TIMESTAMPTZ,
    winning_outcome         BOOLEAN,
    last_synced_block       BIGINT       DEFAULT 0,
    last_synced_at          TIMESTAMPTZ,
    created_at              TIMESTAMPTZ  DEFAULT NOW(),
    updated_at              TIMESTAMPTZ  DEFAULT NOW()
);

-- Case-insensitive unique constraint: one market per (season, player, type)
CREATE UNIQUE INDEX IF NOT EXISTS unique_season_player_market_idx
    ON infofi_markets (season_id, LOWER(player_address), market_type);

CREATE INDEX IF NOT EXISTS idx_infofi_markets_player_id
    ON infofi_markets (player_id);

ALTER TABLE infofi_markets ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'infofi_markets_read' AND tablename = 'infofi_markets') THEN
    CREATE POLICY infofi_markets_read ON infofi_markets FOR SELECT USING (true);
  END IF;
END $$;

COMMENT ON TABLE  infofi_markets             IS 'InfoFi prediction markets — one per player per season per type';
COMMENT ON COLUMN infofi_markets.season_id   IS 'References the raffle season ID (equivalent to raffle_id in other contexts)';
COMMENT ON INDEX  unique_season_player_market_idx IS 'Ensures unique markets per season/player/type with case-insensitive address matching';

-- ==========================================================================
-- 3. infofi_positions — User bets in InfoFi markets
-- ==========================================================================
CREATE TABLE IF NOT EXISTS infofi_positions (
    id           BIGSERIAL       PRIMARY KEY,
    market_id    BIGINT          NOT NULL REFERENCES infofi_markets(id) ON DELETE CASCADE,
    user_address VARCHAR(42)     NOT NULL,
    outcome      VARCHAR(10)     NOT NULL,          -- 'YES' | 'NO'
    amount       NUMERIC(38,18)  NOT NULL,
    price        NUMERIC(38,18),
    created_at   TIMESTAMPTZ     DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_infofi_positions_market ON infofi_positions (market_id);
CREATE INDEX IF NOT EXISTS idx_infofi_positions_user   ON infofi_positions (user_address);

ALTER TABLE infofi_positions ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'infofi_positions_read' AND tablename = 'infofi_positions') THEN
    CREATE POLICY infofi_positions_read ON infofi_positions FOR SELECT USING (true);
  END IF;
END $$;

COMMENT ON TABLE infofi_positions IS 'Individual user position entries (bets) in InfoFi prediction markets';

-- ==========================================================================
-- 4. infofi_winnings — Settled winnings from prediction markets
-- ==========================================================================
CREATE TABLE IF NOT EXISTS infofi_winnings (
    id           BIGSERIAL    PRIMARY KEY,
    user_address VARCHAR(42)  NOT NULL,
    market_id    BIGINT       NOT NULL REFERENCES infofi_markets(id) ON DELETE CASCADE,
    amount       NUMERIC      NOT NULL,
    is_claimed   BOOLEAN      DEFAULT false,
    claimed_at   TIMESTAMPTZ,
    created_at   TIMESTAMPTZ  DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_infofi_winnings_user   ON infofi_winnings (user_address);
CREATE INDEX IF NOT EXISTS idx_infofi_winnings_market ON infofi_winnings (market_id);

ALTER TABLE infofi_winnings ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'infofi_winnings_read' AND tablename = 'infofi_winnings') THEN
    CREATE POLICY infofi_winnings_read ON infofi_winnings FOR SELECT USING (true);
  END IF;
END $$;

COMMENT ON TABLE infofi_winnings IS 'Settled winnings from InfoFi markets; claimed flag tracks payout status';

-- ==========================================================================
-- 5. infofi_odds_history — Historical odds snapshots for charting
-- ==========================================================================
CREATE TABLE IF NOT EXISTS infofi_odds_history (
    id            BIGSERIAL    PRIMARY KEY,
    market_id     BIGINT       NOT NULL REFERENCES infofi_markets(id) ON DELETE CASCADE,
    season_id     BIGINT       NOT NULL,
    recorded_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    yes_bps       INTEGER      NOT NULL,
    no_bps        INTEGER      NOT NULL,
    hybrid_bps    INTEGER      NOT NULL DEFAULT 0,
    raffle_bps    INTEGER      NOT NULL DEFAULT 0,
    sentiment_bps INTEGER      NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_odds_history_market_time ON infofi_odds_history (market_id, recorded_at);
CREATE INDEX IF NOT EXISTS idx_odds_history_season      ON infofi_odds_history (season_id);

ALTER TABLE infofi_odds_history ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'infofi_odds_history_read' AND tablename = 'infofi_odds_history') THEN
    CREATE POLICY infofi_odds_history_read ON infofi_odds_history FOR SELECT USING (true);
  END IF;
END $$;

COMMENT ON TABLE infofi_odds_history IS 'Historical odds snapshots for InfoFi markets, used for charting';

-- ==========================================================================
-- 6. infofi_failed_markets — Failed market creation attempts
-- ==========================================================================
CREATE TABLE IF NOT EXISTS infofi_failed_markets (
    id              BIGSERIAL    PRIMARY KEY,
    season_id       BIGINT,
    player_address  VARCHAR(42)  NOT NULL,
    source          VARCHAR(20)  DEFAULT 'UNKNOWN',   -- 'LISTENER' | 'ADMIN' | 'UNKNOWN'
    error_message   TEXT,
    attempts        INTEGER,
    created_at      TIMESTAMPTZ  DEFAULT NOW(),
    last_attempt_at TIMESTAMPTZ  DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_infofi_failed_markets_season ON infofi_failed_markets (season_id);
CREATE INDEX IF NOT EXISTS idx_infofi_failed_markets_player ON infofi_failed_markets (player_address);

ALTER TABLE infofi_failed_markets ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'infofi_failed_markets_read' AND tablename = 'infofi_failed_markets') THEN
    CREATE POLICY infofi_failed_markets_read ON infofi_failed_markets FOR SELECT USING (true);
  END IF;
END $$;

COMMENT ON TABLE infofi_failed_markets IS 'Tracks failed gasless market creation attempts for admin visibility and recovery';

-- ==========================================================================
-- 7. season_contracts — On-chain contract addresses per season
-- ==========================================================================
CREATE TABLE IF NOT EXISTS season_contracts (
    id                     BIGSERIAL    PRIMARY KEY,
    season_id              BIGINT       NOT NULL UNIQUE,
    bonding_curve_address  VARCHAR(42)  NOT NULL,
    raffle_token_address   VARCHAR(42)  NOT NULL,
    raffle_address         VARCHAR(42)  NOT NULL,
    is_active              BOOLEAN      DEFAULT true,
    created_block          BIGINT,
    created_at             TIMESTAMPTZ  DEFAULT NOW(),
    updated_at             TIMESTAMPTZ  DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_season_contracts_season_id     ON season_contracts (season_id);
CREATE INDEX IF NOT EXISTS idx_season_contracts_active        ON season_contracts (is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_season_contracts_bonding_curve ON season_contracts (bonding_curve_address);
CREATE INDEX IF NOT EXISTS idx_season_contracts_token         ON season_contracts (raffle_token_address);
CREATE INDEX IF NOT EXISTS idx_season_contracts_created_block ON season_contracts (created_block);

ALTER TABLE season_contracts ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'season_contracts_read' AND tablename = 'season_contracts') THEN
    CREATE POLICY season_contracts_read ON season_contracts FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'season_contracts_write' AND tablename = 'season_contracts') THEN
    CREATE POLICY season_contracts_write ON season_contracts FOR INSERT WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'season_contracts_update' AND tablename = 'season_contracts') THEN
    CREATE POLICY season_contracts_update ON season_contracts FOR UPDATE USING (true);
  END IF;
END $$;

COMMENT ON TABLE  season_contracts               IS 'Stores BondingCurve, RaffleToken, and Raffle contract addresses per season';
COMMENT ON COLUMN season_contracts.created_block  IS 'Block number when SeasonStarted event was emitted';

-- ==========================================================================
-- 8. raffle_transactions — Partitioned transaction history per season
-- ==========================================================================
CREATE TABLE IF NOT EXISTS raffle_transactions (
    id               BIGSERIAL,
    season_id        BIGINT       NOT NULL,
    user_address     VARCHAR(42)  NOT NULL,
    player_id        BIGINT       REFERENCES players(id),

    -- Transaction details
    transaction_type VARCHAR(20)  NOT NULL CHECK (transaction_type IN ('BUY', 'SELL', 'CLAIM', 'TRANSFER')),
    ticket_amount    NUMERIC      NOT NULL,
    sof_amount       NUMERIC      NOT NULL,
    price_per_ticket NUMERIC,

    -- Blockchain data
    tx_hash          VARCHAR(66)  NOT NULL,
    block_number     BIGINT       NOT NULL,
    block_timestamp  TIMESTAMPTZ  NOT NULL,

    -- Position tracking
    tickets_before   NUMERIC      NOT NULL DEFAULT 0,
    tickets_after    NUMERIC      NOT NULL,

    -- Metadata
    created_at       TIMESTAMPTZ  DEFAULT NOW(),

    PRIMARY KEY (id, season_id),
    UNIQUE (tx_hash, season_id)
) PARTITION BY RANGE (season_id);

CREATE INDEX IF NOT EXISTS idx_raffle_tx_user   ON raffle_transactions (user_address, season_id, block_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_raffle_tx_hash   ON raffle_transactions (tx_hash);
CREATE INDEX IF NOT EXISTS idx_raffle_tx_block  ON raffle_transactions (block_number);
CREATE INDEX IF NOT EXISTS idx_raffle_tx_player ON raffle_transactions (player_id, season_id);

COMMENT ON TABLE raffle_transactions IS 'Partitioned raffle transaction history; one partition per season_id';

-- Auto-populate player_id from players table on INSERT
CREATE OR REPLACE FUNCTION populate_raffle_tx_player_id()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.player_id IS NULL AND NEW.user_address IS NOT NULL THEN
        SELECT id INTO NEW.player_id
        FROM players
        WHERE address = NEW.user_address;

        -- If player does not exist, create them
        IF NEW.player_id IS NULL THEN
            INSERT INTO players (address, created_at, updated_at)
            VALUES (NEW.user_address, NOW(), NOW())
            ON CONFLICT (address) DO UPDATE SET updated_at = NOW()
            RETURNING id INTO NEW.player_id;
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS raffle_tx_player_id_trigger ON raffle_transactions;
CREATE TRIGGER raffle_tx_player_id_trigger
    BEFORE INSERT ON raffle_transactions
    FOR EACH ROW
    EXECUTE FUNCTION populate_raffle_tx_player_id();

-- Partition management: create a partition for a given season
CREATE OR REPLACE FUNCTION create_raffle_tx_partition(season_num BIGINT)
RETURNS VOID AS $$
DECLARE
    partition_name TEXT;
BEGIN
    partition_name := 'raffle_transactions_season_' || season_num;
    IF NOT EXISTS (
        SELECT 1 FROM pg_tables
        WHERE tablename = partition_name
    ) THEN
        EXECUTE format(
            'CREATE TABLE %I PARTITION OF raffle_transactions
             FOR VALUES FROM (%L) TO (%L)',
            partition_name,
            season_num,
            season_num + 1
        );
        RAISE NOTICE 'Created partition: %', partition_name;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- Auto-create raffle_transactions partition when a new season_contracts row is inserted
CREATE OR REPLACE FUNCTION auto_create_raffle_tx_partition()
RETURNS TRIGGER AS $$
BEGIN
    PERFORM create_raffle_tx_partition(NEW.season_id);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS season_partition_trigger ON season_contracts;
CREATE TRIGGER season_partition_trigger
    AFTER INSERT ON season_contracts
    FOR EACH ROW
    EXECUTE FUNCTION auto_create_raffle_tx_partition();

-- ==========================================================================
-- 9. farcaster_notification_tokens — Push notification tokens
-- ==========================================================================
CREATE TABLE IF NOT EXISTS farcaster_notification_tokens (
    id                    BIGSERIAL    PRIMARY KEY,
    fid                   BIGINT       NOT NULL,                   -- User Farcaster ID
    app_key               TEXT         NOT NULL,                   -- Client app key (warpcast, baseapp, etc.)
    notification_url      TEXT         NOT NULL,                   -- URL to POST notifications to
    notification_token    TEXT         NOT NULL UNIQUE,            -- Globally unique token
    notifications_enabled BOOLEAN      DEFAULT true,
    created_at            TIMESTAMPTZ  DEFAULT NOW(),
    updated_at            TIMESTAMPTZ  DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_farcaster_notification_tokens_fid_app_key
    ON farcaster_notification_tokens (fid, app_key);
CREATE INDEX IF NOT EXISTS idx_farcaster_notification_tokens_fid
    ON farcaster_notification_tokens (fid);
CREATE INDEX IF NOT EXISTS idx_farcaster_notification_tokens_enabled
    ON farcaster_notification_tokens (notifications_enabled)
    WHERE notifications_enabled = true;

COMMENT ON TABLE  farcaster_notification_tokens                    IS 'Stores notification tokens for Farcaster Mini App users';
COMMENT ON COLUMN farcaster_notification_tokens.fid                IS 'User Farcaster ID';
COMMENT ON COLUMN farcaster_notification_tokens.notification_url   IS 'URL to POST notifications to';
COMMENT ON COLUMN farcaster_notification_tokens.notification_token IS 'Unique token per (client, app, user) tuple';

-- ==========================================================================
-- 10. allowlist_entries — FID/wallet-based allowlist
-- ==========================================================================
CREATE TABLE IF NOT EXISTS allowlist_entries (
    id                 BIGSERIAL    PRIMARY KEY,
    fid                BIGINT,                                     -- Nullable: wallet-only entries have no FID
    wallet_address     VARCHAR(42),
    username           TEXT,
    display_name       TEXT,
    source             TEXT         NOT NULL DEFAULT 'webhook',    -- 'webhook', 'manual', 'import'
    is_active          BOOLEAN      DEFAULT true,
    added_at           TIMESTAMPTZ  DEFAULT NOW(),
    wallet_resolved_at TIMESTAMPTZ,
    access_level       INTEGER      DEFAULT 2,                    -- 0=public, 1=connected, 2=allowlist, 3=beta, 4=admin
    metadata           JSONB        DEFAULT '{}',
    created_at         TIMESTAMPTZ  DEFAULT NOW(),
    updated_at         TIMESTAMPTZ  DEFAULT NOW()
);

-- Partial unique indexes (fid and wallet can each be NULL independently)
CREATE UNIQUE INDEX IF NOT EXISTS uq_allowlist_entries_fid_not_null
    ON allowlist_entries (fid)
    WHERE fid IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_allowlist_entries_wallet_not_null
    ON allowlist_entries (LOWER(wallet_address))
    WHERE wallet_address IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_allowlist_entries_wallet
    ON allowlist_entries (wallet_address)
    WHERE wallet_address IS NOT NULL AND is_active = true;
CREATE INDEX IF NOT EXISTS idx_allowlist_entries_fid
    ON allowlist_entries (fid);
CREATE INDEX IF NOT EXISTS idx_allowlist_entries_active
    ON allowlist_entries (is_active)
    WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_allowlist_entries_pending_resolution
    ON allowlist_entries (wallet_resolved_at)
    WHERE wallet_address IS NULL;
CREATE INDEX IF NOT EXISTS idx_allowlist_entries_access_level
    ON allowlist_entries (access_level)
    WHERE is_active = true;

COMMENT ON TABLE  allowlist_entries              IS 'Stores allowlisted users with their FID and/or resolved wallet addresses';
COMMENT ON COLUMN allowlist_entries.fid          IS 'User Farcaster ID — NULL for wallet-only entries';
COMMENT ON COLUMN allowlist_entries.wallet_address IS 'Primary Ethereum wallet address resolved from FID';
COMMENT ON COLUMN allowlist_entries.source       IS 'How user was added: webhook (app add), manual (admin), import (bulk)';
COMMENT ON COLUMN allowlist_entries.access_level IS 'Access tier: 0=public, 1=connected, 2=allowlist, 3=beta, 4=admin';

-- Seed local admins
INSERT INTO allowlist_entries (wallet_address, source, access_level, is_active)
VALUES ('0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266', 'manual', 4, true)
ON CONFLICT DO NOTHING;
INSERT INTO allowlist_entries (wallet_address, source, access_level, is_active)
VALUES ('0x1ed4ac856d7a072c3a336c0971a47db86a808ff4', 'manual', 4, true)
ON CONFLICT DO NOTHING;

-- ==========================================================================
-- 11. allowlist_config — Time-gated allowlist windows
-- ==========================================================================
CREATE TABLE IF NOT EXISTS allowlist_config (
    id           SERIAL       PRIMARY KEY,
    name         TEXT         NOT NULL DEFAULT 'default',
    window_start TIMESTAMPTZ  NOT NULL,
    window_end   TIMESTAMPTZ,                                     -- NULL = open indefinitely
    is_active    BOOLEAN      DEFAULT true,
    max_entries  INTEGER,
    created_at   TIMESTAMPTZ  DEFAULT NOW(),
    updated_at   TIMESTAMPTZ  DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_allowlist_config_active
    ON allowlist_config (is_active)
    WHERE is_active = true;

-- Seed default config
INSERT INTO allowlist_config (name, window_start, window_end, is_active)
VALUES ('default', NOW(), NULL, true)
ON CONFLICT DO NOTHING;

COMMENT ON TABLE  allowlist_config            IS 'Configuration for time-gated allowlist windows';
COMMENT ON COLUMN allowlist_config.window_end IS 'NULL means open indefinitely';

-- ==========================================================================
-- 12. access_groups — Granular resource-level permission groups
-- ==========================================================================
CREATE TABLE IF NOT EXISTS access_groups (
    id          SERIAL       PRIMARY KEY,
    slug        TEXT         NOT NULL UNIQUE,              -- e.g. 'season-5-vip'
    name        TEXT         NOT NULL,
    description TEXT,
    is_active   BOOLEAN      DEFAULT true,
    created_at  TIMESTAMPTZ  DEFAULT NOW(),
    updated_at  TIMESTAMPTZ  DEFAULT NOW()
);

COMMENT ON TABLE access_groups IS 'Defines access groups for granular resource-level permissions';

-- ==========================================================================
-- 13. user_access_groups — Many-to-many user/group membership
-- ==========================================================================
CREATE TABLE IF NOT EXISTS user_access_groups (
    id             BIGSERIAL    PRIMARY KEY,
    fid            BIGINT,                                         -- Nullable: wallet-only users
    wallet_address VARCHAR(42),                                    -- Nullable: FID-only users
    group_id       INTEGER      NOT NULL REFERENCES access_groups(id) ON DELETE CASCADE,
    granted_at     TIMESTAMPTZ  DEFAULT NOW(),
    granted_by     TEXT,                                           -- Admin FID or 'system'
    expires_at     TIMESTAMPTZ,
    is_active      BOOLEAN      DEFAULT true,

    CONSTRAINT chk_user_access_groups_identifier CHECK (fid IS NOT NULL OR wallet_address IS NOT NULL)
);

-- Partial unique indexes (fid or wallet can be NULL independently)
CREATE UNIQUE INDEX IF NOT EXISTS uq_user_access_groups_fid_group
    ON user_access_groups (fid, group_id)
    WHERE fid IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_user_access_groups_wallet_group
    ON user_access_groups (wallet_address, group_id)
    WHERE wallet_address IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_user_access_groups_fid
    ON user_access_groups (fid)    WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_user_access_groups_group
    ON user_access_groups (group_id) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_user_access_groups_wallet
    ON user_access_groups (wallet_address)
    WHERE wallet_address IS NOT NULL AND is_active = true;

COMMENT ON TABLE user_access_groups IS 'Links users (by FID or wallet) to access groups';

-- ==========================================================================
-- 14. route_access_config — Per-route/resource access requirements
-- ==========================================================================
CREATE TABLE IF NOT EXISTS route_access_config (
    id                 SERIAL       PRIMARY KEY,
    route_pattern      TEXT         NOT NULL,              -- e.g. '/raffles', '/raffles/:id'
    resource_type      TEXT,                               -- 'page', 'raffle', 'market', 'feature'
    resource_id        TEXT,

    -- Access requirements
    required_level     INTEGER      DEFAULT 2,             -- Minimum access level (0-4)
    required_groups    TEXT[],                              -- Group slugs (user needs ANY)
    require_all_groups BOOLEAN      DEFAULT false,         -- If true, user needs ALL groups

    -- Override flags
    is_public          BOOLEAN      DEFAULT false,
    is_disabled        BOOLEAN      DEFAULT false,         -- Maintenance lockout

    -- Metadata
    name               TEXT,
    description        TEXT,
    priority           INTEGER      DEFAULT 0,

    created_at         TIMESTAMPTZ  DEFAULT NOW(),
    updated_at         TIMESTAMPTZ  DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_route_access_config_route_pattern
    ON route_access_config (route_pattern);
CREATE INDEX IF NOT EXISTS idx_route_access_config_pattern
    ON route_access_config (route_pattern);
CREATE INDEX IF NOT EXISTS idx_route_access_config_resource
    ON route_access_config (resource_type, resource_id);

COMMENT ON TABLE route_access_config IS 'Defines access requirements per route or resource';

-- Seed default route configurations (after migrations 006, 008, 010 applied)
INSERT INTO route_access_config (route_pattern, resource_type, required_level, required_groups, require_all_groups, is_public, is_disabled, name, priority)
VALUES
  ('/',              'page', 0, ARRAY[]::text[], false, false, false, 'Home',                     0),
  ('/raffles',       'page', 0, ARRAY[]::text[], false, false, false, 'Raffles List (Public)',    50),
  ('/raffles/:id',   'page', 0, ARRAY[]::text[], false, false, false, 'Raffle Detail (Public)',  50),
  ('/markets',       'page', 3, ARRAY[]::text[], false, false, false, 'InfoFi Markets',           0),
  ('/account',       'page', 1, ARRAY[]::text[], false, false, false, 'Account',                  0),
  ('/admin',         'page', 4, ARRAY[]::text[], false, false, false, 'Admin Panel',              0),
  ('/portfolio',     'page', 0, ARRAY[]::text[], false, false, false, 'Portfolio (Public)',       50),
  ('__feature__/prediction_markets', 'feature', 2, ARRAY[]::text[], false, false, false, 'Prediction Markets Feature', 100)
ON CONFLICT (route_pattern) DO NOTHING;

-- ==========================================================================
-- 15. access_settings — Global key/value config
-- ==========================================================================
CREATE TABLE IF NOT EXISTS access_settings (
    key        TEXT         PRIMARY KEY,
    value      JSONB        NOT NULL,
    updated_at TIMESTAMPTZ  DEFAULT NOW(),
    updated_by TEXT
);

INSERT INTO access_settings (key, value) VALUES
  ('default_access_level',  '2'),
  ('global_public_override', 'false')
ON CONFLICT (key) DO NOTHING;

COMMENT ON TABLE access_settings IS 'Global access control settings (key-value)';

-- ==========================================================================
-- 16. nft_drops — NFT mint and airdrop configurations
-- ==========================================================================
CREATE TABLE IF NOT EXISTS nft_drops (
    id                  BIGSERIAL    PRIMARY KEY,
    name                TEXT         NOT NULL,
    description         TEXT,
    network             TEXT         NOT NULL DEFAULT 'base',
    drop_type           TEXT         NOT NULL,               -- 'mint' or 'airdrop'
    nft_symbol          TEXT,
    nft_contract_address TEXT,
    airdrop_id          INTEGER,
    requires_allowlist  BOOLEAN      DEFAULT true,
    start_time          TIMESTAMPTZ,
    end_time            TIMESTAMPTZ,
    is_active           BOOLEAN      DEFAULT true,
    is_featured         BOOLEAN      DEFAULT false,
    image_url           TEXT,
    external_url        TEXT,
    metadata            JSONB        DEFAULT '{}',
    created_by          TEXT,
    created_at          TIMESTAMPTZ  DEFAULT NOW(),
    updated_at          TIMESTAMPTZ  DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_nft_drops_active  ON nft_drops (is_active, is_featured) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_nft_drops_type    ON nft_drops (drop_type);
CREATE INDEX IF NOT EXISTS idx_nft_drops_network ON nft_drops (network);
CREATE INDEX IF NOT EXISTS idx_nft_drops_timing  ON nft_drops (start_time, end_time)   WHERE is_active = true;

COMMENT ON TABLE  nft_drops              IS 'NFT drop configurations for Mint.Club mints and airdrops';
COMMENT ON COLUMN nft_drops.drop_type    IS 'Type of drop: mint (bonding curve) or airdrop (free claim)';
COMMENT ON COLUMN nft_drops.nft_symbol   IS 'For mint drops: the NFT symbol on Mint.Club';
COMMENT ON COLUMN nft_drops.airdrop_id   IS 'For airdrop drops: the Mint.Club distribution ID';
COMMENT ON COLUMN nft_drops.requires_allowlist IS 'If true, only allowlisted users can access this drop';

-- ==========================================================================
-- 17. listener_block_cursors — Persistent block tracking for event listeners
-- ==========================================================================
CREATE TABLE IF NOT EXISTS listener_block_cursors (
    listener_key TEXT         PRIMARY KEY,                  -- e.g. "0xABC123:SeasonStarted"
    last_block   BIGINT       NOT NULL,
    updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE listener_block_cursors IS 'Persists last processed block per event listener for crash recovery';

-- ==========================================================================
-- 18. gating_signatures — EIP-712 allowlist entry signatures
-- ==========================================================================
CREATE TABLE IF NOT EXISTS gating_signatures (
    id                   SERIAL       PRIMARY KEY,
    season_id            INTEGER      NOT NULL,
    participant_address  TEXT         NOT NULL,
    deadline             BIGINT       NOT NULL,
    signature            TEXT         NOT NULL,
    gate_index           INTEGER      DEFAULT 0,
    created_at           TIMESTAMPTZ  DEFAULT NOW(),

    UNIQUE (season_id, participant_address, gate_index)
);

CREATE INDEX IF NOT EXISTS idx_gating_signatures_season ON gating_signatures (season_id);
CREATE INDEX IF NOT EXISTS idx_gating_signatures_lookup ON gating_signatures (season_id, participant_address);

COMMENT ON TABLE gating_signatures IS 'EIP-712 signatures for gated allowlist entry into raffle seasons';

-- ==========================================================================
-- 19. sponsor_prizes — Sponsored prizes with tiered distribution
-- ==========================================================================
CREATE TABLE IF NOT EXISTS sponsor_prizes (
    id              BIGSERIAL    PRIMARY KEY,
    season_id       INTEGER      NOT NULL,
    prize_type      TEXT         NOT NULL CHECK (prize_type IN ('erc20', 'erc721')),
    chain_id        INTEGER      NOT NULL DEFAULT 8453,     -- 8453=Base
    token_address   VARCHAR(42)  NOT NULL,
    token_name      TEXT,
    token_symbol    TEXT,
    token_decimals  INTEGER,
    amount          TEXT,                                    -- Raw uint256 string (ERC-20)
    token_id        TEXT,                                    -- NFT token ID (ERC-721)
    token_uri       TEXT,
    image_url       TEXT,
    description     TEXT,
    sponsor_address VARCHAR(42)  NOT NULL,
    target_tier     INTEGER      DEFAULT 0,                 -- 0-indexed tier
    is_onchain      BOOLEAN      DEFAULT true,              -- False for cross-chain metadata-only
    is_claimed      BOOLEAN      DEFAULT false,
    tx_hash         VARCHAR(66),
    claim_tx_hash   VARCHAR(66),
    created_at      TIMESTAMPTZ  DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sponsor_prizes_season      ON sponsor_prizes (season_id);
CREATE INDEX IF NOT EXISTS idx_sponsor_prizes_season_type ON sponsor_prizes (season_id, prize_type);
CREATE INDEX IF NOT EXISTS idx_sponsor_prizes_season_tier ON sponsor_prizes (season_id, target_tier);
CREATE INDEX IF NOT EXISTS idx_sponsor_prizes_sponsor     ON sponsor_prizes (sponsor_address);

COMMENT ON TABLE  sponsor_prizes             IS 'Sponsored prizes for raffle seasons with tiered distribution';
COMMENT ON COLUMN sponsor_prizes.target_tier IS '0-indexed tier; ERC-20 split equally among tier winners, ERC-721 goes to first winner';
COMMENT ON COLUMN sponsor_prizes.is_onchain  IS 'False for cross-chain prizes distributed off-chain by sponsor';

-- ==========================================================================
-- 20. season_tier_configs — Tier configuration mirroring on-chain data
-- ==========================================================================
CREATE TABLE IF NOT EXISTS season_tier_configs (
    id           BIGSERIAL    PRIMARY KEY,
    season_id    INTEGER      NOT NULL,
    tier_index   INTEGER      NOT NULL,                    -- 0-indexed
    winner_count INTEGER      NOT NULL,
    created_at   TIMESTAMPTZ  DEFAULT NOW(),

    UNIQUE (season_id, tier_index)
);

CREATE INDEX IF NOT EXISTS idx_season_tier_configs_season ON season_tier_configs (season_id);

COMMENT ON TABLE season_tier_configs IS 'Tier configuration per season, mirroring on-chain TierConfig for fast reads';

-- ==========================================================================
-- 21. rollover_events — Rollover escrow event history
-- ==========================================================================
CREATE TABLE IF NOT EXISTS rollover_events (
    id               BIGSERIAL    PRIMARY KEY,
    event_type       VARCHAR(20)  NOT NULL CHECK (event_type IN ('DEPOSIT', 'SPEND', 'REFUND')),
    season_id        BIGINT       NOT NULL,
    user_address     VARCHAR(42)  NOT NULL,
    amount           NUMERIC      NOT NULL,
    bonus_amount     NUMERIC      DEFAULT 0,
    next_season_id   BIGINT,
    tx_hash          VARCHAR(66)  NOT NULL,
    block_number     BIGINT       NOT NULL,
    created_at       TIMESTAMPTZ  DEFAULT now(),
    UNIQUE(tx_hash, event_type)
);

CREATE INDEX IF NOT EXISTS idx_rollover_events_user ON rollover_events (user_address, season_id);
CREATE INDEX IF NOT EXISTS idx_rollover_events_type ON rollover_events (event_type, season_id);

COMMENT ON TABLE rollover_events IS 'On-chain rollover escrow events: deposits, spends, and refunds indexed from RolloverEscrow contract';

-- ==========================================================================
-- 22. MATERIALIZED VIEW: user_raffle_positions
-- ==========================================================================
CREATE MATERIALIZED VIEW IF NOT EXISTS user_raffle_positions AS
SELECT
    user_address,
    player_id,
    season_id,
    COUNT(*)                                                              AS transaction_count,
    SUM(CASE WHEN transaction_type = 'BUY'  THEN ticket_amount ELSE 0 END) AS total_bought,
    SUM(CASE WHEN transaction_type = 'SELL' THEN ABS(ticket_amount) ELSE 0 END) AS total_sold,
    SUM(ticket_amount)                                                    AS current_tickets,
    SUM(sof_amount)                                                       AS total_sof_spent,
    AVG(CASE WHEN transaction_type = 'BUY' THEN price_per_ticket ELSE NULL END) AS avg_buy_price,
    MIN(block_timestamp)                                                  AS first_transaction_at,
    MAX(block_timestamp)                                                  AS last_transaction_at,
    ARRAY_AGG(tx_hash ORDER BY block_timestamp)                           AS transaction_hashes
FROM raffle_transactions
GROUP BY user_address, player_id, season_id;

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_raffle_pos_unique ON user_raffle_positions (user_address, season_id);
CREATE INDEX IF NOT EXISTS idx_user_raffle_pos_player        ON user_raffle_positions (player_id, season_id);

-- Refresh helper
CREATE OR REPLACE FUNCTION refresh_user_positions(season_num BIGINT DEFAULT NULL)
RETURNS VOID AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY user_raffle_positions;
END;
$$ LANGUAGE plpgsql;

-- ==========================================================================
-- 23. VIEW: user_market_positions
-- ==========================================================================
-- Aggregated InfoFi positions per user + market + outcome for efficient reads.
CREATE OR REPLACE VIEW user_market_positions AS
SELECT
    user_address,
    market_id,
    outcome,
    COUNT(*)          AS position_count,
    SUM(amount)       AS total_amount,
    AVG(price)        AS avg_price,
    MIN(created_at)   AS first_position_at,
    MAX(created_at)   AS last_position_at
FROM infofi_positions
GROUP BY user_address, market_id, outcome;

-- ==========================================================================
-- FINAL: Grant all privileges on every table/sequence to service_role
-- ==========================================================================
GRANT ALL PRIVILEGES ON ALL TABLES    IN SCHEMA public TO service_role;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO service_role;

-- Read-only for authenticated and anon (RLS enforces row-level access)
GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon;
