# Egress reduction: cache hot reads + stop polling terminal data

**Issue:** #162 (repurposed — was "move settled raffles/markets/prizes to Supabase Storage JSON snapshots")
**Date:** 2026-06-05
**Status:** Approved design

## Background

Issue #162 originally proposed moving settled raffle/market/prize data into
Supabase Storage JSON snapshots to shift load from the uncached PostgREST egress
quota onto the unused cached (CDN) quota.

A re-diagnosis before implementation found two problems with that premise:

1. **Two of the three proposed data sources don't touch Supabase.** Raffle
   winners (`useSeasonWinnerSummaries`) and sponsor prizes (`useRafflePrizes`)
   are read **directly from on-chain contracts** (`staleTime: Infinity`), not
   from the backend API. Snapshotting them would move data that already bypasses
   Supabase. Only **InfoFi markets** flow through PostgREST.

2. **#162 was the last open item in a 7-issue egress action plan** (#157, #158,
   #159, #160, #161, #163, #164 all shipped: Redis caching of hot reads, narrowed
   `select("*")`, cut frontend polling intervals, cursor cleanup). After those,
   the largest remaining egress is **live polling of *uncached* endpoints**, not
   archive reads. The settled-market data #162 targets is cold, rarely read, and
   already absorbed by the existing 30s markets cache.

### Remaining egress hotspots (static ranking, post-fixes)

| Source | Poll | Cached? | Weight |
|---|---|---|---|
| InfoFi markets list (`useInfoFiMarkets`) | 10s | Redis 30s | High |
| **User market position** (`useUserMarketPosition`) | 15s | ❌ none | High |
| Market detail info / volume (`useMarketInfo`) | 20s | ❌ none | Med |
| All seasons (`useAllSeasons`) | 30s | Redis 5m | Med |
| Raffle transactions (≤500 rows) | 30s | ❌ none | Med |

The cheap, correct fix is therefore **not** Storage snapshots. It is: cache the
uncached live reads, and stop polling data that is immutable once a season
settles.

## Goal

Reduce remaining Supabase egress by attacking the live-polling hotspots, with no
change to the product surface and no new infrastructure (no Storage bucket, no
migration). Reuse the proven `redisCache.js` read-through pattern from #158.

Non-goals: Storage/CDN snapshots, re-architecting the SSE layer, changing the
on-chain read paths for winners/prizes.

## Architecture

Two complementary units. Unit 1 makes each *live* poll cheap; Unit 2 removes
*terminal* (settled) polls entirely. Live data → cached with event-invalidation;
archived data → fetched once.

Shipped as **one PR in two phases** (Phase 1 = backend caching, Phase 2 =
frontend gating).

---

### Unit 1 — Backend: read-through Redis cache for uncached hot endpoints

Reuse `packages/backend/shared/redisCache.js` (`cacheRead` / `cacheInvalidate` /
`cacheInvalidatePattern`) and mirror the existing `invalidateMarketsCache`
pattern in `supabaseClient.js`. Add new key prefixes to `redisCache.js` (single
source of truth, shared by readers + invalidators).

New prefixes:
- `POSITIONS_KEY_PREFIX = "positions:"`
- `MARKET_INFO_KEY_PREFIX = "market_info:"`
- `RAFFLE_TX_KEY_PREFIX = "raffle_tx:"`

| Endpoint | Supabase read today | Cache key | TTL | Invalidate on |
|---|---|---|---|---|
| `GET /infofi/positions/:user/net` (+ `/batch`) | `infofi_positions` per poll (15s) | `positions:net:{marketId}:{user}` | 20s | trade/position event for that market+user |
| `GET /infofi/markets/:id/info` | full `infofi_positions` scan for volume (20s) | `market_info:{marketId}` | 20s | trade/position event for that market |
| `GET /raffle/transactions/season/:id` | `raffle_transactions` ≤500 rows (30s) | `raffle_tx:{seasonId}` | 30s | new raffle tx synced for that season |

**Invalidation (correctness-critical).** TTL bounds staleness; event-invalidation
provides freshness. Without invalidation, a user who trades would not see their
own position/volume update for up to the TTL — a UX regression. Wire invalidators
into the existing on-chain event listeners that already write these rows:

- `src/listeners/tradeListener.js` and `src/listeners/positionUpdateListener.js`
  → on a settled trade/position write, invalidate `positions:net:{marketId}:*`
  and `market_info:{marketId}`.
- The raffle-transaction sync path (`src/services/raffleTransactionService.js`)
  → after syncing new txs for a season, invalidate `raffle_tx:{seasonId}`.

Add the invalidators as named methods (e.g. `invalidatePositionCache(marketId)`,
`invalidateMarketInfoCache(marketId)`, `invalidateRaffleTxCache(seasonId)`)
co-located with `invalidateMarketsCache` so prefixes stay in one place.

**Cache contents.** `market_info` caches the full response (on-chain reserves +
DB-derived volume). Reserves are on-chain reads; caching them for 20s is
acceptable (the frontend already tolerates 15s staleTime) and removes the
per-poll `infofi_positions` volume scan, which is the actual Supabase cost.

**Degradation.** `cacheRead` already falls through to the loader on any Redis
error and never throws — a Redis outage silently reverts to direct Supabase
reads. No new failure modes.

#### Unit 1 components

- `shared/redisCache.js` — add 3 key prefixes. (data: none; pure constants)
- `shared/supabaseClient.js` (or the position/info services) — wrap the three
  reads in `cacheRead`; add the three named invalidators.
- `fastify/routes/infoFiRoutes.js` — the `/positions/:user/net`, `/positions/:user/batch`,
  and `/markets/:id/info` handlers call the cached service methods.
- `src/services/raffleTransactionService.js` — cache the season-tx read; invalidate on sync.
- `src/listeners/tradeListener.js`, `src/listeners/positionUpdateListener.js` —
  call invalidators after their existing DB writes.

---

### Unit 2 — Frontend: stop polling terminal (settled) data

InfoFi/raffle data is immutable once a season settles, so it should be fetched
once and never re-polled. Uniform rule: **season status ≥ 4 (terminal) →
`refetchInterval: false`, `staleTime: Infinity`**; status < 4 (live) keeps the
current intervals. (Terminal = 4 or 5, matching `useSeasonWinnerSummaries`.)

| Hook | Change | Status source |
|---|---|---|
| `useInfoFiMarkets(seasons, filters)` | Split into two internal `useQuery`s by season status: **live** seasons (status < 4) keep `refetchInterval: 10s`; **terminal** seasons (4/5) get `staleTime: Infinity` + no interval. Merge both result maps; public return shape unchanged. Zero live seasons → no polling. | `seasons[].status` (from `useAllSeasons`) |
| `useUserMarketPosition(marketId, { isLive = true })` | New `isLive` option. `false` → `refetchInterval: false`, `staleTime: Infinity`. | caller passes season status |
| `useMarketInfo(marketId, { isLive = true })` | Same `isLive` gate (settled volume + reserves are terminal). | caller passes season status |
| `useRaffleTransactions(..., { enablePolling })` | Already supported. Completed-season callers pass `enablePolling: false` + treat as terminal (`staleTime: Infinity`). | caller |

**Caller wiring:**
- The market-detail view derives `isLive` from its season's status and passes it
  to `useUserMarketPosition` / `useMarketInfo`.
- `RaffleDetails` passes `enablePolling: false` to `useRaffleTransactions` for
  completed seasons.

**Backward compatibility.** `isLive` defaults to `true`, so callers not yet
updated keep current polling behavior — no regression during incremental wiring.

#### Unit 2 components

- `hooks/useInfoFiMarkets.js` — split live/terminal queries, merge results.
- `hooks/useUserMarketPosition.js` — add `isLive` to `useUserMarketPosition` and `useMarketInfo`.
- `hooks/useRaffleTransactions.js` — ensure terminal callers set `staleTime: Infinity`.
- Market-detail + `RaffleDetails` callers — pass status-derived gates.

## Data flow

Live season (status < 4):
`frontend hook (polls) → backend endpoint → cacheRead(Redis hit) → response`
On a trade: `listener writes infofi_positions → invalidate positions/market_info → next poll repopulates cache`.

Terminal season (status ≥ 4):
`frontend hook fetches once (staleTime Infinity) → backend endpoint → cacheRead → response`. No further polls, no further backend/Supabase load.

## Error handling

- Redis unavailable → `cacheRead` falls through to direct Supabase read (existing
  behavior, never throws).
- Invalidation failure → logged at warn, not propagated; TTL is the safety net
  (same contract as `cacheInvalidate` today).
- Frontend gate defaults to `isLive: true` → conservative (keeps polling) if a
  caller omits status.

## Testing

**Unit 1 (backend, vitest):**
- Cache hit returns cached value without a Supabase call; miss calls loader and
  writes through (mock the supabase client + redis, mirror
  `tests/listeners/settleInfoFiMarkets.test.js`).
- Invalidator deletes the right keys; a trade event triggers invalidation for the
  affected market.
- Redis-down path falls through to the loader and still returns correct data.

**Unit 2 (frontend, vitest + @testing-library/react):**
- `useInfoFiMarkets`: terminal-only seasons → no `refetchInterval`; mixed →
  live seasons poll, terminal don't; merged result contains both.
- `useUserMarketPosition` / `useMarketInfo`: `isLive:false` →
  `refetchInterval:false` + `staleTime:Infinity`; `isLive:true` → 15s/20s.
  (Follow the existing `components/mobile/__tests__/SeasonCard.priceLoading.test.jsx`
  react-query test pattern.)

## Version + tracking

- Bump `@sof/backend` (patch) and `@sof/frontend` (patch) per semver.
- Repurpose issue #162: rewrite title/body to this cache + poll-gating scope; the
  PR closes it. Add the re-diagnosis as the issue's context.

## Rollout

No env vars, no migration, no contract changes. Standard PR → Vercel + Railway
previews → merge → auto-deploy. Redis is already provisioned in production.
Verify post-deploy: `/api/health` stays green; spot-check that a trade updates a
position within one poll cycle (invalidation working).
