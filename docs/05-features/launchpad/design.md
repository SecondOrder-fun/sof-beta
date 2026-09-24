# Token Launchpad — Design

> **Status: design / brainstorm.** Nothing below is built. This document exists to
> pin down scope, sequencing, and the decisions that have to be made before code.

## 1. The new user journey

The launchpad inverts the platform's denomination model. Today there is one
protocol currency (`$SOF`) and seasons are created by admins. The target:

```
  ① LAUNCH                ② TRADE                 ③ GRADUATE              ④ RAFFLE
  ─────────               ────────                ───────────             ─────────
  Anyone deploys a        Anyone buys/sells       Curve reserves hit      Any holder with
  token. Pays gas +       on an ETH-quoted        a threshold →           enough stake opens
  a flat launch fee.      bonding curve.          LP seeded on            a raffle season.
  Optional dev-buy,       Price discovery         Uniswap v4 (Base),      TICKETS ARE PRICED
  escrowed as stake.      pre-market.             LP locked, curve        IN THE LAUNCHED
                                                  retires.                TOKEN.
```

Step ④ is the SecondOrder thesis applied to the launchpad: a launched token
acquires a *finite game* on top of it. Step ① is the part being built now.

### Decisions locked in

| Decision | Choice |
|---|---|
| What launches | Persistent ERC-20 on an ETH-quoted bonding curve (pump.fun shape) |
| Who can launch | Fully permissionless — gas + flat fee, no allowlist, no hat |
| Graduation venue | Uniswap v4 on Base |
| Raffle denomination | The launched token, **not** `$SOF` |
| Raffle creation rights | Stake-gated in the launched token, permissionless otherwise |
| `$SOF` | Scrapped as the protocol currency |

### Open questions that block implementation

1. **Launch fee asset and size.** ETH is the only sane answer once `$SOF` is gone.
   Flat (e.g. 0.001 ETH) or a share of the dev-buy?
2. **Is the dev-buy mandatory?** The stated goal — "guarantees a major buy of the
   new token by the dev" — implies a minimum. Mandatory-minimum changes the
   contract shape (launch reverts below it) versus optional-but-incentivised.
3. **Can a raffle open before graduation?** §9 argues strongly for *no*. Needs a ruling.
4. **InfoFi collateral** for a season on token X: token X, or ETH/USDC? Coherent
   versus liquid — §6.4.
5. **Does `$SOF` get deleted or grandfathered?** §3 recommends grandfathering.

---

## 2. What already exists (and is closer than it looks)

Four pieces of the launchpad are already in the repo:

| Existing | Relevance |
|---|---|
| `SOFBondingCurve.sol` | **Already generic over its quote token.** `sofToken` is an `immutable IERC20` set in the constructor — the name is the only thing tying it to `$SOF`. Step-pricing, fees, slippage, permit path, treasury extraction all work against an arbitrary ERC-20. |
| `SeasonFactory.createSeasonContracts()` | Already deploys `RaffleToken` + `SOFBondingCurve` per season. That *is* a token-launch primitive, just admin-triggered and hardwired to `IRaffle.sofToken()`. |
| `Raffle.canCreateSeason()` | Already a two-path authorization check (`SEASON_CREATOR_ROLE` or Hats sponsor hat). `SeasonConfig.sponsor` is even commented *"creator in permissionless mode"*. |
| `ConditionalTokenSOF.sol` | Despite the name, every function already takes `collateralToken` as a parameter. Multi-collateral InfoFi is a rename, not a rewrite. |

The heavy lift is **not** the bonding curve. It is (a) threading a per-season quote
token through ~10 contracts, the backend and the UI, and (b) the Uniswap v4
graduation path, which is genuinely new.

---

## 3. The denomination shift — biggest risk item

Scrapping `$SOF` touches far more than the launchpad. Current coupling:

| File | Coupling | Disposition |
|---|---|---|
| `curve/SOFBondingCurve.sol` | `immutable sofToken` (6 call sites) | **Rename** to `quoteToken`. No logic change. |
| `core/Raffle.sol` | `immutable sofToken`, passed to distributor | Remove; quote token moves to `SeasonConfig`. |
| `core/SeasonFactory.sol` | reads `IRaffle(raffle).sofToken()` | Take `quoteToken` as a parameter. |
| `lib/IRaffle.sol` | `sofToken()` in the interface | Remove or keep as a deprecated alias for one release. |
| `core/RolloverEscrow.sol` | `immutable sofToken`, treasury bonus | Per-token escrow; rollover only *within* a token (§6.5). |
| `infofi/InfoFiMarketFactory.sol` | `immutable sofToken`, treasury-funded seed liquidity (9 call sites) | Per-season collateral (§6.4). Most invasive InfoFi change. |
| `infofi/ConditionalTokenSOF.sol` | name only | Rename `ConditionalTokenERC20`. |
| `exchange/SOFExchange.sol` | mints `$SOF` for ETH/USDC | Retire — there is nothing to mint. |
| `faucet/SOFFaucet.sol` | dispenses `$SOF` | Repoint at a testnet mock quote token, or retire. |
| `token/SOFToken.sol` | the token itself | Becomes a legacy deployment (see below). |
| `paymaster/SOFPaymaster.sol` | allowlists *SOF curve* targets | Registry-driven allowlist (§6.6). Gas is ETH — no token coupling. |
| `sponsor/SponsorOnboarding.sol` | stake `$SOF` → Hats sponsor hat | Superseded by `SeasonCreationStake` (§5.6). |

Frontend: 96 files mention SOF; 15 reference the token/balance directly
(`useSOFBalance`, `useSOFToken`, `useFormatSOF`, `GetSof.jsx`). Backend:
`curveRoutes`, `tradeListener`, `sofTransactionsService`, `seasonRoutes` all
assume a single global currency.

### Recommendation: generalize, don't delete

A hard delete of `$SOF` orphans every deployed testnet season and forces a
big-bang migration across three packages. The cheaper path with the same product
outcome:

> **Stop special-casing `$SOF`. Treat it as one quote token among many —
> a grandfathered, non-launchpad one.**

The code changes are identical (`sofToken` → `quoteToken` everywhere), existing
seasons keep working, `SOFToken.sol` stays deployed but stops being minted or
referenced by new code, and `SOFExchange`/`SOFFaucet` can be retired on their own
schedule. "Scrapping `$SOF`" then becomes a *product* decision (no new utility, no
buyback, not the denomination of anything new) rather than a migration cliff.

This is a recommendation, not a blocker — if you want it gone from the codebase
entirely, that's Phase 5 in §10 and it should still come *after* generalization.

---

## 4. Contract architecture

```
                         ┌────────────────────────┐
     ETH ───launch fee──▶│    TokenLaunchpad      │  registry + fees + factory
                         └───────────┬────────────┘
                     deploys         │         deploys
             ┌───────────────────────┴──────────────────────┐
             ▼                                              ▼
      ┌─────────────┐   mint/burn   ┌──────────────────────────┐
      │ LaunchToken │◀─────────────▶│  LaunchCurve  (ETH-quoted)│
      └──────┬──────┘               └────────────┬─────────────┘
             │                          threshold│reached
             │                                   ▼
             │                    ┌──────────────────────────┐
             │                    │   GraduationManager      │
             │                    │  PoolManager.initialize  │
             │                    │  + full-range LP + lock  │
             │                    └──────────────────────────┘
             │                                   │
             │  stake to earn season rights      ▼
             ▼                          Uniswap v4 pool (Base)
   ┌─────────────────────┐
   │ SeasonCreationStake │──authorizes──▶ Raffle.createSeason(quoteToken = LaunchToken)
   └─────────────────────┘                          │
                                                    ▼
                                    SeasonFactory ──▶ RaffleToken (tickets, 0 dp)
                                                  └─▶ SOFBondingCurve
                                                       (quoteToken = LaunchToken)
```

The existing raffle/InfoFi stack hangs off the bottom of this diagram unchanged
in *shape* — only its currency becomes a parameter.

---

## 5. New contracts

### 5.1 `launchpad/TokenLaunchpad.sol`

Factory, registry, fee sink. One deployment, N launches.

```solidity
function launch(LaunchParams calldata p) external payable
    returns (address token, address curve);

struct LaunchParams {
    string  name;
    string  symbol;
    string  metadataURI;      // image/description/socials — off-chain, see §7.3
    uint256 devBuyWei;        // msg.value - launchFee, bought atomically at curve bottom
    bytes32 salt;             // optional vanity / deterministic address
}
```

- Reverts if `msg.value < launchFee + minDevBuy`.
- Deploys `LaunchToken` + `LaunchCurve` via CREATE2 (deterministic addresses let
  the UI show the token page before the tx confirms).
- Executes the dev-buy against the fresh curve **in the same transaction**, then
  deposits the resulting tokens into `SeasonCreationStake` on the creator's behalf,
  locked until graduation (§9.1).
- Emits `TokenLaunched(token, curve, creator, name, symbol, metadataURI, devBuyWei)`
  — the single event the indexer keys off.
- Guards: symbol/name length caps, reserved-symbol denylist, per-block launch cap.

### 5.2 `launchpad/LaunchToken.sol`

ERC-20 + ERC-2612 permit, 18 decimals, fixed max supply (e.g. 1 000 000 000).
`MINTER_ROLE` held solely by its `LaunchCurve`; renounced at graduation so supply
is provably fixed afterwards. Deliberately *not* `AccessControl`-heavy — a launched
token should have as little owner surface as possible, because the owner is an
anonymous creator.

### 5.3 `launchpad/LaunchCurve.sol`

ETH-quoted discrete bonding curve. Distinct from `SOFBondingCurve` because it
needs native-ETH accounting, a graduation threshold and terminal state, and has
no raffle/season hooks. Shares the pricing math (§5.5).

```
buy(minTokensOut)      payable  — ETH in, tokens minted
sell(amount, minEthOut)         — tokens burned, ETH out
graduate()                      — permissionless once threshold met; one-way
```

State: `reserves`, `totalSupply`, `currentStep`, `buyFeeBps`, `sellFeeBps`,
`graduationThresholdWei`, `graduated`. Once `graduated`, buy/sell revert
permanently — the v4 pool is the market from then on.

Reserved supply (the portion never sold on the curve, e.g. 20%) is minted at
graduation and paired with reserves as LP.

### 5.4 `launchpad/GraduationManager.sol`

Isolated so the DEX venue is swappable and the curve stays auditable.

Uniswap v4 specifics that shape this contract:
- v4 is a **singleton `PoolManager`**; pools are identified by a `PoolKey`
  (`currency0`, `currency1`, `fee`, `tickSpacing`, `hooks`). `Currency` wraps an
  address with `address(0)` meaning native ETH — so an ETH/token pool needs no WETH.
- Liquidity is added through the periphery `PositionManager` via an encoded action
  sequence, or directly inside a `PoolManager.unlock` callback (flash accounting).
  The callback path means **reentrancy discipline matters** — `graduate()` must
  complete all state transitions before unlocking.
- **Do not hardcode addresses.** `PoolManager` / `PositionManager` addresses for
  Base and Base Sepolia go in `packages/contracts/deployments/{network}.json`
  alongside everything else, sourced from Uniswap's published deployments at
  implementation time.
- New Foundry dependencies: `v4-core` and `v4-periphery` (neither is in
  `packages/contracts/lib/` today — remappings need updating).

Flow: `initialize(poolKey, sqrtPriceX96)` at the curve's final price → mint a
full-range position with all reserves + reserved supply → **lock or burn the LP
position** so the creator can't pull it → emit `Graduated(token, poolId, ethIn, tokensIn)`.

### 5.5 `lib/BondingMath.sol`

Extract the step-pricing math currently inline in `SOFBondingCurve.sol`
(`calculateBuyPrice` / `calculateSellPrice` / step walking) into a pure library
used by both curves. Prevents the two curves drifting apart and gives the math a
single fuzz/invariant test target.

### 5.6 `launchpad/SeasonCreationStake.sol`

Replaces the `$SOF` + Hats path with per-token stake.

```solidity
mapping(address token => mapping(address account => Stake)) public stakes;
struct Stake { uint256 amount; uint64 lockedUntil; uint32 activeSeasons; }

function stake(address token, uint256 amount) external;
function unstake(address token, uint256 amount) external;   // blocked while activeSeasons > 0
function canCreateSeason(address token, address account) external view returns (bool);
function onSeasonCreated(address token, address creator) external;   // Raffle-only
function onSeasonSettled(address token, address creator) external;   // Raffle-only
```

Threshold as a **percentage of circulating supply** (e.g. 1%) rather than an
absolute, so it scales with the token and can't be trivially met on a large-cap
launch or made impossible on a small one.

This is where the creator's escrowed dev-buy lands, satisfying both goals from
the brief: the dev must buy meaningfully to launch, and any other holder can reach
the same threshold and open their own season.

**Note:** Hats `StakingEligibility` is one module per hat per token — it does not
generalize to N launch tokens without N hat trees. That's why this is a purpose-built
contract rather than an extension of `SponsorOnboarding.sol`.

### 5.7 `launchpad/UniV4LaunchHook.sol` — optional, Phase 2+

A v4 hook can enforce anti-sniping (per-block buy caps for the first N blocks
post-graduation) and route a slice of swap fees to the treasury — replacing the
`$SOF` fee-capture story with an ETH one. Cost: hook permissions are encoded in
the **low bits of the hook's address**, so deployment requires CREATE2 salt mining,
and the hook is in the path of every swap forever. Ship graduation without a hook
first; add it only if the fee capture justifies the risk.

---

## 6. Changes to existing contracts

### 6.1 `lib/RaffleTypes.sol`

```solidity
struct SeasonConfig {
    ...
    address quoteToken;   // NEW — the ERC-20 that prices tickets
}
```

### 6.2 `curve/SOFBondingCurve.sol`

Mechanical: `sofToken` → `quoteToken` (6 sites). Keep `function sofToken() external view returns (IERC20)`
as a deprecated alias for one release so the exported ABI doesn't break the frontend
in the same PR. Everything else — `initializeCurve`, fees, `PositionUpdate`, permit
fallback — is unchanged.

One real check: the permit path calls `IERC20Permit(quoteToken).permit(...)` in a
`try`. Launch tokens will support permit (§5.2) but arbitrary quote tokens might
not — the existing `try/catch` already degrades to approve, so this is safe. Verify
the test covers a non-permit quote token.

### 6.3 `core/Raffle.sol` + `core/SeasonFactory.sol`

- Drop `immutable sofToken`; read `seasons[id].quoteToken` instead.
- `canCreateSeason(address account)` → `canCreateSeason(address account, address quoteToken)`,
  consulting `SeasonCreationStake` first, then the existing role/hat paths (so
  platform-run seasons still work).
- `SeasonFactory.createSeasonContracts(...)` takes `quoteToken` and passes it to
  `new SOFBondingCurve(quoteToken, msg.sender)` instead of `IRaffle(raffle).sofToken()`.
- `_createSeasonInternal` validates `quoteToken != address(0)` and — if the
  graduation gate is adopted (§9.2) — that the token is registered in
  `TokenLaunchpad` and `graduated == true`.
- `registerCurve` already exists for paymaster validation; it now registers
  many curves across many tokens (§6.6).

### 6.4 InfoFi

`InfoFiMarketFactory.sol` is the most invasive piece. It holds `immutable sofToken`
and seeds every market with `INITIAL_LIQUIDITY` pulled from a treasury balance in
that one token (9 call sites). Multi-token means:

- Collateral resolved per market from `Raffle.seasons[seasonId].quoteToken`.
- Seed liquidity must exist **in that token**. The treasury will not hold every
  launch token. Options:
  - **(a) Creator-funded seed** — the season creator posts seed liquidity at
    season creation, out of their stake. Coherent with the launch model.
  - **(b) ETH/USDC collateral** — markets stay liquid and the treasury can seed
    them, at the cost of breaking the "everything is denominated in the token" story.
  - **(c) No InfoFi on launched tokens in v1** — ship the launchpad, keep InfoFi
    on grandfathered seasons only.

  Recommendation: **(c) for v1, (a) for v2.** InfoFi multi-collateral is a whole
  workstream and it is not on the critical path for the journey in §1.
- `ConditionalTokenSOF.sol` → `ConditionalTokenERC20.sol` (rename only).
- `MarketTypeRegistry` / `InfoFiPriceOracle` / `InfoFiSettlement` are
  probability-domain and currency-agnostic — no change expected, verify.

### 6.5 `core/RolloverEscrow.sol`

Currently escrows `$SOF` between seasons with a treasury-funded bonus. Per-token:
rollover is only meaningful **within the same launch token** (season N → N+1 on
token X). Cross-token rollover would require a swap and is out of scope. The
treasury bonus also has to be re-thought — the treasury holds ETH, not token X,
so either the bonus comes from the creator's allocation or rollover ships without
a bonus initially.

### 6.6 `paymaster/SOFPaymaster.sol`

Today it allowlists targets that are "registered as a SOF curve". With N launch
curves + N ticket curves the static allowlist doesn't scale. Make the check
registry-driven: `TokenLaunchpad.isLaunchCurve(target) || Raffle.isRegisteredCurve(target)`.

Sponsoring gas for *permissionless* launches is an abuse vector — anyone can spam
launches on the protocol's dime. Recommend: **launches are not sponsored** (creator
pays gas + fee, as specified); only trading and raffle actions are.

---

## 7. Backend changes

### 7.1 New routes — `packages/backend/fastify/routes/launchpadRoutes.js`

| Endpoint | Purpose |
|---|---|
| `GET /api/launchpad/tokens` | Discovery feed — filter/sort by new, volume, market cap, graduating soon |
| `GET /api/launchpad/tokens/:address` | Token detail: metadata, curve state, holders, trades, seasons |
| `GET /api/launchpad/tokens/:address/trades` | Trade history for the chart |
| `GET /api/launchpad/tokens/:address/seasons` | Raffle seasons on this token |
| `POST /api/launchpad/metadata` | Pre-upload image/description, returns the `metadataURI` used in `launch()` |
| `GET /api/launchpad/creators/:address` | Creator track record — launches, graduation rate |

### 7.2 New listeners — `packages/backend/src/listeners/`

- `tokenLaunchedListener.js` — `TokenLaunched` → `token_launches` row
- `launchTradeListener.js` — curve buys/sells → `launch_trades`, price points, SSE
- `graduationListener.js` — `Graduated` → flip status, record pool id
- `seasonStakeListener.js` — stake/unstake → eligibility cache

Every existing listener that assumes one currency needs a token dimension:
`tradeListener.js`, `positionUpdateListener.js`, `seasonStartedListener.js`.

### 7.3 Metadata and moderation

Permissionless launch means **user-supplied name, symbol, image and description**.
This is new attack surface the platform has never had:

- Storage: Supabase Storage bucket (simplest, matches existing infra) or IPFS.
  Server-side validation — dimensions, size cap, MIME sniffing, re-encode to strip
  payloads.
- Impersonation: near-duplicate symbol detection at index time; a `verified` flag;
  a report/hide path in the admin panel (`adminRoutes.js` already has the shape).
- The feed must be able to hide a token without touching the chain.

### 7.4 Pricing

Pre-graduation price comes from the curve step; post-graduation from the v4 pool.
`launchPriceService.js` needs both paths and a clean handover at graduation.
The existing `pricingStream`/SSE plumbing (`sseChannelService.js`, `usePricingStream`)
can carry it — add a `launch:{address}` channel.

---

## 8. Frontend changes

### 8.1 New routes

| Route | Component | Content |
|---|---|---|
| `/launch` | `LaunchTokenPage.jsx` | Creation form: name, symbol, image, description, socials, dev-buy slider. Live fee + "you will own X%" preview. Single batched tx. |
| `/tokens` | `TokenExplorer.jsx` | Discovery grid. Sort: new / volume / graduating soon / graduated. Search. The main viral surface — this page is the product. |
| `/tokens/:address` | `TokenDetailPage.jsx` | Price chart, buy/sell panel, **graduation progress bar**, holders, trade feed, seasons on this token, creator card. |
| `/tokens/:address/create-season` | `CreateTokenSeasonPage.jsx` | Stake check + season config. Largely a reskin of the existing `CreateSeasonPage.jsx`. |

`CreateSeasonPage.jsx` stays as the admin/platform path.

### 8.2 Modified components

The deepest UI change is that **"the currency" stops being a constant**:

- `hooks/useSOFBalance.js` → `useQuoteBalance(tokenAddress)`
- `hooks/buysell/useFormatSOF.js` → `useFormatQuote(tokenAddress)` — reads
  `symbol`/`decimals` from the season's quote token
- `hooks/buysell/computeBuySplit.js`, `useBalanceValidation.js`,
  `usePriceEstimation.js` — all assume 18-decimal `$SOF`. Must take decimals as
  input. **Watch the 18-dp quote / 0-dp ticket asymmetry** — that math is already
  delicate and this doubles the number of decimal pairs it has to survive.
- `components/buysell/BuyForm.jsx` / `SellForm.jsx` — label from the quote token,
  not hardcoded "SOF"
- `routes/RaffleList.jsx` / `RaffleDetails.jsx` — show which token denominates each season
- `routes/GetSof.jsx` — retire, or repurpose as "get ETH on Base"
- `Header.jsx` / `MobileHeader.jsx` balance widget — contextual to the page's token,
  or show ETH
- `BottomNav.jsx` / `Header.jsx` — add **Launch**; it should be a primary nav item

### 8.3 Transactions

All new on-chain actions go through `useSmartTransactions.executeBatch` per the
repo rule — never raw `writeContractAsync`. Natural batches:

- **Launch**: `launch{value: fee + devBuy}` — one call, one confirmation
- **Buy on curve**: native ETH, no approval needed — one call
- **Create season**: `approve(stake)` + `stake()` + `createSeason()` — three calls,
  one confirmation; ideal batch case
- **Buy tickets**: `permit(quoteToken)` + `buyTickets()` — the existing Tier-2 path,
  now against the launch token

New hooks: `useTokenLaunch`, `useLaunchCurve`, `useLaunchCurveEvents`,
`useGraduationProgress`, `useSeasonStake`.

---

## 9. Risks and attack surface

Permissionless launch is a materially different threat model than admin-created
seasons. The ones that need a design answer, not just a note:

**9.1 Dev rug via the dev-buy.** Creator buys the bottom of their own curve, promotes,
dumps into buyers. Mitigation: the dev-buy is escrowed in `SeasonCreationStake` and
locked until graduation (and optionally vested after). This is why the dev-buy and
the season stake are the *same deposit* — it makes the anti-rug lock and the
season-rights stake mutually reinforcing rather than two separate asks.

**9.2 Raffle-before-graduation rug.** Worse than 9.1. A creator launches, buys,
opens a raffle that locks other holders' tokens into the ticket curve, and dumps
into the illiquid pre-graduation curve while their tokens are locked. Mitigation:
**gate season creation on `graduated == true`.** Post-graduation there is a real
DEX market and a public price, and the creator's own allocation is unlocked and
therefore at risk alongside everyone else's. Recommended as a hard requirement,
not a flag.

**9.3 Sniping at graduation.** MEV bots buy the first block of the new v4 pool.
Mitigation: the optional hook (§5.7) with per-block caps, or a brief post-graduation
trading delay. Acceptable to ship without and monitor.

**9.4 Spam and impersonation.** Flat fee + gas is the only economic filter.
Needs the moderation path in §7.3 to exist *before* launch day, not after.

**9.5 Reflexive lock/unlock around seasons.** Ticket purchases sink the launch token
into the ticket curve, shrinking float and lifting price; settlement releases it.
This is the intended mechanism — but it should be **shown in the UI** (a "% of
supply locked in seasons" figure on the token page), because a large season on a
small token will move the price visibly and users will otherwise read it as
manipulation.

**9.6 Graduation reentrancy.** The v4 `unlock` callback hands control back to
`GraduationManager`. All curve state transitions (`graduated = true`, trading
disabled) must be committed *before* the unlock call.

**9.7 Regulatory.** Permissionless token issuance combined with raffles on those
tokens is a different posture than an admin-run raffle in a protocol token. Flagged,
not assessed — this needs counsel, not a design doc.

---

## 10. Suggested sequencing

Each phase should land green (`npm test`, `npm run lint`, `npm run build`, `forge test`)
on its own.

| Phase | Scope | Why here |
|---|---|---|
| **0 — Generalize the quote token** | `sofToken` → `quoteToken` across contracts/backend/frontend. `quoteToken` in `SeasonConfig`. No new features; existing seasons still work with `$SOF` as the quote token. | Isolates a large mechanical refactor from new logic. Everything after is additive. |
| **1 — Launch + curve** | `LaunchToken`, `LaunchCurve`, `TokenLaunchpad`, `BondingMath`. No graduation. UI: `/launch`, `/tokens`, `/tokens/:address`. Backend: launch + trade listeners, discovery feed, metadata pipeline. | The deliverable actually asked for. Shippable and demoable without v4. |
| **2 — Graduation** | `GraduationManager`, v4 deps + remappings, Base addresses in `deployments/*.json`, LP lock. Graduation progress UI. | Self-contained; the highest-risk external integration gets its own audit surface. |
| **3 — Raffles on launched tokens** | `SeasonCreationStake`, `canCreateSeason(account, token)`, graduation gate, `/tokens/:address/create-season`. Ticket curve runs against the launch token. | Closes the §1 journey. Depends on 0 + 2. |
| **4 — InfoFi multi-collateral** | Per-season collateral, `ConditionalTokenERC20` rename, seed-liquidity model. | Deliberately last — see §6.4(c). |
| **5 — Retire `$SOF` surfaces** | `SOFExchange`, `SOFFaucet`, buyback/fee-capture docs, tokenomics rewrite. | Only meaningful once nothing new depends on it. |

### Version and task tracking

Per repo rules each phase bumps the relevant `package.json` (minor — these are
features) and is tracked in the TaskList. Phase 0 is a `contracts` +
`backend` + `frontend` minor across all three.

### Documentation that goes stale

`docs/01-product/tokenomics.md` (already flagged WIP, and its `$SOF` fixed-supply /
fee-capture model is superseded), `docs/01-product/framework.md` ("$SOF Token
Utility"), `instructions/project-requirements.md` (contract table, token economics,
revenue streams), `instructions/project-structure.md` (new dirs, new tables).
Update in the same phase that invalidates them.

---

## 11. Database changes

New tables (`packages/backend/migrations/`):

| Table | Key columns |
|---|---|
| `token_launches` | `token_address` (PK), `curve_address`, `creator_address`, `name`, `symbol`, `metadata_uri`, `status` (curve/graduated), `pool_id`, `launched_at`, `graduated_at`, `is_hidden`, `is_verified` |
| `launch_trades` | `token_address`, `trader`, `side`, `eth_amount`, `token_amount`, `price`, `block_number`, `tx_hash` — partition by `token_address`, mirroring `raffle_transactions` |
| `launch_graduations` | `token_address`, `pool_id`, `eth_seeded`, `tokens_seeded`, `lp_position_id`, `tx_hash` |
| `season_stakes` | `token_address`, `account`, `amount`, `locked_until`, `active_seasons` |

Altered: `season_contracts` and `infofi_markets` each gain `quote_token_address`.
The `user_raffle_positions` materialized view needs the token dimension.

Per repo rules migrations must be pushed to the remote Supabase project **before**
the backend deploy that depends on them.
