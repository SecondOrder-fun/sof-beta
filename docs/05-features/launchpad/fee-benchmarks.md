# Launch fee benchmarks: Clanker, pump.fun, Pons

> Resolves open question 1 in [`design.md`](design.md) §1 — what to charge to launch.
> Verification status is marked per row: **(source)** = read from contract source,
> **(secondary)** = press/docs summaries only, because the primary domain is blocked
> by this environment's egress proxy.

## 1. The headline: nobody earns from launch fees

| Platform | Launch fee | Chain | Model |
|---|---|---|---|
| **Clanker** | **None.** No deployment fee exists in `Clanker.sol` **(source)** | Base | Instant Uniswap v4 pool, no curve |
| **pump.fun** | **No protocol fee.** ~0.02 SOL of Solana account rent only **(secondary)** | Solana | Curve → PumpSwap |
| **Pons** | **0.0005 ETH**, and it is a *configurable* `launchFee`, not a constant — `setLaunchFee()`, collected in native ETH, forwarded to the protocol fee recipient **(source)** | Robinhood Chain | Curve → Uniswap v4, LP locked |
| **Pools.trade** (Uniswap's own) | **None** *(secondary)* | Robinhood Chain | **No curve contract and no graduation** — a real v4 pool from block one, at 0.25%; the "curve" in its UI is single-sided concentrated liquidity. Creator gets 0.05% of 0.25% (**20%** of fees); the rest auto-compounds into locked liquidity |

Meanwhile these platforms earn substantially: Pons reported **$5.03M in 24-hour fees**, leading the
launchpad category, and Clanker passed **$8M weekly** *(both secondary)*. None of that is launch
fees. It is all trade fees.

**Conclusion: the launch fee is a spam filter, not a revenue line.** Pricing it as revenue would
suppress the one action the whole product depends on while contributing rounding error to the
P&L. Our §1 plan of "a flat ETH launch fee" as the business model is wrong, and the earlier note
in [`clanker-comparison.md`](clanker-comparison.md) §2.4 was pointing the right way.

## 2. Where the money actually comes from

**Clanker (source):** `ClankerHook.sol` — `FEE_DENOMINATOR = 1_000_000`,
`MAX_LP_FEE = 300_000` (30% cap), `PROTOCOL_FEE_NUMERATOR = 200_000`. The protocol takes **20% of
the LP fee** charged on each swap; the creator side takes the rest — reported as an **80/20
creator/protocol split** for Farcaster deployments *(secondary, consistent with the source
constant)*. Fees accrue in `ClankerFeeLocker`; `ClankerLpLocker` splits them across
`rewardRecipients[]` by `rewardBps[]`.

**pump.fun (secondary — pump.fun is egress-blocked here, so treat these as approximate):**
roughly **1% on bonding-curve trades**, a creator revenue share around **0.05%** rising to
~0.95% in lower market-cap tiers post-graduation, and a graduation/migration cost historically
around **6 SOL** to seed the destination LP. Sources disagree on the exact decomposition (one
gives 0.30% of a 1.25% total), so **do not treat any single figure here as authoritative.** The
directionally reliable facts: launch is free, the curve fee is order-1%, creators get a small
share, and migration has a real cost. Their fee-sharing program splits across **up to 10
shareholders in bps summing to 10,000** **(source, `pump-fun-sdk` docs)**.

**Pons (source, `PonsV2LaunchFactory.sol`)** — guardrails rather than live values:

| Constant | Value |
|---|---|
| `MAX_CURVE_FEE_BPS` | 1_000 (10%) |
| `MAX_CREATOR_TAX_CEILING_BPS` | 1_000 (10%) |
| `MAX_TOTAL_TRADE_FEE_BPS` | 2_000 (20%) |
| `MAX_SNIPE_TAX_START_BPS` | 9_900 (99%) |
| `MAX_SNIPE_TAX_SECONDS` | 60 |
| `MAX_SNIPE_TAX_EXEMPTIONS` | 32 |
| `MIN_LAUNCH_SUPPLY` | 1 ether |

Graduation at **4.2 ETH** of curve value into a permanently locked full-range Uniswap v4 position
*(secondary)*. Creators collect **in the quote asset from the first trade**, not in token dust.

## 3. Four Pons patterns worth adopting

Pons V2 is the closest existing system to `design.md` — bonding curve in ETH, graduating to a
permanently locked Uniswap v4 position. Its contract layout
(`PonsV2BondingCurve`, `PonsV2GraduationGuard`, `PonsV2GraduationExecutor`, `PonsV2LaunchLocker`,
`hooks/PonsV2MemeHook`, `PonsV2BuybackVault`) maps almost one-to-one onto ours, and it has solved
three problems `design.md` left open.

### 3.1 Quote the curve in the asset the future pool will use

Pons: *"the curve trades in the same quote asset its future V4 pool will use,"* explicitly to
eliminate swap and oracle dependencies at graduation. **We already do this** — an ETH-quoted curve
graduating to an ETH-paired pool — but it was incidental rather than a stated invariant. It should
be stated, because it is the thing that keeps `GraduationManager` simple: no swap, no oracle, no
price reconciliation. Worth writing into §5.3 as a constraint, so nobody later "improves" the curve
by quoting it in USDC.

### 3.2 Two-phase, retryable graduation — better than my reentrancy warning

Pons splits graduation into `graduate` (drains reserves) then `createGraduatedPool` (seeds the
position), with retryability so *"reserves can never be stranded."*

This is a materially better answer than `design.md` §9.7, which just says to order state
transitions carefully before the v4 `unlock` callback. Careful ordering still leaves a single
atomic transaction that either wholly succeeds or wholly reverts — and if pool creation reverts for
an external reason (a v4-side failure, a tick problem, gas), a one-shot design either bricks or
traps reserves. Splitting the phases makes the failure recoverable by construction. **Adopt this**;
it supersedes §9.7's mitigation.

### 3.3 The hook converts fees to the quote asset in-pool

`PonsV2MemeHook` takes an `afterSwap` cut and *"converts memecoin-denominated fees back to the
quote currency against the pool's own liquidity, under a configurable max price-impact bound."*

This solves a problem `design.md` has and does not address: with N launched tokens, our treasury
accrues N kinds of token dust. §2.4 of the Clanker study noted the revenue side but not the
denomination problem. Converting at collection time, in-pool, bounded by max price impact, means
protocol revenue arrives in ETH regardless of how many tokens exist. The price-impact bound is the
part that makes it safe — an unbounded in-pool conversion is self-sandwiching.

### 3.4 A decaying snipe tax beats a per-block cap

`MAX_SNIPE_TAX_START_BPS = 9_900` decaying over `MAX_SNIPE_TAX_SECONDS = 60`, with up to 32
exemptions. A punitive tax on the first seconds of trading, decaying to normal.

`design.md` §9.4 proposed per-block buy caps or a brief trading delay for sniping. A decaying tax
is better on two counts: it does not block legitimate early buyers (they just pay more, and can
wait 60s), and it converts the MEV that would otherwise go to a bot into protocol/creator revenue.
The exemption list also gives a clean mechanism for a creator's own dev-buy to execute at par.
Note this applies at **launch**, not only at graduation — which matters more now that we may not
have a graduation event at all.

## 4. Recommendation

**Launch fee: 0.0005–0.001 ETH, configurable, framed explicitly as anti-spam.**

Match Pons rather than Clanker or pump.fun. A small non-zero fee is worth having for exactly the
reason §9.5 of `design.md` identifies — permissionless launch with *zero* cost means the moderation
burden is unbounded — and Pons demonstrates that a fee at this level does not suppress volume.
Make it a settable parameter (`setLaunchFee`), not a constant, so it can be tuned without a
redeploy. This closes open question 1.

**Real revenue: a swap-fee cut, converted to ETH at collection.**

- Curve phase: a total trade fee around **1%** (pump.fun's live level; well inside Pons's 20% cap),
  split protocol/creator.
- Post-graduation: a v4 hook `afterSwap` cut. Clanker's 20%-of-LP-fee is the reference point.
- All of it converted to the quote asset in-pool under a price-impact bound (§3.3).

**Hard caps in the contract from day one.** Pons's `MAX_*_BPS` guardrails are the right pattern:
the *live* values are configurable, but a ceiling is compiled in so no future admin key can raise
fees arbitrarily. Our `SOFBondingCurve` already has a `FeeTooHigh` error and a fee ceiling — extend
the same discipline to the launch curve and the hook.

### 4.1 Creator share — DECIDED: 85% creator / 15% platform

On the Epic Games Store model. This is the coherent counterpart to "no free dev allocations"
(`design.md` §5.1): creators are not granted tokens, so they earn from the volume they attract.

It also positions us slightly better than the market leader — Clanker is 80/20 — which makes it a
usable talking point rather than parity.

**A factual note on the reference, since it affects the talking points:** Epic's headline split is
**88/12** for the Epic Games Store, and Unreal Engine's royalty is a separate **5% after the first
$1M** of revenue. Neither is 15%. If the point is to invoke Epic's positioning, 88/12 matches the
reference exactly and still beats Clanker; if 85/15 is our own number, the Epic comparison should be
described as *the approach* (a headline creator-favourable split, loudly stated) rather than implying
we matched their rate. Worth settling before any copy ships, because "like Epic's 88%" invites a
correction that "we keep only 15%" does not.

### 4.2 Framing the split in copy

Two candidate framings, per the brief:

- **Platform-minimising:** "We only take 15%." Foregrounds our restraint; invites comparison to
  competitors' cuts. Epic used exactly this register.
- **Creator-maximising:** "You keep 85%." Foregrounds the creator's outcome; reads as a benefit
  rather than a concession.

General direction from pricing-psychology practice is that the gain framing ("you keep 85%")
outperforms the loss framing for the *recipient* of the benefit, while the platform-minimising
framing works better as *competitive* positioning aimed at people already comparing platforms. Those
are different audiences, and the answer plausibly differs between the `/launch` form (creator about
to act → "you keep 85%") and the marketing page (creator comparing options → "we only take 15%").
Using both, placed by audience, is defensible and probably better than picking one globally.

### 4.3 A/B testing this is not currently feasible — and why

**The repo has no analytics and no feature-flag library.** Verified: no PostHog, Mixpanel,
Amplitude, `@vercel/analytics`, `@vercel/flags`, GrowthBook, Statsig or LaunchDarkly in any
`package.json` or in `packages/frontend/src`. There is no event pipeline, so there is nothing to
measure a variant against.

What *is* already in place: all user-facing copy lives in `packages/frontend/public/locales/{lang}/*.json`,
so rendering two copy variants is trivial — two keys and a selector. **The missing half is
measurement, not rendering.**

To make it feasible, in order of cost:

1. **An event sink and a conversion metric.** Define the conversion first — almost certainly
   *launch form opened → launch transaction confirmed*. Without that number a test cannot conclude.
2. **A variant assignment that is stable per user.** Wallet address or FID hashed to a bucket,
   persisted, so a user does not see the copy flip between sessions.
3. **A flag mechanism.** Vercel's flags integration is the lowest-friction option given the frontend
   already deploys there.

Two practical cautions:

- **Nine locales.** Copy lives in `de/en/es/fr/it/ja/pt/ru/zh`. A copy A/B test either runs
  English-only (cleanest, and most launch traffic is likely English) or multiplies translation work
  by the number of variants. Run it English-only and apply the winner everywhere.
- **Launch volume has to be high enough to reach significance.** A framing difference on a
  conversion of this kind is a small effect; detecting it needs a large denominator. Until the
  launchpad has meaningful traffic, an A/B test will return noise. **Recommendation: ship one
  framing chosen on judgement (§4.2), instrument the conversion from day one, and revisit a
  test once there is volume to make it conclusive.** Instrumenting early is the part that
  matters — it is cheap now and impossible retroactively.

## 5. What I could not verify

`pump.fun`, `docs.ponsfamily.com`, `defillama.com`, `deepwiki.com`, `clanker.gitbook.io` and
`clanker.world` are all blocked by this environment's egress proxy. Everything marked **(source)**
came from `raw.githubusercontent.com`, which is reachable. Before committing to numbers:

1. Re-check pump.fun's current schedule against `pump.fun/docs/fees` directly — my figures there
   are secondary and internally inconsistent across sources.
2. Confirm Pons's live `launchFee` on-chain rather than trusting the 0.0005 ETH press figure; it is
   a settable parameter and may have changed.
3. Confirm the 4.2 ETH graduation threshold from `PonsV2BondingCurve.sol` or
   `PonsV2GraduationGuard.sol`.

## Sources

- [clanker-devco/v4-contracts](https://github.com/clanker-devco/v4-contracts) — fee constants **(source)**
- [ponsdotdev/pons-labs](https://github.com/ponsdotdev/pons-labs) — V2 factory constants and architecture **(source)**
- [nirholas/pump-fun-sdk — fee-sharing docs](https://github.com/nirholas/pump-fun-sdk/blob/main/docs/fee-sharing.md) **(source)**
- [pump.fun fee docs](https://pump.fun/docs/fees) · [froglabs explainer](https://froglabs.io/blog/pump-fun-fees-explained) · [soltokencreator explainer](https://www.soltokencreator.io/blog/pump-fun-fees-explained) — all blocked here
- [Pons V2 announcement](https://crypto.news/robinhood-chain-launchpad-pons-announces-v2-with-uniswap-v4-upgrade/) · [Pons V2 ETH bonding curve](https://en.cryptonomist.ch/2026/07/23/pons-v2-upgrade-eth-bonding-curve/) · [Pons 24h fees](https://www.kucoin.com/news/flash/pons-24-hour-fee-surpasses-5m-leads-launchpad-category) · [How Pons turned bonding curves into a fee machine](https://coinspress.com/bypassing-the-pool-how-pons-turned-bonding-curves-into-a-fee-machine/)
- [Clanker creator rewards & fees](https://clanker.gitbook.io/clanker-documentation/general/creator-rewards-and-fees) · [Clanker weekly fees](https://www.kucoin.com/news/articles/clanker-protocol-reaches-8-million-weekly-fee-milestone-as-ai-agent-social-trading-ignites-base)
