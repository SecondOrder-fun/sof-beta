---
trigger: always_on
---

# SecondOrder.fun Bonding Curve Mathematics & Prize Pool Analysis

## Stepped Linear Bonding Curve Parameters

### Base Configuration

- **Total Supply**: 1,000,000 ticket-tokens
- **Starting Price**: 10 $SOF per ticket-token
- **Curve Type**: Linear stepped increases
- **Buy Fee**: 0.1%
- **Sell Fee**: 0.7%

## Scenario A: 100-Step Linear Curve

### Step Configuration

- **Steps**: 100 steps of 10,000 tokens each
- **Price Increase**: +1 $SOF per step
- **Step 1**: Tokens 1-10,000 cost 10 $SOF each
- **Step 2**: Tokens 10,001-20,000 cost 11 $SOF each
- **Step 100**: Tokens 990,001-1,000,000 cost 109 $SOF each

### Total Value Locked (TVL) Analysis

**If 50,000 tokens minted (5% of supply)**:

```
Step 1: 10,000 tokens × 10 $SOF = 100,000 $SOF
Step 2: 10,000 tokens × 11 $SOF = 110,000 $SOF
Step 3: 10,000 tokens × 12 $SOF = 120,000 $SOF
Step 4: 10,000 tokens × 13 $SOF = 130,000 $SOF
Step 5: 10,000 tokens × 14 $SOF = 140,000 $SOF

Total TVL: 600,000 $SOF
Average price per token: 12 $SOF
```

**If 200,000 tokens minted (20% of supply)**:

```
Steps 1-20: (10 + 11 + 12 + ... + 29) × 10,000 = 3,900,000 $SOF
Average price per token: 19.5 $SOF
```

**If 500,000 tokens minted (50% of supply)**:

```
Steps 1-50: (10 + 11 + 12 + ... + 59) × 10,000 = 17,250,000 $SOF
Average price per token: 34.5 $SOF
```

### Prize Pool & Consolation Analysis (50,000 tokens example)

**Total TVL**: 600,000 $SOF

**Prize Split Option 1 (Conservative)**:

- **Winner Prize**: 20% = 120,000 $SOF
- **Consolation Pool**: 70% = 420,000 $SOF
- **Next Season Seed**: 10% = 60,000 $SOF

**Consolation per losing ticket**: 420,000 ÷ 49,999 = **8.4 $SOF per ticket**
**Average ticket cost**: 12 $SOF
**Loser recovery rate**: 8.4 ÷ 12 = **70%** of investment

**Prize Split Option 2 (Aggressive)**:

- **Winner Prize**: 40% = 240,000 $SOF
- **Consolation Pool**: 50% = 300,000 $SOF
- **Next Season Seed**: 10% = 60,000 $SOF

**Consolation per losing ticket**: 300,000 ÷ 49,999 = **6.0 $SOF per ticket**
**Loser recovery rate**: 6.0 ÷ 12 = **50%** of investment

## Scenario B: 1000-Step Linear Curve

### Step Configuration

- **Steps**: 1,000 steps of 1,000 tokens each
- **Price Increase**: +0.1 $SOF per step
- **Step 1**: Tokens 1-1,000 cost 10.0 $SOF each
- **Step 2**: Tokens 1,001-2,000 cost 10.1 $SOF each
- **Step 1000**: Tokens 999,001-1,000,000 cost 109.9 $SOF each

### TVL Analysis (Finer Steps)

**If 50,000 tokens minted (50 steps)**:

```
Step 1: 1,000 tokens × 10.0 $SOF = 10,000 $SOF
Step 2: 1,000 tokens × 10.1 $SOF = 10,100 $SOF
...
Step 50: 1,000 tokens × 14.9 $SOF = 14,900 $SOF

Total TVL: 624,500 $SOF
Average price per token: 12.49 $SOF
```

**If 200,000 tokens minted (200 steps)**:

```
Steps 1-200: Total TVL = 3,999,000 $SOF
Average price per token: 19.995 $SOF
```

### Prize Pool Analysis (Finer Steps, 50,000 tokens)

**Total TVL**: 624,500 $SOF

**Conservative Split (70% consolation)**:

- **Consolation per losing ticket**: (624,500 × 0.7) ÷ 49,999 = **8.74 $SOF**
- **Loser recovery rate**: 8.74 ÷ 12.49 = **70%**

**Balanced Split (60% consolation)**:

- **Consolation per losing ticket**: (624,500 × 0.6) ÷ 49,999 = **7.49 $SOF**
- **Loser recovery rate**: 7.49 ÷ 12.49 = **60%**

## Fee Revenue Analysis

### Buy/Sell Fee Structure

- **Buy Fee**: 0.1% of $SOF spent
- **Sell Fee**: 0.7% of $SOF received

### Revenue Examples (50,000 tokens, 100-step scenario)

**From Initial Minting** (600,000 $SOF TVL):

- **Buy fees**: 600,000 × 0.001 = **600 $SOF**

**From Trading Activity** (assume 20% trade volume):

- **Additional buy volume**: 120,000 $SOF
- **Additional buy fees**: 120,000 × 0.001 = **120 $SOF**
- **Sell volume**: 120,000 $SOF
- **Sell fees**: 120,000 × 0.007 = **840 $SOF**

**Total Platform Revenue**: 600 + 120 + 840 = **1,560 $SOF**

### Concurrent Seasons Revenue Model

**With 5 concurrent seasons** running:

- **Season A**: 50,000 tokens, 1,560 $SOF fees
- **Season B**: 30,000 tokens, 800 $SOF fees
- **Season C**: 75,000 tokens, 2,100 $SOF fees
- **Season D**: 100,000 tokens, 3,500 $SOF fees
- **Season E**: 25,000 tokens, 600 $SOF fees

**Total concurrent revenue**: **8,560 $SOF per period**

## Bonding Curve Exit Dynamics

### Early Exit Scenarios (50,000 tokens minted, 100-step curve)

**Participant bought at Step 1** (10 $SOF per token):

- **Current market price**: 14 $SOF (Step 5)
- **Gross exit value**: 1,000 tokens × 14 $SOF = 14,000 $SOF
- **Exit fee**: 14,000 × 0.007 = 98 $SOF
- **Net exit value**: 13,902 $SOF
- **Profit**: 13,902 - 10,000 = **3,902 $SOF (39% profit)**

**Participant bought at Step 3** (12 $SOF per token):

- **Current market price**: 14 $SOF (Step 5)
- **Net exit value**: (1,000 × 14 × 0.993) = 13,902 $SOF
- **Profit**: 13,902 - 12,000 = **1,902 $SOF (16% profit)**

### Hold vs Exit Decision Matrix

**For Step 1 buyer with 1,000 tickets**:

**Option A: Exit Now**

- **Guaranteed profit**: 3,902 $SOF
- **Forfeits**: Prize eligibility

**Option B: Hold to End**

- **If wins raffle**: 120,000 $SOF (Conservative split)
- **If loses raffle**: 8.4 $SOF consolation
- **Win probability**: 1,000 ÷ 50,000 = 2%
- **Expected value**: (0.02 × 120,000) + (0.98 × 8,400) = 2,400 + 8,232 = **10,632 $SOF**

**Expected value of holding > Guaranteed exit profit**, so rational to hold.

## Scale-Dependent Dynamics

### Small Season (25,000 tokens)

```
TVL: ~275,000 $SOF
Winner Prize (40%): 110,000 $SOF
Consolation (50%): 137,500 $SOF
Per-loser consolation: 5.5 $SOF
Average ticket cost: 11 $SOF
Recovery rate: 50%
```

### Medium Season (100,000 tokens)

```
TVL: ~1,450,000 $SOF
Winner Prize (40%): 580,000 $SOF
Consolation (50%): 725,000 $SOF
Per-loser consolation: 7.3 $SOF
Average ticket cost: 14.5 $SOF
Recovery rate: 50%
```

### Large Season (300,000 tokens)

```
TVL: ~5,950,000 $SOF
Winner Prize (40%): 2,380,000 $SOF
Consolation (50%): 2,975,000 $SOF
Per-loser consolation: 9.9 $SOF
Average ticket cost: 19.8 $SOF
Recovery rate: 50%
```

## Key Mathematical Insights

### 1. Recovery Rate is Determined by Prize Split

The loser recovery rate is roughly equal to the consolation pool percentage, regardless of bonding curve parameters. If consolation pool is 60% of TVL, losers recover ~60% of their average investment.

### 2. Bonding Curve Steepness Affects Participation

**Steeper curves** (fewer, larger steps):

- **Higher early-exit profits** for early participants
- **Greater inequality** between early and late participants
- **More speculation-focused** behavior

**Gentler curves** (more, smaller steps):

- **Smoother price discovery** with less dramatic profit opportunities
- **More equal treatment** of participants
- **More raffle-focused** behavior

### 3. Win Probability vs Expected Value

The expected value of holding almost always exceeds early exit value due to:

- **Large winner prizes** creating high expected value
- **Guaranteed consolation** providing downside protection
- **Exit fees** reducing exit attractiveness

### 4. Concurrent Seasons Create Diversification

Multiple seasons running simultaneously:

- **Reduce platform risk** from any single season failure
- **Provide participant choice** in risk/reward profiles
- **Create more consistent revenue** streams
- **Enable cross-season strategic behavior**

## Optimization Considerations

### Balancing Recovery Rate vs Prize Appeal

- **70%+ recovery**: Very safe for losers, but smaller winner prizes
- **50-60% recovery**: Balanced risk/reward, attractive winner prizes
- **<50% recovery**: High-stakes gambling, may deter participation

### Fee Structure Optimization

- **Low buy fees**: Encourage participation and minting
- **Higher sell fees**: Discourage short-term speculation, encourage holding
- **Progressive sell fees**: Could increase with profit percentage

### Bonding Curve Calibration

- **100 steps**: Good balance of price discovery and simplicity
- **1000 steps**: Very smooth but potentially less exciting price movements
- **50 steps**: More dramatic price jumps, higher speculation potential

## Next Steps for Analysis

1. **Selection mechanism impact**: How do different winner selection methods affect optimal strategies?
2. **Multi-winner scenarios**: How do 3-winner vs 10-winner structures change the mathematics?
3. **Cross-season behavior**: How do concurrent seasons interact and compete for participants?
4. **Whale mitigation**: What position limits or diminishing returns prevent dominance?
5. **Market maker dynamics**: How do automated exit/entry strategies affect the ecosystem?
