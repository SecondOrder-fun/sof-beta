---
trigger: always_on
---

# Winner Selection Methods: Sliding Window System Analysis

## The Sliding Window Numbering System

### How It Works

Instead of traditional discrete ticket numbers, positions are tracked by **entry order** and **position size**, creating dynamic number ranges that slide as new purchases occur.

### Example Scenario

```
Initial State:
- Player A: Buys 1,000 tickets → Numbers 1-1,000
- Player B: Buys 500 tickets → Numbers 1,001-1,500
- Player C: Buys 300 tickets → Numbers 1,501-1,800

Player A Increases Position (+500 tickets):
- Player A: 1,500 tickets → Numbers 1-1,500 (expanded)
- Player B: 500 tickets → Numbers 1,501-2,000 (slid up)
- Player C: 300 tickets → Numbers 2,001-2,300 (slid up)

Player B Increases Position (+200 tickets):
- Player A: 1,500 tickets → Numbers 1-1,500 (unchanged)
- Player B: 700 tickets → Numbers 1,501-2,200 (expanded)
- Player C: 300 tickets → Numbers 2,201-2,500 (slid up)
```

### Technical Advantages

- **Single state update**: Only need to track position sizes and entry order
- **Gas efficient**: No complex ticket ID management
- **Atomic operations**: Position changes update all ranges automatically
- **Prediction market compatible**: Positions naturally tracked for derivatives

## Winner Selection Method 1: Linear Probability

### Mechanism

Win probability is directly proportional to ticket holdings. More tickets = proportionally higher chance to win.

### Mathematical Implementation

```
Player A: 1,500 tickets (1-1,500)
Player B: 700 tickets (1,501-2,200)
Player C: 300 tickets (2,201-2,500)
Total: 2,500 tickets

Win Probabilities:
- Player A: 1,500/2,500 = 60%
- Player B: 700/2,500 = 28%
- Player C: 300/2,500 = 12%

Random number generation: 1-2,500
If result = 834 → Player A wins
If result = 1,876 → Player B wins
If result = 2,234 → Player C wins
```

### Pros

✅ **Mathematically simple** - Easy to understand and verify
✅ **Transparent fairness** - Exactly proportional to investment
✅ **Incentivizes participation** - More tickets always = better odds
✅ **Gas efficient** - Simple random number check against ranges
✅ **Prediction market alignment** - Betting odds directly match win probability

### Cons

❌ **Whale dominance risk** - Large holders can achieve very high win probability
❌ **Winner predictability** - In extreme cases, outcomes become near-certain
❌ **Discourages small players** - Tiny positions have negligible win chance
❌ **Concentration incentive** - Optimal strategy is maximum position size

### Whale Dominance Examples

```
Extreme Case:
- Whale: 900,000 tickets (90% win probability)
- Others: 100,000 tickets total (10% win probability)

Result: Whale wins 9 out of 10 times, making it less like a lottery and more like delayed profit-taking.
```

## Winner Selection Method 2: Diminishing Returns

### Mechanism

Win probability increases with ticket holdings but at a decreasing rate. Uses mathematical functions like square root or logarithmic scaling.

### Mathematical Implementation (Square Root)

```
Player A: 1,500 tickets → sqrt(1,500) = 38.7 "effective tickets"
Player B: 700 tickets → sqrt(700) = 26.5 "effective tickets"
Player C: 300 tickets → sqrt(300) = 17.3 "effective tickets"
Total effective: 82.5

Win Probabilities:
- Player A: 38.7/82.5 = 46.9% (vs 60% linear)
- Player B: 26.5/82.5 = 32.1% (vs 28% linear)
- Player C: 17.3/82.5 = 21.0% (vs 12% linear)
```

### Alternative Functions

**Logarithmic Scaling**: `ln(tickets + 1)`
**Power Scaling**: `tickets^0.7`
**Capped Linear**: Linear up to X tickets, then flat

### Pros

✅ **Whale resistance** - Large positions get diminishing returns
✅ **Small player protection** - Disproportionate benefit to smaller holdings
✅ **Maintains incentives** - More tickets still = better odds, just not linearly
✅ **Tunable parameters** - Can adjust diminishing rate for desired effect
✅ **Still transparent** - Mathematical formula is public and verifiable

### Cons

❌ **Mathematical complexity** - Harder to explain and calculate
❌ **Gas costs** - Square root/log operations more expensive on-chain
❌ **Prediction market complications** - Betting odds no longer match simple holdings
❌ **Strategic complexity** - Optimal position sizing becomes non-obvious
❌ **Potential gaming** - Multiple accounts to avoid diminishing returns

### Anti-Gaming Considerations

**Sybil Attack Prevention**:

- **KYC requirements** (reduces accessibility)
- **Wallet history analysis** (complex implementation)
- **Minimum position sizes** (excludes small players)
- **Economic barriers** (gas costs for multiple accounts)

## Winner Selection Method 3: Multi-Winner Structures

### Mechanism

Instead of single winner taking largest prize, distribute prizes across multiple winners (3, 5, 10, etc.).

### Prize Distribution Models

**Model A: Exponential Decay**

```
Total Prize Pool: 2,000,000 $SOF
- 1st Place: 50% = 1,000,000 $SOF
- 2nd Place: 25% = 500,000 $SOF
- 3rd Place: 12.5% = 250,000 $SOF
- 4th Place: 6.25% = 125,000 $SOF
- 5th Place: 6.25% = 125,000 $SOF
```

**Model B: More Equal Distribution**

```
Total Prize Pool: 2,000,000 $SOF
- 1st Place: 30% = 600,000 $SOF
- 2nd Place: 25% = 500,000 $SOF
- 3rd Place: 20% = 400,000 $SOF
- 4th Place: 15% = 300,000 $SOF
- 5th Place: 10% = 200,000 $SOF
```

**Model C: Many Small Winners**

```
Total Prize Pool: 2,000,000 $SOF
- Top 10 winners: 100,000 $SOF each (50%)
- Next 20 winners: 25,000 $SOF each (25%)
- Next 50 winners: 10,000 $SOF each (25%)
```

### Selection Process with Sliding Windows

```
For 5-winner system:
1. Generate 5 distinct random numbers (1 to total_tickets)
2. Map each number to winner using sliding windows
3. Same player cannot win multiple prizes (re-roll if duplicate)
4. Award prizes in order of random number magnitude

Example:
Random numbers: 234, 1,876, 2,401, 445, 1,234
Sorted: 234, 445, 1,234, 1,876, 2,401
Winners: A(1st), A(2nd), A(3rd), B(4th), C(5th)

Problem: Player A wins 3 prizes!
Solution: Re-roll duplicates or use "without replacement" selection
```

### Pros

✅ **More winners = more excitement** - Multiple participants get life-changing money
✅ **Reduced whale dominance** - Even large holders unlikely to win all top prizes
✅ **Better marketing** - "10 winners every week" vs "1 winner every week"
✅ **Risk distribution** - Multiple prize levels create different risk/reward profiles
✅ **Community building** - More success stories create stronger network effects

### Cons

❌ **Selection complexity** - Need anti-duplicate logic and multiple random numbers
❌ **Prize dilution** - Largest prize smaller than single-winner model
❌ **Gas costs** - Multiple winner selection operations
❌ **Strategic complications** - Optimal position sizing for different prize tiers
❌ **Prediction market complexity** - Need to track multiple winner possibilities

## Sliding Window Compatibility Analysis

### Best Fit: Linear Probability

The sliding window system was **designed for linear probability**:

- Natural mapping from position size to number range
- Simple random number generation and checking
- Prediction markets can easily track linear probabilities
- Gas efficient implementation

### Moderate Fit: Multi-Winner

**Compatible but requires additional logic**:

- Multiple random number generation (higher gas costs)
- Anti-duplicate selection mechanisms needed
- More complex prize distribution logic
- Prediction markets need to track multiple outcomes

### Poor Fit: Diminishing Returns

**Significant implementation challenges**:

- Sliding windows don't naturally map to diminished probabilities
- Need additional calculation layer for "effective tickets"
- Prediction markets become much more complex
- Higher gas costs for mathematical operations

## Hybrid Approaches

### Capped Linear + Multi-Winner

```
Win probability = min(tickets, 50,000) / total_effective_tickets
5 winners with exponential prize decay

Benefits:
- Whale resistance through cap
- Multiple winners for excitement
- Maintains simplicity up to cap
- Compatible with sliding windows
```

### Progressive Tiers

```
Tier 1 (1-10,000 tickets): Linear probability
Tier 2 (10,001-50,000 tickets): 0.8x linear probability
Tier 3 (50,001+ tickets): 0.6x linear probability

Benefits:
- Graduated diminishing returns
- Still uses sliding window system
- Predictable tier boundaries
```

## Implementation Recommendations

### For MVP: Linear Probability + Position Limits

**Reasoning**:

- Simplest implementation with sliding windows
- Transparent and easily understood
- Compatible with prediction markets
- Add position limits (e.g., max 10% of total tickets) to prevent extreme dominance

### For V2: Multi-Winner Linear

**Reasoning**:

- Maintains linear simplicity
- Addresses whale dominance through prize distribution
- Creates more marketing opportunities
- Better community engagement

### For V3: Sophisticated Hybrid

**Reasoning**:

- Combines best aspects of multiple approaches
- Addresses lessons learned from earlier versions
- Can optimize based on real user behavior data

## Strategic Implications

### Linear Probability Strategy

**Optimal player behavior**: Buy maximum affordable position, hold until end
**Whale strategy**: Accumulate large position for near-guaranteed wins
**Small player strategy**: Buy small position for lottery-style hope

### Diminishing Returns Strategy

**Optimal player behavior**: Find sweet spot in diminishing curve
**Whale strategy**: Multiple smaller positions or accept reduced efficiency
**Small player strategy**: Relatively better odds than linear system

### Multi-Winner Strategy

**Optimal player behavior**: Size position for desired prize tier
**Whale strategy**: Large position for multiple prize chances
**Small player strategy**: Aim for lower-tier prizes with reasonable odds

## Recommendation: Start Linear with Safeguards

Given the sliding window system's natural fit with linear probability and the need for MVP simplicity, **start with linear probability** but include these safeguards:

1. **Position limits**: Maximum 20% of total tickets per address
2. **Multiple winner tiers**: 3-5 winners to distribute prizes
3. **Minimum position size**: Prevent dust attacks and ensure meaningful participation
4. **Clear communication**: Emphasize that large positions have proportionally better odds

This approach maintains the mathematical elegance of your sliding window system while addressing the primary concerns about whale dominance through position limits and multi-winner structures.
