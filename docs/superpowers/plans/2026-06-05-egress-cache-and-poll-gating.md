# Egress Cache + Poll-Gating Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce remaining Supabase egress by caching the uncached hot read endpoints (positions, market info, raffle transactions) and by stopping frontend polling of immutable settled-season data.

**Architecture:** Two phases. Phase 1 (backend) wraps three uncached read paths in the existing `redisCache.js` read-through helper and invalidates them from the position-write path (`recordPosition`) and the raffle-tx sync path. Phase 2 (frontend) gates `refetchInterval`/`staleTime` on season status so terminal seasons (status ≥ 4) are fetched once, never polled.

**Tech Stack:** Node 22 ESM, Fastify 5, `@supabase/supabase-js`, ioredis (via `redisClient`), Vitest (backend), React 18 + `@tanstack/react-query` + Vitest/@testing-library (frontend).

**Spec:** `docs/superpowers/specs/2026-06-05-egress-cache-and-poll-gating-design.md`

**Conventions:**
- Backend tests run from `packages/backend` via `npx vitest run <path>`.
- Frontend tests run from `packages/frontend` via `npx vitest run <path>`.
- Terminal season status = 4 or 5; live = status < 4 (matches `useSeasonWinnerSummaries`).
- Bump versions per semver: `@sof/backend` patch (Phase 1), `@sof/frontend` patch (Phase 2).

---

## File Structure

**Phase 1 — backend (`packages/backend`):**
- Modify `shared/redisCache.js` — add 3 key-prefix constants.
- Modify `src/services/infoFiPositionService.js` — cache `getNetPosition`; add `getMarketInfo` (extracted from the route handler) and cache it; invalidate both in `recordPosition`.
- Modify `fastify/routes/infoFiRoutes.js` — `/markets/:id/info` and `/markets/batch-info` call the new cached `getMarketInfo`.
- Modify `src/services/raffleTransactionService.js` — cache `getSeasonTransactions`; invalidate in `syncSeasonTransactions`.
- Tests: `tests/services/positionCache.test.js`, `tests/services/marketInfoCache.test.js`, `tests/services/raffleTxCache.test.js`.

**Phase 2 — frontend (`packages/frontend`):**
- Modify `src/hooks/useInfoFiMarkets.js` — split live/terminal queries.
- Modify `src/hooks/useUserMarketPosition.js` — `isLive` gate on both `useUserMarketPosition` and `useMarketInfo`.
- Modify `src/hooks/useRaffleTransactions.js` — terminal callers set `staleTime: Infinity`.
- Modify callers: `src/components/infofi/InfoFiMarketCard.jsx`, `src/components/mobile/MobileMarketsList.jsx`, `src/components/curve/TransactionsTab.jsx`.
- Tests: `src/hooks/__tests__/useInfoFiMarkets.gating.test.jsx`, `src/hooks/__tests__/useUserMarketPosition.gating.test.jsx`.

---

# Phase 1 — Backend caching

## Task 1: Add cache key prefixes

**Files:**
- Modify: `packages/backend/shared/redisCache.js` (after the existing prefix block, ~line 33)

- [ ] **Step 1: Add the three prefixes**

In `shared/redisCache.js`, find:

```js
export const ROUTE_CONFIG_KEY_PREFIX = "route_config:";
export const MARKETS_KEY_PREFIX = "markets:";
export const SEASON_CONTRACTS_KEY_PREFIX = "season_contracts:";
```

Add immediately after:

```js
// Per-user net position in a single market. Key:
//   positions:net:{marketId}:{userAddress}
export const POSITIONS_KEY_PREFIX = "positions:";
// Market pool info (on-chain reserves + DB-derived volume). Key:
//   market_info:{marketId}
export const MARKET_INFO_KEY_PREFIX = "market_info:";
// Paginated season transaction list. Key:
//   raffle_tx:{seasonId}:{order}:{limit}:{offset}
export const RAFFLE_TX_KEY_PREFIX = "raffle_tx:";
```

- [ ] **Step 2: Verify lint passes**

Run: `cd packages/backend && npm run lint`
Expected: exits 0, no warnings.

- [ ] **Step 3: Commit**

```bash
git add packages/backend/shared/redisCache.js
git commit -m "feat(backend): add positions/market_info/raffle_tx cache key prefixes (#162)"
```

---

## Task 2: Cache `getNetPosition` + invalidate on trade

**Files:**
- Modify: `packages/backend/src/services/infoFiPositionService.js` (imports; `getNetPosition` ~380; `recordPosition` ~98 after successful insert)
- Test: `packages/backend/tests/services/positionCache.test.js`

- [ ] **Step 1: Write the failing test**

Create `packages/backend/tests/services/positionCache.test.js`:

```js
// tests/services/positionCache.test.js
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const hoisted = vi.hoisted(() => ({
  cacheRead: vi.fn(),
  cacheInvalidatePattern: vi.fn(),
}));

vi.mock("../../shared/redisCache.js", async (orig) => {
  const actual = await orig();
  return {
    ...actual,
    cacheRead: hoisted.cacheRead,
    cacheInvalidatePattern: hoisted.cacheInvalidatePattern,
  };
});

// db is imported by the service; stub it so import doesn't touch network.
vi.mock("../../shared/supabaseClient.js", () => ({
  db: { client: { from: vi.fn() } },
}));
vi.mock("../../src/lib/viemClient.js", () => ({ publicClient: {} }));

import { infoFiPositionService } from "../../src/services/infoFiPositionService.js";
import { POSITIONS_KEY_PREFIX } from "../../shared/redisCache.js";

beforeEach(() => {
  hoisted.cacheRead.mockReset();
  hoisted.cacheInvalidatePattern.mockReset();
});

describe("getNetPosition caching", () => {
  it("reads through cacheRead with a per-market+user key", async () => {
    const cached = { yes: "1", no: "0", net: "1", isHedged: false, numTradesYes: 1, numTradesNo: 0 };
    hoisted.cacheRead.mockResolvedValueOnce(cached);

    const result = await infoFiPositionService.getNetPosition("0xABC", 7);

    expect(result).toEqual(cached);
    expect(hoisted.cacheRead).toHaveBeenCalledTimes(1);
    const [key, , opts] = hoisted.cacheRead.mock.calls[0];
    expect(key).toBe(`${POSITIONS_KEY_PREFIX}net:7:0xabc`);
    expect(opts.ttlSeconds).toBe(20);
  });
});

describe("recordPosition invalidation", () => {
  it("invalidates the market's position + market_info caches after insert", async () => {
    // Force the early idempotency check to say "not recorded", market lookup to
    // resolve, and the insert to succeed.
    vi.spyOn(infoFiPositionService, "getMarketIdFromFpmm").mockResolvedValue(42);
    const single = vi.fn().mockResolvedValue({ data: { id: 1 }, error: null });
    const selectAfterInsert = vi.fn(() => ({ single }));
    const insert = vi.fn(() => ({ select: selectAfterInsert }));
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    const eqTx = vi.fn(() => ({ maybeSingle }));
    const selectId = vi.fn(() => ({ eq: eqTx }));
    const { db } = await import("../../shared/supabaseClient.js");
    db.client.from = vi.fn(() => ({ select: selectId, insert }));

    await infoFiPositionService.recordPosition({
      fpmmAddress: "0xfpmm",
      trader: "0xTrader",
      buyYes: true,
      amountIn: 10n ** 18n,
      amountOut: 10n ** 18n,
      txHash: "0xhash",
    });

    expect(hoisted.cacheInvalidatePattern).toHaveBeenCalledWith(
      `${POSITIONS_KEY_PREFIX}net:42:*`,
    );
    expect(hoisted.cacheInvalidatePattern).toHaveBeenCalledWith(
      "market_info:42",
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/backend && npx vitest run tests/services/positionCache.test.js`
Expected: FAIL — `getNetPosition` does not call `cacheRead`; `recordPosition` does not call `cacheInvalidatePattern`.

- [ ] **Step 3: Add imports**

In `src/services/infoFiPositionService.js`, the top imports are:

```js
import { publicClient } from "../lib/viemClient.js";
import { db } from "../../shared/supabaseClient.js";
import { SimpleFPMMABI as simpleFpmmAbi } from '@sof/contracts';
import { queryLogsInChunks } from "../utils/blockRangeQuery.js";
```

Add after them:

```js
import {
  cacheRead,
  cacheInvalidate,
  cacheInvalidatePattern,
  POSITIONS_KEY_PREFIX,
} from "../../shared/redisCache.js";

const POSITION_CACHE_TTL_SECONDS = 20;
```

- [ ] **Step 4: Wrap `getNetPosition` in cacheRead**

Replace the existing `getNetPosition` method:

```js
  async getNetPosition(userAddress, marketId) {
    const positions = await this.getAggregatedPosition(userAddress, marketId);
```
…through its closing `}`… with:

```js
  async getNetPosition(userAddress, marketId) {
    const key = `${POSITIONS_KEY_PREFIX}net:${marketId}:${userAddress.toLowerCase()}`;
    return cacheRead(
      key,
      async () => {
        const positions = await this.getAggregatedPosition(userAddress, marketId);

        const yesPosition = positions.find((p) => p.outcome === "YES");
        const noPosition = positions.find((p) => p.outcome === "NO");

        const yesAmount = parseFloat(yesPosition?.total_amount || 0);
        const noAmount = parseFloat(noPosition?.total_amount || 0);

        return {
          yes: yesPosition?.total_amount || "0",
          no: noPosition?.total_amount || "0",
          net: (yesAmount - noAmount).toString(),
          isHedged: !!(yesPosition && noPosition),
          numTradesYes: yesPosition?.num_trades || 0,
          numTradesNo: noPosition?.num_trades || 0,
        };
      },
      { ttlSeconds: POSITION_CACHE_TTL_SECONDS },
    );
  }
```

- [ ] **Step 5: Invalidate in `recordPosition` after a successful insert**

In `recordPosition`, find the success return:

```js
      console.log(
        `[recordPosition] Successfully inserted position with id: ${data.id}`
      );
      return { success: true, data };
```

Replace with:

```js
      console.log(
        `[recordPosition] Successfully inserted position with id: ${data.id}`
      );

      // Trade just landed — bust this market's cached positions (all users in
      // the market may have hedged volume changes) and its market_info volume.
      // TTL is the safety net; this is the freshness path so a trader sees
      // their own position update within one poll instead of after the TTL.
      await cacheInvalidatePattern(`${POSITIONS_KEY_PREFIX}net:${marketId}:*`);
      await cacheInvalidate(`market_info:${marketId}`);

      return { success: true, data };
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd packages/backend && npx vitest run tests/services/positionCache.test.js`
Expected: PASS (2 tests).

- [ ] **Step 7: Commit**

```bash
git add packages/backend/src/services/infoFiPositionService.js packages/backend/tests/services/positionCache.test.js
git commit -m "feat(backend): cache getNetPosition + invalidate on trade (#162)"
```

---

## Task 3: Extract + cache `getMarketInfo`; wire both info endpoints

**Files:**
- Modify: `packages/backend/src/services/infoFiPositionService.js` (new `getMarketInfo` method)
- Modify: `packages/backend/fastify/routes/infoFiRoutes.js` (`/markets/:id/info` ~355, `/markets/batch-info` ~459)
- Test: `packages/backend/tests/services/marketInfoCache.test.js`

- [ ] **Step 1: Write the failing test**

Create `packages/backend/tests/services/marketInfoCache.test.js`:

```js
// tests/services/marketInfoCache.test.js
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const hoisted = vi.hoisted(() => ({ cacheRead: vi.fn() }));

vi.mock("../../shared/redisCache.js", async (orig) => {
  const actual = await orig();
  return { ...actual, cacheRead: hoisted.cacheRead };
});
vi.mock("../../shared/supabaseClient.js", () => ({
  db: { client: { from: vi.fn() } },
}));
vi.mock("../../src/lib/viemClient.js", () => ({ publicClient: {} }));

import { infoFiPositionService } from "../../src/services/infoFiPositionService.js";
import { MARKET_INFO_KEY_PREFIX } from "../../shared/redisCache.js";

beforeEach(() => hoisted.cacheRead.mockReset());

describe("getMarketInfo caching", () => {
  it("reads through cacheRead keyed by market id with a 20s TTL", async () => {
    const cached = { totalYesPool: "0", totalNoPool: "0", volume: "0" };
    hoisted.cacheRead.mockResolvedValueOnce(cached);

    const result = await infoFiPositionService.getMarketInfo(42);

    expect(result).toEqual(cached);
    const [key, , opts] = hoisted.cacheRead.mock.calls[0];
    expect(key).toBe(`${MARKET_INFO_KEY_PREFIX}42`);
    expect(opts.ttlSeconds).toBe(20);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/backend && npx vitest run tests/services/marketInfoCache.test.js`
Expected: FAIL — `getMarketInfo` is not a function.

- [ ] **Step 3: Add `getMarketInfo` to the service**

In `src/services/infoFiPositionService.js`, add `MARKET_INFO_KEY_PREFIX` to the redisCache import added in Task 2:

```js
import {
  cacheRead,
  cacheInvalidate,
  cacheInvalidatePattern,
  POSITIONS_KEY_PREFIX,
  MARKET_INFO_KEY_PREFIX,
} from "../../shared/redisCache.js";
```

Add this method to the class (e.g. directly after `getNetPosition`). It is the logic currently inlined in the `/markets/:id/info` route handler, made reusable + cached:

```js
  /**
   * Market pool info: on-chain FPMM reserves + DB-derived traded volume.
   * Returns WEI strings: { totalYesPool, totalNoPool, volume }.
   * Cached 20s; invalidated by recordPosition on a new trade (volume changes).
   */
  async getMarketInfo(marketId) {
    return cacheRead(
      `${MARKET_INFO_KEY_PREFIX}${marketId}`,
      async () => {
        const { data: market, error: marketError } = await db.client
          .from("infofi_markets")
          .select("id, contract_address")
          .eq("id", marketId)
          .single();

        if (marketError || !market) {
          const err = new Error("Market not found");
          err.code = "MARKET_NOT_FOUND";
          throw err;
        }

        if (!market.contract_address) {
          return { totalYesPool: "0", totalNoPool: "0", volume: "0" };
        }

        let totalYesPool = "0";
        let totalNoPool = "0";
        try {
          const [yesReserve, noReserve] = await Promise.all([
            publicClient.readContract({
              address: market.contract_address,
              abi: simpleFpmmAbi,
              functionName: "yesReserve",
            }),
            publicClient.readContract({
              address: market.contract_address,
              abi: simpleFpmmAbi,
              functionName: "noReserve",
            }),
          ]);
          totalYesPool = yesReserve.toString();
          totalNoPool = noReserve.toString();
        } catch {
          // reserves unavailable — return zeros for pools, still compute volume
        }

        const { data: volumeData, error: volumeError } = await db.client
          .from("infofi_positions")
          .select("amount")
          .eq("market_id", marketId);

        let volumeWei = 0n;
        const WEI = 10n ** 18n;
        if (!volumeError && volumeData) {
          for (const pos of volumeData) {
            try {
              const humanAmount = parseFloat(pos.amount || "0");
              if (humanAmount > 0) {
                const wholePart = BigInt(Math.floor(humanAmount));
                const fracPart = BigInt(
                  Math.round((humanAmount - Math.floor(humanAmount)) * 1e18),
                );
                volumeWei += wholePart * WEI + fracPart;
              }
            } catch {
              // skip invalid amounts
            }
          }
        }

        return {
          totalYesPool,
          totalNoPool,
          volume: volumeWei.toString(),
        };
      },
      { ttlSeconds: 20 },
    );
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/backend && npx vitest run tests/services/marketInfoCache.test.js`
Expected: PASS (1 test).

- [ ] **Step 5: Wire the `/markets/:id/info` route to the service**

In `fastify/routes/infoFiRoutes.js`, replace the body of the `/markets/:marketId/info` handler (everything inside the `try`) with a call to the cached service method:

```js
  fastify.get("/markets/:marketId/info", async (request, reply) => {
    try {
      const { marketId } = request.params;
      const info = await infoFiPositionService.getMarketInfo(marketId);
      return reply.send(info);
    } catch (error) {
      if (error.code === "MARKET_NOT_FOUND") {
        return reply.code(404).send({ error: "Market not found" });
      }
      fastify.log.error({ error }, "Failed to fetch market info");
      return reply.code(500).send({
        error: "Failed to fetch market info",
        details: error.message,
      });
    }
  });
```

- [ ] **Step 6: Wire `/markets/batch-info` to reuse the cached method**

In the `/markets/batch-info` handler, replace the per-id info computation loop so each id resolves via `infoFiPositionService.getMarketInfo(id)` (returning zeros on `MARKET_NOT_FOUND`). The handler shape:

```js
  fastify.get("/markets/batch-info", async (request, reply) => {
    try {
      const { ids } = request.query;
      if (!ids) {
        return reply.code(400).send({ error: "ids query parameter is required" });
      }
      const marketIds = ids
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean)
        .slice(0, 50);

      const results = {};
      await Promise.all(
        marketIds.map(async (id) => {
          try {
            results[id] = await infoFiPositionService.getMarketInfo(id);
          } catch {
            results[id] = { totalYesPool: "0", totalNoPool: "0", volume: "0" };
          }
        }),
      );

      return reply.send({ results });
    } catch (error) {
      fastify.log.error({ error }, "Failed to batch-fetch market info");
      return reply.code(500).send({ error: "Failed to batch-fetch market info" });
    }
  });
```

- [ ] **Step 7: Run the route tests + lint**

Run: `cd packages/backend && npx vitest run tests/ && npm run lint`
Expected: all pass, lint exits 0.

- [ ] **Step 8: Commit**

```bash
git add packages/backend/src/services/infoFiPositionService.js packages/backend/fastify/routes/infoFiRoutes.js packages/backend/tests/services/marketInfoCache.test.js
git commit -m "feat(backend): extract + cache getMarketInfo; reuse in /info + /batch-info (#162)"
```

---

## Task 4: Cache `getSeasonTransactions` + invalidate on sync

**Files:**
- Modify: `packages/backend/src/services/raffleTransactionService.js` (imports; `getSeasonTransactions` ~389; `syncSeasonTransactions` ~123)
- Test: `packages/backend/tests/services/raffleTxCache.test.js`

- [ ] **Step 1: Write the failing test**

Create `packages/backend/tests/services/raffleTxCache.test.js`:

```js
// tests/services/raffleTxCache.test.js
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const hoisted = vi.hoisted(() => ({ cacheRead: vi.fn() }));

vi.mock("../../shared/redisCache.js", async (orig) => {
  const actual = await orig();
  return { ...actual, cacheRead: hoisted.cacheRead };
});
vi.mock("../../shared/supabaseClient.js", () => ({
  db: { client: { from: vi.fn() } },
}));

import { raffleTransactionService } from "../../src/services/raffleTransactionService.js";
import { RAFFLE_TX_KEY_PREFIX } from "../../shared/redisCache.js";

beforeEach(() => hoisted.cacheRead.mockReset());

describe("getSeasonTransactions caching", () => {
  it("reads through cacheRead keyed by season+pagination, 30s TTL", async () => {
    const cached = { transactions: [{ id: 1 }], total: 1 };
    hoisted.cacheRead.mockResolvedValueOnce(cached);

    const result = await raffleTransactionService.getSeasonTransactions(3, {
      limit: 500,
      offset: 0,
      order: "desc",
    });

    expect(result).toEqual(cached);
    const [key, , opts] = hoisted.cacheRead.mock.calls[0];
    expect(key).toBe(`${RAFFLE_TX_KEY_PREFIX}3:desc:500:0`);
    expect(opts.ttlSeconds).toBe(30);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/backend && npx vitest run tests/services/raffleTxCache.test.js`
Expected: FAIL — `getSeasonTransactions` does not call `cacheRead`.

- [ ] **Step 3: Add imports**

At the top of `src/services/raffleTransactionService.js`, add (after the existing imports):

```js
import {
  cacheRead,
  cacheInvalidatePattern,
  RAFFLE_TX_KEY_PREFIX,
} from "../../shared/redisCache.js";

const RAFFLE_TX_CACHE_TTL_SECONDS = 30;
```

- [ ] **Step 4: Wrap `getSeasonTransactions` in cacheRead**

Replace the `getSeasonTransactions` method with:

```js
  async getSeasonTransactions(seasonId, options = {}) {
    const {
      limit = 200,
      offset = 0,
      order = "desc",
    } = options;

    const key = `${RAFFLE_TX_KEY_PREFIX}${seasonId}:${order}:${limit}:${offset}`;
    return cacheRead(
      key,
      async () => {
        // Scope to the season's current bonding curve so prior-deployment rows
        // in the same season_id partition don't bleed in (#144).
        const curveAddress = await this.getSeasonCurveAddress(seasonId);
        let query = db.client
          .from("raffle_transactions")
          .select("*", { count: "exact" })
          .eq("season_id", seasonId);
        if (curveAddress) {
          query = query.eq("bonding_curve_address", curveAddress);
        }
        const { data, error, count } = await query
          .order("block_timestamp", { ascending: order === "asc" })
          .range(offset, offset + limit - 1);

        if (error) throw error;
        return { transactions: data, total: count };
      },
      { ttlSeconds: RAFFLE_TX_CACHE_TTL_SECONDS },
    );
  }
```

- [ ] **Step 5: Invalidate in `syncSeasonTransactions` when new rows land**

Read `syncSeasonTransactions` (starts ~line 123). At the end of the method, after the sync completes successfully and the function knows how many rows were inserted, add a pattern bust for that season **only when something changed**. Locate the method's success return (it returns an object describing the sync result, e.g. `{ synced, inserted, ... }`) and insert just before the return:

```js
    // New transactions for this season changed the cached list — bust all
    // paginations for the season. Guard on actual inserts so a no-op sync
    // (the common steady-state) doesn't thrash the cache.
    if (insertedCount > 0) {
      await cacheInvalidatePattern(`${RAFFLE_TX_KEY_PREFIX}${seasonId}:*`);
    }
```

Use the method's existing inserted-count variable in the `insertedCount > 0` guard; if the method tracks inserts under a different name (e.g. `result.inserted` or `newRows.length`), use that exact name. If no such count exists, compute it from the insert result already present in the method (do not add a second DB call).

- [ ] **Step 6: Run test + full suite + lint**

Run: `cd packages/backend && npx vitest run tests/ && npm run lint`
Expected: all pass, lint exits 0.

- [ ] **Step 7: Commit**

```bash
git add packages/backend/src/services/raffleTransactionService.js packages/backend/tests/services/raffleTxCache.test.js
git commit -m "feat(backend): cache getSeasonTransactions + invalidate on sync (#162)"
```

---

## Task 5: Bump backend version + open the PR

**Files:**
- Modify: `packages/backend/package.json`

- [ ] **Step 1: Bump the patch version**

In `packages/backend/package.json`, change `"version": "0.31.3"` to `"version": "0.31.4"`.
(If `main` has advanced past 0.31.3, bump whatever the current value is by one patch.)

- [ ] **Step 2: Run the full backend suite + lint one more time**

Run: `cd packages/backend && npm test && npm run lint`
Expected: all green.

- [ ] **Step 3: Commit + push + open PR**

```bash
git add packages/backend/package.json
git commit -m "chore(backend): bump 0.31.3 -> 0.31.4 (egress caching #162)"
git push -u origin fix/egress-cache-and-poll-gating-162
```

Then open the PR (the spec + plan commits are already on the branch):

```bash
gh pr create --title "fix: egress caching + poll-gating for settled seasons (#162)" --body "Closes #162.

## Summary
Re-diagnosis (see spec) showed the remaining Supabase egress is live polling of uncached endpoints, not archive reads. This PR:
- Phase 1 (backend): read-through Redis cache for getNetPosition, getMarketInfo (/info + /batch-info), and getSeasonTransactions, with event-based invalidation from recordPosition and the raffle-tx sync.
- Phase 2 (frontend): stop polling terminal (status >= 4) season data.

## Test plan
- [ ] backend: npm test (new positionCache/marketInfoCache/raffleTxCache suites + full suite)
- [ ] frontend: npm test (new gating suites + full suite)
- [ ] manual: a trade updates a position within one poll cycle (invalidation working)
"
```

---

# Phase 2 — Frontend poll-gating

## Task 6: Split `useInfoFiMarkets` into live vs terminal queries

**Files:**
- Modify: `packages/frontend/src/hooks/useInfoFiMarkets.js`
- Test: `packages/frontend/src/hooks/__tests__/useInfoFiMarkets.gating.test.jsx`

- [ ] **Step 1: Write the failing test**

Create `packages/frontend/src/hooks/__tests__/useInfoFiMarkets.gating.test.jsx`:

```jsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { useInfoFiMarkets } from "../useInfoFiMarkets";

function wrapper({ children }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  global.fetch = vi.fn(async (url) => {
    const seasonId = new URL(url, "http://x").searchParams.get("seasonId");
    return {
      ok: true,
      json: async () => ({ markets: { [seasonId]: [{ id: Number(seasonId) }] } }),
    };
  });
});

describe("useInfoFiMarkets live/terminal gating", () => {
  it("merges markets from both live and terminal seasons", async () => {
    const seasons = [
      { id: 1, status: 1 }, // live
      { id: 2, status: 5 }, // terminal
    ];
    const { result } = renderHook(() => useInfoFiMarkets(seasons, {}), { wrapper });

    await waitFor(() => {
      expect(Object.keys(result.current.markets)).toContain("1");
      expect(Object.keys(result.current.markets)).toContain("2");
    });
  });

  it("does not poll when every passed season is terminal", async () => {
    const seasons = [
      { id: 2, status: 4 },
      { id: 3, status: 5 },
    ];
    const { result } = renderHook(() => useInfoFiMarkets(seasons, {}), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const callsAfterLoad = global.fetch.mock.calls.length;
    await new Promise((r) => setTimeout(r, 50));
    // No refetchInterval on a fully-terminal set: call count stays flat.
    expect(global.fetch.mock.calls.length).toBe(callsAfterLoad);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/frontend && npx vitest run src/hooks/__tests__/useInfoFiMarkets.gating.test.jsx`
Expected: FAIL — current hook returns a single merged shape but the "terminal-only → no poll" expectation may pass by accident only if implemented; the merge test should pass, the gating test fails because the single query always sets `refetchInterval: 10_000`.

- [ ] **Step 3: Rewrite the hook to split by status**

Replace the `useInfoFiMarkets` export in `src/hooks/useInfoFiMarkets.js` (keep `fetchMarketsFromAPI` as-is):

```jsx
export function useInfoFiMarkets(seasons = [], filters = {}) {
  const liveSeasons = React.useMemo(
    () => (seasons || []).filter((s) => Number(s?.status) < 4),
    [seasons],
  );
  const terminalSeasons = React.useMemo(
    () => (seasons || []).filter((s) => Number(s?.status) >= 4),
    [seasons],
  );

  const liveQuery = useQuery({
    queryKey: ["infofi", "markets", "api", "live", liveSeasons.map((s) => s.id).join(","), JSON.stringify(filters)],
    queryFn: () => fetchMarketsFromAPI(liveSeasons, filters),
    staleTime: 10_000,
    refetchInterval: liveSeasons.length > 0 ? 10_000 : false,
    enabled: liveSeasons.length > 0,
  });

  const terminalQuery = useQuery({
    queryKey: ["infofi", "markets", "api", "terminal", terminalSeasons.map((s) => s.id).join(","), JSON.stringify(filters)],
    queryFn: () => fetchMarketsFromAPI(terminalSeasons, filters),
    staleTime: Infinity,
    refetchInterval: false,
    enabled: terminalSeasons.length > 0,
  });

  const markets = React.useMemo(
    () => ({ ...(terminalQuery.data || {}), ...(liveQuery.data || {}) }),
    [liveQuery.data, terminalQuery.data],
  );

  const marketsArray = React.useMemo(
    () => Object.values(markets).flat(),
    [markets],
  );

  return {
    markets,
    marketsArray,
    isLoading:
      (liveSeasons.length > 0 && liveQuery.isLoading) ||
      (terminalSeasons.length > 0 && terminalQuery.isLoading),
    error: liveQuery.error || terminalQuery.error,
    refetch: () => {
      liveQuery.refetch();
      terminalQuery.refetch();
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/frontend && npx vitest run src/hooks/__tests__/useInfoFiMarkets.gating.test.jsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Run the existing markets-related tests to check for regressions**

Run: `cd packages/frontend && npx vitest run src/routes/__tests__/`
Expected: PASS (no regressions in MarketsIndex/RaffleList consumers).

- [ ] **Step 6: Commit**

```bash
git add packages/frontend/src/hooks/useInfoFiMarkets.js packages/frontend/src/hooks/__tests__/useInfoFiMarkets.gating.test.jsx
git commit -m "feat(frontend): stop polling terminal seasons in useInfoFiMarkets (#162)"
```

---

## Task 7: `isLive` gate on `useUserMarketPosition` + `useMarketInfo`

**Files:**
- Modify: `packages/frontend/src/hooks/useUserMarketPosition.js`
- Test: `packages/frontend/src/hooks/__tests__/useUserMarketPosition.gating.test.jsx`

- [ ] **Step 1: Write the failing test**

Create `packages/frontend/src/hooks/__tests__/useUserMarketPosition.gating.test.jsx`:

```jsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

vi.mock("@/hooks/useRaffleAccount", () => ({
  useRaffleAccount: () => ({ sma: "0xsma" }),
}));

import { useUserMarketPosition, useMarketInfo } from "../useUserMarketPosition";

function wrapper({ children }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  global.fetch = vi.fn(async () => ({
    ok: true,
    json: async () => ({ yes: "0", no: "0", net: "0", totalYesPool: "0", totalNoPool: "0", volume: "0" }),
  }));
});

describe("isLive gating", () => {
  it("useUserMarketPosition does not poll a settled market", async () => {
    const { result } = renderHook(
      () => useUserMarketPosition(7, { isLive: false }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const after = global.fetch.mock.calls.length;
    await new Promise((r) => setTimeout(r, 50));
    expect(global.fetch.mock.calls.length).toBe(after);
  });

  it("useMarketInfo does not poll a settled market", async () => {
    const { result } = renderHook(
      () => useMarketInfo(7, { isLive: false }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const after = global.fetch.mock.calls.length;
    await new Promise((r) => setTimeout(r, 50));
    expect(global.fetch.mock.calls.length).toBe(after);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/frontend && npx vitest run src/hooks/__tests__/useUserMarketPosition.gating.test.jsx`
Expected: FAIL — hooks ignore the options arg and keep `refetchInterval` 15s/20s, so fetch keeps firing.

- [ ] **Step 3: Add the `isLive` option to both hooks**

In `src/hooks/useUserMarketPosition.js`, change the `useUserMarketPosition` signature and query options:

```jsx
export const useUserMarketPosition = (marketId, { isLive = true } = {}) => {
  const { sma: address } = useRaffleAccount();

  return useQuery({
    queryKey: ["userMarketPosition", marketId, address],
    enabled: !!address && !!marketId,
    queryFn: async () => {
      // ...unchanged...
    },
    staleTime: isLive ? 10_000 : Infinity,
    refetchInterval: isLive ? 15_000 : false,
  });
};
```

And the `useMarketInfo` signature and query options:

```jsx
export const useMarketInfo = (marketId, { isLive = true } = {}) => {
  return useQuery({
    queryKey: ["marketInfo", marketId],
    enabled: !!marketId,
    queryFn: async () => {
      // ...unchanged...
    },
    staleTime: isLive ? 15_000 : Infinity,
    refetchInterval: isLive ? 20_000 : false,
  });
};
```

(Leave the `queryFn` bodies exactly as they are.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/frontend && npx vitest run src/hooks/__tests__/useUserMarketPosition.gating.test.jsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/hooks/useUserMarketPosition.js packages/frontend/src/hooks/__tests__/useUserMarketPosition.gating.test.jsx
git commit -m "feat(frontend): add isLive poll-gate to position + market-info hooks (#162)"
```

---

## Task 8: Wire callers to pass `isLive` / `enablePolling`

**Files:**
- Modify: `packages/frontend/src/components/infofi/InfoFiMarketCard.jsx:59,74`
- Modify: `packages/frontend/src/components/mobile/MobileMarketsList.jsx:21`
- Modify: `packages/frontend/src/components/curve/TransactionsTab.jsx:23`

- [ ] **Step 1: Determine the season-status source in each caller**

Read each caller and find the season status already in scope (the market object typically carries `season_id`/season status, or the parent passes it). For each call site, compute:

```jsx
const isLive = Number(season?.status) < 4;
```

using whatever season/status prop the component already receives. If the component does not have the season in scope, pass `isLive` down as a prop from the parent that renders it (the parent has the season from `useAllSeasons`). Do NOT fetch the season again inside the leaf component.

- [ ] **Step 2: Update `InfoFiMarketCard.jsx`**

At line ~59 and ~74, pass the option:

```jsx
const individualPosition = useUserMarketPosition(market.id, { isLive });
// ...
const individualMarketInfo = useMarketInfo(market.id, { isLive });
```

- [ ] **Step 3: Update `MobileMarketsList.jsx`**

At line ~21:

```jsx
const { data: individualPosition } = useUserMarketPosition(market.id, { isLive });
```

- [ ] **Step 4: Update `TransactionsTab.jsx`**

At line ~23, disable polling for completed seasons:

```jsx
const { transactions, isPending, error } = useRaffleTransactions(
  bondingCurveAddress,
  seasonId,
  { enablePolling: Number(seasonStatus) < 4 },
);
```

Use the season status prop the tab already receives; if it only has `seasonId`, accept a `seasonStatus` (or `isLive`) prop from its parent and thread it through.

- [ ] **Step 5: Set `staleTime: Infinity` for terminal raffle tx**

In `src/hooks/useRaffleTransactions.js`, make `staleTime` follow polling so a non-polling (terminal) call also treats data as fresh forever:

```jsx
    enabled: !!bondingCurveAddress && !!seasonId,
    staleTime: options.enablePolling !== false ? 30000 : Infinity,
    refetchInterval: options.enablePolling !== false ? 30000 : false,
```

- [ ] **Step 6: Run the relevant component tests + full frontend suite**

Run: `cd packages/frontend && npm test`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add packages/frontend/src/components/infofi/InfoFiMarketCard.jsx packages/frontend/src/components/mobile/MobileMarketsList.jsx packages/frontend/src/components/curve/TransactionsTab.jsx packages/frontend/src/hooks/useRaffleTransactions.js
git commit -m "feat(frontend): wire isLive/enablePolling gates from season status (#162)"
```

---

## Task 9: Bump frontend version + final checks

**Files:**
- Modify: `packages/frontend/package.json`

- [ ] **Step 1: Bump the patch version**

In `packages/frontend/package.json`, bump the `version` by one patch (e.g. `0.43.7` → `0.43.8`; use the actual current value).

- [ ] **Step 2: Run the full monorepo checks**

Run (from repo root): `npm test && npm run lint && npm run build`
Expected: all green across packages.

- [ ] **Step 3: Commit + push**

```bash
git add packages/frontend/package.json
git commit -m "chore(frontend): bump version (egress poll-gating #162)"
git push
```

---

## Task 10: Repurpose issue #162

- [ ] **Step 1: Rewrite the issue to the new scope (keeps the number; PR already links Closes #162)**

```bash
gh issue edit 162 \
  --title "Egress: cache uncached hot reads + stop polling settled-season data" \
  --body "## Context

Re-diagnosis (spec: docs/superpowers/specs/2026-06-05-egress-cache-and-poll-gating-design.md) found that settled raffle/prize data is read on-chain (not via Supabase), so the original Storage-snapshot plan would not reduce Supabase egress. After the #157–#164 fixes, the remaining egress is live polling of *uncached* endpoints.

## Scope
- Backend: read-through Redis cache for getNetPosition, getMarketInfo (/info + /batch-info), getSeasonTransactions; invalidate on trade (recordPosition) and raffle-tx sync.
- Frontend: stop polling terminal seasons (status >= 4) in useInfoFiMarkets, useUserMarketPosition, useMarketInfo, useRaffleTransactions.

## Acceptance
- The three endpoints serve from Redis on repeat reads; a trade invalidates the affected market within one poll cycle.
- Terminal-season views issue one fetch and never poll.
- Tests for cache hit/miss/invalidation (backend) and interval gating (frontend)."
```

- [ ] **Step 2: Confirm the edit**

Run: `gh issue view 162 --json title -q .title`
Expected: prints the new title.

---

## Self-Review

**Spec coverage:**
- Unit 1 positions cache → Task 2. ✓
- Unit 1 market_info cache (+ /info + /batch-info) → Task 3. ✓
- Unit 1 raffle_tx cache + sync invalidation → Task 4. ✓
- Unit 1 invalidation from recordPosition → Task 2 Step 5. ✓
- Unit 1 new key prefixes → Task 1. ✓
- Unit 2 useInfoFiMarkets split → Task 6. ✓
- Unit 2 useUserMarketPosition/useMarketInfo isLive → Task 7. ✓
- Unit 2 useRaffleTransactions terminal staleTime + caller wiring → Task 8. ✓
- Version bumps → Tasks 5, 9. ✓
- Repurpose #162 → Task 10. ✓
- Tests for both units → Tasks 2,3,4,6,7. ✓

**Type/name consistency:**
- Prefix constants (`POSITIONS_KEY_PREFIX`, `MARKET_INFO_KEY_PREFIX`, `RAFFLE_TX_KEY_PREFIX`) defined in Task 1, used identically in Tasks 2–4. ✓
- Cache key shapes match between reader and the test assertions (`positions:net:{id}:{user}`, `market_info:{id}`, `raffle_tx:{id}:{order}:{limit}:{offset}`). ✓
- `getMarketInfo` defined in Task 3, consumed by both route handlers in the same task. ✓
- `isLive` option name consistent across hook defs (Task 7) and callers (Task 8). ✓

**Known soft spot (flagged for the implementer):**
- Task 4 Step 5 depends on the inserted-row count variable inside `syncSeasonTransactions`. The plan instructs using the method's existing count and not adding a DB call. The implementer must read that method and bind the correct variable name.
- Task 8 requires each leaf component to have season status in scope; the plan says thread it from the parent rather than refetch. Verify the parent has it (it comes from `useAllSeasons`).
