# InfoFi mechanism redesign: DPM vs FPMM

> Why the current FPMM design forces an awkward supply earmark on the launchpad,
> what a dynamic pari-mutuel market would replace it with, and what it costs.

## 1. The problem this solves

`InfoFiMarketFactory.sol` seeds every market with `INITIAL_LIQUIDITY` pulled from a treasury
balance (nine call sites). That is fine when there is exactly one collateral token. It breaks
under the launchpad, where markets would be denominated in an arbitrary launched token the
treasury has no reason to hold.

The launchpad design answered this by **earmarking a share of every launched token's supply**
into an `InfoFiSeedVault` (`../launchpad/design.md` §5.2, §5.8). That answer works, but look at
what it drags in:

- ~10% of every token's supply held permanently outside circulation
- a vault contract with a deposit path, a release path, and an admin-withdrawal path that must
  provably not exist
- a supply overhang that has the shape of a team allocation and will be read as one (§9.8)
- a dead-earmark problem: most tokens will never host a market, so most of that supply needs a
  terminal `sweepUnused` path — burn or fall through to LP
- two of the three remaining open questions in the launchpad design

Every one of those exists **only because FPMM needs seed liquidity**. Remove that requirement and
the whole apparatus disappears. That is the case for looking at DPM.

## 2. What a DPM is

A dynamic pari-mutuel market (Pennock, 2004) is a hybrid of a pari-mutuel pool and a continuous
market maker. The properties that matter here:

- **Infinite buy-in liquidity and zero risk to the operator.** There is always a price at which
  you can buy. The house never takes a position and cannot lose money.
- **No seed capital.** The pool is whatever traders have wagered. A market opens empty.
- **Continuous price discovery.** Unlike a classic pari-mutuel (where odds are only known at
  close), a DPM's price function moves with the money already wagered, so prices react to
  information as it arrives.
- **Traders can exit before resolution.** The price function lets you sell back, which a plain
  pari-mutuel does not.
- **Payout is redistributive.** It pays out exactly what came in, less fees — by construction.

Price on an outcome rises as money accumulates on it, so backing an outcome others think unlikely
is cheap. Real deployments exist: Yahoo!'s Tech Buzz Game was a DPM, and there is at least one
on-chain implementation (9Lives).

## 3. Why this fits us unusually well

Our markets are **"will player X win this raffle?"** — and the raffle already has an on-chain
ground truth for probability: `tickets_held / total_tickets`. That changes the calculus versus a
general prediction market:

- **We don't need a market maker to bootstrap a prior.** The raffle supplies it. The FPMM's seeded
  pool is doing work that `InfoFiPriceOracle`'s 70% raffle-probability term already does.
- **Pari-mutuel settlement is the natural shape for a raffle.** Exactly one player wins. A
  winner-take-the-pool mechanism maps onto that without needing conditional-token machinery for
  each YES/NO pair.
- **Zero operator risk matters more for us than for a standalone prediction market**, because we
  would otherwise be taking that risk in a *different token for every launch*.

The hybrid pricing model survives, and arguably improves. Today the 30% sentiment term is derived
from FPMM YES/NO pool balances; under a DPM it comes from money wagered per outcome, which is a
more direct sentiment signal and cheaper to read on-chain.

## 4. What it costs

Not free. The honest list:

**4.1 Known incentive weaknesses.** Chen & Pennock's *Gaming Dynamic Parimutuel Markets* shows
truthful betting is a Nash equilibrium of the two-stage game under uniform initial market
probabilities — but **not** of the three-stage game even under uniform conditions, and there exist
initial probabilities where the first player is better off misleading others. The general concern
is an **incentive to delay**: because payout depends on the final composition of the pool, waiting
can dominate betting early. For short-lived markets this is mild; for a two-week raffle season it
needs thought. Mitigations in the literature and in practice: time-decayed payout weighting
(earlier money earns a larger share), or an adaptive fee that rises as the market ages — which is
what Limitless does (see §6).

**4.2 Payout per share is not fixed at purchase.** This is the biggest UX change. Under FPMM you
buy a share that pays 1 unit of collateral if it resolves YES. Under a DPM your payout depends on
the pool's final state. "You paid X, you'll receive Y if right" becomes an estimate, not a promise.
Every position display, the arbitrage detection in `docs/05-features/arbitrage/`, and any
expected-value calculation in the UI has to change accordingly. Underestimating this is the main
way the migration goes badly.

**4.3 Contract work is a rewrite, not a refactor.** `InfoFiFPMMV2.sol` (598 lines) and
`ConditionalTokenSOF.sol` (170) are replaced by a DPM contract. `InfoFiSettlement.sol` and
`RaffleOracleAdapter.sol` change shape. `InfoFiPriceOracle.sol` and `MarketTypeRegistry.sol` are
probability-domain and should mostly survive. Backend: `infoFiPositionService.js`,
`historicalOddsService.js` and the `infofi_positions` / `infofi_odds_history` schemas all encode
share semantics that no longer hold.

**4.4 Less familiar to traders.** FPMM/CLOB prediction markets are what people know from
Polymarket and Limitless. A DPM's "your payout depends on who else shows up" needs explaining.

## 5. What it buys, concretely

If DPM is adopted, this deletes from `../launchpad/design.md`:

| Deleted | Section |
|---|---|
| InfoFi seed supply bucket (~10%) | §5.2 |
| `InfoFiSeedVault.sol` entirely | §5.8 |
| `sweepUnused` and the dead-earmark problem | §5.8 |
| Open question 2's InfoFi component (supply split) | §1 |
| Open question 3 (unused earmark: burn or LP?) | §1 |
| Treasury-funded `INITIAL_LIQUIDITY` and its 9 call sites | §6.4 |
| Most of §9.8 (reserved-supply misread) | §9.8 |

The supply split collapses from three buckets to two — curve sale and LP — and if the Clanker
staircase model is also adopted (`../launchpad/clanker-comparison.md` §2.1), to **one**. That is a
materially simpler token.

It also means InfoFi no longer needs to be Phase 4. The reason it was sequenced last was the
multi-collateral seed problem. Without it, InfoFi on launched tokens becomes independent of the
launch work and can land whenever it is wanted.

## 6. Other market types — and a correction on Limitless

**Timed-price markets are worth stealing; Limitless's mechanism is not the model here.**
Limitless runs hourly and daily crypto price markets ("will SOL be above $150 in the next hour?")
with plans for 15-, 10- and 1-minute timeframes. But it runs them on a **central limit order book**,
not a DPM — separate YES and NO books with bids and asks. A CLOB is *more* liquidity-hungry than
FPMM, not less: it needs active market makers rather than a seeded pool. So Limitless is a good
source for **what markets to offer**, and the wrong source for **how to run them without capital**.

One Limitless mechanic does transfer directly and is worth noting: **adaptive fees that reward
early conviction** — markets open at ~0.03% fee and close at ~3%. That is a clean answer to
DPM's incentive-to-delay problem in §4.1, arrived at independently.

Market types worth considering, given `MarketTypeRegistry.sol` already exists to register them:

| Type | Question | Notes |
|---|---|---|
| Winner prediction *(current)* | Will player X win? | Ground truth from the raffle |
| Timed price | Will the launch token be above P at time T? | Borrowed from Limitless. Needs a price oracle on the v4 pool — new dependency |
| Position threshold | Will X hold >N% of tickets at season lock? | Pure raffle state, no external oracle, cheap to settle |
| Participation | Will the season exceed N participants / N tokens locked? | Ties directly to the volatility-damper thesis |
| Graduation timing | Will this token graduate before T? | Only meaningful if graduation survives §2.1 of the Clanker study |

The threshold and participation types are the cheapest to add — they settle purely from raffle
state, need no external oracle, and are unavailable to any general prediction market because they
are questions about *our* game.

## 7. Recommendation

1. **Spike a two-outcome DPM contract** against the existing `InfoFiPriceOracle` hybrid model, and
   confirm the 30% sentiment term reads cleanly from wagered amounts. Small, isolated, decides the
   question.
2. **Hold the launchpad's InfoFi earmark as provisional** until that spike returns. It is cheap to
   delete from the design and expensive to retrofit into already-launched tokens, so the launchpad
   should not ship Phase 1 until this is decided — see the note in `../launchpad/design.md` §5.2.
3. **Adopt adaptive fees** (§6) regardless of mechanism — they address a real DPM weakness and
   improve FPMM too.
4. **Add position-threshold and participation market types** before timed-price ones. They need no
   new oracle and they are defensible in a way price markets are not.

## Open questions

1. Payout weighting: flat pari-mutuel, or time-decayed to blunt the incentive to delay (§4.1)?
2. Does the UI present an estimated payout range, and how is that kept honest as the pool moves
   (§4.2)?
3. Does arbitrage detection still work when payout is not fixed at purchase? The current detector
   assumes a fixed-payout share.
4. Migration: do existing FPMM markets on grandfathered seasons get migrated, or run to completion
   in parallel?

## Sources

- [A Dynamic Pari-Mutuel Market for Hedging, Wagering, and Information Aggregation](https://dl.acm.org/doi/10.1145/988772.988799) — Pennock, ACM EC'04
- [Gaming Dynamic Parimutuel Markets](https://link.springer.com/chapter/10.1007/978-3-642-10841-9_64) — Chen & Pennock
- [A Unified Framework for Dynamic Pari-Mutuel Information Market Design](https://arxiv.org/pdf/0902.2429)
- [An Empirical Study of Dynamic Pari-mutuel Markets: Evidence from the Tech Buzz Game](https://www.semanticscholar.org/paper/f296cec567f08ae4444e3232d52f58369a4bf044)
- [9Lives: Deep Dive into Dynamic Pari-Mutuel Markets](https://medium.com/@Superpositionso/9lives-deep-dive-into-dynamic-pari-mutuel-markets-b8185f0b8a78) — on-chain precedent
- [Limitless Exchange docs](https://docs.limitless.exchange/) · [pm.wiki profile](https://pm.wiki/projects/limitless-exchange)
