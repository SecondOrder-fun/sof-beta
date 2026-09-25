# Season size caps: the $2,000 prize cap and the float lock

> Two caps bound how big a season can get. This works out which one actually binds
> (the prize cap, almost always), and flags a problem with enforcing a **dollar**
> cap on a **token**-denominated prize. Thresholds are Delaware's charitable-gaming
> raffle rules. **Not legal advice** — see §2.1 and §3.
>
> Models: `scripts/analysis/prize-cap-model.py`, `scripts/analysis/float-lock-model.py`.

## 1. The float-lock table, explained properly

The earlier table was unreadable. Here is what it was trying to say.

When a season ends, every token that players spent on tickets is released back to them at
once. Some holders sell immediately. The question is whether that wave of selling is **large
compared to how much the token normally trades**.

- Token normally trades **$10k/day**. A season releases tokens and $15k of selling hits.
  That is **1.5 days of normal volume arriving in one moment** — the price drops hard.
- Token normally trades **$500k/day**. The same $15k is **0.03 days** — nobody notices.

That ratio is the only number in the table:

```
release pressure  =  (how much of the float was locked  ×  how much of it gets sold)
                     ─────────────────────────────────────────────────────────────
                                    normal daily trading volume
```

Read it as **"how many days of normal trading arrives at settlement in one moment."**
Under 0.1 → invisible. Around 0.3 → noticeable. Over 1.0 → the chart breaks.

The conclusion was: **a 10% float lock is fine for a token that trades 10%+ of its supply
daily, and dangerous for a dormant one** (at 2% daily turnover, a 10% lock releases 1.5 days
of volume). A *fixed* percentage cap is therefore unsafe at the bottom of the activity range.

**But all of that is now mostly moot**, because your $2,000 prize cap is far more restrictive.

## 2. The Delaware thresholds — and the two conditions that came with the $5,000

The reference point is Delaware's charitable-gaming raffle rules. The $5,000 is real, but it
is **a permit-exemption threshold with three conditions attached, not a standalone prize cap**,
and the other two conditions matter more than the dollar figure:

> No permit is required **if** you are a **qualified charitable organization**, **and** the
> ticket price is **$5 or less**, **and** the total retail cash value of all prizes is **under
> $5,000**. A permit *is* required if a single-drawing ticket costs more than $5, a series
> ticket more than $15, or total prize value reaches $5,000. An annual licence allows up to
> **20 raffle events per year**.

Three things follow, in descending order of how much they hurt.

### 2.1 "Qualified charitable organization" is the real obstacle

The exemption is for charitable organizations. A for-profit token launchpad is not one, so the
**exemption path plausibly does not apply to us at all** — in which case designing to $5,000
and $5 buys nothing, and the relevant analysis is an entirely different one. This is the first
question for counsel, because if the answer is "this framework doesn't apply", §2.2–§2.4 are
wasted effort and the actual constraints live somewhere else.

### 2.2 Twenty events per year is structurally fatal if it binds at platform level

An annual licence covers **20 raffle events per year**. A platform running two-week seasons
across many tokens would blow through that in a week. Everything depends on who counts as the
operator:

- **If the platform is the operator** → 20 seasons per year, total, across all tokens. The
  product as designed is impossible.
- **If each season creator is the operator** → 20 per creator per year, which is generous and
  workable — but it pushes a licensing obligation onto users, which is its own product and
  ethical problem, and one they will not understand.

**This question outranks every number in this document.** It is not a tuning parameter; it
determines whether the design is viable in this jurisdiction at all.

### 2.3 The $5 ticket cap binds harder than the $5,000

With prize pool < $5,000 and a prize pool of ~70% of reserves:

| Quantity | Cap |
|---|---|
| Total prize value (all prizes) | **< $5,000** |
| Grand prize at `defaultGrandPrizeBps = 6500` | **$3,250** |
| Ticket-curve reserves | **$7,143** |
| Ticket price — **top step of the ladder**, not the average | **$5.00** |

Note that the $5 applies to the **highest** step on an increasing ladder, not the average.
That sets a floor on ticket count:

| Tickets | Average price | Within $5 cap? |
|---|---|---|
| 500 | $14.29 | **no** |
| 1,000 | $7.14 | **no** |
| 2,500 | $2.86 | yes |
| 5,000 | $1.43 | yes |
| 10,000 | $0.71 | yes |

**Seasons need roughly 2,500+ tickets**, with a ladder topping out at $5. At a flat $5 it takes
1,429 tickets to reach the cap. This is a workable design — it just means seasons are
many-small-tickets rather than few-large-ones, which also improves the participation and
distribution story.

### 2.4 The float cap still only matters for small tokens

Reserves of $7,143 as a share of circulating market cap:

| Market cap | Reserves / mcap | Which cap binds |
|---|---|---|
| $25,000 | 28.57% | **float cap** |
| $50,000 | 14.29% | **float cap** |
| $100,000 | 7.14% | $5,000 pool cap |
| $1,000,000 | 0.71% | $5,000 pool cap |
| $10,000,000 | 0.07% | $5,000 pool cap |

**Crossover is ~$71,000 market cap.** Below it the float cap binds; above it the pool cap binds
and float-lock is irrelevant. Same conclusion as before: keep `maxFloatLockedBps` as a
small-token safety rail at 10%/25%, enforced against the **sum of all active seasons** on a
token, and stop treating it as a tokenomics lever.

## 3. The problem: a dollar cap on a token-denominated prize

The prize is paid in the launched token. The cap is in dollars. **A cap checked at season
creation does not bound the prize at settlement.**

A season lasts two weeks. If the token 3x's, a $3,250 grand prize becomes $9,750. If it
10x's — an ordinary outcome for a memecoin that works, and the outcome the product is designed
to produce — it becomes **$32,500**, and the *pool* blows through $5,000 many times over. For a
threshold whose purpose is regulatory, that is not an edge case; it is the success case.

Options, ranked by whether they actually bound the fiat value:

| Option | Bounds fiat prize at award? | Cost |
|---|---|---|
| **A. Cap tokens at creation, accept drift** | **No** | Free, but fails the stated purpose |
| **B. Cap sales continuously in USD during the season** | No — bounds the *input* only | Live oracle; a post-sales pump still breaks it |
| **C. Truncate payout at settlement** to the capped fiat equivalent, excess to consolation | **Yes** | Oracle at settlement; winner gets less than the pool implies; must be disclosed loudly |
| **D. Convert reserves to a stablecoin at season lock** | **Yes** | Breaks "prizes in the launched token"; needs pool depth to swap ~$7k |
| **E. Cap at creation with headroom** (e.g. $500 so a 10x lands at $5,000) | Partially | Cripples the 95% of tokens that never 10x |

### 3.1 The permit route — right idea, but it cannot be reactive

There is a permit for exceeding $5,000, and it costs **$15**. Funding it from fee revenue is
sound: one season's fees cover it many times over, so cost is never the obstacle.

**But a permit cannot be obtained after a prize balloons.** Delaware requires the application
*in advance*: the Board considers it **across two consecutive board meetings**, the state
suggests applying **60 days** ahead, and the hard minimum is **15 days before the drawing**.
So "the token mooned, buy a permit" does not work — by the time the prize crosses $5,000
mid-season, the window has closed.

The version that *does* work is stronger than the reactive one:

> **Permit every season in advance by default.** Budget $15 per season from fee revenue,
> file ahead of the season opening, and the $5,000 ceiling simply never binds.

That dissolves the entire drift problem in §3 — no oracle, no truncation, no stablecoin
conversion, no headroom sizing. Options B–E all exist only to keep an unpermitted raffle under
a threshold; if the raffle is permitted, the threshold is not the constraint.

The cost is a **scheduling constraint that reaches into the product**: a season cannot open
sooner than ~15 days (realistically 60) after it is declared. That is incompatible with a
permissionless "open a season now" button, and instead implies scheduled season windows
announced well ahead — which, notably, is what `docs/01-product/framework.md` already
describes ("2-week seasons with clear start/end dates known upfront", staking windows opening
at T-14). **The existing product design is closer to permit-compatible than the launchpad
design is.** Worth reconciling deliberately rather than discovering later.

Two caveats that still gate this:

- **Eligibility (§2.1) is unresolved and outranks everything here.** The permit is issued by
  the Board of Charitable Gaming to qualified charitable organizations. If we are not one,
  the permit route is no more available than the exemption route.
- **The 20-events-per-year annual licence (§2.2) may still cap volume** independently of
  per-event permits. Whether per-event permits are additive to, or bounded by, the annual
  licence is the second question for counsel.

**Recommendation: design for permitted seasons with advance scheduling, and treat options B–E
as the fallback for jurisdictions where a permit is unavailable.** It is a simpler engineering
answer, and it pushes the hard problem into scheduling — where it is a known, solvable product
constraint — rather than into oracles and payout truncation, where it is neither.

**C is the only mechanism that bounds what a winner actually receives while keeping prizes in
the token.** It needs the truncation rule visible from the first ticket sale — "grand prize is
capped; any excess goes to consolation" is legible, and arguably *more* attractive to the
majority who do not win.

**But the mechanism must follow legal advice rather than lead it.** This is mechanism design
against numbers you supplied — it is not legal advice, and I can't assess whether Delaware is
even the right jurisdiction (the operator, the servers, and the players may each sit
elsewhere), nor whether a token-denominated prize is a "retail cash value" prize at all. The
design differs sharply by answer:

- Bounds **prize value at award** → option C.
- Bounds **consideration collected** → option B, which is easier.
- Bounds **aggregate prizes per operator per period** → per-season caps do nothing; the control
  is a platform-wide budget across all tokens.
- The exposure is really about **consideration and chance** → capping prizes may not help at
  all, and the levers are geofencing or a no-consideration entry path.

**Resolve §2.1 and §2.2 first.** Both can invalidate everything else here.

## 4. InfoFi seed: 1% is right, and 10% was ~10x too much

Your recollection is correct — the 10% figure came from a single `$SOF` pool seeding *every*
market across *all* raffles. Per-token, it only has to seed that token's own markets.

Grounding it in the contracts: `INITIAL_LIQUIDITY = 100e18` per market, and markets auto-create
when a player crosses `THRESHOLD_BPS = 100` (1% of tickets), so at most ~100 markets per season
and realistically 5–25.

Assuming a market wants seed worth ~1% of the season's prize pool (~$31 at the capped pool of
$3,077):

| Earmark | On a $250k mcap token | On a $1M mcap token |
|---|---|---|
| **0.25%** | 2 seasons (at 10 markets) | 8 seasons |
| **1%** | 8 seasons | 32 seasons |
| **10%** | 81 seasons | 325 seasons |

**1% is comfortably sufficient** — dozens of seasons of seed on any token big enough to be
interesting. 10% would fund hundreds and is pure overhang. And the smaller sweep has exactly the
benefit you identified: when unused seed is swept into the LP position, 1% moves the pool far
less than 10% would.

One correction that matters more than the percentage: **`INITIAL_LIQUIDITY = 100e18` is a fixed
token count, and that cannot survive the launchpad.** 100 tokens of a 1-billion-supply launch
token is economically nothing; 100 tokens of a low-supply one could be a large share. The seed
must become **value-based or supply-proportional** — a fraction of the season's prize pool, or a
fraction of supply — not a constant. This is a required change to `InfoFiMarketFactory` whatever
the earmark percentage is.

## 5. Recommendations

1. **Resolve eligibility (§2.1) and the 20-events-per-year question (§2.2) first.** Both can
   invalidate everything else in this document, and neither is an engineering question.
2. **Design for permitted seasons scheduled in advance (§3.1)**, budgeting the $15 permit from
   fee revenue. This dissolves the drift problem without oracles or payout truncation, at the
   cost of a scheduling lead time the existing season design already assumes. Keep options B–E
   as the fallback where a permit is unavailable.
3. **If running unpermitted, cap total ticket sales at the token equivalent of ~$7,100** (prize
   pool < $5,000 via the 65%/70% factors) with the ladder topping out at $5, checked at season
   creation where it is deterministic — and accept that drift after creation is unbounded.
4. **Keep `maxFloatLockedBps` at 10%/25% ceiling as a sub-$71k safety rail**, enforced against the
   **sum of all active seasons** on a token. Stop treating it as a tokenomics dial.
5. **Set the InfoFi earmark at 1%**, and change `INITIAL_LIQUIDITY` from a fixed token count to a
   value- or supply-proportional figure.
6. **Stagger season settlements** — still free, still the cheapest release mitigation, and now
   mainly relevant for the many-concurrent-seasons case.

## 6. Operating posture (decided)

**Positioning: the platform sells blank tickets; the season creator is the operator.**
Permits are paid for out of creation-fee revenue. Beyond that, the posture is explicitly
to ship, stay small, and resolve any challenge later — accepting that a serious challenge
means either a funded legal fight or winding the company down.

That is a founder's risk call and this document does not second-guess it. But two things in
the design as specified **cut against the positioning it would need to defend**, and both are
cheaper to change now than later.

### 6.1 Paying the permit is the platform acting as operator

If the defence is "the creator is the operator", then the platform paying that creator's
permit is evidence for the other side. So is the platform choosing prize parameters, pooling
VRF funding across seasons (§5.1 of `design.md` — "whales fund minnows" is a common pool the
platform administers), and taking a percentage of raffle fees, which resembles a cut of the
handle rather than software revenue.

The Epic analogy holds for the *token* layer — Epic takes 12% of sales without being a
publisher — but raffle law tends to care about **who profits from the wager**, which is a
narrower question than who profits from the platform.

Changes that cost little and align the mechanics with the story:

- **Permit in the creator's name, funded by a rebate.** The creator applies; the platform
  reimburses the $15 from fee revenue. Same cash flow, materially different paper trail.
- **Creator sets the prize parameters** within protocol bounds, rather than the protocol
  setting them. The UI can default them; the creator must affirm them.
- **Explicit operator acknowledgement at season creation** — a checkbox the creator signs
  stating they are the operator of record. Cheap, and it is the single most useful artifact to
  have if this is ever argued.
- **Keep the raffle fee structurally identical to the token fee** (same 88/12, same
  collection path). Uniform software pricing reads differently from a bespoke cut of raffle
  proceeds.

None of this makes the position safe. It makes it *consistent*, which is the difference
between a hard argument and a contradicted one.

### 6.2 "Shut down the front ends" does not stop permissionless contracts

The stated wind-down is to take down the front ends and dissolve the company. **That does not
stop the system.** The contracts are permissionless and on-chain: seasons keep opening,
tickets keep selling, and settlement keeps running whether or not the UI exists — and the
protocol keeps accruing fees to an address the dissolved company controlled, which is worse
than either stopping cleanly or not stopping at all.

If wind-down is part of the plan, **it has to be built in now**:

- **A season-creation pause** on `Raffle` / `SeasonCreationStake` — stop new seasons without
  stranding live ones. `Pausable` is already imported in `SOFBondingCurve`; this is a small
  addition, not a new subsystem.
- **A guaranteed settlement path for in-flight seasons** even while paused, so a shutdown
  never traps user funds. This is the same liveness requirement as the VRF budget floor
  (§5.1 of `design.md`), and it should be tested as a first-class scenario rather than assumed.
- **A fee-redirection or fee-zeroing switch**, so a dissolved entity stops accruing revenue it
  cannot legally receive.
- **Decide who holds the key**, and write it down. A pause nobody can reach is not a pause.

This is ordinary operational hygiene for any on-chain system with a possible sunset — it is
worth building regardless of the regulatory question, because the same switches cover an
exploit, a compromised key, or a chain migration.

### 6.3 Scope note

Tax and licensing operations (Elven or similar) are an operational dependency, not a design
input — nothing in the contracts or the UI needs to change for it. The one design-adjacent
consequence is that **per-season records need to be exportable**: operator of record,
participant count, gross ticket sales, prize value at settlement, and fee split. Those are all
derivable from events the indexer already stores, provided the events carry them — worth
confirming when the season schema is written rather than reconstructing later.
