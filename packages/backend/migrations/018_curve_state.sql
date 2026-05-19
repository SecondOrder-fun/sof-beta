-- Adds curve_state table to cache bonding curve state per season, populated
-- by tradeListener and positionUpdateListener so the frontend can read
-- accumulated fees, sof reserves, supply, current step, and immutable bond
-- steps from backend REST instead of polling RPC every 12s.

CREATE TABLE IF NOT EXISTS curve_state (
  bonding_curve_address TEXT PRIMARY KEY,
  accumulated_fees TEXT NOT NULL DEFAULT '0',     -- bigint as string
  sof_reserves TEXT NOT NULL DEFAULT '0',          -- bigint as string
  current_supply TEXT NOT NULL DEFAULT '0',        -- bigint as string
  current_step_index INTEGER,
  current_step_price TEXT,                         -- bigint as string
  current_step_range_to TEXT,                      -- bigint as string
  bond_steps JSONB,                                -- immutable; populated once by seasonStartedListener
  treasury_address TEXT,
  last_updated_block BIGINT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Auto-update updated_at on row change.
CREATE OR REPLACE FUNCTION curve_state_touch_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS curve_state_touch ON curve_state;
CREATE TRIGGER curve_state_touch
  BEFORE UPDATE ON curve_state
  FOR EACH ROW EXECUTE FUNCTION curve_state_touch_updated_at();

-- Allow service role full access; allow anon read for public viewing.
GRANT SELECT ON curve_state TO anon;
GRANT ALL ON curve_state TO service_role;
