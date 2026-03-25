---
trigger: always_on
---

# SecondOrder.fun Tokenomics Deep Dive

## Executive Summary

Based on research into Seasonal Tokens and Immutable X's fee capture models, this analysis recommends a **staking-based approach** over bonding curves for SecondOrder.fun's ticket-coin system, combined with graduated post-season liquidity mechanisms to handle the critical "locked token" problem.

## Seasonal Tokens: Key Insights for SecondOrder.fun

### Core Mechanics

Seasonal Tokens demonstrates a successful multi-token system with **predictable seasonality**:

- **Four tokens** (Spring, Summer, Autumn, Winter) with 9-month production cycles
- **Supply halvings** create predictable price appreciation patterns
- **Proof-of-work mining** with "farming" (liquidity provision) for rewards
- **Closed-loop trading strategy**: Always trade for more tokens of different types

### Critical Success Factors

1. **Predictable cycles** - Users can anticipate optimal trading windows
2. **Supply-driven price discovery** - Halving events create clear signals
3. **"More tokens" strategy** - Success measured by token accumulation, not USD value
4. **Built-in arbitrage** - System rewards strategic trading behavior

### Lessons for SecondOrder.fun

- **Finite game seasons work** when rules are transparent and predictable
- **Token accumulation metrics** can substitute for traditional profit/loss measurements
- **Cyclic supply mechanics** create sustainable trading opportunities
- **Community-driven price discovery** emerges from known fundamentals

## Staking Model vs Bonding Curves for Ticket-Coins

### Problems with Bonding Curves for Gaming

1. **Continuous pricing** creates speculation rather than game focus
2. **Price discovery complexity** distracts from raffle mechanics
3. **Exit liquidity uncertainty** - unclear reserve management post-season
4. **MEV vulnerability** - sophisticated traders can exploit pricing algorithms

### Advantages of Staking Model

1. **Fixed conversion rates** - Clear $SOF:ticket-coin ratios set per season
2. **Discrete time windows** - Staking opens/closes with season calendar
3. **Predictable economics** - No complex curve mathematics to understand
4. **Gaming-first design** - Price speculation minimized during active seasons

### Proposed Staking Mechanism

```
Season Announcement (T-14 days):
- Staking window opens
- Fixed conversion rate announced (e.g., 100 $SOF = 1 TICKET-COIN)
- Maximum ticket supply disclosed

Season Start (T+0):
- Staking window closes
- Ticket-coins become non-transferable
- Raffle mechanics begin

Season End (T+14 days):
- Winners selected
- Ticket-coins become transferable again
- Unlocking period begins
```

## Immutable X Fee Capture: Lessons and Adaptations

### Immutable's Model

- **2% protocol fee** on all NFT trades
- **20% of fees** converted to IMX and distributed to stakers
- **Staking requirements**: Hold IMX + trade ≥1 NFT per cycle
- **Aligned incentives**: Stakers profit from protocol growth

### Why Direct Application Won't Work for SecondOrder.fun

1. **Different user goals** - Immutable users want ongoing platform engagement; SO.f users want to win and potentially exit
2. **Seasonal vs continuous** - Immutable has steady trading; SO.f has discrete events
3. **Platform vs game** - Immutable is infrastructure; SO.f is entertainment

### Adapted Fee Model for SecondOrder.fun

**Revenue Sources**:

- **Entry fees** (5-10% of season ticket sales)
- **Prediction market fees** (2-3% of derivative trading)
- **Premium features** ($SOF required for early access, multiple entries)
- **Cross-season bridging** (small fee for rolling tickets between seasons)

**Distribution Mechanism**:

- **40% to prize pools** (boost season rewards)
- **35% to $SOF stakers** (fee capture model)
- **25% to treasury** (development, operations)

## Post-Season Token Management: The Critical Problem

### The Dilemma

After each season ends, significant amounts of $SOF are "locked" in the staking contracts that issued ticket-coins. Traditional solutions create problems:

- **Immediate unlock** → Market dumping, price volatility
- **Permanent lock** → Reduces $SOF circulation, harms liquidity
- **Simple burning** → Deflationary pressure, but no user benefit

### Graduated Liquidity Solution

#### Phase 1: Immediate Conversion Rights (Days 1-7)

- **Winners** can immediately convert ticket-coins 1:1 to $SOF (they earned it)
- **Non-winners** can convert at 90% rate (small penalty for losing)
- **Emergency exit** available at 80% rate for immediate liquidity needs

#### Phase 2: Linear Unlocking (Days 8-30)

- **Automatic daily release** of 1/23rd of remaining locked $SOF per day
- **Staking credit** - Users earn additional $SOF for keeping tokens locked longer
- **Rollover bonus** - 10% bonus $SOF for committing to next season

#### Phase 3: Long-term Treasury (Day 31+)

- **Unclaimed $SOF** moves to treasury for future season prizes
- **Recovery mechanism** - Users can still claim for 1 year at decreasing rates
- **Burn option** - Treasury can burn tokens for deflationary pressure

### Example Post-Season Flow

```
Season End: 1000 $SOF locked, issued 10 ticket-coins

Day 1-7 (Immediate):
- 3 winners convert 3 tickets → 300 $SOF (100% rate)
- 2 losers convert 2 tickets → 180 $SOF (90% rate)
- Remaining: 520 $SOF locked, 5 tickets outstanding

Day 8-30 (Linear unlock):
- 22.6 $SOF released daily to remaining ticket holders
- 60% choose to stake for next season (get 10% bonus)
- 40% take gradual unlock

Day 31+ (Treasury):
- ~100 $SOF moves to treasury
- Available for future season prize boosts
```

## Fixed Supply $SOF Economics

### Supply Structure

- **Total supply**: 100 million $SOF (fixed, no inflation)
- **Initial distribution**:
  - 40% - Public sale/liquidity
  - 25% - Team/advisors (4-year vest)
  - 20% - Treasury (operations, prizes)
  - 15% - Ecosystem incentives

### Value Accrual Mechanisms

1. **Fee capture** - 35% of all platform fees used to buy $SOF from market
2. **Staking utility** - Required for ticket-coin conversion
3. **Governance rights** - Vote on season parameters, fee structures
4. **Premium access** - Early season entry, special features
5. **Deflationary pressure** - Post-season burning of unclaimed tokens

### Sustainability Model

- **Self-reinforcing cycle**: More seasons → More fees → Higher $SOF demand → Better prizes → More participation
- **Network effects**: Successful seasons attract new players and sponsors
- **Treasury management**: Strategic $SOF buybacks during low-activity periods

## Prediction Market Integration

### Second-Order Token Economics

The prediction market derivatives should use **separate tokenomics** from the base game:

- **ETH-denominated** betting for broader accessibility
- **2-3% platform fee** on all prediction market trades
- **Real-time odds** based on ticket-coin holdings and trading activity
- **Cross-collateralization** between base game and derivatives prohibited

### Revenue Implications

Prediction markets could generate **more revenue than base raffle** due to:

- **Higher trading velocity** (continuous vs discrete)
- **Sophisticated traders** (willing to pay fees for alpha)
- **Leverage opportunities** (amplified position sizes)
- **Social/viral mechanics** (betting on friends' positions)

## Implementation Roadmap

### Phase 1: Fixed Supply $SOF Launch

- **Token issuance** with transparent distribution
- **Basic staking mechanics** for fee sharing
- **Treasury management** system

### Phase 2: Season Staking System

- **Season calendar** with predictable timing
- **Staking contracts** for ticket-coin conversion
- **Post-season unlocking** mechanisms

### Phase 3: Prediction Market Layer

- **Derivative trading** infrastructure
- **Cross-system fee capture** integration
- **Advanced hedging** tools for sophisticated users

### Phase 4: Ecosystem Expansion

- **Multi-season strategies** for power users
- **Sponsor integration** for prize funding
- **Community governance** via $SOF voting

## Risk Mitigation

### Technical Risks

- **Smart contract audits** before any token launches
- **Gradual rollout** starting with smaller seasons
- **Emergency pause** mechanisms for unforeseen issues

### Economic Risks

- **Treasury diversification** (not 100% $SOF)
- **Conservative fee estimates** for sustainability modeling
- **Multiple revenue streams** to reduce single-point-of-failure

### User Experience Risks

- **Clear communication** of all mechanics and timelines
- **Educational content** explaining staking vs speculation
- **Progressive complexity** introduction for new users

## Conclusion

The staking model provides **clearer game mechanics**, **predictable economics**, and **better post-season management** compared to bonding curves. Combined with Immutable X's proven fee capture approach (adapted for gaming), this creates a sustainable tokenomics foundation that aligns with SecondOrder.fun's core value proposition of "fair games through transparent rules."

The graduated post-season liquidity mechanism solves the critical "locked token" problem while maintaining incentives for continued participation and providing flexibility for different user preferences.
