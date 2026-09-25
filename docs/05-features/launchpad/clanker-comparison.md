# Prior art: Clanker v4 — and what it changes for us

> Study of the dominant token launcher on Base, read against `design.md`.
> Findings are from the v4 contract source unless marked otherwise.

## 0. Link corrections

Two of the four links in the brief point at something other than what they appear to:

| Link given | What it actually is |
|---|---|
| `github.com/bgdnvk/clanker` — "Clanker CLI" | **Not the token launcher.** An unrelated AI DevOps CLI that inspects cloud infrastructure (AWS/GCP/Azure/k8s) and generates deployment plans. Pure name collision — no blockchain code. The real SDK is [`clanker-devco/clanker-sdk`](https://github.com/clanker-devco/clanker-sdk) (npm `clanker-sdk`), which ships its own CLI with `deploy`, `rewards claim`, `vault claim`, `airdrop`. |
| `clankercloud.ai/api-docs` — "Clanker Cloud" | Egress-blocked here, so **unverified**. But the DevOps CLI above documents `clanker cloud apps` for deploying HTML/app specs to "Clanker Cloud", so this is almost certainly that product, not token infrastructure. Worth confirming before relying on it. |

Also: `clanker.world`, `clanker.gitbook.io`, `blog.base.org` and `arxiv.org` are all blocked by this
environment's egress proxy. The contract findings below come from
`raw.githubusercontent.com/clanker-devco/v4-contracts`, which is reachable;
items sourced from search results rather than source are marked *(secondary)*.

## 1. Clanker v4 architecture

Canonical entry point — one call, fully permissionless:

```solidity
function deployToken(DeploymentConfig memory config) external payable returns (address token);

struct DeploymentConfig {
    TokenConfig       tokenConfig;      // admin, name, symbol, salt, image, metadata, context, originatingChainId
    PoolConfig        poolConfig;       // hook, pairedToken, tickIfToken0IsClanker, tickSpacing, poolData
    LockerConfig      lockerConfig;     // rewardAdmins[], rewardRecipients[], rewardBps[],
                                        // tickLower[], tickUpper[], positionBps[], lockerData
    MevModuleConfig   mevModuleConfig;  // mevModule, mevModuleData
    ExtensionConfig[] extensionConfigs; // extension, msgValue, extensionBps, extensionData
}
```

Constants from `Clanker.sol`:

| Constant | Value |
|---|---|
| `TOKEN_SUPPLY` | `100_000_000_000e18` — 100B, fixed, every token |
| `MAX_EXTENSIONS` | 10 |
| `MAX_EXTENSION_BPS` | 9_000 (90% of supply may go to extensions) |
| `BPS` | 10_000 |

Deploy flow: deploy token with full supply → compute extension allocations → initialize the
Uniswap v4 pool via the hook → place *remaining* supply as liquidity through the locker →
trigger each extension's `receiveTokens()` → initialize the MEV module.

**No deployment fee exists in the contract.** Clanker's revenue is a cut of swap fees (§1.2).

### 1.1 There is no bonding curve and no graduation

This is the headline difference from `design.md`. Clanker initializes a **standard Uniswap v4
pool at deploy time** and places the token as **single-sided liquidity across up to seven tick
bands** — the "liquidity staircase" *(secondary; structurally corroborated by `LockerConfig`'s
parallel `tickLower[]` / `tickUpper[]` / `positionBps[]` arrays)*. The deployer supplies tokens
only; buyers bring the quote asset.

Price still rises as buyers consume successive bands, so the *economic* shape resembles a
bonding curve — but there is no separate curve contract, no reserve accounting, no graduation
threshold and no migration event. The pool is the market from block one.

### 1.2 Fee model

From `ClankerHook.sol`:

| Constant | Value | Meaning |
|---|---|---|
| `FEE_DENOMINATOR` | 1_000_000 | |
| `MAX_LP_FEE` | 300_000 | LP fee capped at 30% |
| `PROTOCOL_FEE_NUMERATOR` | 200_000 | **Protocol takes 20% of the LP fee charged** |

Static-fee and dynamic-fee hook variants exist (`ClankerHookStaticFee`, `ClankerHookDynamicFee`,
plus `V2` versions). Fees accrue to `ClankerFeeLocker`; `ClankerLpLocker` splits LP rewards across
`rewardRecipients[]` by `rewardBps[]`, with `rewardAdmins[]` able to manage them.

### 1.3 Extensions — the pattern that matters most to us

`IClankerExtension` is a single hook, called during deployment:

```solidity
function receiveTokens(
    IClanker.DeploymentConfig calldata deploymentConfig,
    PoolKey memory poolKey,
    address token,
    uint256 extensionSupply,
    uint256 extensionIndex
) external payable;
```

Shipped extensions: **`ClankerVault`** (time-locked allocation), **`ClankerAirdrop`**,
**`ClankerUniv4EthDevBuy`** (buys from the pool during launch).

`ClankerVault` is worth copying details from: minimum **7-day lockup** enforced, then **linear
vesting** to a named admin between lockup-end and vest-end, one allocation per token, admin
transferable via `editAllocationAdmin()`, and only the factory may create an allocation.

Note the interface is **deploy-time only** — there are no lifecycle callbacks afterwards. An
extension can receive supply at launch and then must be driven by its own contracts.

### 1.4 MEV modules

`ClankerMevBlockDelay`, `ClankerSniperAuctionV0` / `V2`, and the dev-buy module all plug in via
`IClankerMevModule`. Anti-sniping is treated as a swappable module rather than baked into the hook.

### 1.5 Base mainnet addresses (v4.0/v4.1)

| Contract | Address |
|---|---|
| `Clanker` | `0xE85A59c628F7d27878ACeB4bf3b35733630083a9` |
| `ClankerFeeLocker` | `0xF3622742b1E446D92e45E22923Ef11C2fcD55D68` |
| `ClankerLpLocker` | `0x29d17C1A8D851d7d4cA97FAe97AcAdb398D9cCE0` |
| `ClankerVault` | `0x8E845EAd15737bF71904A30BdDD3aEE76d6ADF6C` |
| `ClankerAirdrop` | `0x56Fa0Da89eD94822e46734e736d34Cab72dF344F` |

Also deployed on Base Sepolia, Unichain and Arbitrum. Audits are in the repo's `audits/`.

---

## 2. What this changes in our design

### 2.1 The staircase is a serious alternative to curve + graduation

Adopting single-sided-liquidity-at-launch instead of an ETH-quoted curve with a graduation
threshold would delete a large fraction of `design.md`:

| Would disappear | Why |
|---|---|
| `LaunchCurve.sol` (§5.3) | The v4 pool is the market from block one |
| `GraduationManager.sol` (§5.4) | Nothing to migrate |
| `graduationThresholdWei`, `graduated`, `graduate()` | No terminal state |
| §9.3 graduation-mid-season | **Evaporates entirely** — the problem only exists because there is a migration event |
| §9.4 sniping at graduation | Becomes ordinary launch-time sniping, handled by a MEV module |
| §7.4 dual price source | One venue for a token's whole life; no handover |
| `requireGraduated` dial (§6.3) | Meaningless |

It also removes the LP-reserve supply bucket as a *separate* concept — under the staircase, the
"reserve" simply *is* the liquidity, placed at launch.

The cost: we lose the pre-graduation phase as a distinct, ETH-accumulating stage, and the
`design.md` framing of graduation as a milestone users anticipate. Whether that stage has product
value is a real question — pump.fun's graduation is a genuine engagement mechanic, and Clanker
deliberately does without it.

**This is now the largest open architectural decision in the launchpad.** It is not mine to make;
§1 of `design.md` records it as an open question.

### 2.2 `extensionBps` validates our supply-bucket pattern — and bounds it

Our three-bucket split (§5.2) is the same idea as `extensionBps`: reserve a share of supply at
deploy time for a purpose other than sale. Clanker permits up to **90%** across ten extensions,
which tells us our ~30% reserved is not unusual by launchpad standards. It does not make the
disclosure problem (§9.8) go away — Clanker tokens with large vault allocations attract exactly
the criticism §9.8 anticipates — but it does mean the mechanism is well-trodden.

### 2.3 `ClankerVault`'s 7-day-minimum-lockup-plus-linear-vest is a good template

Our dev-buy escrow (§5.1) currently says "locked until graduation and season settlement". Clanker's
shape — a hard minimum lockup, then linear vesting, with a transferable admin — is more legible to
users and is already audited. Worth copying, particularly the idea that the lock has a *floor* in
wall-clock time rather than being purely event-driven.

### 2.4 Their fee model challenges our flat launch fee

We planned a flat ETH launch fee (§1, open question 1). Clanker charges **nothing to deploy** and
takes 20% of LP fees instead. That is strictly better on two counts: no upfront friction on the
action we most want people to take, and revenue that scales with a token's success rather than
with the number of tokens created — which also removes the incentive to farm launches. Against it:
no economic spam filter at all, so the moderation burden (§7.3) rises.

Recommend revisiting open question 1 in that light: a near-zero launch fee for spam resistance
plus a swap-fee cut for actual revenue.

### 2.5 Their MEV modules are an off-the-shelf shape for §9.4

If we keep graduation, `ClankerSniperAuctionV0/V2` and `ClankerMevBlockDelay` are worth reading
before writing our own hook — a sniper auction that *sells* the first-block advantage is a more
interesting answer than a per-block cap.

---

## 3. The strategic fork: build, or build on top

Worth deciding explicitly rather than by default.

**Option A — build our own launch layer** (what `design.md` currently specifies). Full control of
curve shape, supply split, fee routing, and the token contract. Cost: `LaunchToken`, `LaunchCurve`,
`TokenLaunchpad`, `GraduationManager`, the v4 integration and its audit — the bulk of Phases 1–3.

**Option B — deploy tokens *through* Clanker, and build only the raffle layer.** Call
`Clanker.deployToken()` with a `SecondOrderRaffleExtension` in `extensionConfigs` that receives our
reserved bps at launch. We would inherit audited contracts, the v4 pool, locked LP, fee splitting
(list ourselves in `rewardRecipients[]`), vault/vesting, dev-buy and MEV protection — and Clanker's
distribution, which for a Farcaster-native product is not a small thing. We would give up control
of the token contract and the launch curve, take a dependency on their fee schedule and upgrade
path, and inherit their 100B fixed supply.

**Option C — hybrid.** Our own launch layer, but adopt their patterns: staircase liquidity,
deploy-time extension supply, vault-style lockups, swap-fee revenue instead of launch fees.

**My read:** the raffle layer is the differentiator; the launch layer is commodity infrastructure
that Clanker has already audited and distributed. Option B deserves a serious spike — specifically,
whether a deploy-time-only extension hook is sufficient to reserve supply for a raffle that starts
later (it probably is: receive supply at launch, hold it, and let our own `SeasonCreationStake` and
ticket curve drive everything after). If that spike passes, Option B removes most of Phases 1–3.

Option C is the safe fallback and is strictly better than Option A as currently written.

What would push against Option B: needing a quote asset other than what Clanker supports, needing
a supply other than 100B, or wanting the raffle to be inseparable from the launch rather than an
extension of it.

### 3.1 Does the commodity infrastructure exist on Robinhood Chain?

**Yes — Clanker itself is there.** Clanker has been live on Robinhood Chain since **2026-07-08**, a
week after Robinhood Chain's mainnet went live on 1 July 2026, and its fee data shows it active
across Base, Arbitrum, Unichain, Ethereum, Monad and Robinhood *(secondary — DefiLlama adapter PR
and coverage)*. Note this is *not* the "Arbitrum" entry in the v4-contracts README's address list,
which is Arbitrum One; Robinhood Chain is a separate Arbitrum Orbit L2. **Verify the Robinhood Chain
factory address on-chain before relying on it.**

That materially strengthens Option B: the integration is **portable across both chains we might
care about**, so choosing Clanker is not a bet on Base.

Context on why the question matters: Robinhood Chain is an Arbitrum Orbit L2, mainnet 1 July 2026,
permissionless (no partner status needed to deploy). Uniswap shipped v2/v3/v4 and UniswapX on day
one and v4 took ~73% of DEX liquidity for tokenized stocks. Robinhood Chain platforms captured
**almost 70% of all crypto launchpad fees on 31 August** *(The Defiant, secondary)* — the launchpad
centre of gravity has moved off Base. Competitors there: Pons, Flap, hood.fun, NOXA Fun, Bankr,
Virtuals, Clanker — and **Uniswap's own Pools.trade**, which out-launched Pons on its first day.

An important distinction: Pons is a *product*, not infrastructure. Its factory
(`PonsV2LaunchFactory.launchToken`) takes a `launchConfigId` and a `pairToken` but exposes **no
extension interface** — there is no equivalent of `IClankerExtension` to plug a raffle into.
Clanker's extension system is the unusual thing here, and it is the only reason Option B is
available at all.

### 3.2 What Option B costs in revenue

Clanker takes **20% of the LP fee off the top**; the remaining 80% is split across
`rewardRecipients[]` by `rewardBps[]`, where we would list ourselves alongside the creator. With the
85/15 creator/platform split decided in [`fee-benchmarks.md`](fee-benchmarks.md) §4.1, applied to
the portion we control:

| | Creator | Us | Clanker |
|---|---|---|---|
| **Own infrastructure** | 85% | **15%** | — |
| **On Clanker, our 15% preserved** | 65% | 15% | 20% |
| **On Clanker, creator's 85% preserved** | 85% | **12%** | 20% |

So the rent is **either 3 percentage points of gross swap fees (a 20% haircut on our own revenue),
or 20 points off the creator's share — which breaks the "you keep 85%" headline.** Those are the
only two options; the 20% comes off the top either way. If the 85% promise is load-bearing
positioning, Option B costs us 12% instead of 15% of gross, and that is the real number.

**But this only applies to the launch/trading layer.** Clanker takes nothing from the ticket curve,
the raffle, or InfoFi — those are our contracts and our fees entirely. So the decision hinges on
expected revenue mix:

- If most revenue comes from **token swap fees**, the 20% rent is significant and Option A or C
  looks better.
- If most comes from the **raffle and InfoFi layers**, the rent applies to a minority of revenue and
  buying audited contracts, LP locking, MEV protection, multi-chain reach and Clanker's distribution
  for 3 points of gross is cheap.

Given that launchpad swap volume dwarfs anything our raffle layer will do early on, the honest
reading is that the rent is **large in year one and shrinking thereafter** as the raffle layer
grows. That argues for Option C — our own launch layer, built with Pons's and Clanker's patterns —
if we can afford the build, and Option B if time-to-market matters more than the 3 points.

One further consideration that is not about money: on Clanker, **we do not control the token
contract**, so any raffle-specific behaviour has to live outside it, and Clanker's 100B fixed supply
and upgrade path become constraints we cannot change.

---

## 4. Base MCP — not what the brief implies

`blog.base.org` is blocked here, so this is from search results *(secondary)*.

Base MCP is an MCP server exposing onchain tools to an LLM: wallet addresses and balances,
transfers, contract deployment and calls, ERC-20 management, Morpho vault interaction, and
Coinbase onramp. It is non-custodial — it never holds keys, and transactions require user sign-off.

Two things to know:

- **The `base-mcp` npm package is deprecated.** Do not `npx base-mcp`. It is superseded by the MCP
  server bundled with `@coinbase/cdp-cli`.
- **It is an operator tool, not product infrastructure.** It would let *us* drive Base from Claude
  Code — deploy to testnet, poke contracts, check balances during development — and it could
  underpin an agent-facing launch path later. It does not belong anywhere in the runtime design of
  the app, and nothing in `design.md` should depend on it.

Useful for the dev loop, especially Phase 0–1 testnet work. Not an architectural input.

---

## Sources

- [clanker-devco/v4-contracts](https://github.com/clanker-devco/v4-contracts) — primary source for §1
- [clanker-devco/clanker-sdk](https://github.com/clanker-devco/clanker-sdk) · [npm `clanker-sdk`](https://www.npmjs.com/package/clanker-sdk)
- [Clanker documentation (GitBook)](https://clanker.gitbook.io/clanker-documentation/references/core-contracts/v4) — blocked here
- [Introducing Clanker v4](https://paragraph.com/@dish/introducing-clanker-v4) · [Clanker v4 on Bankless](https://www.bankless.com/read/clanker-v4-token-creator) · [PoolFans guide](https://pool.fans/clank)
- [github.com/bgdnvk/clanker](https://github.com/bgdnvk/clanker) — the unrelated DevOps CLI
- [Robinhood Chain mainnet (Arbitrum)](https://blog.arbitrum.io/robinhood-chain-mainnet/) · [Uniswap live on Robinhood Chain](https://blog.uniswap.org/robinhood-chain-is-live) · [Clanker Robinhood Chain adapter PR](https://github.com/DefiLlama/dimension-adapters/pull/9232) · [Pools.trade out-launches Pons](https://thedefiant.io/news/defi/uniswaps-new-launchpad-out-launched-pons-on-its-first-day-on-robinhood-chain) · [Robinhood Chain launchpad fee boom](https://www.mexc.com/learn/article/pons-long-and-the-robinhood-chain-launchpad-boom-where-the-fees-are-coming-from/1)
- [Base MCP catalog entry](https://archestra.ai/mcp-catalog/base__base-mcp) · [CDP for Agents](https://docs.cdp.coinbase.com/get-started/build-with-ai/cdp-for-agents) · [coverage](https://cryptobriefing.com/base-mcp-ai-agents-wallets-tokens/)
