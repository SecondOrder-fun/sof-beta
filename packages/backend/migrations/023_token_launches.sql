-- Launchpad indexer tables.
--
-- token_launches is fed by tokenLaunchedListener from the launchpad's
-- TokenLaunched event. Every column except the metadata_* ones comes straight
-- off that event or off the token contract; nothing here is derived state that
-- the chain does not already hold, so the table can be rebuilt by replaying
-- events from block 0.
--
-- Two things worth knowing about the shape:
--
--   * `pool_id` is the event's `placementId`. UniV4LiquidityPlacer returns the
--     v4 PoolId from place(), so the launch record already carries the key the
--     trade indexer needs to filter PoolManager Swap logs. No extra lookup.
--
--   * name / symbol / metadata_uri are emitted, not stored on-chain. The
--     launchpad deliberately has no setter (a setter lets a creator swap the
--     name after people have bought), so the event is the ONLY source for them
--     and this table is where they live.
--
-- bigint-valued columns are TEXT, matching curve_state (018): wei does not fit
-- in a Postgres BIGINT and JS numbers lose precision above 2^53.

CREATE TABLE IF NOT EXISTS token_launches (
  token_address TEXT PRIMARY KEY,
  launch_id BIGINT NOT NULL,
  creator_address TEXT NOT NULL,
  name TEXT,
  symbol TEXT,
  metadata_uri TEXT,
  start_price_wei TEXT NOT NULL,          -- wei of ETH per whole token
  implied_fdv_wei TEXT NOT NULL,          -- start_price_wei * whole supply
  total_supply TEXT NOT NULL,             -- raw units (18 dp)
  pool_id TEXT,                           -- v4 PoolId, from the event's placementId
  launched_at TIMESTAMPTZ NOT NULL,
  block_number BIGINT,
  tx_hash TEXT,
  -- Moderation, set by hand. Hidden tokens stay indexed but drop out of the
  -- public feed; the on-chain token is unaffected either way.
  is_hidden BOOLEAN NOT NULL DEFAULT FALSE,
  is_verified BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The feed's only ordering today is newest-first over visible rows.
CREATE INDEX IF NOT EXISTS token_launches_launched_at_idx
  ON token_launches (launched_at DESC)
  WHERE is_hidden = FALSE;

-- "What has this creator launched" — the creator track record in the design.
CREATE INDEX IF NOT EXISTS token_launches_creator_idx
  ON token_launches (creator_address);

-- The trade indexer resolves a Swap's pool_id back to its token.
CREATE UNIQUE INDEX IF NOT EXISTS token_launches_pool_id_idx
  ON token_launches (pool_id)
  WHERE pool_id IS NOT NULL;

CREATE OR REPLACE FUNCTION token_launches_touch_updated_at() RETURNS TRIGGER
SET search_path = '' AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS token_launches_touch ON token_launches;
CREATE TRIGGER token_launches_touch
  BEFORE UPDATE ON token_launches
  FOR EACH ROW EXECUTE FUNCTION token_launches_touch_updated_at();

GRANT SELECT ON token_launches TO anon;
GRANT ALL ON token_launches TO service_role;

-- RLS on, read-only for everyone else. Supabase's default privileges grant anon
-- and authenticated full write on new public tables, and the anon key ships in
-- the frontend — without RLS anyone could forge or hide a launch. The indexer
-- writes with the service role, which bypasses RLS.
ALTER TABLE token_launches ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS token_launches_read ON token_launches;
CREATE POLICY token_launches_read ON token_launches FOR SELECT USING (true);

-- launch_trades is fed by launchTradeListener from PoolManager Swap events.
--
-- Amounts are v4 balance deltas from the POOL's perspective, normalised here to
-- the trader's: `side` is BUY when ETH went in and tokens came out. ETH is
-- always currency0 and the launch token always currency1 (ETH is address(0),
-- numerically below every token address), so the orientation is fixed and does
-- not need storing per row.
--
-- (tx_hash, log_index) is the primary key rather than a surrogate id: it is
-- what makes replay idempotent. A cursor rewind re-inserts the same rows and
-- ON CONFLICT DO NOTHING absorbs it.

CREATE TABLE IF NOT EXISTS launch_trades (
  tx_hash TEXT NOT NULL,
  log_index INTEGER NOT NULL,
  token_address TEXT NOT NULL REFERENCES token_launches (token_address) ON DELETE CASCADE,
  pool_id TEXT NOT NULL,
  trader TEXT,                            -- the account, from the launch router's Bought/Sold event;
                                          -- the Swap's `sender` (e.g. the router) only if that is impossible
  side TEXT NOT NULL CHECK (side IN ('BUY', 'SELL')),
  eth_amount TEXT NOT NULL,               -- wei, unsigned
  token_amount TEXT NOT NULL,             -- raw units, unsigned
  price_wei TEXT,                         -- wei of ETH per whole token, from sqrtPriceX96 after the swap
  tick INTEGER,
  block_number BIGINT NOT NULL,
  block_time TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tx_hash, log_index)
);

-- The trade feed and the price chart, both per token, newest first.
CREATE INDEX IF NOT EXISTS launch_trades_token_block_idx
  ON launch_trades (token_address, block_number DESC);

GRANT SELECT ON launch_trades TO anon;
GRANT ALL ON launch_trades TO service_role;

-- Same as token_launches: public read, writes only via the service role.
ALTER TABLE launch_trades ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS launch_trades_read ON launch_trades;
CREATE POLICY launch_trades_read ON launch_trades FOR SELECT USING (true);
