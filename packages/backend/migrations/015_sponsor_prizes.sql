-- Migration: 015_sponsor_prizes
-- Description: Create table for sponsored prizes with tiered distribution support

CREATE TABLE IF NOT EXISTS sponsor_prizes (
    id BIGSERIAL PRIMARY KEY,

    -- Season link
    season_id INTEGER NOT NULL,

    -- Prize type
    prize_type TEXT NOT NULL CHECK (prize_type IN ('erc20', 'erc721')),

    -- Chain info
    chain_id INTEGER NOT NULL DEFAULT 8453,          -- 8453=Base, 1=Ethereum, etc.

    -- Token info
    token_address VARCHAR(42) NOT NULL,
    token_name TEXT,
    token_symbol TEXT,
    token_decimals INTEGER,

    -- ERC-20 specific
    amount TEXT,                                       -- Raw uint256 string for ERC-20

    -- ERC-721 specific
    token_id TEXT,                                     -- NFT token ID
    token_uri TEXT,                                    -- NFT metadata URI
    image_url TEXT,                                    -- Resolved NFT image

    -- Sponsor info
    description TEXT,                                  -- Sponsor-provided description
    sponsor_address VARCHAR(42) NOT NULL,

    -- Tier targeting
    target_tier INTEGER DEFAULT 0,                     -- 0-indexed tier

    -- Cross-chain support
    is_onchain BOOLEAN DEFAULT TRUE,                   -- False for cross-chain (metadata-only)

    -- Claim tracking
    is_claimed BOOLEAN DEFAULT FALSE,

    -- Transaction hashes
    tx_hash VARCHAR(66),                               -- Sponsorship tx
    claim_tx_hash VARCHAR(66),                         -- Claim tx

    -- Audit
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_sponsor_prizes_season
    ON sponsor_prizes(season_id);

CREATE INDEX IF NOT EXISTS idx_sponsor_prizes_season_type
    ON sponsor_prizes(season_id, prize_type);

CREATE INDEX IF NOT EXISTS idx_sponsor_prizes_season_tier
    ON sponsor_prizes(season_id, target_tier);

CREATE INDEX IF NOT EXISTS idx_sponsor_prizes_sponsor
    ON sponsor_prizes(sponsor_address);

-- Tier configurations table (mirrors on-chain tier config for fast reads)
CREATE TABLE IF NOT EXISTS season_tier_configs (
    id BIGSERIAL PRIMARY KEY,
    season_id INTEGER NOT NULL,
    tier_index INTEGER NOT NULL,                       -- 0-indexed
    winner_count INTEGER NOT NULL,

    created_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(season_id, tier_index)
);

CREATE INDEX IF NOT EXISTS idx_season_tier_configs_season
    ON season_tier_configs(season_id);

-- Comments
COMMENT ON TABLE sponsor_prizes IS 'Sponsored prizes for raffle seasons with tiered distribution';
COMMENT ON COLUMN sponsor_prizes.target_tier IS '0-indexed tier this prize targets; ERC-20 split equally among tier winners, ERC-721 goes to first winner';
COMMENT ON COLUMN sponsor_prizes.is_onchain IS 'False for cross-chain prizes that are metadata-only (distributed by sponsor off-chain)';
COMMENT ON TABLE season_tier_configs IS 'Tier configuration per season, mirroring on-chain TierConfig for fast reads';
