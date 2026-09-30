-- Mirror of packages/backend/migrations/025_launch_trades_recent_idx.sql

CREATE INDEX IF NOT EXISTS launch_trades_recent_idx ON launch_trades (block_number DESC, log_index DESC);
