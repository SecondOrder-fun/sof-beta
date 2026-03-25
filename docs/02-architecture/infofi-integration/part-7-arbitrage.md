---
trigger: always_on
---

# SecondOrder.fun InfoFi Integration: Complete Technical Specification Part 7

## Database Schema Updates

### Supabase Schema Additions

```sql
-- InfoFi Markets table
CREATE TABLE infofi_markets (
    id BIGSERIAL PRIMARY KEY,
    raffle_id BIGINT NOT NULL REFERENCES raffles(id),
    player_id BIGINT NOT NULL REFERENCES players(id),
    market_type VARCHAR(50) NOT NULL, -- 'WINNER_PREDICTION', 'POSITION_SIZE', 'BEHAVIORAL'
    contract_address VARCHAR(42), -- Ethereum address of deployed market contract
    initial_probability INTEGER NOT NULL, -- Basis points (0-10000)
    current_probability INTEGER NOT NULL, -- Updated in real-time
    is_active BOOLEAN DEFAULT true,
    is_settled BOOLEAN DEFAULT false,
    settlement_time TIMESTAMPTZ,
    winning_outcome BOOLEAN,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- InfoFi Positions table (user bets in markets)
CREATE TABLE infofi_positions (
    id BIGSERIAL PRIMARY KEY,
    market_id BIGINT NOT NULL REFERENCES infofi_markets(id),
    user_address VARCHAR(42) NOT NULL, -- Ethereum address
    outcome VARCHAR(10) NOT NULL, -- 'YES' or 'NO'
    amount DECIMAL(18,6) NOT NULL, -- Amount bet
    price DECIMAL(18,6), -- Price at time of bet
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- InfoFi Winnings table (claimable winnings)
CREATE TABLE infofi_winnings (
    id BIGSERIAL PRIMARY KEY,
    user_address VARCHAR(42) NOT NULL,
    market_id BIGINT NOT NULL REFERENCES infofi_markets(id),
    amount DECIMAL(18,6) NOT NULL,
    is_claimed BOOLEAN DEFAULT false,
    claimed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Arbitrage Opportunities table (for tracking and analytics)
CREATE TABLE arbitrage_opportunities (
    id BIGSERIAL PRIMARY KEY,
    raffle_id BIGINT NOT NULL REFERENCES raffles(id),
    player_address VARCHAR(42) NOT NULL,
    market_id BIGINT REFERENCES infofi_markets(id),
    raffle_price DECIMAL(18,6) NOT NULL,
    market_price DECIMAL(18,6) NOT NULL,
    price_difference DECIMAL(18,6) NOT NULL,
    profitability DECIMAL(5,2) NOT NULL, -- Percentage
    estimated_profit DECIMAL(18,6) NOT NULL,
    is_executed BOOLEAN DEFAULT false,
    executed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Real-time pricing cache
CREATE TABLE market_pricing_cache (
    market_id BIGINT PRIMARY KEY REFERENCES infofi_markets(id),
    raffle_probability INTEGER NOT NULL, -- Basis points
    market_sentiment INTEGER NOT NULL, -- Basis points
    hybrid_price DECIMAL(18,6) NOT NULL,
    raffle_weight INTEGER DEFAULT 7000, -- 70% in basis points
    market_weight INTEGER DEFAULT 3000, -- 30% in basis points
    last_updated TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX idx_infofi_markets_raffle_id ON infofi_markets(raffle_id);
CREATE INDEX idx_infofi_markets_player_id ON infofi_markets(player_id);
CREATE INDEX idx_infofi_markets_active ON infofi_markets(is_active) WHERE is_active = true;
CREATE INDEX idx_infofi_positions_market_id ON infofi_positions(market_id);
CREATE INDEX idx_infofi_positions_user ON infofi_positions(user_address);
CREATE INDEX idx_infofi_winnings_user ON infofi_winnings(user_address) WHERE is_claimed = false;
CREATE INDEX idx_arbitrage_opportunities_raffle ON arbitrage_opportunities(raffle_id);
CREATE INDEX idx_arbitrage_opportunities_executed ON arbitrage_opportunities(is_executed) WHERE is_executed = false;

-- Real-time subscriptions for live updates
ALTER TABLE infofi_markets ENABLE ROW LEVEL SECURITY;
ALTER TABLE infofi_positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE market_pricing_cache ENABLE ROW LEVEL SECURITY;

-- Policies for read access (adjust based on your auth requirements)
CREATE POLICY "Markets are viewable by everyone" ON infofi_markets FOR SELECT USING (true);
CREATE POLICY "Positions are viewable by everyone" ON infofi_positions FOR SELECT USING (true);
CREATE POLICY "Pricing cache is viewable by everyone" ON market_pricing_cache FOR SELECT USING (true);
```