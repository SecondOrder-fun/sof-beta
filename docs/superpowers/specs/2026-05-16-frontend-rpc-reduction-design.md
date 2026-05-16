# Frontend RPC Reduction — Freshness-Gradient Data Layer

**Status:** Design / approved
**Date:** 2026-05-16
**Owner:** Patrick

## Problem

The frontend currently issues ~5–7 RPC calls per second per active-season viewer against Tenderly, driven by polling read hooks across ~60 files. We are hitting rate-limit denials in production. Worst offenders:

- `useAllSeasons` — fan-out loop: `readContract(getSeasonDetails)` × N seasons every 10s.
- `useCurveState` — 5-call multicall every 12s while a season is Active.
- `useCurveEvents` — `watchContractEvent` with `poll: true` → `eth_getLogs` every ~4s.
- `useTreasury` — 5 useReadContracts per season + `hasRole` polled every 5s.
- `useChainTime` — `getBlock` polled every 10s on create-season screens.
- InfoFi widgets — 5–10s `refetchInterval`s on already-backend-backed data.

Mitigations already in place: viem `http(url, { batch: true })`, retryCount=1, fallback transport. The microtask batching helps, but interval polling × file count still saturates the free Tenderly tier.

## Goals

1. **Eliminate sustained polling RPC** for screens where on-chain data is available via backend listeners or Blockscout.
2. **Preserve ultra-fresh UX** for the user's own state after the user's own transaction — RPC reads on receipt confirmation, not delayed by listener cursors.
3. **Establish a durable data-layer pattern** so new reads land in the right tier by default.
4. **Keep on-chain as source of truth** ideologically. Every cached/proxied read could be replaced by a direct RPC read; we choose not to for cost/freshness reasons, not architectural ones.
5. **Cost shape**: stay near current ~$5/mo Railway + free tiers. Defer Blockscout Pro and Tenderly paid until growth justifies.

## Non-goals (this PR)

- Verify-on-chain user toggle ("trust nothing" mode). Designed-around but not surfaced.
- Migrating away from Tenderly for writes or ultra-fresh reads.
- WebSocket upgrade for SSE (server-sent events sufficient at current scale).
- Redis-backed cache (in-memory is fine for one Railway instance).
- Blockscout Pro API key acquisition (free tier covers initial usage; spec assumes a key is configured in `BLOCKSCOUT_API_KEY` but does not require Pro).

## Strategy: freshness-gradient routing

Every read is classified by how stale it can tolerably be. The classification drives the data source.

| Tier | Trigger | Source | Caching | Refresh model |
|---|---|---|---|---|
| **Ultra-fresh** | Caller's own state after caller's own tx | RPC direct | Short staleTime (5s) | `executeBatch.onSuccess` invalidation by `touches` predicate |
| **Live** | Others' market/raffle activity | Backend SSE (per-domain) | n/a (push-based) | Server-pushed events; invalidate related warm caches on event |
| **Warm** | Read-mostly active-session state | Backend REST | Medium staleTime (20–30s), optional polling | Polling opt-in, or invalidation via SSE handlers |
| **Cold** | Historical / aggregate | Backend → Blockscout proxy | Long staleTime (5–15 min) | Manual invalidate only |
| **Wallet-batched-RPC** | Per-user balances / allowances | RPC direct (viem batched) | Short, gated on UI visibility | Degenerate ultra-fresh: refetch on tx if `touches` matches |

**Ideological win:** every Blockscout endpoint derives from chain, so a future "verify on-chain" toggle could route those reads through RPC. Backend warm caches are domain-specific (rollover eligibility, season status enums, claim math) — those couldn't be replaced 1:1 with RPC, but their inputs all come from on-chain events.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                          BROWSER (frontend)                          │
│                                                                      │
│   useColdRead ─────────────┐                                         │
│   useWarmRead ─────────────┤                                         │
│   useLiveSubscription ─────┤                                         │
│   useUltraFreshRead ───────┤                                         │
│                            │                                         │
│   useSmartTransactions     │  ← invalidates ultra-fresh queries      │
│     .executeBatch ─────────┤    by meta.touches predicate            │
└────────────────────────────┼─────────────────────────────────────────┘
                             │
            ┌────────────────┼────────────────┬─────────────────┐
            │                │                │                 │
            ▼                ▼                ▼                 ▼
    ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌─────────────┐
    │  Backend     │ │  Backend     │ │  Backend SSE │ │   RPC       │
    │  Blockscout  │ │  REST cache  │ │  per-domain  │ │  (Tenderly) │
    │  proxy (cold)│ │  (warm)      │ │  channels    │ │  (wallet +  │
    │              │ │              │ │  (live)      │ │ ultra-fresh)│
    └──────┬───────┘ └──────┬───────┘ └──────┬───────┘ └──────┬──────┘
           │                │                │                 │
           ▼                │                │                 │
    ┌──────────────┐        │                │                 │
    │  Blockscout  │        │                │                 │
    │  REST API    │        │                │                 │
    │  (Base       │        │                │                 │
    │  Sepolia /   │        │                │                 │
    │  mainnet)    │        │                │                 │
    └──────────────┘        │                │                 │
                            │                │                 │
            ┌───────────────┴────────────────┴─────────────────┴──────┐
            │              Backend Listeners + Supabase                │
            │   (persist Trade, PositionUpdate, SeasonStarted, etc.)   │
            └──────────────────────────────────────────────────────────┘
                                       │
                                       ▼
                              ┌─────────────────┐
                              │  Base Sepolia / │
                              │  Base Mainnet   │
                              │   (chain)       │
                              └─────────────────┘
```

## Frontend: four typed hooks

All four hooks live under `packages/frontend/src/hooks/chain/`. A new shared `chain/internal.js` factors error normalization, network-key resolution, and a dev-only telemetry counter.

### `useColdRead`

```js
useColdRead({
  endpoint: 'tokens/:address/holders',     // matches a backend /api/blockscout/* route
  params: { address: raffleToken },        // ':address' substituted; remaining keys → query string
  staleTime: 10 * 60 * 1000,               // default 5 min
  enabled: !!raffleToken,
})
// → { data, isLoading, error, refetch }
```

- Internally: `fetch(${VITE_API_BASE_URL}/api/blockscout/<endpoint>?...)`.
- No `refetchInterval`. Caller may `refetch()` or invalidate by key.
- Query key: `['cold', endpoint, params]`.
- Errors are normalized to `{ code, message, retryable }`.

### `useWarmRead`

```js
useWarmRead({
  path: '/api/seasons/all',
  params: { active: true },                 // serialized as query string
  refetchInterval: 30_000,                  // optional, default off
  staleTime: 20_000,
  enabled: true,
})
```

- Plain `fetch` against `${VITE_API_BASE_URL}${path}`.
- Polling opt-in.
- Query key: `['warm', path, params]`.

### `useLiveSubscription`

```js
useLiveSubscription({
  channel: 'raffle',                        // 'raffle' | 'infofi' | 'rollover'
  filter: (event) => event.seasonId === seasonId,
  onEvent: (event) => {
    queryClient.invalidateQueries({ queryKey: ['warm', '/api/seasons/all'] });
  },
  enabled: !!seasonId,
})
// → { status: 'connecting' | 'open' | 'closed', lastEvent }
```

- A small connection registry shares one `EventSource` per channel across multiple subscribers, so 5 components subscribing to `raffle` open 1 connection, not 5.
- `filter` runs in JS before `onEvent`.
- Auto-reconnect with exponential backoff capped at 30s.

### `useUltraFreshRead`

```js
useUltraFreshRead({
  contract: { address: SOF, abi: ERC20Abi },
  fn: 'balanceOf',
  args: [me],
  touches: [SOF],                           // contracts this read mirrors
  enabled: !!me,
  staleTime: 5_000,
})
```

- Thin `useQuery` over `publicClient.readContract`.
- Sets `meta: { tier: 'ultraFresh', touches: [...] }` on the query.
- `executeBatch` (write path) invalidates matching queries on receipt success — see below.
- Lazy by convention: only mount the hook when its UI is visible (menus, drawers, expand-collapse panels) to avoid stale-cache risk.

### Centralized post-tx invalidation

`useSmartTransactions.executeBatch` gains a single post-receipt invalidation hook that replaces all hand-rolled `invalidateQueries` lists scattered across handler files:

```js
// in executeBatch, after waitForCallsStatus resolves:
const callTargets = calls.map((c) => c.to.toLowerCase());
queryClient.invalidateQueries({
  predicate: (q) =>
    q.meta?.tier === 'ultraFresh' &&
    Array.isArray(q.meta.touches) &&
    q.meta.touches.some((addr) => callTargets.includes(addr.toLowerCase())),
});
```

The existing per-handler blocks (e.g. `finishWithReceipt` lines 80–83 in `useBuySellTransactions.js`, similar code in `ClaimCenter.jsx`) all get deleted as part of this PR.

## Backend changes

### SSE: per-domain channels

Generalize `sseService.js` into a small dispatcher:

```js
// shared/sseDispatcher.js
sseDispatcher.broadcast('raffle',  { type: 'PositionUpdate', seasonId, player, ... });
sseDispatcher.broadcast('infofi',  { type: 'Trade', marketId, side, amount, ... });
sseDispatcher.broadcast('rollover',{ type: 'RolloverFunded', seasonId, amount });
```

New routes under `fastify/routes/sseRoutes.js`:

| Route | Events |
|---|---|
| `GET /sse/raffle` | `PositionUpdate`, `SeasonStarted`, `SeasonCompleted`, `SponsorPrizeAdded`, `SponsorHatGranted`, `AccountCreated` |
| `GET /sse/infofi` | `Trade`, `MarketCreated`, `ProbabilityUpdate` (renames/absorbs `/sse/market-events`) |
| `GET /sse/rollover` | `RolloverFunded`, `RolloverClaimed`, `ConsolationFunded` |

Each existing listener gains a `sseDispatcher.broadcast()` call **after** its DB write commits, so a crash mid-handler does not emit a phantom event the client invalidates against.

`/sse/market-events` is renamed/replaced by `/sse/infofi`. No grace period — single-PR migration. Any external consumers of the old route get a 404; we own all consumers.

### Blockscout proxy (full coverage)

All Blockscout calls go through the backend. `BLOCKSCOUT_API_KEY` is account-scoped and billable; it must never enter the frontend bundle.

New routes under `fastify/routes/blockscoutRoutes.js`:

| Backend route | Blockscout endpoint | Cache TTL |
|---|---|---|
| `GET /api/blockscout/tokens/:address/holders` | `/api/v2/tokens/{addr}/holders` | 5 min |
| `GET /api/blockscout/tokens/:address/transfers` | `/api/v2/tokens/{addr}/transfers` | 30 sec |
| `GET /api/blockscout/addresses/:address/transactions` | `/api/v2/addresses/{addr}/transactions` | 30 sec |
| `GET /api/blockscout/transactions/:hash` | `/api/v2/transactions/{hash}` | 5 sec |
| `GET /api/blockscout/addresses/:address` | `/api/v2/addresses/{addr}` | 60 sec |

- Endpoint whitelist enforced server-side; the proxy will not forward arbitrary paths.
- In-memory LRU cache keyed by `(endpoint, params)`. Max 500 entries; eviction by TTL or LRU.
- `BLOCKSCOUT_API_KEY` is added server-side via the auth header Blockscout requires. Stub already added to backend `.env.testnet.example` and `.env.mainnet.example`; production keys flow through `deploy-env.sh`.
- `BLOCKSCOUT_API_KEY` is declared in `assertRequiredEnv.js` so missing config fails loudly at boot rather than 404'ing routes.
- Blockscout base URL is single-valued per backend instance, set via `BLOCKSCOUT_BASE_URL` env var. Each backend deployment is already scoped to one network (matching its `RPC_URL`), so the proxy uses the matching base URL: `https://base-sepolia.blockscout.com` for the testnet backend, `https://base.blockscout.com` for mainnet. No per-request network selection needed.

### New warm REST endpoints

| Endpoint | Replaces | Backed by |
|---|---|---|
| `GET /api/seasons/all` | `useAllSeasons` (N×10s loop) | Supabase `season_contracts` |
| `GET /api/curve/:address/state` | `useCurveState` polling path | Supabase, populated by `tradeListener` + `positionUpdateListener` |
| `GET /api/curve/:address/steps` | `useCurveState` initial steps fetch | Supabase, populated by `seasonStartedListener` (steps are immutable) |
| `GET /api/curve/:address/treasury` | `useTreasury` (fees, reserves, treasury addr) | Supabase, populated by `tradeListener` |
| `GET /api/chain/time` | `useChainTime` | Backend keeps a cached `block.timestamp` updated by any listener that processes a block |

### Schema additions

New table `curve_state`:

```sql
CREATE TABLE curve_state (
  bonding_curve_address TEXT PRIMARY KEY,
  accumulated_fees TEXT NOT NULL DEFAULT '0',   -- bigint as string
  sof_reserves TEXT NOT NULL DEFAULT '0',
  current_supply TEXT NOT NULL DEFAULT '0',
  current_step_index INT,
  current_step_price TEXT,
  current_step_range_to TEXT,
  bond_steps JSONB,                              -- immutable; written once
  treasury_address TEXT,
  last_updated_block BIGINT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

`season_contracts` gains no new columns — curve state is its own table so the migration is purely additive.

Migration goes in `packages/backend/migrations/` (or `supabase/migrations/`, per existing convention). Per `feedback_supabase_migrations_to_prod`: `supabase db push --linked` against `mmblfpccknlrhowicesv` **before** the Railway backend deploy that depends on the schema.

## Hook migration mapping

### Cold → `useColdRead`

| Current call site | What it does |
|---|---|
| `RaffleList.jsx` completed-season tab (detail) | Historical season detail |
| `TransactionsTab.jsx` on completed seasons | Curve buy/sell history via Blockscout transfers |
| Raffle holders panel | Token holders list |
| `UserProfile.jsx` activity tab | Address tx history |
| `useSeasonWinnerSummaries.js` for past seasons | Winner state for closed seasons |

### Warm → `useWarmRead`

| Current hook | New endpoint |
|---|---|
| `useAllSeasons.js` | `GET /api/seasons/all` |
| `useCurveState.js` (passive: pre-start, completed) | `GET /api/curve/:addr/state` + `/steps` |
| `useTreasury.js` | `GET /api/curve/:addr/treasury` |
| `useChainTime.js` | `GET /api/chain/time` |
| `useSeasonGating.js` | wrap existing backend endpoint |
| `useRafflePrizes.js` | wrap existing backend endpoint |
| `useInfoFiMarket.js`, `useMarketsBatchInfo.js`, `useMarketCardData.js` | wrap existing `/infofi/markets/*` |
| `useRollover.js`, `useEligibleRolloverCohort.js` cohort lookup | `/api/rollover/positions` |
| `useConsolationStatus.js` | wrap existing backend endpoint |
| `useInfoFiMarketsAdmin.js`, `useInfoFiFactory.js` (read paths) | wrap existing |
| `usePlayerPosition.js` (non-self players) | `/api/transactions/positions/:user/:season` |

### Live → `useLiveSubscription`

| Current hook / call site | New channel + handler |
|---|---|
| `useCurveEvents.js` | `raffle` channel, filter on `PositionUpdate` for current curve |
| InfoFi live state in `BuySellWidget`, `ClaimCenter`, `RewardsDebug` | `infofi` channel |
| Live raffle position updates on detail page | `raffle` channel; invalidates warm `/curve/state` |
| Season transitions (Started → Active → Settling → Completed) | `raffle` channel; invalidates warm `/seasons/all` |
| Rollover events on detail page | `rollover` channel |

### Ultra-fresh → `useUltraFreshRead`

| Current hook | `touches` |
|---|---|
| `useSOFBalance.js` | `[SOF]` |
| `usePlayerPosition.js` (self only) | `[RAFFLE_TOKEN]` |
| `useSofDecimals.js` | `[]` (infinite staleTime, never invalidated) |
| Allowance reads inside `useBuySellTransactions` | `[SOF]` |
| `useAccessControl.js` user-role checks | `[contract being read]` |
| `useTreasury.hasManagerRole` (currently 5s poll) | `[BONDING_CURVE]` |

### Unchanged (write paths)

`useSmartTransactions` (edit only: centralized invalidation), `useBuySellTransactions`, `useTransactionHandlers`, `useRaffleWrite`, `useFundDistributor`, `useSettlement`, `useRaffleAdmin` (write parts), `onchainInfoFi.js`, `onchainRolloverEscrow.js`, `onchainRaffleDistributor.js`, `sofSmartAccount.js`.

The hand-rolled `invalidateQueries` blocks in `useBuySellTransactions.finishWithReceipt`, `ClaimCenter.jsx`, `InfoFiMarketCardMobile.jsx`, etc. are all deleted — the centralized predicate in `executeBatch.onSuccess` replaces them.

### Deletes / simplifications

- `useRaffleRead.js`'s `useSeasonDetailsQuery` (10s interval): becomes warm.
- `viemClient.js`'s build-on-demand publicClient: still used by ultra-fresh path; most callers shift to backend.
- `wagmi.js` retry/batch settings: keep as defensive default.

## Expected impact

For 1 user on the active raffle detail page:

- **Today**: `useCurveState` (5/12s) + `useCurveEvents` (1/4s) + `useTreasury` (5+1/5s) + `useChainTime` (1/10s) + `useAllSeasons` (~20/10s) ≈ **5–7 RPC calls/sec sustained**.
- **After**: idle ≈ **0 RPC/sec**, spike to ~3 RPC calls per user tx (ultra-fresh re-reads).

## Testing & rollout

### Test layers

**A. Backend unit + integration tests** (Vitest)
- Each new route: happy path + 404 + cache hit/miss.
- SSE dispatcher: per-channel routing, channel isolation.
- Listener idempotency: re-processed event doesn't double-broadcast.

**B. Frontend hook unit tests** (Vitest)
- `useColdRead`, `useWarmRead`, `useUltraFreshRead`: stub fetch / publicClient; assert query key, staleTime, retry.
- `useLiveSubscription`: stub EventSource; assert connection sharing, reconnect, filter behavior.
- `useUltraFreshRead` × `useSmartTransactions` integration: emit fake receipt; assert matching `touches` invalidate and non-matching don't.
- Migrate existing `useConsolationStatus.test.js` to new wrapper.

**C. Per-screen smoke tests** (manual checklist in PR description)
- Raffle list (4 tabs) — paint with no RPC fan-out.
- Active raffle detail — buy 1 ticket, watch position + curve update.
- Rollover claim — claim → balances refresh.
- Profile — historical activity loads from Blockscout proxy.
- InfoFi trading widget — bet, watch market info update.
- Admin panel — role checks, treasury extraction.
- Create season workflow — chain time + gating.

**D. Tenderly RPC budget test** (one-shot, manual)
- Capture Tenderly dashboard request count before merge.
- Smoke-test the PR preview for 5 minutes with 1 active season.
- Verify delta < 100 (vs. several thousand today). Document in PR.

### Pre-merge checklist

```
[ ] All Vitest suites green (frontend + backend)
[ ] supabase migration list --linked shows new migrations applied to remote
[ ] Vercel preview + Railway PR env deployed and paired
[ ] Smoke checklist (C) executed on PR preview; screenshots / notes in PR
[ ] Tenderly RPC delta logged (D)
[ ] Lint zero warnings on all 3 packages
```

### Rollout sequencing (commit order within the single PR)

1. Backend: `sseDispatcher` + per-domain SSE routes (no listener wiring yet).
2. Backend: extend each listener to broadcast on its domain channel.
3. Backend: new warm endpoints (`/seasons/all`, `/curve/*`, `/chain/time`).
4. Backend: Blockscout proxy routes + LRU cache.
5. Supabase migration: `curve_state` table + listener writes to populate.
6. Frontend: introduce four `hooks/chain/*` hooks with unit tests, no callers yet.
7. Frontend: amend `useSmartTransactions.executeBatch` for centralized invalidation.
8. Frontend: migrate hooks bucket by bucket (cold → warm → live → ultra-fresh), one commit per bucket.
9. Frontend: delete legacy `invalidateQueries` blocks from `finishWithReceipt` and friends.
10. Cleanup: delete `/sse/market-events`, drop dead code in `useRaffleRead.js`, etc.
11. Version bumps in all three `package.json` (minor for frontend + backend, no contracts changes).

### Rollback

Single-PR revert if a regression escapes. No feature flag means no half-state. The Tenderly delta gate (D) is what prevents a regression from being merged in the first place.

## Out of scope (followup tickets)

- Blockscout Pro API key (free tier is sufficient for launch).
- Verify-on-chain UI toggle.
- WebSocket upgrade for SSE.
- Redis-backed cache (only if we scale past one Railway instance).
- Migration off Tenderly.
- `assertRequiredEnv.js` general fail-fast pass (tracked under `followup_env_validator_failfast`; this PR adds `BLOCKSCOUT_API_KEY` to that list as part of the work).
