-- The activity ticker's tokens row reads the newest launch-pool trades across
-- every token (launchpadActivityDb.listRecentTrades), ordered by
-- (block_number DESC, log_index DESC). launch_trades_token_block_idx leads with
-- token_address and cannot serve that order, so without this index every
-- ticker request sorts the whole table.

CREATE INDEX IF NOT EXISTS launch_trades_recent_idx ON launch_trades (block_number DESC, log_index DESC);
