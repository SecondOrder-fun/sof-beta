# `maxFloatLockedBps`: impact model

> What capping the share of float a season can absorb actually does to a launched
> token's economics. Model script: `scripts/analysis/float-lock-model.py`.

## 1. A correction first — locking float does not lift price

Earlier drafts of `design.md` (§9.6) said ticket purchases shrink float and *lift price*.
**That is wrong, and the error matters for the rest of this analysis.**

- **On a step bonding curve**, price is a function of *tokens minted/sold by the curve*. A holder
  moving tokens into the ticket curve mints nothing and burns nothing. Curve price is unchanged.
- **In a Uniswap v4 pool**, price is a function of *pool reserves*. Tokens moving from a holder's
  wallet into the ticket curve never touch the pool. Pool price is unchanged.

Locking float removes tokens from the set that *could* be sold. It does not remove liquidity, and it
does not move the quoted price by itself. The volatility-damper claim in §1.1 is still true, but the
mechanism is **removal of potential sell pressure**, not a supply squeeze.

This means the real impacts to model are:

1. **Reduced sell pressure during a season** — a benefit, and the point of the feature.
2. **A release event at settlement** — the risk, and what the cap exists to bound.
3. **Prize pool size** — directly proportional to the cap.
4. **Outcome concentration** — a large lock on a small float means few players decide the game.

## 2. The right unit is days of volume, not percent of supply

A release of *L* tokens matters in proportion to how much volume the market normally absorbs. "10% of
supply" is meaningless without turnover; "two days of average volume dumped at once" is not.

```
release_pressure  =  (cap × sell_through) / daily_turnover      [days of average volume]

  cap             = maxFloatLockedBps / 10000
  daily_turnover  = daily volume / circulating supply
  sell_through    = share of unlocked tokens sold promptly at settlement
```

Impact bands used below: **≤0.10d** comfortable, **≤0.30d** noticeable, **≤1.0d** significant,
**>1.0d** severe.

## 3. Results

At a 30% sell-through assumption:

| cap | dormant (2%) | quiet (10%) | active (25%) | hot (50%) | frenzy (150%) |
|---|---|---|---|---|---|
| **5%** | 0.75d significant | 0.15d noticeable | 0.06d comfortable | 0.03d comfortable | 0.01d comfortable |
| **10%** | 1.50d **SEVERE** | 0.30d noticeable | 0.12d noticeable | 0.06d comfortable | 0.02d comfortable |
| **15%** | 2.25d **SEVERE** | 0.45d significant | 0.18d noticeable | 0.09d comfortable | 0.03d comfortable |
| **20%** | 3.00d **SEVERE** | 0.60d significant | 0.24d noticeable | 0.12d noticeable | 0.04d comfortable |
| **30%** | 4.50d **SEVERE** | 0.90d significant | 0.36d significant | 0.18d noticeable | 0.06d comfortable |
| **50%** | 7.50d **SEVERE** | 1.50d **SEVERE** | 0.60d significant | 0.30d noticeable | 0.10d comfortable |

Sensitivity to the sell-through assumption, holding cap at 15%:

| sell-through | dormant | quiet | active | hot | frenzy |
|---|---|---|---|---|---|
| 10% | 0.75d | 0.15d | 0.06d | 0.03d | 0.01d |
| 30% | 2.25d | 0.45d | 0.18d | 0.09d | 0.03d |
| 50% | 3.75d | 0.75d | 0.30d | 0.15d | 0.05d |
| 80% | 6.00d | 1.20d | 0.48d | 0.24d | 0.08d |

### 3.1 The rule that falls out

Solving for the cap that keeps release ≤0.30d at 30% sell-through gives **cap ≤ daily turnover**,
exactly. So:

> **Cap the lock at roughly one day's turnover.**

A token turning over 10% of its supply daily can safely support a ~10% lock. A dormant token turning
over 2% can support ~2% and no more — and note that **at a fixed 10% cap, a dormant token is in the
SEVERE band**. That is the single most important output of this model: *a fixed cap is unsafe at the
bottom of the turnover range*, which is exactly where most launched tokens will spend most of their
lives.

## 4. The prize pool is not a constraint

The obvious worry is that a small cap starves prizes. It does not. Prize pool equals the tokens
locked, so as a share of circulating market cap it equals the cap:

| cap | % of mcap | $250k mcap | $1M mcap | $10M mcap |
|---|---|---|---|---|
| 5% | 5% | $12,500 | $50,000 | $500,000 |
| 10% | 10% | $25,000 | $100,000 | $1,000,000 |
| 15% | 15% | $37,500 | $150,000 | $1,500,000 |
| 20% | 20% | $50,000 | $200,000 | $2,000,000 |

A 5% cap on a $1M token is a $50k prize pool. That is already a large raffle by any reasonable
standard. **There is no real tension between a conservative cap and an attractive game**, which
removes the main argument for setting the cap high.

## 5. Recommendation

**Start at 10%, admin-settable, with a compiled-in ceiling of 25%.** Ten percent is safe from
"quiet" turnover upward and gives generous prizes. The ceiling exists so no future admin key can
push it into the range where settlement reliably wrecks the token.

Then, three structural requirements that matter more than the number:

**5.1 The cap must be global across concurrent seasons on a token, not per-season.** Three
simultaneous seasons each locking 10% is a 30% lock. Enforce against the sum of all active seasons'
locked balances for that quote token, or the cap is trivially bypassed by opening more seasons.

**5.2 Stagger settlements.** The model measures a single release. Overlapping seasons that settle on
different days spread the release across several days of volume and materially reduce peak impact —
the cheapest available mitigation, and free if season end dates are simply not allowed to coincide.

**5.3 Turnover-awareness is desirable but probably not worth it on-chain.** The honest version of
this model sets the cap from trailing turnover, which needs volume data on-chain — a new oracle, and
a manipulable one (wash trading inflates turnover, which would *raise* the permitted lock: precisely
backwards). Options, in order of preference:

1. **Fixed conservative cap** (recommended). Simple, unmanipulable, safe from "quiet" upward.
2. **Off-chain-computed cap, set by admin per token.** Backend already indexes every trade, so
   turnover is known. Keeps the math honest without an on-chain oracle. Adds a trusted input.
3. **On-chain turnover oracle.** Rejected: the manipulation points the wrong way.

**5.4 Surface it in the UI as days-of-volume, not a percentage.** "This season can lock up to 10% of
float — about 1 day of trading volume" is legible. "10%" alone is not, and the whole point of §1 is
that the percentage means nothing without turnover.

## 6. What this model does not cover

- **Outcome concentration.** A lock that is large relative to float means few wallets hold most
  tickets. That is a game-design question (and `maxParticipants` / ticket distribution already bear
  on it), not a price-impact one.
- **Correlated settlement across tokens.** If the platform runs many seasons across many tokens that
  settle together, that is a platform-level event with no per-token model.
- **Sell-through is assumed, not measured.** 30% is a guess. Once real seasons settle, measure actual
  post-settlement sell-through and re-run — it is the input the result is most sensitive to, and
  §3's sensitivity table exists so the conclusion can be re-derived rather than re-guessed.
- **Reflexive feedback.** A falling price at settlement may itself raise sell-through, which is a
  second-order effect the linear model ignores. It makes the SEVERE cells worse, not better.
