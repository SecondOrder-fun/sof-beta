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
| Raffle requires graduation | **Yes** — hard requirement, not a flag (§9.2) |
| Token decimals | **Always 18**, asserted at raffle creation (§6.3) |
| Dev-buy | Optional, no minimum — and the *only* route to a starting stake (§5.1) |
| Creator allocation | **None.** No free tokens, ever. |
| InfoFi seed liquidity | Earmarked share of each token's supply, reserved at deploy time (§6.4) |
| `$SOF` | Removed. Base Sepolia only, never on mainnet — nothing to migrate (§3) |

### Open questions that block implementation

1. **Launch fee size.** ETH is the only candidate once `$SOF` is gone. Flat
   (e.g. 0.001 ETH) or a share of the dev-buy? Unresolved.
2. **Supply split.** What percentages go to curve sale / graduation LP / InfoFi
   seed? §5.2 carries placeholders that need real numbers.
3. **Unused InfoFi seed.** If no market ever opens on a token, does its earmark
   burn, or fall through to the LP position? §6.4.

Everything else from the first pass is now settled and folded in below.

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

## 3. The denomination shift

`$SOF` is removed outright. It was only ever deployed to Base Sepolia — there is
no mainnet deployment, no holders, and no value to migrate. **The motivation is
regulatory, not technical:** the platform issues no token of its own, so there is
no protocol security, no buyback, and no fee-capture-to-token story anywhere in
the design. Revenue is ETH (§ launch fees, curve fees) plus fee accrual in
individual launch tokens.

This is a straight deletion, not a migration. An earlier draft of this document
recommended grandfathering `$SOF` as a legacy quote token to avoid orphaning
deployed seasons; that recommendation assumed mainnet exposure that does not
exist, and is withdrawn. Testnet seasons can be re-created from scratch.

The code change is the same either way — `sofToken` becomes a per-season
`quoteToken` parameter — but the `$SOF`-specific contracts get deleted rather
than deprecated, and there is no compatibility shim to carry. Current coupling:

| File | Coupling | Disposition |
|---|---|---|
| `curve/SOFBondingCurve.sol` | `immutable sofToken` (6 call sites) | **Rename** to `quoteToken`. No logic change. |
| `core/Raffle.sol` | `immutable sofToken`, passed to distributor | Remove; quote token moves to `SeasonConfig`. |
| `core/SeasonFactory.sol` | reads `IRaffle(raffle).sofToken()` | Take `quoteToken` as a parameter. |
| `lib/IRaffle.sol` | `sofToken()` in the interface | Remove. |
| `core/RolloverEscrow.sol` | `immutable sofToken`, treasury bonus | Per-token escrow; rollover only *within* a token (§6.5). |
| `infofi/InfoFiMarketFactory.sol` | `immutable sofToken`, treasury-funded seed liquidity (9 call sites) | Per-season collateral (§6.4). Most invasive InfoFi change. |
| `infofi/ConditionalTokenSOF.sol` | name only | Rename `ConditionalTokenERC20`. |
| `exchange/SOFExchange.sol` | mints `$SOF` for ETH/USDC | **Delete** — there is nothing to mint. |
| `faucet/SOFFaucet.sol` | dispenses `$SOF` | **Delete.** Testnet flow becomes: public Base Sepolia ETH faucet → launch a token → trade it. Nothing protocol-specific to dispense. |
| `token/SOFToken.sol` | the token itself | **Delete.** |
| `paymaster/SOFPaymaster.sol` | allowlists *SOF curve* targets | Registry-driven allowlist (§6.6). Gas is ETH — no token coupling. |
| `sponsor/SponsorOnboarding.sol` | stake `$SOF` → Hats sponsor hat | Superseded by `SeasonCreationStake` (§5.6). |

Frontend: 96 files mention SOF; 15 reference the token/balance directly
(`useSOFBalance`, `useSOFToken`, `useFormatSOF`, `GetSof.jsx`). Backend:
`curveRoutes`, `tradeListener`, `sofTransactionsService`, `seasonRoutes` all
assume a single global currency.

Sequencing note: the rename still lands as its own phase (§10, Phase 0) ahead of
any launchpad code. Deleting `$SOF` and introducing the launchpad in one change
would mix a large mechanical refactor with new logic and make the diff unreviewable.
Phase 0 can quote seasons in a `MockERC20` to keep tests meaningful until
`LaunchToken` exists.

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

- Reverts if `msg.value < launchFee`. **There is no minimum dev-buy** — `devBuyWei`
  may be zero.
- Deploys `LaunchToken` + `LaunchCurve` via CREATE2 (deterministic addresses let
  the UI show the token page before the tx confirms).
- If `devBuyWei > 0`, executes the dev-buy against the fresh curve **in the same
  transaction**, then deposits the resulting tokens into `SeasonCreationStake` on
  the creator's behalf, locked until graduation (§9.1).

**The creator receives no free allocation.** The dev-buy is the only way tokens
reach the creator, at the same curve price as everyone else, and it is the only
route to a starting stake. Two consequences worth stating plainly, because they
are unusual and the UI has to communicate them:

- **A creator who launches with no dev-buy has no stake and cannot open the first
  raffle on their own token.** Anyone who buys past the threshold can. The
  launcher is not privileged — launching and controlling are separate, earned
  things. This is intended.
- Because the stake threshold is a share of *circulating* supply (§5.6) and the
  dev buys at the bottom of the curve, a dev-buy that clears the threshold at
  launch will be diluted below it as others buy. The `/launch` form must show
  the projected end-state share, not the at-launch share, or creators will be
  systematically surprised.
- Emits `TokenLaunched(token, curve, creator, name, symbol, metadataURI, devBuyWei)`
  — the single event the indexer keys off.
- Guards: symbol/name length caps, reserved-symbol denylist, per-block launch cap.

### 5.2 `launchpad/LaunchToken.sol`

ERC-20 + ERC-2612 permit, **18 decimals — fixed, not configurable** (§6.3 depends
on this), fixed max supply (e.g. 1 000 000 000). `MINTER_ROLE` held solely by its
`LaunchCurve`; renounced at graduation so supply is provably fixed afterwards.
Deliberately *not* `AccessControl`-heavy — a launched token should have as little
owner surface as possible, because the owner is an anonymous creator.

#### Supply allocation, fixed at deploy time

Every launch splits its max supply into three buckets, in the constructor, with
no creator discretion:

| Bucket | Share | Purpose |
|---|---|---|
| **Curve sale** | ~70% *(placeholder)* | Mintable by `LaunchCurve` on buys. The only supply in circulation pre-graduation. |
| **Graduation LP** | ~20% *(placeholder)* | Minted at graduation, paired with ETH reserves into the v4 position (§5.4). |
| **InfoFi seed** | ~10% *(placeholder)* | Reserved for prediction-market seed liquidity (§6.4). Held by `InfoFiSeedVault`. |

Percentages are placeholders — see open question 2 in §1. What matters structurally:

- The split is **identical for every launch** and set in the constructor. Making it
  creator-configurable reintroduces the free-allocation vector by another name.
- The non-curve buckets are a **supply overhang** and must be surfaced in the UI
  as such. A token whose curve shows 70% sold is 100% sold *of what is sellable*;
  displaying that as "70% of supply" is misleading and will read as a hidden
  team allocation. The token page should show circulating vs. reserved explicitly.
- Neither reserved bucket is ever claimable by the creator, under any path.

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
launch or made impossible on a small one. Evaluated against circulating supply
*at the moment of season creation*, not at launch — see the dilution note in §5.1.

Circulating supply for this purpose excludes the reserved buckets (§5.2);
otherwise the LP and InfoFi earmarks inflate the denominator and make the
threshold harder to reach than intended.

This is where the creator's escrowed dev-buy lands. Note what it does *not* do:
it gives the creator no special status. A creator who skipped the dev-buy has no
stake and no season rights, and any holder who crosses the threshold has exactly
the same rights the creator would have had.

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

### 5.8 `launchpad/InfoFiSeedVault.sol` — Phase 1 stub, Phase 4 logic

Custodies the InfoFi seed bucket (§5.2) for every launch. Deployed and funded in
Phase 1 so the supply split is correct from the first token; its release path stays
disabled until InfoFi lands in Phase 4.

```solidity
mapping(address token => uint256) public reserved;   // unspent earmark
function deposit(address token, uint256 amount) external;   // launchpad-only
function seedMarket(address token, address market, uint256 amount) external;  // factory-only
function sweepUnused(address token) external;               // see below
```

Two properties that must hold from day one, because they cannot be retrofitted
once tokens are live:

- **The vault can never transfer to the creator or to an admin EOA.** Its only
  outbound path is `seedMarket`, into an InfoFi market for that same token.
  Otherwise the earmark is just a team allocation wearing a different hat, and it
  will be read that way.
- **Unused earmarks need a terminal path.** Most tokens will never have an InfoFi
  market. Leaving ~10% of supply locked forever in a vault is a permanent,
  invisible overhang on every launch. `sweepUnused` should either burn it or add
  it to the graduated LP position after a fixed window. Which one is open question
  3 in §1 — but **the function must exist in the Phase 1 deployment even if it
  reverts**, or every token launched before Phase 4 is permanently stuck with
  dead supply.

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

Mechanical: `sofToken` → `quoteToken` (6 sites). No deprecation alias — with `$SOF`
deleted outright there is no external consumer to keep compatible, and the ABI
export + frontend move in the same phase. Everything else — `initializeCurve`,
fees, `PositionUpdate`, permit fallback — is unchanged.

The contract name `SOFBondingCurve` should go too, since it no longer refers to
anything. `TicketCurve` distinguishes it from `LaunchCurve` and says what it does.
Renaming it is free in Phase 0 and awkward afterwards.

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
- `_createSeasonInternal` validates `quoteToken != address(0)`, that the token is
  registered in `TokenLaunchpad` with `graduated == true` (§9.2), and that its
  decimals are 18 (below).

#### Decimals are asserted, not accommodated

Every launch token is 18 decimals by construction (§5.2), and season creation
enforces it:

```solidity
uint8 d;
try IERC20Metadata(quoteToken).decimals() returns (uint8 v) { d = v; }
catch { revert QuoteTokenDecimalsUnavailable(); }
if (d != 18) revert QuoteTokenDecimals(d);
```

`decimals()` is in `IERC20Metadata`, not the core ERC-20 interface, so a token can
legally omit it — the `try/catch` must reject rather than assume. This is
belt-and-braces given the launchpad-registry check already restricts quote tokens
to launchpad-issued ones; it matters if a non-launchpad quote token is ever
allowed in.

The payoff is in the frontend (§8.2): the decimal pair stays exactly
**(18 quote, 0 ticket)**, which is what the existing buy/sell math already
assumes. This collapses that work from "generalize every calculation over
arbitrary decimals" to "read the symbol dynamically, keep the 18-dp assumption,
and assert it at the boundary." It is the single largest risk reduction of the
decisions made so far.
- `registerCurve` already exists for paymaster validation; it now registers
  many curves across many tokens (§6.6).

### 6.4 InfoFi

`InfoFiMarketFactory.sol` is the most invasive piece. It holds `immutable sofToken`
and seeds every market with `INITIAL_LIQUIDITY` pulled from a treasury balance in
that one token (9 call sites). Multi-token means:

- Collateral resolved per market from `Raffle.seasons[seasonId].quoteToken`.
- Seed liquidity must exist **in that token**, and the treasury will never hold
  every launch token. **Resolved: each token pre-funds its own seed.** A fixed
  share of max supply is earmarked at deploy time into `InfoFiSeedVault` (§5.2,
  §5.8); `InfoFiMarketFactory` draws `INITIAL_LIQUIDITY` from that vault instead
  of from a treasury balance.

  This is strictly better than the alternatives considered — creator-funded seed
  (taxes the creator and couples market creation to their solvency) and ETH/USDC
  collateral (liquid, but breaks the "everything is denominated in the token"
  story that makes the season coherent). Its cost is the supply overhang in §5.2
  and the dead-earmark problem in §5.8; both are manageable, but only if handled
  from the first launch.

- **InfoFi ships in Phase 4, after the §1 journey is closed.** The vault and the
  earmark land in Phase 1 — supply splits cannot be changed retroactively — but
  market creation against launch tokens is deliberately last. Multi-collateral
  InfoFi is its own workstream and nothing in launch → graduate → raffle depends
  on it.
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
  `usePriceEstimation.js` — these assume 18-decimal `$SOF` against 0-decimal
  tickets, and **that assumption stays valid**: every quote token is 18 decimals
  by construction and asserted on-chain (§6.3). The math does not need to
  generalize. What changes is only the *symbol* and *address* it formats against.
  Add a dev-mode assertion mirroring the contract check so a mis-wired token
  fails loudly in the client rather than silently mispricing.
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
**season creation requires `graduated == true`.** Post-graduation there is a real
DEX market and a public price, and the creator's own allocation is unlocked and
therefore at risk alongside everyone else's. **Adopted as a hard requirement**,
enforced in `_createSeasonInternal` (§6.3) — not a config flag, because a flag
is something that can be turned off under commercial pressure later.

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

**9.7 Reserved-supply misread.** The graduation-LP and InfoFi-seed buckets (§5.2)
are ~30% of max supply sitting outside circulation, held by protocol contracts.
Functionally this is not a team allocation — no path delivers it to the creator or
an admin — but it has the same *shape* as one, and a launchpad's users are
primed to look for exactly that. This is a disclosure problem, not a contract
problem: the token page must show circulating / LP-reserved / InfoFi-reserved as
three distinct figures, and `InfoFiSeedVault` must have no admin withdrawal path
to point at. Getting this wrong costs trust that is very hard to win back.

**9.8 Regulatory.** Removing `$SOF` removes the platform's own issued token, which
is the point — the motivation for scrapping it is regulatory rather than technical
(§3). What remains is still permissionless token issuance combined with raffles
denominated in those tokens, which is its own posture. Flagged, not assessed —
this needs counsel, not a design doc.

---

## 10. Suggested sequencing

Each phase should land green (`npm test`, `npm run lint`, `npm run build`, `forge test`)
on its own.

| Phase | Scope | Why here |
|---|---|---|
| **0 — Remove `$SOF`, parameterize the quote token** | `sofToken` → `quoteToken` across contracts/backend/frontend; `quoteToken` in `SeasonConfig`; delete `SOFToken`/`SOFExchange`/`SOFFaucet`. Seasons quote a `MockERC20` until Phase 1 exists. No new features. | Isolates a large mechanical refactor from new logic. Everything after is additive. |
| **1 — Launch + curve** | `LaunchToken` (18 dp, three-bucket supply), `LaunchCurve`, `TokenLaunchpad`, `BondingMath`, `InfoFiSeedVault` (funded, release disabled). No graduation. UI: `/launch`, `/tokens`, `/tokens/:address` incl. circulating-vs-reserved display. Backend: launch + trade listeners, discovery feed, metadata pipeline. | The deliverable asked for. Shippable and demoable without v4. The supply split **must** be right here — it cannot be changed for tokens already launched. |
| **2 — Graduation** | `GraduationManager`, v4 deps + remappings, Base addresses in `deployments/*.json`, LP lock. Graduation progress UI. | Self-contained; the highest-risk external integration gets its own audit surface. |
| **3 — Raffles on launched tokens** | `SeasonCreationStake`, `canCreateSeason(account, token)`, graduation gate + 18-dp assertion, `/tokens/:address/create-season`. Ticket curve runs against the launch token. | Closes the §1 journey. Depends on 0 + 2. |
| **4 — InfoFi on launched tokens** | Per-season collateral drawn from `InfoFiSeedVault`, `ConditionalTokenERC20` rename, `sweepUnused` enabled. | Deliberately last — §6.4. Nothing in the §1 journey depends on it. |

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
