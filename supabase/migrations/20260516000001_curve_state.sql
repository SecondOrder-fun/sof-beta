-- Mirror of packages/backend/migrations/018_curve_state.sql

CREATE TABLE IF NOT EXISTS curve_state (
  bonding_curve_address TEXT PRIMARY KEY,
  accumulated_fees TEXT NOT NULL DEFAULT '0',
  sof_reserves TEXT NOT NULL DEFAULT '0',
  current_supply TEXT NOT NULL DEFAULT '0',
  current_step_index INTEGER,
  current_step_price TEXT,
  current_step_range_to TEXT,
  bond_steps JSONB,
  treasury_address TEXT,
  last_updated_block BIGINT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

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

GRANT SELECT ON curve_state TO anon;
GRANT ALL ON curve_state TO service_role;
