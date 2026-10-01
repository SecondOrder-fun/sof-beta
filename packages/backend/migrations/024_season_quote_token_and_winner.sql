-- Link each raffle season to the token it is priced in, and record its winner.
--
-- quote_token_address is SeasonConfig.quoteToken, read at season creation. It is
-- what connects the raffle layer to the launchpad: "raffles on this token", the
-- raffle badge on a token card, and the raffle row of the activity ticker all
-- key off it. Seasons priced in a token the launchpad did not launch (the
-- placeholder quote token, for one) simply have no token_launches match.
--
-- winner_address is the grand-prize winner (Raffle.getWinners(season)[0]),
-- written when the season completes. It feeds the "won" ticker item and the
-- ended state of the raffle card; before this, the winner lived only on-chain.

ALTER TABLE season_contracts
  ADD COLUMN IF NOT EXISTS quote_token_address TEXT,
  ADD COLUMN IF NOT EXISTS winner_address TEXT;

CREATE INDEX IF NOT EXISTS idx_season_contracts_quote_token
  ON season_contracts (quote_token_address);
