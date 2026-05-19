# Frontend RPC Reduction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace ~60 frontend RPC-polling read hooks with four typed tiers (cold/warm/live/ultra-fresh), routed through a backend Blockscout proxy and per-domain SSE channels, eliminating sustained polling against Tenderly.

**Architecture:** Five-tier freshness gradient — ultra-fresh stays on RPC (user's own state after their own tx, invalidated by centralized `executeBatch.onSuccess` predicate); live uses per-domain SSE channels (`/sse/{raffle,infofi,rollover}`); warm uses backend REST cached against Supabase populated by listeners; cold uses backend → Blockscout proxy with LRU cache. Single big-bang PR — no feature flag, no parallel patterns. Risk mitigation via layered tests + a Tenderly RPC delta gate before merge.

**Tech Stack:** Vitest, React Query (@tanstack/react-query), wagmi v2, viem, Fastify, Supabase, EventSource (SSE), Node 20.

**Spec:** [`docs/superpowers/specs/2026-05-16-frontend-rpc-reduction-design.md`](../specs/2026-05-16-frontend-rpc-reduction-design.md)

---

## File Structure

### New files

```
packages/backend/
  src/services/
    sseChannelService.js          # multi-channel SSE service (replaces sseService.js)
    blockscoutClient.js           # outbound HTTP client + LRU cache
    curveStateService.js          # reads/writes for curve_state table
  fastify/routes/
    blockscoutRoutes.js           # /api/blockscout/* proxy (5 endpoints)
    curveRoutes.js                # /api/curve/:addr/{state,steps,treasury}
    chainTimeRoutes.js            # /api/chain/time
  migrations/
    018_curve_state.sql           # new curve_state table
  tests/backend/
    sseChannelService.test.js
    blockscoutClient.test.js
    blockscoutRoutes.test.js
    curveRoutes.test.js
    seasonsAllRoute.test.js
    chainTimeRoute.test.js

packages/frontend/src/
  hooks/chain/
    internal.js                   # shared error normalization, network key, telemetry
    useColdRead.js
    useWarmRead.js
    useLiveSubscription.js
    useUltraFreshRead.js
    sseRegistry.js                # shared EventSource per channel
  hooks/chain/__tests__/
    useColdRead.test.js
    useWarmRead.test.js
    useLiveSubscription.test.js
    useUltraFreshRead.test.js
    sseRegistry.test.js
    executeBatchInvalidation.test.js
```

### Files modified

```
packages/backend/
  fastify/server.js                              # register new routes; remove /sse/market-events
  fastify/routes/sseRoutes.js                    # rewrite for 3 channels
  fastify/routes/seasonRoutes.js                 # add GET /all (renames existing GET /)
  shared/assertRequiredEnv.js                    # add BLOCKSCOUT_API_KEY, BLOCKSCOUT_BASE_URL
  shared/supabaseClient.js                       # add curve_state CRUD helpers
  src/listeners/tradeListener.js                 # +sse broadcast + curve_state writes
  src/listeners/positionUpdateListener.js        # +sse broadcast + curve_state writes
  src/listeners/marketCreatedListener.js         # +sse broadcast
  src/listeners/rolloverEventListener.js         # +sse broadcast
  src/listeners/seasonStartedListener.js         # +sse broadcast + curve_state seed (bond_steps)
  src/listeners/seasonCompletedListener.js       # +sse broadcast
  src/listeners/sponsorPrizeListener.js          # +sse broadcast
  src/listeners/sponsorHatListener.js            # +sse broadcast
  src/listeners/accountCreatedListener.js        # +sse broadcast
  src/services/seasonLifecycleService.js         # update cached chain time
  env/.env.local.example                         # +BLOCKSCOUT_API_KEY, BLOCKSCOUT_BASE_URL
  env/.env.testnet.example                       # +BLOCKSCOUT_BASE_URL (key already added)
  env/.env.mainnet.example                       # +BLOCKSCOUT_BASE_URL (key already added)
  package.json                                   # bump minor version

packages/frontend/src/
  hooks/useSmartTransactions.js                  # centralized invalidation in executeBatch
  hooks/useAllSeasons.js                         # rewrite via useWarmRead
  hooks/useCurveState.js                         # rewrite: passive→warm, active→warm+SSE
  hooks/useCurveEvents.js                        # rewrite via useLiveSubscription
  hooks/useTreasury.js                           # rewrite via useWarmRead + useUltraFreshRead
  hooks/useChainTime.js                          # rewrite via useWarmRead
  hooks/useSOFBalance.js                         # rewrite via useUltraFreshRead
  hooks/useSofDecimals.js                        # rewrite via useUltraFreshRead (infinite stale)
  hooks/usePlayerPosition.js                     # split: self ultra-fresh / others warm
  hooks/useRollover.js                           # rewrite via useWarmRead + useLiveSubscription
  hooks/useEligibleRolloverCohort.js             # rewrite via useWarmRead
  hooks/useConsolationStatus.js                  # rewrite via useWarmRead
  hooks/useInfoFiMarket.js                       # rewrite via useWarmRead
  hooks/useMarketsBatchInfo.js                   # rewrite via useWarmRead
  hooks/useMarketCardData.js                     # rewrite via useWarmRead
  hooks/useRafflePrizes.js                       # rewrite via useWarmRead
  hooks/useSeasonGating.js                       # rewrite via useWarmRead
  hooks/useSeasonWinnerSummaries.js              # split: active warm / past cold
  hooks/useInfoFiMarketsAdmin.js                 # rewrite via useWarmRead
  hooks/useInfoFiFactory.js                      # rewrite read paths via useWarmRead
  hooks/useAccessControl.js                      # rewrite via useUltraFreshRead
  hooks/useRaffleRead.js                         # delete useSeasonDetailsQuery (moved to warm)
  hooks/buysell/useBuySellTransactions.js        # delete hand-rolled invalidations
  components/curve/BuySellWidget.jsx             # use new hooks
  components/curve/TokenInfoTab.jsx              # use new hooks
  components/curve/TransactionsTab.jsx           # use cold for completed seasons
  components/mobile/BuySellSheet.jsx             # use new hooks
  components/infofi/BuySellWidget.jsx            # use live + warm
  components/infofi/ClaimCenter.jsx              # use live + warm; delete invalidations
  components/infofi/RewardsDebug.jsx             # use live
  components/infofi/PositionsPanel.jsx           # use warm
  components/infofi/InfoFiMarketCard.jsx         # delete invalidations
  components/infofi/InfoFiMarketCardMobile.jsx   # delete invalidations
  components/account/InfoFiPositionsTab.jsx      # use warm
  components/account/ProfileContent.jsx          # use warm
  routes/RaffleList.jsx                          # use warm + cold for completed
  routes/UserProfile.jsx                         # use cold for activity tab
  routes/AdminPanel.jsx                          # use warm + ultra-fresh
  features/admin/components/BackendWalletManager.jsx  # use warm
  features/admin/components/ManualMarketCreation.jsx  # use warm
  components/auth/SweepBanner.jsx                # use warm
  package.json                                   # bump minor version
```

### Files deleted

```
packages/backend/src/services/sseService.js      # replaced by sseChannelService.js
```

---

## Phase A — Backend foundations

### Task A1: Multi-channel SSE service

**Files:**
- Create: `packages/backend/src/services/sseChannelService.js`
- Test: `packages/backend/tests/backend/sseChannelService.test.js`

- [ ] **Step 1: Write failing test**

```javascript
// packages/backend/tests/backend/sseChannelService.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SSEChannelService } from '../../src/services/sseChannelService.js';

const noopLogger = { info: vi.fn(), debug: vi.fn(), error: vi.fn(), warn: vi.fn() };

function fakeReply() {
  return { raw: { write: vi.fn(), end: vi.fn() } };
}

describe('SSEChannelService', () => {
  let svc;
  beforeEach(() => {
    svc = new SSEChannelService(noopLogger, ['raffle', 'infofi', 'rollover']);
  });

  it('rejects unknown channel on addConnection', () => {
    expect(() => svc.addConnection('bogus', 'c1', fakeReply())).toThrow(/unknown channel/i);
  });

  it('isolates broadcasts per channel', () => {
    const replyA = fakeReply();
    const replyB = fakeReply();
    svc.addConnection('raffle', 'a', replyA);
    svc.addConnection('infofi', 'b', replyB);
    svc.broadcast('raffle', { type: 'PositionUpdate', seasonId: 1 });
    expect(replyA.raw.write).toHaveBeenCalledTimes(1);
    expect(replyB.raw.write).not.toHaveBeenCalled();
  });

  it('removes connection that throws on write', () => {
    const replyA = fakeReply();
    replyA.raw.write.mockImplementation(() => { throw new Error('peer reset'); });
    svc.addConnection('raffle', 'a', replyA);
    svc.broadcast('raffle', { type: 'x' });
    expect(svc.getConnectionCount('raffle')).toBe(0);
  });

  it('counts connections per channel', () => {
    svc.addConnection('raffle', 'a', fakeReply());
    svc.addConnection('raffle', 'b', fakeReply());
    svc.addConnection('infofi', 'c', fakeReply());
    expect(svc.getConnectionCount('raffle')).toBe(2);
    expect(svc.getConnectionCount('infofi')).toBe(1);
    expect(svc.getConnectionCount('rollover')).toBe(0);
  });

  it('removeConnection is idempotent', () => {
    svc.addConnection('raffle', 'a', fakeReply());
    svc.removeConnection('raffle', 'a');
    svc.removeConnection('raffle', 'a');
    expect(svc.getConnectionCount('raffle')).toBe(0);
  });

  it('closeAllConnections clears every channel', () => {
    svc.addConnection('raffle', 'a', fakeReply());
    svc.addConnection('infofi', 'b', fakeReply());
    svc.closeAllConnections();
    expect(svc.getConnectionCount('raffle')).toBe(0);
    expect(svc.getConnectionCount('infofi')).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/backend && npx vitest run tests/backend/sseChannelService.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the service**

```javascript
// packages/backend/src/services/sseChannelService.js
/**
 * Multi-channel SSE service. Each channel maintains its own connection map,
 * so a broadcast on `raffle` doesn't reach subscribers of `infofi`.
 *
 * Constructed with an explicit channel list to fail loud on typos in
 * broadcast(channel, ...) calls — better than silently routing into a
 * channel that no one is listening to.
 */
export class SSEChannelService {
  constructor(logger, channels) {
    this.logger = logger;
    this.channels = new Map();
    for (const name of channels) {
      this.channels.set(name, new Map());
    }
  }

  _channel(name) {
    const ch = this.channels.get(name);
    if (!ch) {
      throw new Error(`Unknown channel: ${name}`);
    }
    return ch;
  }

  addConnection(channel, id, reply) {
    this._channel(channel).set(id, reply);
    this.logger.info(`📡 SSE add ${channel}/${id} (total: ${this.getConnectionCount(channel)})`);
  }

  removeConnection(channel, id) {
    const ch = this._channel(channel);
    if (ch.delete(id)) {
      this.logger.info(`📡 SSE remove ${channel}/${id} (total: ${ch.size})`);
    }
  }

  broadcast(channel, message) {
    const ch = this._channel(channel);
    const payload = `data: ${JSON.stringify({ ...message, timestamp: new Date().toISOString() })}\n\n`;
    const dead = [];
    let sent = 0;
    for (const [id, reply] of ch.entries()) {
      try {
        reply.raw.write(payload);
        sent++;
      } catch (err) {
        this.logger.error(`❌ SSE write failed ${channel}/${id}: ${err.message}`);
        dead.push(id);
      }
    }
    for (const id of dead) ch.delete(id);
    if (sent > 0) {
      this.logger.debug(`📤 ${channel} → ${sent} clients (${dead.length} dropped)`);
    }
    return { sent, failed: dead.length };
  }

  getConnectionCount(channel) {
    return this._channel(channel).size;
  }

  getConnectionIds(channel) {
    return Array.from(this._channel(channel).keys());
  }

  closeAllConnections() {
    for (const [name, ch] of this.channels.entries()) {
      for (const [, reply] of ch.entries()) {
        try { reply.raw.end(); } catch { /* ignore */ }
      }
      ch.clear();
      this.logger.info(`📡 SSE closed channel ${name}`);
    }
  }
}

let _singleton = null;
const CHANNELS = ['raffle', 'infofi', 'rollover'];

export function getSSEChannelService(logger) {
  if (!_singleton) {
    _singleton = new SSEChannelService(logger, CHANNELS);
  }
  return _singleton;
}

export { CHANNELS };
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd packages/backend && npx vitest run tests/backend/sseChannelService.test.js`
Expected: PASS — all 6 tests green.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/services/sseChannelService.js packages/backend/tests/backend/sseChannelService.test.js
git commit -m "feat(backend): multi-channel SSE service"
```

---

### Task A2: Per-domain SSE routes

**Files:**
- Modify: `packages/backend/fastify/routes/sseRoutes.js` (full rewrite)
- Modify: `packages/backend/fastify/server.js` (register new routes; remove old `/sse/market-events`)

- [ ] **Step 1: Rewrite sseRoutes.js for 3 channels**

```javascript
// packages/backend/fastify/routes/sseRoutes.js
import { getSSEChannelService, CHANNELS } from '../../src/services/sseChannelService.js';

const HEARTBEAT_MS = 30_000;

function registerChannelRoute(fastify, logger, sseService, channel) {
  fastify.get(`/${channel}`, async (request, reply) => {
    const connectionId = `${channel}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Cache-Control',
    });
    sseService.addConnection(channel, connectionId, reply);
    reply.raw.write(
      `data: ${JSON.stringify({
        type: 'connected',
        channel,
        connectionId,
        timestamp: new Date().toISOString(),
      })}\n\n`,
    );
    const heartbeat = setInterval(() => {
      try {
        reply.raw.write(': heartbeat\n\n');
      } catch {
        clearInterval(heartbeat);
        sseService.removeConnection(channel, connectionId);
      }
    }, HEARTBEAT_MS);
    request.raw.on('close', () => {
      clearInterval(heartbeat);
      sseService.removeConnection(channel, connectionId);
    });
    request.raw.on('error', (err) => {
      logger.error(`SSE ${channel}/${connectionId} error: ${err.message}`);
      clearInterval(heartbeat);
      sseService.removeConnection(channel, connectionId);
    });
  });
}

export async function registerSSERoutes(fastify, options) {
  const { logger } = options;
  const sseService = getSSEChannelService(logger);

  for (const channel of CHANNELS) {
    registerChannelRoute(fastify, logger, sseService, channel);
  }

  fastify.get('/health', async () => ({
    status: 'ok',
    channels: Object.fromEntries(
      CHANNELS.map((c) => [c, sseService.getConnectionCount(c)]),
    ),
    timestamp: new Date().toISOString(),
  }));

  logger.info(`✅ SSE routes registered: ${CHANNELS.map((c) => `/${c}`).join(', ')}, /health`);
}

export default registerSSERoutes;
```

- [ ] **Step 2: Update server.js registration**

Find the existing SSE route registration in `packages/backend/fastify/server.js` and change the URL prefix. The old line looked like `await fastify.register(sseRoutes, { prefix: '/sse', logger: fastify.log });` — keep that, but ensure no second registration of the old service.

```javascript
// packages/backend/fastify/server.js (where SSE routes are registered)
await fastify.register(sseRoutes, { prefix: '/sse', logger: fastify.log });
```

(No change if already prefixed `/sse` — the route names changed from `/sse/market-events` to `/sse/raffle`, `/sse/infofi`, `/sse/rollover`.)

- [ ] **Step 3: Verify lint + existing tests pass**

Run: `cd packages/backend && npm run lint && npx vitest run tests/backend/sseChannelService.test.js`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/backend/fastify/routes/sseRoutes.js packages/backend/fastify/server.js
git commit -m "feat(backend): per-domain SSE routes (raffle, infofi, rollover)"
```

---

### Task A3: Delete legacy sseService.js

**Files:**
- Delete: `packages/backend/src/services/sseService.js`
- Modify: any callers still importing it (marketCreatedListener.js, farcasterWebhookRoutes.js — to be re-wired in Phase B; for now they'll fail to import)

- [ ] **Step 1: Find callers**

Run: `cd packages/backend && grep -rn "sseService" src/ fastify/ shared/ --include='*.js' | grep -v sseChannelService`
Expected: list of files importing the old sseService.

- [ ] **Step 2: Stub old callers temporarily**

For each caller (typically `marketCreatedListener.js`, `farcasterWebhookRoutes.js`), replace the import with the new service. Example for `marketCreatedListener.js`:

```javascript
// OLD: import { getSSEService } from '../services/sseService.js';
import { getSSEChannelService } from '../services/sseChannelService.js';
// OLD: const sseService = getSSEService(logger);
const sseService = getSSEChannelService(logger);
// OLD: sseService.broadcastMarketCreationStarted({ ... })
sseService.broadcast('infofi', { type: 'MarketCreationStarted', ...payload });
// Similar for ...Confirmed and ...Failed: { type: 'MarketCreationConfirmed' }, { type: 'MarketCreationFailed' }
```

Apply identical swap to `farcasterWebhookRoutes.js` if it broadcasts (search file for `broadcast`, route the relevant events to the appropriate channel — most should go to `infofi` if they're market-related, otherwise leave un-broadcast).

- [ ] **Step 3: Delete sseService.js**

```bash
rm packages/backend/src/services/sseService.js
```

- [ ] **Step 4: Verify no stale imports**

Run: `cd packages/backend && grep -rn "from.*sseService['\"]" src/ fastify/ shared/ --include='*.js'`
Expected: empty.

- [ ] **Step 5: Run backend test suite**

Run: `cd packages/backend && npm test`
Expected: all green (sseService.test.js no longer exists; new sseChannelService.test.js passes).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor(backend): swap callers to multi-channel SSE; delete legacy sseService"
```

---

### Task A4: Curve state schema migration

**Files:**
- Create: `packages/backend/migrations/018_curve_state.sql`

- [ ] **Step 1: Write migration SQL**

```sql
-- packages/backend/migrations/018_curve_state.sql
-- Adds curve_state table to cache bonding curve state per season, populated
-- by tradeListener and positionUpdateListener so the frontend can read
-- accumulated fees, sof reserves, supply, current step, and immutable bond
-- steps from backend REST instead of polling RPC every 12s.

CREATE TABLE IF NOT EXISTS curve_state (
  bonding_curve_address TEXT PRIMARY KEY,
  accumulated_fees TEXT NOT NULL DEFAULT '0',     -- bigint as string
  sof_reserves TEXT NOT NULL DEFAULT '0',          -- bigint as string
  current_supply TEXT NOT NULL DEFAULT '0',        -- bigint as string
  current_step_index INTEGER,
  current_step_price TEXT,                         -- bigint as string
  current_step_range_to TEXT,                      -- bigint as string
  bond_steps JSONB,                                -- immutable; populated once by seasonStartedListener
  treasury_address TEXT,
  last_updated_block BIGINT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Auto-update updated_at on row change.
CREATE OR REPLACE FUNCTION curve_state_touch_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS curve_state_touch ON curve_state;
CREATE TRIGGER curve_state_touch
  BEFORE UPDATE ON curve_state
  FOR EACH ROW EXECUTE FUNCTION curve_state_touch_updated_at();

-- Allow service role full access; allow anon read for public viewing.
GRANT SELECT ON curve_state TO anon;
GRANT ALL ON curve_state TO service_role;
```

- [ ] **Step 2: Apply to local Supabase**

Run: `cd packages/backend && supabase migration list --local` to see existing migrations.
Run: `cd packages/backend && supabase db reset --local` or `supabase migration up --local` per project convention. If `local-dev.sh` auto-applies, just restart: `./scripts/local-dev.sh`.

Verify the table exists:
```bash
supabase db inspect --local || psql "$SUPABASE_LOCAL_DB_URL" -c '\d curve_state'
```
Expected: column list matches the SQL.

- [ ] **Step 3: Push to remote Supabase BEFORE backend deploy**

Per `feedback_supabase_migrations_to_prod` — the remote has no auto-apply. Do not skip.

```bash
cd packages/backend
supabase link --project-ref mmblfpccknlrhowicesv  # if not already linked
supabase migration list --linked
supabase db push --linked
```

If `migration list --linked` shows older migrations as unapplied but the tables already exist (schema was applied via SQL editor before), use `supabase migration repair --status applied <timestamp>` per migration to mark them applied, then `db push --linked` again.

- [ ] **Step 4: Commit**

```bash
git add packages/backend/migrations/018_curve_state.sql
git commit -m "feat(backend): curve_state table for warm-cached bonding curve state"
```

---

### Task A5: curve_state CRUD helpers in supabaseClient

**Files:**
- Modify: `packages/backend/shared/supabaseClient.js`

- [ ] **Step 1: Locate existing `db` exports**

Run: `grep -n "export const db\|export function\|db\." packages/backend/shared/supabaseClient.js | head -30`

- [ ] **Step 2: Add curve_state methods to the `db` API**

Append to the `db` object's methods (find the existing object; insert these methods alongside `getSeasonContracts`, `updateMarketProbabilityByFpmm`, etc.):

```javascript
// In packages/backend/shared/supabaseClient.js, inside the db API object:

async getCurveState(bondingCurveAddress) {
  const { data, error } = await supabase
    .from('curve_state')
    .select('*')
    .eq('bonding_curve_address', bondingCurveAddress.toLowerCase())
    .maybeSingle();
  if (error) throw error;
  return data;
},

async upsertCurveState(bondingCurveAddress, patch) {
  const row = {
    bonding_curve_address: bondingCurveAddress.toLowerCase(),
    ...patch,
  };
  const { data, error } = await supabase
    .from('curve_state')
    .upsert(row, { onConflict: 'bonding_curve_address' })
    .select()
    .single();
  if (error) throw error;
  return data;
},

async setCurveBondSteps(bondingCurveAddress, bondSteps, treasuryAddress) {
  return await this.upsertCurveState(bondingCurveAddress, {
    bond_steps: bondSteps,
    treasury_address: treasuryAddress?.toLowerCase() ?? null,
  });
},
```

- [ ] **Step 3: Verify backend boots**

Run: `cd packages/backend && node -e "import('./shared/supabaseClient.js').then(m => console.log(Object.keys(m.db)))"`
Expected: list includes `getCurveState`, `upsertCurveState`, `setCurveBondSteps`.

- [ ] **Step 4: Commit**

```bash
git add packages/backend/shared/supabaseClient.js
git commit -m "feat(backend): curve_state CRUD helpers on db client"
```

---

### Task A6: Blockscout HTTP client + LRU cache

**Files:**
- Create: `packages/backend/src/services/blockscoutClient.js`
- Test: `packages/backend/tests/backend/blockscoutClient.test.js`

- [ ] **Step 1: Write failing test**

```javascript
// packages/backend/tests/backend/blockscoutClient.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createBlockscoutClient } from '../../src/services/blockscoutClient.js';

const noopLogger = { info: vi.fn(), debug: vi.fn(), error: vi.fn(), warn: vi.fn() };

describe('blockscoutClient', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects endpoints not in the whitelist', async () => {
    const client = createBlockscoutClient({
      baseUrl: 'https://example.com',
      apiKey: 'k',
      logger: noopLogger,
    });
    await expect(
      client.fetch('arbitrary/path', {})
    ).rejects.toThrow(/whitelist/i);
  });

  it('serves whitelisted endpoint and caches the response', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ items: [{ address: '0xabc' }] }),
    });
    const client = createBlockscoutClient({
      baseUrl: 'https://example.com',
      apiKey: 'k',
      logger: noopLogger,
      cacheTtlsMs: { 'tokens/:address/holders': 300 },
    });
    const first = await client.fetch('tokens/:address/holders', { address: '0xToken' });
    const second = await client.fetch('tokens/:address/holders', { address: '0xToken' });
    expect(first).toEqual({ items: [{ address: '0xabc' }] });
    expect(second).toEqual(first);
    expect(fetchSpy).toHaveBeenCalledTimes(1);   // cached
    expect(fetchSpy.mock.calls[0][0]).toContain('/api/v2/tokens/0xToken/holders');
  });

  it('forwards remaining params as query string', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });
    const client = createBlockscoutClient({
      baseUrl: 'https://example.com',
      apiKey: 'k',
      logger: noopLogger,
    });
    await client.fetch('tokens/:address/transfers', { address: '0xT', page: '2' });
    const url = fetchSpy.mock.calls[0][0];
    expect(url).toContain('/api/v2/tokens/0xT/transfers');
    expect(url).toContain('page=2');
  });

  it('throws normalized error on non-OK response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 502,
      statusText: 'Bad Gateway',
      text: async () => 'upstream down',
    });
    const client = createBlockscoutClient({
      baseUrl: 'https://example.com',
      apiKey: 'k',
      logger: noopLogger,
    });
    await expect(
      client.fetch('tokens/:address/holders', { address: '0xT' })
    ).rejects.toThrow(/502/);
  });

  it('respects per-endpoint TTL', async () => {
    vi.useFakeTimers();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ value: 1 }),
    });
    const client = createBlockscoutClient({
      baseUrl: 'https://example.com',
      apiKey: 'k',
      logger: noopLogger,
      cacheTtlsMs: { 'transactions/:hash': 5_000 },
    });
    await client.fetch('transactions/:hash', { hash: '0x1' });
    vi.advanceTimersByTime(6_000);
    await client.fetch('transactions/:hash', { hash: '0x1' });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/backend && npx vitest run tests/backend/blockscoutClient.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement client**

```javascript
// packages/backend/src/services/blockscoutClient.js
/**
 * Blockscout outbound HTTP client with an LRU cache and an endpoint
 * whitelist. The whitelist exists so the route layer can't be tricked into
 * proxying arbitrary Blockscout paths — every URL we forward is explicitly
 * declared here, with its own TTL.
 *
 * Each endpoint pattern uses `:name` placeholders that match keys in the
 * params object. Remaining params are appended as query string.
 */

const DEFAULT_CACHE_TTLS_MS = {
  'tokens/:address/holders': 5 * 60_000,
  'tokens/:address/transfers': 30_000,
  'addresses/:address/transactions': 30_000,
  'transactions/:hash': 5_000,
  'addresses/:address': 60_000,
};

const MAX_CACHE_ENTRIES = 500;

function substitutePath(endpoint, params) {
  const used = new Set();
  const path = endpoint.replace(/:([a-zA-Z]+)/g, (_, name) => {
    if (!(name in params)) {
      throw new Error(`Missing path param ":${name}" for endpoint "${endpoint}"`);
    }
    used.add(name);
    return encodeURIComponent(params[name]);
  });
  const query = Object.entries(params)
    .filter(([k]) => !used.has(k))
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
  return query ? `${path}?${query}` : path;
}

function makeCache() {
  const map = new Map();
  return {
    get(key) {
      const entry = map.get(key);
      if (!entry) return undefined;
      if (entry.expires < Date.now()) {
        map.delete(key);
        return undefined;
      }
      // bump to MRU position
      map.delete(key);
      map.set(key, entry);
      return entry.value;
    },
    set(key, value, ttl) {
      if (map.has(key)) map.delete(key);
      map.set(key, { value, expires: Date.now() + ttl });
      while (map.size > MAX_CACHE_ENTRIES) {
        const oldest = map.keys().next().value;
        map.delete(oldest);
      }
    },
    size() { return map.size; },
  };
}

export function createBlockscoutClient({ baseUrl, apiKey, logger, cacheTtlsMs }) {
  if (!baseUrl) throw new Error('blockscoutClient: baseUrl is required');
  if (!apiKey) throw new Error('blockscoutClient: apiKey is required');
  const ttls = { ...DEFAULT_CACHE_TTLS_MS, ...(cacheTtlsMs || {}) };
  const allowed = new Set(Object.keys(ttls));
  const cache = makeCache();

  async function fetchFn(endpoint, params) {
    if (!allowed.has(endpoint)) {
      throw new Error(`Endpoint not in whitelist: ${endpoint}`);
    }
    const subpath = substitutePath(endpoint, params);
    const cacheKey = `${endpoint}::${subpath}`;
    const cached = cache.get(cacheKey);
    if (cached !== undefined) {
      logger.debug(`[BLOCKSCOUT] cache hit ${endpoint}`);
      return cached;
    }
    const url = `${baseUrl.replace(/\/$/, '')}/api/v2/${subpath}`;
    const headers = { Accept: 'application/json' };
    // Blockscout Pro API key is sent as a query param or header depending on
    // host configuration; sending both is harmless if one is rejected.
    headers['Authorization'] = `Bearer ${apiKey}`;
    const res = await fetch(url, { headers });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      logger.error(`[BLOCKSCOUT] ${res.status} ${endpoint}: ${body.slice(0, 200)}`);
      const err = new Error(`Blockscout ${res.status} ${res.statusText}: ${endpoint}`);
      err.status = res.status;
      err.retryable = res.status >= 500 || res.status === 429;
      throw err;
    }
    const json = await res.json();
    cache.set(cacheKey, json, ttls[endpoint]);
    return json;
  }

  return { fetch: fetchFn, cacheSize: () => cache.size() };
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `cd packages/backend && npx vitest run tests/backend/blockscoutClient.test.js`
Expected: PASS — all 5 tests green.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/services/blockscoutClient.js packages/backend/tests/backend/blockscoutClient.test.js
git commit -m "feat(backend): Blockscout HTTP client with LRU cache and endpoint whitelist"
```

---

### Task A7: Blockscout proxy routes

**Files:**
- Create: `packages/backend/fastify/routes/blockscoutRoutes.js`
- Test: `packages/backend/tests/backend/blockscoutRoutes.test.js`

- [ ] **Step 1: Write failing test**

```javascript
// packages/backend/tests/backend/blockscoutRoutes.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import blockscoutRoutes from '../../fastify/routes/blockscoutRoutes.js';

function buildApp(clientFetch) {
  const app = Fastify({ logger: false });
  app.register(blockscoutRoutes, {
    prefix: '/api/blockscout',
    blockscoutClient: { fetch: clientFetch },
  });
  return app;
}

describe('blockscoutRoutes', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('GET /tokens/:address/holders forwards to client and returns JSON', async () => {
    const clientFetch = vi.fn().mockResolvedValue({ items: [] });
    const app = buildApp(clientFetch);
    const res = await app.inject({ method: 'GET', url: '/api/blockscout/tokens/0xAbc/holders' });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ items: [] });
    expect(clientFetch).toHaveBeenCalledWith('tokens/:address/holders', { address: '0xAbc' });
  });

  it('GET /tokens/:address/transfers forwards query params', async () => {
    const clientFetch = vi.fn().mockResolvedValue({ items: [] });
    const app = buildApp(clientFetch);
    const res = await app.inject({
      method: 'GET',
      url: '/api/blockscout/tokens/0xAbc/transfers?page=2',
    });
    expect(res.statusCode).toBe(200);
    expect(clientFetch).toHaveBeenCalledWith('tokens/:address/transfers', { address: '0xAbc', page: '2' });
  });

  it('GET /addresses/:address/transactions works', async () => {
    const clientFetch = vi.fn().mockResolvedValue({ items: [] });
    const app = buildApp(clientFetch);
    const res = await app.inject({ method: 'GET', url: '/api/blockscout/addresses/0xUser/transactions' });
    expect(res.statusCode).toBe(200);
    expect(clientFetch).toHaveBeenCalledWith('addresses/:address/transactions', { address: '0xUser' });
  });

  it('GET /transactions/:hash works', async () => {
    const clientFetch = vi.fn().mockResolvedValue({ hash: '0x1' });
    const app = buildApp(clientFetch);
    const res = await app.inject({ method: 'GET', url: '/api/blockscout/transactions/0x1' });
    expect(res.statusCode).toBe(200);
    expect(clientFetch).toHaveBeenCalledWith('transactions/:hash', { hash: '0x1' });
  });

  it('GET /addresses/:address works', async () => {
    const clientFetch = vi.fn().mockResolvedValue({ hash: '0xUser' });
    const app = buildApp(clientFetch);
    const res = await app.inject({ method: 'GET', url: '/api/blockscout/addresses/0xUser' });
    expect(res.statusCode).toBe(200);
    expect(clientFetch).toHaveBeenCalledWith('addresses/:address', { address: '0xUser' });
  });

  it('returns 502 when client throws non-retryable', async () => {
    const clientFetch = vi.fn().mockRejectedValue(Object.assign(new Error('upstream'), { status: 404 }));
    const app = buildApp(clientFetch);
    const res = await app.inject({ method: 'GET', url: '/api/blockscout/tokens/0xA/holders' });
    expect(res.statusCode).toBe(502);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/backend && npx vitest run tests/backend/blockscoutRoutes.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement routes**

```javascript
// packages/backend/fastify/routes/blockscoutRoutes.js
/**
 * Proxy routes for Blockscout. Every endpoint is fixed — the underlying
 * client also enforces a whitelist, but routing here keeps the surface
 * explicit and lets us cap which Blockscout paths the frontend can reach.
 */

function handle(blockscoutClient) {
  return async (request, reply, endpointPattern, paramsBuilder) => {
    try {
      const params = paramsBuilder(request);
      const data = await blockscoutClient.fetch(endpointPattern, params);
      return reply.code(200).send(data);
    } catch (err) {
      request.log.error({ err }, `blockscout proxy failure: ${endpointPattern}`);
      return reply.code(502).send({ error: 'Blockscout upstream failure', detail: err.message });
    }
  };
}

export default async function blockscoutRoutes(fastify, options) {
  const { blockscoutClient } = options;
  if (!blockscoutClient || typeof blockscoutClient.fetch !== 'function') {
    throw new Error('blockscoutRoutes: blockscoutClient with .fetch is required');
  }
  const h = handle(blockscoutClient);

  fastify.get('/tokens/:address/holders', async (req, reply) =>
    h(req, reply, 'tokens/:address/holders', (r) => ({
      address: r.params.address,
      ...r.query,
    })),
  );

  fastify.get('/tokens/:address/transfers', async (req, reply) =>
    h(req, reply, 'tokens/:address/transfers', (r) => ({
      address: r.params.address,
      ...r.query,
    })),
  );

  fastify.get('/addresses/:address/transactions', async (req, reply) =>
    h(req, reply, 'addresses/:address/transactions', (r) => ({
      address: r.params.address,
      ...r.query,
    })),
  );

  fastify.get('/transactions/:hash', async (req, reply) =>
    h(req, reply, 'transactions/:hash', (r) => ({
      hash: r.params.hash,
      ...r.query,
    })),
  );

  fastify.get('/addresses/:address', async (req, reply) =>
    h(req, reply, 'addresses/:address', (r) => ({
      address: r.params.address,
      ...r.query,
    })),
  );
}
```

- [ ] **Step 4: Run test to verify pass**

Run: `cd packages/backend && npx vitest run tests/backend/blockscoutRoutes.test.js`
Expected: PASS — all 6 tests green.

- [ ] **Step 5: Register routes in server.js**

Open `packages/backend/fastify/server.js`. Near the other route registrations, add:

```javascript
import blockscoutRoutes from './routes/blockscoutRoutes.js';
import { createBlockscoutClient } from '../src/services/blockscoutClient.js';
```

Then where routes are registered (after env validation):

```javascript
if (process.env.BLOCKSCOUT_BASE_URL && process.env.BLOCKSCOUT_API_KEY) {
  const blockscoutClient = createBlockscoutClient({
    baseUrl: process.env.BLOCKSCOUT_BASE_URL,
    apiKey: process.env.BLOCKSCOUT_API_KEY,
    logger: fastify.log,
  });
  await fastify.register(blockscoutRoutes, {
    prefix: '/api/blockscout',
    blockscoutClient,
  });
  fastify.log.info('✅ Blockscout proxy registered at /api/blockscout');
} else {
  fastify.log.warn('⚠️  BLOCKSCOUT_BASE_URL/API_KEY missing; cold reads disabled');
}
```

- [ ] **Step 6: Commit**

```bash
git add packages/backend/fastify/routes/blockscoutRoutes.js packages/backend/tests/backend/blockscoutRoutes.test.js packages/backend/fastify/server.js
git commit -m "feat(backend): Blockscout proxy routes (holders, transfers, transactions, addresses)"
```

---

### Task A8: assertRequiredEnv adds Blockscout vars

**Files:**
- Modify: `packages/backend/shared/assertRequiredEnv.js`
- Modify: `packages/backend/tests/backend/assertRequiredEnv.test.js`
- Modify: `packages/backend/env/.env.local.example`, `.env.testnet.example`, `.env.mainnet.example`

- [ ] **Step 1: Add the two vars to `buildManifest`**

In `packages/backend/shared/assertRequiredEnv.js`, inside the `buildManifest(env)` array, append (before the closing `]`):

```javascript
    {
      key: "BLOCKSCOUT_BASE_URL",
      // Required on TESTNET/MAINNET; on LOCAL we usually have no Blockscout
      // instance and the proxy stays disabled.
      required: requireOnNonLocal,
      validate: (v) => (isUrl(v) ? null : "must be a valid URL"),
    },
    {
      key: "BLOCKSCOUT_API_KEY",
      required: requireOnNonLocal,
      // Length sanity only; Blockscout will validate the key itself.
      validate: (v) => (v.length >= 10 ? null : "looks too short"),
    },
```

- [ ] **Step 2: Add tests**

Open `packages/backend/tests/backend/assertRequiredEnv.test.js`. Find where existing required-on-non-local vars are tested (e.g., PIMLICO_API_KEY). Add parallel cases:

```javascript
it('requires BLOCKSCOUT_BASE_URL on TESTNET', () => {
  const env = { ...validTestnetEnv(), BLOCKSCOUT_BASE_URL: '' };
  expect(() => assertRequiredEnv(env)).toThrow(/BLOCKSCOUT_BASE_URL: missing/);
});

it('requires BLOCKSCOUT_API_KEY on TESTNET', () => {
  const env = { ...validTestnetEnv(), BLOCKSCOUT_API_KEY: '' };
  expect(() => assertRequiredEnv(env)).toThrow(/BLOCKSCOUT_API_KEY: missing/);
});

it('does NOT require BLOCKSCOUT_* on LOCAL', () => {
  const env = { ...validLocalEnv(), BLOCKSCOUT_BASE_URL: '', BLOCKSCOUT_API_KEY: '' };
  expect(() => assertRequiredEnv(env)).not.toThrow();
});
```

You'll need to update `validTestnetEnv()` at the top of the test file to include `BLOCKSCOUT_BASE_URL: 'https://base-sepolia.blockscout.com'` and `BLOCKSCOUT_API_KEY: 'abcdef0123456789'` so the other testnet tests keep passing.

- [ ] **Step 3: Run tests**

Run: `cd packages/backend && npx vitest run tests/backend/assertRequiredEnv.test.js`
Expected: PASS, including the three new cases.

- [ ] **Step 4: Update env example files**

Add to `packages/backend/env/.env.local.example` (after existing entries):

```
# ── Blockscout proxy (optional on LOCAL; required on TESTNET/MAINNET) ──
BLOCKSCOUT_BASE_URL=
BLOCKSCOUT_API_KEY=
```

Add to `packages/backend/env/.env.testnet.example` (next to existing `BLOCKSCOUT_API_KEY=` line):

```
BLOCKSCOUT_BASE_URL=https://base-sepolia.blockscout.com
```

Add to `packages/backend/env/.env.mainnet.example` (next to existing `BLOCKSCOUT_API_KEY=` line):

```
BLOCKSCOUT_BASE_URL=https://base.blockscout.com
```

- [ ] **Step 5: Commit**

```bash
git add packages/backend/shared/assertRequiredEnv.js packages/backend/tests/backend/assertRequiredEnv.test.js packages/backend/env/
git commit -m "feat(backend): require BLOCKSCOUT_BASE_URL/API_KEY on non-LOCAL"
```

---

### Task A9: GET /api/seasons/all

**Files:**
- Modify: `packages/backend/fastify/routes/seasonRoutes.js`
- Test: `packages/backend/tests/backend/seasonsAllRoute.test.js`

The existing `GET /` returns only active seasons (`db.getActiveSeasonContracts`). We need a new `GET /all` that returns every season.

- [ ] **Step 1: Add db helper if missing**

Open `packages/backend/shared/supabaseClient.js`. If `db.getAllSeasonContracts` doesn't exist, add it next to `getActiveSeasonContracts`:

```javascript
async getAllSeasonContracts() {
  const { data, error } = await supabase
    .from('season_contracts')
    .select('*')
    .order('season_id', { ascending: false });
  if (error) throw error;
  return data || [];
},
```

- [ ] **Step 2: Add `GET /all` route**

Open `packages/backend/fastify/routes/seasonRoutes.js`. Add a new route alongside existing ones (do not modify existing routes — `GET /` and `GET /:seasonId` stay):

```javascript
// Get every season (active + past). Used by useAllSeasons on the frontend
// to render the raffle list across all 4 tabs without an N×RPC fan-out.
fastify.get("/all", async (_request, reply) => {
  try {
    const data = await db.getAllSeasonContracts();
    return data;
  } catch (error) {
    fastify.log.error(error, "Failed to get all seasons");
    return reply.status(500).send({ error: error.message });
  }
});
```

- [ ] **Step 3: Write test**

```javascript
// packages/backend/tests/backend/seasonsAllRoute.test.js
import { describe, it, expect, vi } from 'vitest';
import Fastify from 'fastify';
import seasonRoutes from '../../fastify/routes/seasonRoutes.js';

vi.mock('../../shared/supabaseClient.js', () => ({
  db: {
    getActiveSeasonContracts: vi.fn().mockResolvedValue([{ season_id: 1 }]),
    getAllSeasonContracts: vi.fn().mockResolvedValue([
      { season_id: 2, status: 'completed' },
      { season_id: 1, status: 'completed' },
    ]),
    getSeasonContracts: vi.fn(),
  },
}));

describe('seasonRoutes GET /all', () => {
  it('returns every season in descending order', async () => {
    const app = Fastify({ logger: false });
    await app.register(seasonRoutes, { prefix: '/api/seasons' });
    const res = await app.inject({ method: 'GET', url: '/api/seasons/all' });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual([
      { season_id: 2, status: 'completed' },
      { season_id: 1, status: 'completed' },
    ]);
  });
});
```

- [ ] **Step 4: Run tests**

Run: `cd packages/backend && npx vitest run tests/backend/seasonsAllRoute.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/fastify/routes/seasonRoutes.js packages/backend/shared/supabaseClient.js packages/backend/tests/backend/seasonsAllRoute.test.js
git commit -m "feat(backend): GET /api/seasons/all returns full season list"
```

---

### Task A10: GET /api/curve/:address/{state,steps,treasury}

**Files:**
- Create: `packages/backend/fastify/routes/curveRoutes.js`
- Test: `packages/backend/tests/backend/curveRoutes.test.js`
- Modify: `packages/backend/fastify/server.js`

- [ ] **Step 1: Write failing test**

```javascript
// packages/backend/tests/backend/curveRoutes.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import curveRoutes from '../../fastify/routes/curveRoutes.js';

vi.mock('../../shared/supabaseClient.js', () => ({
  db: {
    getCurveState: vi.fn(),
  },
}));

import { db } from '../../shared/supabaseClient.js';

describe('curveRoutes', () => {
  let app;
  beforeEach(async () => {
    vi.clearAllMocks();
    app = Fastify({ logger: false });
    await app.register(curveRoutes, { prefix: '/api/curve' });
  });

  it('GET /:addr/state returns curve state', async () => {
    db.getCurveState.mockResolvedValue({
      bonding_curve_address: '0xabc',
      accumulated_fees: '100',
      sof_reserves: '200',
      current_supply: '300',
      current_step_index: 2,
      current_step_price: '50',
      current_step_range_to: '1000',
    });
    const res = await app.inject({ method: 'GET', url: '/api/curve/0xABC/state' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.accumulatedFees).toBe('100');
    expect(body.sofReserves).toBe('200');
    expect(body.currentSupply).toBe('300');
    expect(body.currentStep).toEqual({ index: 2, price: '50', rangeTo: '1000' });
  });

  it('GET /:addr/state returns 404 when not found', async () => {
    db.getCurveState.mockResolvedValue(null);
    const res = await app.inject({ method: 'GET', url: '/api/curve/0xnotfound/state' });
    expect(res.statusCode).toBe(404);
  });

  it('GET /:addr/steps returns the bond steps array', async () => {
    db.getCurveState.mockResolvedValue({
      bonding_curve_address: '0xabc',
      bond_steps: [{ rangeTo: '100', price: '1' }, { rangeTo: '200', price: '2' }],
    });
    const res = await app.inject({ method: 'GET', url: '/api/curve/0xabc/steps' });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual([
      { rangeTo: '100', price: '1' },
      { rangeTo: '200', price: '2' },
    ]);
  });

  it('GET /:addr/treasury returns the treasury slice', async () => {
    db.getCurveState.mockResolvedValue({
      accumulated_fees: '500',
      sof_reserves: '1000',
      treasury_address: '0xdef',
    });
    const res = await app.inject({ method: 'GET', url: '/api/curve/0xabc/treasury' });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({
      accumulatedFees: '500',
      sofReserves: '1000',
      treasuryAddress: '0xdef',
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/backend && npx vitest run tests/backend/curveRoutes.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement routes**

```javascript
// packages/backend/fastify/routes/curveRoutes.js
import { db } from '../../shared/supabaseClient.js';

function lowerHex(addr) {
  return typeof addr === 'string' ? addr.toLowerCase() : addr;
}

export default async function curveRoutes(fastify) {
  fastify.get('/:address/state', async (request, reply) => {
    const { address } = request.params;
    try {
      const row = await db.getCurveState(lowerHex(address));
      if (!row) return reply.status(404).send({ error: 'curve_state not found' });
      return {
        bondingCurveAddress: row.bonding_curve_address,
        accumulatedFees: row.accumulated_fees,
        sofReserves: row.sof_reserves,
        currentSupply: row.current_supply,
        currentStep: row.current_step_index == null
          ? null
          : {
              index: row.current_step_index,
              price: row.current_step_price,
              rangeTo: row.current_step_range_to,
            },
        lastUpdatedBlock: row.last_updated_block,
        updatedAt: row.updated_at,
      };
    } catch (err) {
      fastify.log.error(err, 'curve state lookup failed');
      return reply.status(500).send({ error: err.message });
    }
  });

  fastify.get('/:address/steps', async (request, reply) => {
    const { address } = request.params;
    try {
      const row = await db.getCurveState(lowerHex(address));
      if (!row || !row.bond_steps) {
        return reply.status(404).send({ error: 'bond_steps not populated' });
      }
      return row.bond_steps;
    } catch (err) {
      fastify.log.error(err, 'curve steps lookup failed');
      return reply.status(500).send({ error: err.message });
    }
  });

  fastify.get('/:address/treasury', async (request, reply) => {
    const { address } = request.params;
    try {
      const row = await db.getCurveState(lowerHex(address));
      if (!row) return reply.status(404).send({ error: 'curve_state not found' });
      return {
        accumulatedFees: row.accumulated_fees,
        sofReserves: row.sof_reserves,
        treasuryAddress: row.treasury_address,
      };
    } catch (err) {
      fastify.log.error(err, 'curve treasury lookup failed');
      return reply.status(500).send({ error: err.message });
    }
  });
}
```

- [ ] **Step 4: Run test to verify pass**

Run: `cd packages/backend && npx vitest run tests/backend/curveRoutes.test.js`
Expected: PASS — all 4 tests green.

- [ ] **Step 5: Register routes in server.js**

Open `packages/backend/fastify/server.js`. Near other route registrations:

```javascript
import curveRoutes from './routes/curveRoutes.js';
// ...
await fastify.register(curveRoutes, { prefix: '/api/curve' });
```

- [ ] **Step 6: Commit**

```bash
git add packages/backend/fastify/routes/curveRoutes.js packages/backend/tests/backend/curveRoutes.test.js packages/backend/fastify/server.js
git commit -m "feat(backend): GET /api/curve/:addr/{state,steps,treasury}"
```

---

### Task A11: GET /api/chain/time

**Files:**
- Create: `packages/backend/fastify/routes/chainTimeRoutes.js`
- Test: `packages/backend/tests/backend/chainTimeRoute.test.js`
- Modify: `packages/backend/src/lib/viemClient.js` (export latest-block cache)
- Modify: `packages/backend/fastify/server.js`

We cache the latest block timestamp updated by listener polling (every 4s minimum across listeners), so this endpoint is essentially free at request time.

- [ ] **Step 1: Add cache to viemClient.js**

Open `packages/backend/src/lib/viemClient.js`. Add an exported mutable record at module scope and a helper to update it:

```javascript
// Add at module scope:
export const chainTimeCache = {
  blockNumber: null,
  timestamp: null,
  updatedAt: null,
};

export function updateChainTimeCache(blockNumber, timestamp) {
  chainTimeCache.blockNumber = blockNumber;
  chainTimeCache.timestamp = timestamp;
  chainTimeCache.updatedAt = Date.now();
}
```

- [ ] **Step 2: Update cache from contractEventPolling**

Open `packages/backend/src/lib/contractEventPolling.js`. Where it reads the latest block (search for `getBlockNumber` or block iteration), call `updateChainTimeCache(blockNumber, block.timestamp)` after a successful fetch. If the file doesn't currently fetch full blocks, add a `getBlock` call right after the `getBlockNumber` and use its timestamp:

```javascript
// Inside the polling loop, after getting blockNumber:
import { updateChainTimeCache } from './viemClient.js';
// ... existing logic to get latestBlockNumber ...
try {
  const block = await client.getBlock({ blockNumber: latestBlockNumber });
  if (block?.timestamp != null) {
    updateChainTimeCache(Number(latestBlockNumber), Number(block.timestamp));
  }
} catch (e) {
  // non-fatal — cache stays stale, endpoint will return what it has
}
```

(Skip this if the polling loop already calls `getBlock` — just wire `updateChainTimeCache` into the existing path.)

- [ ] **Step 3: Write failing test**

```javascript
// packages/backend/tests/backend/chainTimeRoute.test.js
import { describe, it, expect, beforeEach, vi } from 'vitest';
import Fastify from 'fastify';
import chainTimeRoutes from '../../fastify/routes/chainTimeRoutes.js';
import { chainTimeCache } from '../../src/lib/viemClient.js';

describe('chainTimeRoutes', () => {
  let app;
  beforeEach(async () => {
    chainTimeCache.blockNumber = null;
    chainTimeCache.timestamp = null;
    chainTimeCache.updatedAt = null;
    app = Fastify({ logger: false });
    await app.register(chainTimeRoutes, { prefix: '/api/chain' });
  });

  it('returns 503 when cache is empty', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/chain/time' });
    expect(res.statusCode).toBe(503);
  });

  it('returns cached chain time', async () => {
    chainTimeCache.blockNumber = 12345;
    chainTimeCache.timestamp = 1700000000;
    chainTimeCache.updatedAt = Date.now();
    const res = await app.inject({ method: 'GET', url: '/api/chain/time' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.blockNumber).toBe(12345);
    expect(body.timestamp).toBe(1700000000);
    expect(typeof body.cachedAt).toBe('number');
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `cd packages/backend && npx vitest run tests/backend/chainTimeRoute.test.js`
Expected: FAIL — module not found.

- [ ] **Step 5: Implement route**

```javascript
// packages/backend/fastify/routes/chainTimeRoutes.js
import { chainTimeCache } from '../../src/lib/viemClient.js';

export default async function chainTimeRoutes(fastify) {
  fastify.get('/time', async (_request, reply) => {
    if (chainTimeCache.blockNumber == null || chainTimeCache.timestamp == null) {
      return reply.status(503).send({ error: 'chain time not yet cached' });
    }
    return {
      blockNumber: chainTimeCache.blockNumber,
      timestamp: chainTimeCache.timestamp,
      cachedAt: chainTimeCache.updatedAt,
    };
  });
}
```

- [ ] **Step 6: Run test to verify pass**

Run: `cd packages/backend && npx vitest run tests/backend/chainTimeRoute.test.js`
Expected: PASS — both tests green.

- [ ] **Step 7: Register in server.js**

```javascript
import chainTimeRoutes from './routes/chainTimeRoutes.js';
// ...
await fastify.register(chainTimeRoutes, { prefix: '/api/chain' });
```

- [ ] **Step 8: Commit**

```bash
git add packages/backend/fastify/routes/chainTimeRoutes.js packages/backend/tests/backend/chainTimeRoute.test.js packages/backend/src/lib/viemClient.js packages/backend/src/lib/contractEventPolling.js packages/backend/fastify/server.js
git commit -m "feat(backend): GET /api/chain/time + cache populated by event polling"
```

---

## Phase B — Listener wiring (SSE broadcasts + curve_state writes)

Each listener gains an SSE broadcast call **after** its DB write commits. tradeListener and positionUpdateListener additionally update `curve_state`. seasonStartedListener seeds `curve_state.bond_steps` and `treasury_address`.

### Task B1: tradeListener → infofi SSE + curve_state writes

**Files:**
- Modify: `packages/backend/src/listeners/tradeListener.js`

- [ ] **Step 1: Wire SSE broadcast**

Open `packages/backend/src/listeners/tradeListener.js`. At the top, add the SSE service import:

```javascript
import { getSSEChannelService } from '../services/sseChannelService.js';
```

Inside `startTradeListener`, after the existing `logger` validation, get the service:

```javascript
const sseService = getSSEChannelService(logger);
```

Locate the line `if (recordResult.alreadyRecorded) {` (around line 194). Immediately AFTER the if/else block that logs `Position recorded`, add:

```javascript
// Broadcast on infofi channel only after DB writes commit so a crash
// mid-handler doesn't emit a phantom event the client invalidates against.
if (!recordResult.alreadyRecorded) {
  sseService.broadcast('infofi', {
    type: 'Trade',
    fpmmAddress,
    trader,
    buyYes: Boolean(buyYes),
    amountIn: amountIn.toString(),
    amountOut: amountOut.toString(),
    sentimentBps: sentiment,
    txHash,
    blockNumber: Number(blockNum),
  });
}
```

- [ ] **Step 2: Verify lint**

Run: `cd packages/backend && npm run lint`
Expected: zero warnings.

- [ ] **Step 3: Commit**

```bash
git add packages/backend/src/listeners/tradeListener.js
git commit -m "feat(backend): tradeListener broadcasts Trade events on infofi SSE channel"
```

---

### Task B2: positionUpdateListener → raffle SSE + curve_state writes

**Files:**
- Modify: `packages/backend/src/listeners/positionUpdateListener.js`

- [ ] **Step 1: Read the existing handler**

Run: `cat packages/backend/src/listeners/positionUpdateListener.js | head -80` to find the event-handling block.

- [ ] **Step 2: Wire SSE broadcast + curve_state write**

At the top of the file:

```javascript
import { getSSEChannelService } from '../services/sseChannelService.js';
import { db } from '../../shared/supabaseClient.js';
import { publicClient } from '../lib/viemClient.js';
```

Inside the listener-start function, after `logger` validation:

```javascript
const sseService = getSSEChannelService(logger);
```

In the `onLogs` per-event loop, AFTER the existing DB write that records the position update (look for an `await ...` to Supabase), add:

```javascript
// PositionUpdate signature: (seasonId, player, oldTickets, newTickets, totalTickets)
// Source: SOFBondingCurve.PositionUpdate event ABI.
const { seasonId, player, oldTickets, newTickets, totalTickets } = log.args;

// Update warm cache for curve supply (totalTickets is curve-wide total supply).
try {
  await db.upsertCurveState(log.address, {
    current_supply: totalTickets.toString(),
    last_updated_block: Number(log.blockNumber),
  });
} catch (e) {
  logger.warn(`[POSITION_UPDATE_LISTENER] curve_state write failed: ${e.message}`);
}

// Read current step + reserves cheaply via multicall to keep warm cache fresh.
// This is the same data useCurveState used to poll every 12s; we read it once
// per tx and serve to all clients for free.
try {
  const { SOFBondingCurveABI } = await import('@sof/contracts');
  const results = await publicClient.multicall({
    contracts: [
      { address: log.address, abi: SOFBondingCurveABI, functionName: 'getCurrentStep' },
      { address: log.address, abi: SOFBondingCurveABI, functionName: 'curveConfig' },
      { address: log.address, abi: SOFBondingCurveABI, functionName: 'accumulatedFees' },
    ],
    allowFailure: true,
  });
  const step = results[0]?.status === 'success' ? results[0].result : null;
  const cfg = results[1]?.status === 'success' ? results[1].result : null;
  const fees = results[2]?.status === 'success' ? results[2].result : null;
  await db.upsertCurveState(log.address, {
    current_step_index: step ? Number(step[0]) : null,
    current_step_price: step ? step[1].toString() : null,
    current_step_range_to: step ? step[2].toString() : null,
    sof_reserves: cfg ? cfg[1].toString() : '0',
    accumulated_fees: fees != null ? fees.toString() : '0',
  });
} catch (e) {
  logger.warn(`[POSITION_UPDATE_LISTENER] curve multicall failed: ${e.message}`);
}

sseService.broadcast('raffle', {
  type: 'PositionUpdate',
  bondingCurveAddress: log.address,
  seasonId: Number(seasonId),
  player,
  oldTickets: oldTickets.toString(),
  newTickets: newTickets.toString(),
  totalTickets: totalTickets.toString(),
  blockNumber: Number(log.blockNumber),
  txHash: log.transactionHash,
});
```

(If the existing handler already destructures `log.args` or has a different shape, use the existing pattern's variables instead of re-destructuring. The shape and broadcast payload are what matter.)

- [ ] **Step 3: Commit**

```bash
git add packages/backend/src/listeners/positionUpdateListener.js
git commit -m "feat(backend): positionUpdateListener writes curve_state and broadcasts on raffle SSE"
```

---

### Task B3: seasonStartedListener → raffle SSE + seed bond_steps

**Files:**
- Modify: `packages/backend/src/listeners/seasonStartedListener.js`

- [ ] **Step 1: Wire SSE broadcast + bond_steps seed**

Open `packages/backend/src/listeners/seasonStartedListener.js`. At the top:

```javascript
import { getSSEChannelService } from '../services/sseChannelService.js';
import { db } from '../../shared/supabaseClient.js';
import { publicClient } from '../lib/viemClient.js';
```

Inside the handler, after the existing DB write that records the new season:

```javascript
const sseService = getSSEChannelService(logger);
const { seasonId } = log.args;
const seasonIdNum = Number(seasonId);

// Bond steps are immutable once a season is created — seed them once into
// curve_state so useCurveState can read them from warm cache forever.
try {
  const { RaffleABI, SOFBondingCurveABI } = await import('@sof/contracts');
  const seasonDetails = await publicClient.readContract({
    address: process.env.RAFFLE_ADDRESS,
    abi: RaffleABI,
    functionName: 'getSeasonDetails',
    args: [BigInt(seasonIdNum)],
  });
  const bondingCurveAddress = seasonDetails?.[0]?.bondingCurve || seasonDetails?.[0]?.[5];
  if (bondingCurveAddress) {
    const [steps, treasuryAddr] = await Promise.all([
      publicClient.readContract({
        address: bondingCurveAddress,
        abi: SOFBondingCurveABI,
        functionName: 'getBondSteps',
      }),
      publicClient.readContract({
        address: bondingCurveAddress,
        abi: SOFBondingCurveABI,
        functionName: 'treasuryAddress',
      }),
    ]);
    const stepsJson = (steps || []).map((s) => ({
      rangeTo: s.rangeTo?.toString?.() ?? s[0]?.toString?.() ?? '0',
      price: s.price?.toString?.() ?? s[1]?.toString?.() ?? '0',
    }));
    await db.setCurveBondSteps(bondingCurveAddress, stepsJson, treasuryAddr);
  }
} catch (e) {
  logger.warn(`[SEASON_STARTED_LISTENER] bond_steps seed failed: ${e.message}`);
}

sseService.broadcast('raffle', {
  type: 'SeasonStarted',
  seasonId: seasonIdNum,
  blockNumber: Number(log.blockNumber),
  txHash: log.transactionHash,
});
```

- [ ] **Step 2: Commit**

```bash
git add packages/backend/src/listeners/seasonStartedListener.js
git commit -m "feat(backend): seasonStartedListener seeds curve_state.bond_steps and broadcasts on raffle SSE"
```

---

### Task B4: Remaining listeners → SSE broadcasts

**Files:**
- Modify: `packages/backend/src/listeners/seasonCompletedListener.js`
- Modify: `packages/backend/src/listeners/marketCreatedListener.js`
- Modify: `packages/backend/src/listeners/rolloverEventListener.js`
- Modify: `packages/backend/src/listeners/sponsorPrizeListener.js`
- Modify: `packages/backend/src/listeners/sponsorHatListener.js`
- Modify: `packages/backend/src/listeners/accountCreatedListener.js`

Each listener follows the same pattern: import the SSE service, broadcast after DB commit. Below are the per-listener edits.

- [ ] **Step 1: seasonCompletedListener**

Add at top:
```javascript
import { getSSEChannelService } from '../services/sseChannelService.js';
```
Inside start function (after logger validation):
```javascript
const sseService = getSSEChannelService(logger);
```
After the existing DB write inside the event loop:
```javascript
const { seasonId, winnerCount } = log.args;
sseService.broadcast('raffle', {
  type: 'SeasonCompleted',
  seasonId: Number(seasonId),
  winnerCount: winnerCount != null ? Number(winnerCount) : null,
  blockNumber: Number(log.blockNumber),
  txHash: log.transactionHash,
});
```

- [ ] **Step 2: marketCreatedListener**

Add at top:
```javascript
import { getSSEChannelService } from '../services/sseChannelService.js';
```
Inside start function:
```javascript
const sseService = getSSEChannelService(logger);
```
After existing DB write:
```javascript
const { fpmmAddress, seasonId, player } = log.args;
sseService.broadcast('infofi', {
  type: 'MarketCreated',
  fpmmAddress,
  seasonId: Number(seasonId),
  player,
  blockNumber: Number(log.blockNumber),
  txHash: log.transactionHash,
});
```

- [ ] **Step 3: rolloverEventListener**

This listener handles multiple events (RolloverFunded, RolloverClaimed, ConsolationFunded). Add the import and service handle, then broadcast per event branch:

```javascript
import { getSSEChannelService } from '../services/sseChannelService.js';
// ... inside start function:
const sseService = getSSEChannelService(logger);
// ... in RolloverFunded branch, after DB write:
sseService.broadcast('rollover', {
  type: 'RolloverFunded',
  seasonId: Number(seasonId),
  amount: amount.toString(),
  player: player ?? null,
  blockNumber: Number(log.blockNumber),
  txHash: log.transactionHash,
});
// ... RolloverClaimed branch:
sseService.broadcast('rollover', {
  type: 'RolloverClaimed',
  seasonId: Number(seasonId),
  amount: amount.toString(),
  player,
  blockNumber: Number(log.blockNumber),
  txHash: log.transactionHash,
});
// ... ConsolationFunded branch:
sseService.broadcast('rollover', {
  type: 'ConsolationFunded',
  seasonId: Number(seasonId),
  amount: amount.toString(),
  blockNumber: Number(log.blockNumber),
  txHash: log.transactionHash,
});
```

(Use the actual variable names from the existing destructure in each branch.)

- [ ] **Step 4: sponsorPrizeListener**

```javascript
import { getSSEChannelService } from '../services/sseChannelService.js';
// ... inside start:
const sseService = getSSEChannelService(logger);
// ... after DB write:
const { seasonId, sponsor, prizeTokenAddress, amount, label } = log.args;
sseService.broadcast('raffle', {
  type: 'SponsorPrizeAdded',
  seasonId: Number(seasonId),
  sponsor,
  prizeTokenAddress,
  amount: amount?.toString?.() ?? '0',
  label: label ?? null,
  blockNumber: Number(log.blockNumber),
  txHash: log.transactionHash,
});
```

- [ ] **Step 5: sponsorHatListener**

```javascript
import { getSSEChannelService } from '../services/sseChannelService.js';
const sseService = getSSEChannelService(logger);
// after DB write:
const { seasonId, holder, hatId } = log.args;
sseService.broadcast('raffle', {
  type: 'SponsorHatGranted',
  seasonId: seasonId != null ? Number(seasonId) : null,
  holder,
  hatId: hatId?.toString?.() ?? null,
  blockNumber: Number(log.blockNumber),
  txHash: log.transactionHash,
});
```

- [ ] **Step 6: accountCreatedListener**

```javascript
import { getSSEChannelService } from '../services/sseChannelService.js';
const sseService = getSSEChannelService(logger);
// after DB write:
const { owner, account } = log.args;
sseService.broadcast('raffle', {
  type: 'AccountCreated',
  owner,
  account,
  blockNumber: Number(log.blockNumber),
  txHash: log.transactionHash,
});
```

- [ ] **Step 7: Run backend test suite**

Run: `cd packages/backend && npm test`
Expected: all tests green.

- [ ] **Step 8: Commit**

```bash
git add packages/backend/src/listeners/
git commit -m "feat(backend): remaining listeners broadcast on appropriate SSE channels"
```

---

## Phase C — Frontend foundations

### Task C1: chain/internal.js (shared helpers)

**Files:**
- Create: `packages/frontend/src/hooks/chain/internal.js`

- [ ] **Step 1: Write helpers**

```javascript
// packages/frontend/src/hooks/chain/internal.js
/**
 * Shared internals for the four chain hooks (useColdRead, useWarmRead,
 * useLiveSubscription, useUltraFreshRead). Keeps each hook small.
 */

import { getStoredNetworkKey } from '@/lib/wagmi';

export const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000/api';

/**
 * Substitute `:name` path params in a path; leftover keys become query string.
 * Returns a URL relative to API_BASE.
 */
export function buildApiUrl(path, params = {}) {
  const used = new Set();
  const substituted = path.replace(/:([a-zA-Z]+)/g, (_, name) => {
    if (!(name in params)) {
      throw new Error(`Missing path param ":${name}" for path "${path}"`);
    }
    used.add(name);
    return encodeURIComponent(params[name]);
  });
  const query = Object.entries(params)
    .filter(([k, v]) => !used.has(k) && v != null)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
  return `${API_BASE}${substituted}${query ? `?${query}` : ''}`;
}

/**
 * Normalize a fetch error into the shape every hook surfaces.
 */
export function normalizeFetchError(error, response) {
  if (response && !response.ok) {
    return {
      code: response.status,
      message: response.statusText || `HTTP ${response.status}`,
      retryable: response.status >= 500 || response.status === 429,
    };
  }
  return {
    code: 'network',
    message: error?.message || 'Network error',
    retryable: true,
  };
}

/**
 * Telemetry: count requests per tier in dev. Surfaces a window-attached
 * counter so a budget overlay can read it without import dependencies.
 */
const counters = { cold: 0, warm: 0, live: 0, ultraFresh: 0 };
export function bumpTelemetry(tier) {
  counters[tier] = (counters[tier] || 0) + 1;
  if (typeof window !== 'undefined' && import.meta.env.DEV) {
    window.__sofChainTelemetry = counters;
  }
}

export { getStoredNetworkKey };
```

- [ ] **Step 2: Commit**

```bash
git add packages/frontend/src/hooks/chain/internal.js
git commit -m "feat(frontend): chain/internal.js shared helpers for new data layer"
```

---

### Task C2: useColdRead

**Files:**
- Create: `packages/frontend/src/hooks/chain/useColdRead.js`
- Test: `packages/frontend/src/hooks/chain/__tests__/useColdRead.test.js`

- [ ] **Step 1: Write failing test**

```javascript
// packages/frontend/src/hooks/chain/__tests__/useColdRead.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useColdRead } from '../useColdRead';

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

describe('useColdRead', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('fetches from /api/blockscout/<endpoint>', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ items: [{ address: '0xa' }] }),
    });
    const { result } = renderHook(
      () =>
        useColdRead({
          endpoint: 'tokens/:address/holders',
          params: { address: '0xToken' },
        }),
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data).toEqual({ items: [{ address: '0xa' }] });
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/api/blockscout/tokens/0xToken/holders'),
      expect.any(Object),
    );
  });

  it('respects enabled=false', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => ({}) });
    renderHook(
      () =>
        useColdRead({
          endpoint: 'tokens/:address/holders',
          params: { address: '0xT' },
          enabled: false,
        }),
      { wrapper: wrapper() },
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns normalized error on non-OK response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Server Error',
    });
    const { result } = renderHook(
      () => useColdRead({ endpoint: 'tokens/:address/holders', params: { address: '0xT' } }),
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toMatchObject({ code: 500, retryable: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/frontend && npx vitest run src/hooks/chain/__tests__/useColdRead.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement hook**

```javascript
// packages/frontend/src/hooks/chain/useColdRead.js
import { useQuery } from '@tanstack/react-query';
import { buildApiUrl, bumpTelemetry, normalizeFetchError, API_BASE } from './internal';

const COLD_DEFAULT_STALE = 5 * 60_000; // 5 min

export function useColdRead({
  endpoint,
  params = {},
  staleTime = COLD_DEFAULT_STALE,
  enabled = true,
}) {
  return useQuery({
    queryKey: ['cold', endpoint, params],
    enabled,
    staleTime,
    retry: 1,
    queryFn: async () => {
      bumpTelemetry('cold');
      const url = buildApiUrl(`/blockscout/${endpoint}`, params);
      let response;
      try {
        response = await fetch(url, { headers: { Accept: 'application/json' } });
      } catch (err) {
        throw normalizeFetchError(err, null);
      }
      if (!response.ok) throw normalizeFetchError(null, response);
      return response.json();
    },
  });
}

export { API_BASE };
```

(`buildApiUrl` already prepends `API_BASE` which includes `/api`. The endpoint is passed `/blockscout/<endpoint>`, so the final URL becomes `${API_BASE}/blockscout/<resolved-endpoint>`. Verify `API_BASE` does NOT itself end in `/api/blockscout` — it should be `http://host/api`.)

- [ ] **Step 4: Run test to verify pass**

Run: `cd packages/frontend && npx vitest run src/hooks/chain/__tests__/useColdRead.test.js`
Expected: PASS — all 3 tests green.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/hooks/chain/useColdRead.js packages/frontend/src/hooks/chain/__tests__/useColdRead.test.js
git commit -m "feat(frontend): useColdRead hook (Blockscout via backend proxy)"
```

---

### Task C3: useWarmRead

**Files:**
- Create: `packages/frontend/src/hooks/chain/useWarmRead.js`
- Test: `packages/frontend/src/hooks/chain/__tests__/useWarmRead.test.js`

- [ ] **Step 1: Write failing test**

```javascript
// packages/frontend/src/hooks/chain/__tests__/useWarmRead.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useWarmRead } from '../useWarmRead';

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

describe('useWarmRead', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('fetches from VITE_API_BASE_URL + path', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ id: 1 }),
    });
    const { result } = renderHook(
      () => useWarmRead({ path: '/seasons/all' }),
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(result.current.data).toEqual({ id: 1 }));
    expect(fetchSpy.mock.calls[0][0]).toContain('/seasons/all');
  });

  it('serializes params as query string', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ([]),
    });
    renderHook(
      () =>
        useWarmRead({
          path: '/transactions/positions/:user/:season',
          params: { user: '0xUser', season: 5 },
        }),
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    expect(fetchSpy.mock.calls[0][0]).toMatch(/\/transactions\/positions\/0xUser\/5$/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/frontend && npx vitest run src/hooks/chain/__tests__/useWarmRead.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement hook**

```javascript
// packages/frontend/src/hooks/chain/useWarmRead.js
import { useQuery } from '@tanstack/react-query';
import { buildApiUrl, bumpTelemetry, normalizeFetchError } from './internal';

const WARM_DEFAULT_STALE = 20_000;

export function useWarmRead({
  path,
  params = {},
  refetchInterval,
  staleTime = WARM_DEFAULT_STALE,
  enabled = true,
}) {
  return useQuery({
    queryKey: ['warm', path, params],
    enabled,
    staleTime,
    refetchInterval,
    retry: 1,
    queryFn: async () => {
      bumpTelemetry('warm');
      const url = buildApiUrl(path, params);
      let response;
      try {
        response = await fetch(url, { headers: { Accept: 'application/json' } });
      } catch (err) {
        throw normalizeFetchError(err, null);
      }
      if (!response.ok) throw normalizeFetchError(null, response);
      return response.json();
    },
  });
}
```

- [ ] **Step 4: Run test to verify pass**

Run: `cd packages/frontend && npx vitest run src/hooks/chain/__tests__/useWarmRead.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/hooks/chain/useWarmRead.js packages/frontend/src/hooks/chain/__tests__/useWarmRead.test.js
git commit -m "feat(frontend): useWarmRead hook (backend REST)"
```

---

### Task C4: SSE registry + useLiveSubscription

**Files:**
- Create: `packages/frontend/src/hooks/chain/sseRegistry.js`
- Create: `packages/frontend/src/hooks/chain/useLiveSubscription.js`
- Test: `packages/frontend/src/hooks/chain/__tests__/sseRegistry.test.js`
- Test: `packages/frontend/src/hooks/chain/__tests__/useLiveSubscription.test.js`

The registry shares one EventSource per channel across subscribers — 5 components watching `raffle` open 1 connection, not 5.

- [ ] **Step 1: Write failing registry test**

```javascript
// packages/frontend/src/hooks/chain/__tests__/sseRegistry.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { _resetRegistryForTests, subscribe } from '../sseRegistry';

class FakeEventSource {
  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.listeners = {};
    FakeEventSource.instances.push(this);
  }
  addEventListener(name, cb) {
    (this.listeners[name] ||= []).push(cb);
  }
  removeEventListener(name, cb) {
    if (this.listeners[name]) {
      this.listeners[name] = this.listeners[name].filter((f) => f !== cb);
    }
  }
  close() { this.readyState = 2; }
  emit(name, ev) {
    (this.listeners[name] || []).forEach((cb) => cb(ev));
  }
  static instances = [];
  static reset() { FakeEventSource.instances = []; }
}

describe('sseRegistry', () => {
  beforeEach(() => {
    FakeEventSource.reset();
    _resetRegistryForTests();
    globalThis.EventSource = FakeEventSource;
  });

  it('shares one EventSource per channel across subscribers', () => {
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    subscribe('raffle', cb1);
    subscribe('raffle', cb2);
    expect(FakeEventSource.instances).toHaveLength(1);
  });

  it('dispatches messages to every subscriber on the channel', () => {
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    subscribe('raffle', cb1);
    subscribe('raffle', cb2);
    const es = FakeEventSource.instances[0];
    es.emit('message', { data: JSON.stringify({ type: 'PositionUpdate' }) });
    expect(cb1).toHaveBeenCalledWith({ type: 'PositionUpdate' });
    expect(cb2).toHaveBeenCalledWith({ type: 'PositionUpdate' });
  });

  it('closes connection when last subscriber leaves', () => {
    const cb1 = vi.fn();
    const unsubscribe = subscribe('raffle', cb1);
    unsubscribe();
    expect(FakeEventSource.instances[0].readyState).toBe(2);
  });

  it('opens separate connections for different channels', () => {
    subscribe('raffle', vi.fn());
    subscribe('infofi', vi.fn());
    expect(FakeEventSource.instances).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/frontend && npx vitest run src/hooks/chain/__tests__/sseRegistry.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement registry**

```javascript
// packages/frontend/src/hooks/chain/sseRegistry.js
import { API_BASE } from './internal';

const registry = new Map(); // channel -> { es, subscribers: Set<cb>, reconnectMs }

const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

function sseUrl(channel) {
  const root = API_BASE.replace(/\/api\/?$/, '');
  return `${root}/sse/${channel}`;
}

function open(channel) {
  const entry = registry.get(channel);
  if (!entry) return;
  const es = new EventSource(sseUrl(channel));
  entry.es = es;

  es.addEventListener('message', (ev) => {
    let payload;
    try { payload = JSON.parse(ev.data); } catch { return; }
    if (payload?.type === 'connected') return;   // initial server hello
    for (const cb of entry.subscribers) {
      try { cb(payload); } catch (_) { /* swallow */ }
    }
  });

  es.addEventListener('error', () => {
    if (entry.subscribers.size === 0) return;
    es.close();
    entry.es = null;
    setTimeout(() => open(channel), entry.reconnectMs);
    entry.reconnectMs = Math.min(entry.reconnectMs * 2, RECONNECT_MAX_MS);
  });
}

export function subscribe(channel, callback) {
  let entry = registry.get(channel);
  if (!entry) {
    entry = { es: null, subscribers: new Set(), reconnectMs: RECONNECT_BASE_MS };
    registry.set(channel, entry);
    open(channel);
  }
  entry.subscribers.add(callback);
  return function unsubscribe() {
    entry.subscribers.delete(callback);
    if (entry.subscribers.size === 0) {
      if (entry.es) entry.es.close();
      registry.delete(channel);
    }
  };
}

// Test-only.
export function _resetRegistryForTests() {
  for (const [, entry] of registry) {
    if (entry.es) entry.es.close();
  }
  registry.clear();
}
```

- [ ] **Step 4: Run registry test**

Run: `cd packages/frontend && npx vitest run src/hooks/chain/__tests__/sseRegistry.test.js`
Expected: PASS.

- [ ] **Step 5: Write failing useLiveSubscription test**

```javascript
// packages/frontend/src/hooks/chain/__tests__/useLiveSubscription.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useLiveSubscription } from '../useLiveSubscription';
import { _resetRegistryForTests } from '../sseRegistry';

class FakeEventSource {
  constructor(url) { this.url = url; this.listeners = {}; FakeEventSource.instances.push(this); }
  addEventListener(name, cb) { (this.listeners[name] ||= []).push(cb); }
  removeEventListener(name, cb) { if (this.listeners[name]) this.listeners[name] = this.listeners[name].filter((f) => f !== cb); }
  close() { this.readyState = 2; }
  emit(name, ev) { (this.listeners[name] || []).forEach((cb) => cb(ev)); }
  static instances = [];
  static reset() { FakeEventSource.instances = []; }
}

describe('useLiveSubscription', () => {
  beforeEach(() => {
    FakeEventSource.reset();
    _resetRegistryForTests();
    globalThis.EventSource = FakeEventSource;
  });

  it('subscribes to a channel and forwards filtered events to onEvent', () => {
    const onEvent = vi.fn();
    renderHook(() =>
      useLiveSubscription({
        channel: 'raffle',
        filter: (e) => e.seasonId === 42,
        onEvent,
      }),
    );
    const es = FakeEventSource.instances[0];
    es.emit('message', { data: JSON.stringify({ type: 'PositionUpdate', seasonId: 42 }) });
    es.emit('message', { data: JSON.stringify({ type: 'PositionUpdate', seasonId: 43 }) });
    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onEvent).toHaveBeenCalledWith({ type: 'PositionUpdate', seasonId: 42 });
  });

  it('unsubscribes on unmount', () => {
    const onEvent = vi.fn();
    const { unmount } = renderHook(() =>
      useLiveSubscription({ channel: 'raffle', onEvent }),
    );
    unmount();
    expect(FakeEventSource.instances[0].readyState).toBe(2);
  });

  it('does not subscribe when enabled=false', () => {
    renderHook(() =>
      useLiveSubscription({ channel: 'raffle', onEvent: vi.fn(), enabled: false }),
    );
    expect(FakeEventSource.instances).toHaveLength(0);
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `cd packages/frontend && npx vitest run src/hooks/chain/__tests__/useLiveSubscription.test.js`
Expected: FAIL — module not found.

- [ ] **Step 7: Implement hook**

```javascript
// packages/frontend/src/hooks/chain/useLiveSubscription.js
import { useEffect, useRef, useState } from 'react';
import { subscribe } from './sseRegistry';
import { bumpTelemetry } from './internal';

export function useLiveSubscription({ channel, filter, onEvent, enabled = true }) {
  const filterRef = useRef(filter);
  const onEventRef = useRef(onEvent);
  filterRef.current = filter;
  onEventRef.current = onEvent;
  const [status, setStatus] = useState('connecting');
  const [lastEvent, setLastEvent] = useState(null);

  useEffect(() => {
    if (!enabled) return;
    bumpTelemetry('live');
    setStatus('connecting');
    const unsubscribe = subscribe(channel, (event) => {
      if (filterRef.current && !filterRef.current(event)) return;
      setLastEvent(event);
      setStatus('open');
      onEventRef.current?.(event);
    });
    return () => {
      unsubscribe();
      setStatus('closed');
    };
  }, [channel, enabled]);

  return { status, lastEvent };
}
```

- [ ] **Step 8: Run test**

Run: `cd packages/frontend && npx vitest run src/hooks/chain/__tests__/useLiveSubscription.test.js`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/frontend/src/hooks/chain/sseRegistry.js packages/frontend/src/hooks/chain/useLiveSubscription.js packages/frontend/src/hooks/chain/__tests__/sseRegistry.test.js packages/frontend/src/hooks/chain/__tests__/useLiveSubscription.test.js
git commit -m "feat(frontend): useLiveSubscription + shared SSE registry"
```

---

### Task C5: useUltraFreshRead

**Files:**
- Create: `packages/frontend/src/hooks/chain/useUltraFreshRead.js`
- Test: `packages/frontend/src/hooks/chain/__tests__/useUltraFreshRead.test.js`

- [ ] **Step 1: Write failing test**

```javascript
// packages/frontend/src/hooks/chain/__tests__/useUltraFreshRead.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useUltraFreshRead } from '../useUltraFreshRead';

const mockReadContract = vi.fn();
vi.mock('wagmi', () => ({
  usePublicClient: () => ({ readContract: (...args) => mockReadContract(...args) }),
}));

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

describe('useUltraFreshRead', () => {
  beforeEach(() => vi.clearAllMocks());

  it('calls publicClient.readContract and returns data', async () => {
    mockReadContract.mockResolvedValue(123n);
    const { result } = renderHook(
      () =>
        useUltraFreshRead({
          contract: { address: '0xSOF', abi: [] },
          fn: 'balanceOf',
          args: ['0xUser'],
          touches: ['0xSOF'],
        }),
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(result.current.data).toBe(123n));
    expect(mockReadContract).toHaveBeenCalledWith({
      address: '0xSOF',
      abi: [],
      functionName: 'balanceOf',
      args: ['0xUser'],
    });
  });

  it('respects enabled=false', () => {
    renderHook(
      () =>
        useUltraFreshRead({
          contract: { address: '0xSOF', abi: [] },
          fn: 'balanceOf',
          args: ['0xU'],
          enabled: false,
        }),
      { wrapper: wrapper() },
    );
    expect(mockReadContract).not.toHaveBeenCalled();
  });

  it('attaches meta.tier and meta.touches to the query', async () => {
    mockReadContract.mockResolvedValue(0n);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapperWithClient = ({ children }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    renderHook(
      () =>
        useUltraFreshRead({
          contract: { address: '0xSOF', abi: [] },
          fn: 'balanceOf',
          args: ['0xU'],
          touches: ['0xSOF', '0xCURVE'],
        }),
      { wrapper: wrapperWithClient },
    );
    await waitFor(() => {
      const queries = client.getQueryCache().getAll();
      expect(queries.length).toBeGreaterThan(0);
      expect(queries[0].meta).toEqual({ tier: 'ultraFresh', touches: ['0xSOF', '0xCURVE'] });
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/frontend && npx vitest run src/hooks/chain/__tests__/useUltraFreshRead.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement hook**

```javascript
// packages/frontend/src/hooks/chain/useUltraFreshRead.js
import { useQuery } from '@tanstack/react-query';
import { usePublicClient } from 'wagmi';
import { bumpTelemetry } from './internal';

const ULTRA_FRESH_DEFAULT_STALE = 5_000;

export function useUltraFreshRead({
  contract,
  fn,
  args = [],
  touches = [],
  enabled = true,
  staleTime = ULTRA_FRESH_DEFAULT_STALE,
}) {
  const publicClient = usePublicClient();
  return useQuery({
    queryKey: ['ultraFresh', contract?.address, fn, args],
    enabled: enabled && !!publicClient && !!contract?.address && !!fn,
    staleTime,
    retry: 1,
    meta: { tier: 'ultraFresh', touches },
    queryFn: async () => {
      bumpTelemetry('ultraFresh');
      return await publicClient.readContract({
        address: contract.address,
        abi: contract.abi,
        functionName: fn,
        args,
      });
    },
  });
}
```

- [ ] **Step 4: Run test**

Run: `cd packages/frontend && npx vitest run src/hooks/chain/__tests__/useUltraFreshRead.test.js`
Expected: PASS — all 3 tests green.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/hooks/chain/useUltraFreshRead.js packages/frontend/src/hooks/chain/__tests__/useUltraFreshRead.test.js
git commit -m "feat(frontend): useUltraFreshRead hook (RPC, tx-invalidated)"
```

---

### Task C6: Centralized post-tx invalidation in useSmartTransactions

**Files:**
- Modify: `packages/frontend/src/hooks/useSmartTransactions.js`
- Test: `packages/frontend/src/hooks/chain/__tests__/executeBatchInvalidation.test.js`

- [ ] **Step 1: Write failing test**

```javascript
// packages/frontend/src/hooks/chain/__tests__/executeBatchInvalidation.test.js
import { describe, it, expect } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { invalidateUltraFreshTouching } from '../../useSmartTransactions';

describe('invalidateUltraFreshTouching', () => {
  it('invalidates ultra-fresh queries whose touches overlap call targets', async () => {
    const qc = new QueryClient();
    qc.setQueryData(['ultraFresh', '0xsof', 'balanceOf', ['me']], 100n);
    qc.setQueryData(['ultraFresh', '0xother', 'balanceOf', ['me']], 200n);
    // Manually attach meta (production sets this via the hook)
    const cache = qc.getQueryCache();
    cache.getAll()[0].meta = { tier: 'ultraFresh', touches: ['0xSOF'] };
    cache.getAll()[1].meta = { tier: 'ultraFresh', touches: ['0xOTHER'] };

    const spy = vi.spyOn(qc, 'invalidateQueries');
    invalidateUltraFreshTouching(qc, ['0xsof']);

    expect(spy).toHaveBeenCalled();
    const predicate = spy.mock.calls[0][0].predicate;
    // First query should match (touches 0xSOF, call target 0xsof — case-insensitive)
    expect(predicate(cache.getAll()[0])).toBe(true);
    // Second query should not match
    expect(predicate(cache.getAll()[1])).toBe(false);
  });

  it('returns 0 invalidations when call targets are empty', () => {
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, 'invalidateQueries');
    invalidateUltraFreshTouching(qc, []);
    expect(spy).not.toHaveBeenCalled();
  });
});
```

Add `import { vi } from 'vitest';` at the top of the test file.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/frontend && npx vitest run src/hooks/chain/__tests__/executeBatchInvalidation.test.js`
Expected: FAIL — `invalidateUltraFreshTouching` not exported.

- [ ] **Step 3: Add helper + wire into executeBatch**

Open `packages/frontend/src/hooks/useSmartTransactions.js`. At the top (after existing imports):

```javascript
import { useQueryClient } from '@tanstack/react-query';
```

Near the bottom of the file, before `export function useSmartTransactions()`, add the helper export:

```javascript
/**
 * Invalidate ultra-fresh queries whose meta.touches overlap with the given
 * call targets (lowercased). Used after a batch confirms so the user's own
 * post-tx state refreshes without waiting on backend listener cursors.
 */
export function invalidateUltraFreshTouching(queryClient, callTargets) {
  if (!Array.isArray(callTargets) || callTargets.length === 0) return;
  const targetsLower = callTargets.map((t) => String(t).toLowerCase());
  queryClient.invalidateQueries({
    predicate: (q) => {
      if (q.meta?.tier !== 'ultraFresh') return false;
      if (!Array.isArray(q.meta.touches)) return false;
      return q.meta.touches.some((addr) =>
        targetsLower.includes(String(addr).toLowerCase()),
      );
    },
  });
}
```

Inside `useSmartTransactions()`, add a queryClient reference near the top of the body:

```javascript
const queryClient = useQueryClient();
```

In `executeBatch`'s success paths — three places where a tx hash is about to be returned — insert the invalidation. The relevant return points in the existing code (lines noted are approximate; locate by the `return ...` statement):

1. In Path A: after `const receipt = await bundlerClient.waitForUserOperationReceipt(...)` and before `return receipt.receipt.transactionHash;`:

```javascript
invalidateUltraFreshTouching(queryClient, calls.map((c) => c.to));
```

2. In the per-call fallback: after the `for` loop completes, before `return lastHash;`:

```javascript
invalidateUltraFreshTouching(queryClient, calls.map((c) => c.to));
```

3. In Path B (Coinbase): after `const hash = await normalizeBatchResult(sendResult);` (rename `sendResult`'s resolution if needed) — basically just before the final `return await normalizeBatchResult(sendResult);`:

Replace:
```javascript
return await normalizeBatchResult(sendResult);
```
With:
```javascript
const finalHash = await normalizeBatchResult(sendResult);
invalidateUltraFreshTouching(queryClient, finalCalls.map((c) => c.to));
return finalHash;
```

(Use `finalCalls` since Path B may prepend the fee call.)

- [ ] **Step 4: Run test to verify pass**

Run: `cd packages/frontend && npx vitest run src/hooks/chain/__tests__/executeBatchInvalidation.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/hooks/useSmartTransactions.js packages/frontend/src/hooks/chain/__tests__/executeBatchInvalidation.test.js
git commit -m "feat(frontend): centralized ultra-fresh invalidation in executeBatch"
```

---

## Phase D — Frontend hook migrations

### Task D1: Migrate useAllSeasons → warm

**Files:**
- Modify: `packages/frontend/src/hooks/useAllSeasons.js`

- [ ] **Step 1: Rewrite the hook**

Replace the entire file contents with:

```javascript
// src/hooks/useAllSeasons.js
import { useWarmRead } from '@/hooks/chain/useWarmRead';

/**
 * Returns every season (active + completed). Reads from /api/seasons/all
 * which is populated by season listeners — no per-season RPC fan-out.
 *
 * Each row is shaped by the backend route; consumers should treat it as the
 * Supabase season_contracts row schema:
 *   { season_id, status, bonding_curve, raffle_token, name,
 *     start_time, end_time, total_participants, total_tickets,
 *     total_prize_pool, created_block, ... }
 */
export function useAllSeasons() {
  const query = useWarmRead({
    path: '/seasons/all',
    refetchInterval: 30_000,
    staleTime: 20_000,
  });

  return {
    ...query,
    data: query.data || [],
  };
}
```

- [ ] **Step 2: Search for consumers**

Run: `cd packages/frontend && grep -rn "useAllSeasons" src --include='*.js' --include='*.jsx'`

For each consumer, confirm the shape it reads matches the backend row schema. If a consumer destructured fields like `s.config?.bondingCurve` (old on-chain shape), it needs to be updated to `s.bonding_curve` (backend row shape). Update the call sites accordingly. Most consumers iterate the array and read a small set of fields — fix them in place.

- [ ] **Step 3: Run frontend tests**

Run: `cd packages/frontend && npm test`
Expected: green.

- [ ] **Step 4: Commit**

```bash
git add packages/frontend/src/hooks/useAllSeasons.js packages/frontend/src/  # capture consumer updates
git commit -m "feat(frontend): useAllSeasons reads from /api/seasons/all (warm)"
```

---

### Task D2: Migrate useChainTime → warm

**Files:**
- Modify: `packages/frontend/src/hooks/useChainTime.js`

- [ ] **Step 1: Rewrite hook**

Read the existing useChainTime to know what it returns (probably a `bigint` or `Date`).

Run: `cat packages/frontend/src/hooks/useChainTime.js`

Replace with the warm version:

```javascript
// src/hooks/useChainTime.js
import { useWarmRead } from '@/hooks/chain/useWarmRead';

/**
 * Returns the latest chain block timestamp from /api/chain/time, populated
 * by backend listener polling. Refetches every 10s by default — pass
 * `refetchInterval: ms` to override.
 *
 * Returns `null` until the backend cache has been populated.
 */
export function useChainTime(opts = {}) {
  const query = useWarmRead({
    path: '/chain/time',
    refetchInterval: opts.refetchInterval ?? 10_000,
    staleTime: 5_000,
  });
  if (!query.data) return null;
  return Number(query.data.timestamp);
}
```

- [ ] **Step 2: Run frontend tests**

Run: `cd packages/frontend && npm test`
Expected: green.

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/hooks/useChainTime.js
git commit -m "feat(frontend): useChainTime reads from /api/chain/time (warm)"
```

---

### Task D3: Migrate useCurveState — passive path to warm; active path to warm+SSE invalidation

**Files:**
- Modify: `packages/frontend/src/hooks/useCurveState.js`

- [ ] **Step 1: Rewrite the hook**

Replace file contents with:

```javascript
// src/hooks/useCurveState.js
import { useEffect, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useWarmRead } from '@/hooks/chain/useWarmRead';
import { useLiveSubscription } from '@/hooks/chain/useLiveSubscription';

/**
 * Bonding curve state, served from backend cache populated by listeners.
 *
 *   isActive=true   → subscribe to /sse/raffle for PositionUpdate; on event,
 *                     invalidate the warm cache so the next render sees fresh data.
 *   isActive=false  → warm cache only, no polling needed (curve state changes
 *                     only on trades).
 *
 * Steps are immutable post-creation and served by /api/curve/:addr/steps,
 * never refetched after first success.
 */
export function useCurveState(
  bondingCurveAddress,
  { isActive = false, includeSteps = true, includeFees = true, enabled = true } = {},
) {
  const queryClient = useQueryClient();
  const lowerAddr = bondingCurveAddress ? bondingCurveAddress.toLowerCase() : '';

  const stateQuery = useWarmRead({
    path: '/curve/:address/state',
    params: { address: lowerAddr },
    enabled: enabled && !!bondingCurveAddress,
    staleTime: isActive ? 5_000 : 60_000,
  });

  const stepsQuery = useWarmRead({
    path: '/curve/:address/steps',
    params: { address: lowerAddr },
    enabled: enabled && !!bondingCurveAddress && includeSteps,
    staleTime: Infinity, // immutable
  });

  // Live invalidation while season is Active.
  useLiveSubscription({
    channel: 'raffle',
    enabled: isActive && !!bondingCurveAddress,
    filter: (e) =>
      e.type === 'PositionUpdate' &&
      e.bondingCurveAddress?.toLowerCase() === lowerAddr,
    onEvent: () => {
      queryClient.invalidateQueries({
        queryKey: ['warm', '/curve/:address/state', { address: lowerAddr }],
      });
    },
  });

  const refreshCurveState = useCallback(() => {
    queryClient.invalidateQueries({
      queryKey: ['warm', '/curve/:address/state', { address: lowerAddr }],
    });
  }, [queryClient, lowerAddr]);

  const debouncedRefresh = useCallback(
    (delay = 600) => {
      const t = setTimeout(refreshCurveState, delay);
      return () => clearTimeout(t);
    },
    [refreshCurveState],
  );

  const state = stateQuery.data;
  const steps = stepsQuery.data || [];
  const tail = steps.slice(Math.max(0, steps.length - 3));

  return {
    curveSupply: state?.currentSupply ? BigInt(state.currentSupply) : 0n,
    curveReserves: state?.sofReserves ? BigInt(state.sofReserves) : 0n,
    curveFees: includeFees && state?.accumulatedFees ? BigInt(state.accumulatedFees) : 0n,
    curveStep: state?.currentStep
      ? {
          step: BigInt(state.currentStep.index ?? 0),
          price: BigInt(state.currentStep.price ?? 0),
          rangeTo: BigInt(state.currentStep.rangeTo ?? 0),
        }
      : null,
    bondStepsPreview: tail.map((s) => ({
      rangeTo: BigInt(s.rangeTo),
      price: BigInt(s.price),
    })),
    allBondSteps: steps.map((s) => ({
      rangeTo: BigInt(s.rangeTo),
      price: BigInt(s.price),
    })),
    refreshCurveState,
    debouncedRefresh,
  };
}
```

- [ ] **Step 2: Run tests + lint**

Run: `cd packages/frontend && npm test && npm run lint`
Expected: green.

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/hooks/useCurveState.js
git commit -m "feat(frontend): useCurveState reads from /api/curve/:addr/* with SSE invalidation"
```

---

### Task D4: Migrate useCurveEvents → useLiveSubscription

**Files:**
- Modify: `packages/frontend/src/hooks/useCurveEvents.js`

- [ ] **Step 1: Rewrite**

Replace file contents with:

```javascript
// src/hooks/useCurveEvents.js
import { useLiveSubscription } from '@/hooks/chain/useLiveSubscription';

/**
 * Subscribes to PositionUpdate events on a bonding curve via the raffle
 * SSE channel. Drop-in for the old watchContractEvent variant: the handler
 * receives an event object whose shape mirrors the backend broadcast payload
 * rather than a viem log. Consumers that previously read log.args should
 * read event fields directly (event.player, event.seasonId, event.newTickets,
 * event.totalTickets).
 */
export function useCurveEvents(bondingCurveAddress, { onPositionUpdate } = {}) {
  const lowerAddr = bondingCurveAddress ? bondingCurveAddress.toLowerCase() : '';
  useLiveSubscription({
    channel: 'raffle',
    enabled: !!bondingCurveAddress,
    filter: (e) =>
      e.type === 'PositionUpdate' &&
      e.bondingCurveAddress?.toLowerCase() === lowerAddr,
    onEvent: (e) => {
      onPositionUpdate?.(e);
    },
  });
}
```

- [ ] **Step 2: Update consumers**

Run: `cd packages/frontend && grep -rn "useCurveEvents" src --include='*.js' --include='*.jsx'`

For each consumer, check the callback signature. The old API passed a viem `log` (with `log.args.player`, etc.); the new API passes the broadcast event directly. Update destructures: `log.args.player` → `event.player`, `log.args.totalTickets` → `BigInt(event.totalTickets)`.

- [ ] **Step 3: Run tests + lint**

Run: `cd packages/frontend && npm test && npm run lint`
Expected: green.

- [ ] **Step 4: Commit**

```bash
git add packages/frontend/src/hooks/useCurveEvents.js packages/frontend/src/
git commit -m "feat(frontend): useCurveEvents subscribes via SSE instead of polling"
```

---

### Task D5: Migrate useTreasury — warm + ultra-fresh role check

**Files:**
- Modify: `packages/frontend/src/hooks/useTreasury.js`

- [ ] **Step 1: Rewrite**

Replace file contents with:

```javascript
import { useEffect, useMemo } from 'react';
import { useAccount } from 'wagmi';
import { encodeFunctionData, formatEther } from 'viem';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { SOFBondingCurveAbi } from '@/utils/abis';
import { getContractAddresses } from '@/config/contracts';
import { getStoredNetworkKey } from '@/lib/wagmi';
import { useSmartTransactions } from '@/hooks/useSmartTransactions';
import { useWarmRead } from '@/hooks/chain/useWarmRead';
import { useUltraFreshRead } from '@/hooks/chain/useUltraFreshRead';

const MANAGER_ROLE_HASH =
  '0x03b4459c543e7fe245e8e148c6cab46a28e66bba7ee09988335c0dc88457fac2';

export function useTreasury(seasonId, bondingCurveAddress) {
  const { address } = useAccount();
  const queryClient = useQueryClient();
  const networkKey = getStoredNetworkKey();
  const contracts = getContractAddresses(networkKey);
  const { executeBatch } = useSmartTransactions();

  // Warm fetch: accumulated fees + reserves + treasury address (DB-cached).
  const treasuryQuery = useWarmRead({
    path: '/curve/:address/treasury',
    params: { address: bondingCurveAddress ? bondingCurveAddress.toLowerCase() : '' },
    enabled: !!bondingCurveAddress,
    refetchInterval: 30_000,
  });

  // Ultra-fresh role check — refetches on any tx touching the curve.
  const roleQuery = useUltraFreshRead({
    contract: { address: bondingCurveAddress, abi: SOFBondingCurveAbi },
    fn: 'hasRole',
    args: [MANAGER_ROLE_HASH, address],
    touches: bondingCurveAddress ? [bondingCurveAddress] : [],
    enabled: !!(bondingCurveAddress && address),
  });

  const accumulatedFees = treasuryQuery.data?.accumulatedFees
    ? BigInt(treasuryQuery.data.accumulatedFees)
    : 0n;
  const sofReserves = treasuryQuery.data?.sofReserves
    ? BigInt(treasuryQuery.data.sofReserves)
    : 0n;
  const treasuryAddress = treasuryQuery.data?.treasuryAddress ?? null;
  const hasManagerRole = !!roleQuery.data;

  const extractMutation = useMutation({
    mutationFn: async () => {
      if (!bondingCurveAddress) throw new Error('Bonding curve address unavailable');
      const call = {
        to: bondingCurveAddress,
        data: encodeFunctionData({
          abi: SOFBondingCurveAbi,
          functionName: 'extractFeesToTreasury',
          args: [],
        }),
      };
      return executeBatch([call]);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['warm', '/curve/:address/treasury'],
      });
    },
  });

  const handleExtractFees = async () => {
    if (!bondingCurveAddress || !address) return;
    try { await extractMutation.mutateAsync(); } catch { /* surfaced via extractError */ }
  };

  useEffect(() => {
    if (!bondingCurveAddress) return;
    if (import.meta?.env?.DEV) {
      // eslint-disable-next-line no-console
      console.debug('[Treasury] season', seasonId, {
        bondingCurveAddress,
        accumulatedFees: accumulatedFees.toString(),
        sofReserves: sofReserves.toString(),
        treasuryAddress,
      });
    }
  }, [seasonId, bondingCurveAddress, accumulatedFees, sofReserves, treasuryAddress]);

  return {
    accumulatedFees: formatEther(accumulatedFees),
    accumulatedFeesRaw: accumulatedFees,
    sofReserves: formatEther(sofReserves),
    sofReservesRaw: sofReserves,
    treasuryAddress,
    hasManagerRole,
    canExtractFees: hasManagerRole && accumulatedFees > 0n,
    extractFees: handleExtractFees,
    isExtracting: extractMutation.isPending,
    isExtractConfirmed: extractMutation.isSuccess,
    extractError: extractMutation.error,
    refetchAccumulatedFees: treasuryQuery.refetch,
    bondingCurveAddress,
  };
}
```

- [ ] **Step 2: Run tests + lint**

Run: `cd packages/frontend && npm test && npm run lint`
Expected: green.

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/hooks/useTreasury.js
git commit -m "feat(frontend): useTreasury reads warm + ultra-fresh role"
```

---

### Task D6: Migrate useSOFBalance → ultra-fresh

**Files:**
- Modify: `packages/frontend/src/hooks/useSOFBalance.js`

- [ ] **Step 1: Read existing**

Run: `cat packages/frontend/src/hooks/useSOFBalance.js`

- [ ] **Step 2: Rewrite**

Replace contents with:

```javascript
// src/hooks/useSOFBalance.js
import { useAccount } from 'wagmi';
import { formatEther } from 'viem';
import { ERC20Abi } from '@/utils/abis';
import { getContractAddresses } from '@/config/contracts';
import { getStoredNetworkKey } from '@/lib/wagmi';
import { useUltraFreshRead } from '@/hooks/chain/useUltraFreshRead';

export function useSOFBalance() {
  const { address } = useAccount();
  const contracts = getContractAddresses(getStoredNetworkKey());
  const sofAddress = contracts?.SOF;

  const query = useUltraFreshRead({
    contract: { address: sofAddress, abi: ERC20Abi },
    fn: 'balanceOf',
    args: address ? [address] : undefined,
    touches: sofAddress ? [sofAddress] : [],
    enabled: !!(address && sofAddress),
  });

  const raw = query.data ?? 0n;
  return {
    balance: formatEther(raw),
    balanceRaw: raw,
    isLoading: query.isLoading,
    refetch: query.refetch,
  };
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/hooks/useSOFBalance.js
git commit -m "feat(frontend): useSOFBalance uses ultra-fresh (RPC, tx-invalidated)"
```

---

### Task D7: Migrate useSofDecimals → ultra-fresh (infinite stale)

**Files:**
- Modify: `packages/frontend/src/hooks/useSofDecimals.js`

- [ ] **Step 1: Rewrite**

```javascript
// src/hooks/useSofDecimals.js
import { ERC20Abi } from '@/utils/abis';
import { getContractAddresses } from '@/config/contracts';
import { getStoredNetworkKey } from '@/lib/wagmi';
import { useUltraFreshRead } from '@/hooks/chain/useUltraFreshRead';

// Decimals never change for an ERC-20 token. Read once with infinite
// staleTime; no tx will ever invalidate it (touches is empty).
export function useSofDecimals() {
  const contracts = getContractAddresses(getStoredNetworkKey());
  const sofAddress = contracts?.SOF;

  const query = useUltraFreshRead({
    contract: { address: sofAddress, abi: ERC20Abi },
    fn: 'decimals',
    args: [],
    touches: [],
    enabled: !!sofAddress,
    staleTime: Infinity,
  });

  return {
    decimals: query.data ?? 18,
    isLoading: query.isLoading,
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/frontend/src/hooks/useSofDecimals.js
git commit -m "feat(frontend): useSofDecimals is degenerate ultra-fresh (infinite stale)"
```

---

### Task D8: Migrate usePlayerPosition — split self/others

**Files:**
- Modify: `packages/frontend/src/hooks/usePlayerPosition.js`

- [ ] **Step 1: Read existing + rewrite**

Run: `cat packages/frontend/src/hooks/usePlayerPosition.js`

Replace with a version that:
- If the queried address equals `useAccount().address` (self), read ultra-fresh from RPC (raffle token balanceOf for the season).
- Otherwise, read warm from `/api/transactions/positions/:user/:season`.

```javascript
// src/hooks/usePlayerPosition.js
import { useAccount } from 'wagmi';
import { useWarmRead } from '@/hooks/chain/useWarmRead';
import { useUltraFreshRead } from '@/hooks/chain/useUltraFreshRead';
import { ERC20Abi } from '@/utils/abis';

export function usePlayerPosition({ playerAddress, seasonId, raffleTokenAddress }) {
  const { address: connectedAddress } = useAccount();
  const isSelf =
    !!connectedAddress &&
    !!playerAddress &&
    connectedAddress.toLowerCase() === playerAddress.toLowerCase();

  const selfQuery = useUltraFreshRead({
    contract: { address: raffleTokenAddress, abi: ERC20Abi },
    fn: 'balanceOf',
    args: connectedAddress ? [connectedAddress] : undefined,
    touches: raffleTokenAddress ? [raffleTokenAddress] : [],
    enabled: isSelf && !!raffleTokenAddress && !!connectedAddress,
  });

  const otherQuery = useWarmRead({
    path: '/transactions/positions/:user/:season',
    params: { user: playerAddress, season: seasonId },
    enabled: !isSelf && !!playerAddress && seasonId != null,
  });

  if (isSelf) {
    return {
      ticketBalance: selfQuery.data ?? 0n,
      isLoading: selfQuery.isLoading,
      refetch: selfQuery.refetch,
    };
  }
  const raw = otherQuery.data?.ticketBalance ?? otherQuery.data?.ticket_balance ?? '0';
  return {
    ticketBalance: BigInt(raw),
    isLoading: otherQuery.isLoading,
    refetch: otherQuery.refetch,
  };
}
```

- [ ] **Step 2: Update consumers**

Run: `cd packages/frontend && grep -rn "usePlayerPosition" src --include='*.js' --include='*.jsx'`

For each consumer, verify the new args shape matches. If a caller passed a single string (the address), update to the object form `{ playerAddress, seasonId, raffleTokenAddress }`.

- [ ] **Step 3: Run tests + lint**

Run: `cd packages/frontend && npm test && npm run lint`
Expected: green.

- [ ] **Step 4: Commit**

```bash
git add packages/frontend/src/hooks/usePlayerPosition.js packages/frontend/src/
git commit -m "feat(frontend): usePlayerPosition splits self (ultra-fresh) vs others (warm)"
```

---

### Task D9: Migrate useRollover, useEligibleRolloverCohort, useConsolationStatus → warm (+ rollover SSE)

**Files:**
- Modify: `packages/frontend/src/hooks/useRollover.js`
- Modify: `packages/frontend/src/hooks/useEligibleRolloverCohort.js`
- Modify: `packages/frontend/src/hooks/useConsolationStatus.js`

These already largely call backend endpoints. We're swapping their internal `useQuery`/`fetch` boilerplate for `useWarmRead`, and adding an SSE subscription on `/sse/rollover` so claim/fund events refresh the position immediately.

- [ ] **Step 1: Rewrite useRollover**

Read existing first: `cat packages/frontend/src/hooks/useRollover.js`

Replace its internal query-machinery with `useWarmRead({ path: '/rollover/positions', params: { user: address } })` (or whatever route exists — confirm in `rolloverRoutes.js`), wired through the existing public API. Keep the return shape identical for consumers.

Add an SSE subscription so claims refresh immediately:

```javascript
import { useQueryClient } from '@tanstack/react-query';
import { useLiveSubscription } from '@/hooks/chain/useLiveSubscription';
// ... inside the hook:
const queryClient = useQueryClient();
useLiveSubscription({
  channel: 'rollover',
  enabled: !!address,
  filter: (e) =>
    e?.player?.toLowerCase() === address?.toLowerCase() || e.type === 'ConsolationFunded',
  onEvent: () => {
    queryClient.invalidateQueries({ queryKey: ['warm', '/rollover/positions'] });
  },
});
```

- [ ] **Step 2: Rewrite useEligibleRolloverCohort similarly**

Wrap with `useWarmRead`. Same SSE subscription (filter by event type === 'ConsolationFunded' or 'RolloverFunded').

- [ ] **Step 3: Rewrite useConsolationStatus**

This hook currently mixes `useRafflePrizes` + `useReadContract`. After migration it should use:
- `useWarmRead` for prize/eligibility lookup
- `useUltraFreshRead` for `viewerClaimed`/`viewerEligible` distributor reads (these change on user's own tx)

Keep the existing test file passing — port the test mocks to the new hooks. The existing test in `__tests__/useConsolationStatus.test.js` mocks `useReadContract`; replace those with mocks for `useUltraFreshRead`.

- [ ] **Step 4: Run tests**

Run: `cd packages/frontend && npm test`
Expected: green (including the migrated useConsolationStatus.test.js).

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/hooks/useRollover.js packages/frontend/src/hooks/useEligibleRolloverCohort.js packages/frontend/src/hooks/useConsolationStatus.js packages/frontend/src/hooks/__tests__/useConsolationStatus.test.js
git commit -m "feat(frontend): rollover/consolation hooks → warm + rollover SSE"
```

---

### Task D10: Migrate InfoFi market hooks → warm + infofi SSE

**Files:**
- Modify: `packages/frontend/src/hooks/useInfoFiMarket.js`
- Modify: `packages/frontend/src/hooks/useMarketsBatchInfo.js`
- Modify: `packages/frontend/src/hooks/useMarketCardData.js`
- Modify: `packages/frontend/src/hooks/useInfoFiMarketsAdmin.js`
- Modify: `packages/frontend/src/hooks/useInfoFiFactory.js` (read paths only)

These already use `useQuery` against backend endpoints — swap to `useWarmRead` for consistency. Add `useLiveSubscription({ channel: 'infofi', filter: e => e.type === 'Trade' ... })` where the data should react to trades.

- [ ] **Step 1: Rewrite each hook**

For each file, follow the same conversion pattern: read the existing hook, identify the backend `fetch(...)` calls, replace with `useWarmRead({ path: ... })`. For market-detail views, add an SSE subscription:

```javascript
import { useLiveSubscription } from '@/hooks/chain/useLiveSubscription';
const queryClient = useQueryClient();
useLiveSubscription({
  channel: 'infofi',
  enabled: !!marketId,
  filter: (e) => e.type === 'Trade' && e.fpmmAddress?.toLowerCase() === marketId?.toLowerCase(),
  onEvent: () => {
    queryClient.invalidateQueries({ queryKey: ['warm', '/infofi/markets/:marketId/info'] });
  },
});
```

- [ ] **Step 2: Run tests + lint**

Run: `cd packages/frontend && npm test && npm run lint`
Expected: green.

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/hooks/useInfoFiMarket.js packages/frontend/src/hooks/useMarketsBatchInfo.js packages/frontend/src/hooks/useMarketCardData.js packages/frontend/src/hooks/useInfoFiMarketsAdmin.js packages/frontend/src/hooks/useInfoFiFactory.js
git commit -m "feat(frontend): infofi market hooks → useWarmRead + infofi SSE"
```

---

### Task D11: Migrate useRafflePrizes, useSeasonGating → warm

**Files:**
- Modify: `packages/frontend/src/hooks/useRafflePrizes.js`
- Modify: `packages/frontend/src/hooks/useSeasonGating.js`

Both already call backend endpoints. Swap their internal `fetch`/`useQuery` to `useWarmRead`. Keep return shapes identical for consumers.

- [ ] **Step 1: Rewrite both hooks**

For each file, find the inner fetch logic and replace with:

```javascript
import { useWarmRead } from '@/hooks/chain/useWarmRead';
// inside the hook:
const query = useWarmRead({
  path: '/sponsor-prizes/:seasonId',   // or appropriate path
  params: { seasonId },
  enabled: seasonId != null,
});
// adapt return shape to match the existing public API
```

- [ ] **Step 2: Run tests + lint**

Run: `cd packages/frontend && npm test && npm run lint`
Expected: green.

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/hooks/useRafflePrizes.js packages/frontend/src/hooks/useSeasonGating.js
git commit -m "feat(frontend): useRafflePrizes/useSeasonGating → useWarmRead"
```

---

### Task D12: Migrate useAccessControl → ultra-fresh

**Files:**
- Modify: `packages/frontend/src/hooks/useAccessControl.js`

Role checks change on admin txs touching the relevant contract. Convert to `useUltraFreshRead` so they refetch on receipt.

- [ ] **Step 1: Rewrite**

```javascript
// src/hooks/useAccessControl.js
import { useUltraFreshRead } from '@/hooks/chain/useUltraFreshRead';

export function useAccessControl({ contract, role, account, enabled = true }) {
  const query = useUltraFreshRead({
    contract,
    fn: 'hasRole',
    args: role && account ? [role, account] : undefined,
    touches: contract?.address ? [contract.address] : [],
    enabled: enabled && !!contract?.address && !!role && !!account,
  });
  return {
    hasRole: !!query.data,
    isLoading: query.isLoading,
    refetch: query.refetch,
  };
}
```

- [ ] **Step 2: Update consumers if API shape changed**

Run: `cd packages/frontend && grep -rn "useAccessControl" src --include='*.js' --include='*.jsx'`

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/hooks/useAccessControl.js packages/frontend/src/
git commit -m "feat(frontend): useAccessControl → ultra-fresh (role checks)"
```

---

### Task D13: Migrate useSeasonWinnerSummaries — split active warm / past cold

**Files:**
- Modify: `packages/frontend/src/hooks/useSeasonWinnerSummaries.js`

For past seasons, winners are immutable → cold via Blockscout `transactions/:hash` or address tx lookups. For active/recently-completed, warm from existing backend endpoint if one exists, otherwise leave warm against backend.

- [ ] **Step 1: Read existing**

Run: `cat packages/frontend/src/hooks/useSeasonWinnerSummaries.js`

- [ ] **Step 2: Rewrite per-season status branching**

If a season is in `status: 'completed'`, use `useColdRead`; otherwise `useWarmRead`. Keep the existing return shape.

```javascript
// inside the hook, when looping over seasons:
const isCompleted = season.status === 'completed';
const summary = isCompleted
  ? useColdRead({ endpoint: 'transactions/:hash', params: { hash: season.distribution_tx_hash } })
  : useWarmRead({ path: '/seasons/:seasonId', params: { seasonId: season.season_id } });
```

(Note: calling hooks inside loops is generally illegal — restructure so each summary is its own component, or accept just one season at a time. See existing implementation for the current per-season layout.)

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/hooks/useSeasonWinnerSummaries.js
git commit -m "feat(frontend): useSeasonWinnerSummaries splits active (warm) vs completed (cold)"
```

---

### Task D14: Migrate allowance reads in buysell → ultra-fresh

**Files:**
- Modify: `packages/frontend/src/hooks/buysell/useBalanceValidation.js`
- Modify: `packages/frontend/src/hooks/buysell/useBuySellTransactions.js` (also delete legacy invalidations)

- [ ] **Step 1: Rewrite useBalanceValidation**

If the hook reads `allowance(owner, spender)` via `useReadContract`, replace with `useUltraFreshRead`:

```javascript
import { useUltraFreshRead } from '@/hooks/chain/useUltraFreshRead';
import { ERC20Abi } from '@/utils/abis';

const allowanceQuery = useUltraFreshRead({
  contract: { address: sofAddress, abi: ERC20Abi },
  fn: 'allowance',
  args: [owner, spender],
  touches: [sofAddress],
  enabled: !!(owner && spender && sofAddress),
});
const currentAllowance = allowanceQuery.data ?? 0n;
```

- [ ] **Step 2: Delete legacy invalidations in useBuySellTransactions**

Open `packages/frontend/src/hooks/buysell/useBuySellTransactions.js`. Locate `finishWithReceipt` (around line 50–93). Delete the block:

```javascript
queryClient.invalidateQueries({ queryKey: ["rollover"] });
queryClient.invalidateQueries({ queryKey: ["rollover-eligible"] });
queryClient.invalidateQueries({ queryKey: ["sofBalance"] });
queryClient.invalidateQueries({ queryKey: ["sofTransactions"] });
```

These were band-aids for what the centralized `invalidateUltraFreshTouching` in `executeBatch` now handles. `refetchBalance?.()` should also go — the ultra-fresh `useSOFBalance` will refetch on its own.

- [ ] **Step 3: Run buysell tests + manual smoke**

Run: `cd packages/frontend && npm test`
Expected: green.

- [ ] **Step 4: Commit**

```bash
git add packages/frontend/src/hooks/buysell/
git commit -m "feat(frontend): buysell allowance → ultra-fresh; delete legacy invalidations"
```

---

### Task D15: Migrate component-level invalidations & SSE wiring

**Files:**
- Modify: `packages/frontend/src/components/infofi/ClaimCenter.jsx`
- Modify: `packages/frontend/src/components/infofi/BuySellWidget.jsx`
- Modify: `packages/frontend/src/components/infofi/InfoFiMarketCard.jsx`
- Modify: `packages/frontend/src/components/infofi/InfoFiMarketCardMobile.jsx`
- Modify: `packages/frontend/src/components/infofi/RewardsDebug.jsx`
- Modify: `packages/frontend/src/components/curve/BuySellWidget.jsx`
- Modify: `packages/frontend/src/components/curve/TokenInfoTab.jsx`
- Modify: `packages/frontend/src/components/mobile/BuySellSheet.jsx`

These currently:
- Have their own `refetchInterval` (5–30s) on react-query queries → drop the interval; rely on SSE invalidation
- Call `qc.invalidateQueries({ queryKey: [...] })` after tx → these can stay if they target warm caches (those still need explicit invalidation), but delete the ones targeting balance/position queries (now ultra-fresh).

- [ ] **Step 1: Per component, audit + edit**

For each component:
1. Find `refetchInterval: <number>` in `useQuery` calls — delete them if data is also subscribed via SSE (the SSE invalidation will keep them fresh).
2. Find `queryClient.invalidateQueries({ queryKey: ['sofBalance'|'infofiBet'|...] })` calls after tx mutations — delete them if they target ultra-fresh queries (handled centrally). Keep ones that target warm caches the central invalidator doesn't know about.
3. If a component shows live market state, add a `useLiveSubscription({ channel: 'infofi', filter: ..., onEvent: () => qc.invalidateQueries(['warm', '/infofi/markets/:id/info']) })`.

- [ ] **Step 2: Run tests + lint**

Run: `cd packages/frontend && npm test && npm run lint`
Expected: green.

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/components/infofi/ packages/frontend/src/components/curve/ packages/frontend/src/components/mobile/
git commit -m "feat(frontend): trading components drop polling; rely on SSE + central invalidation"
```

---

### Task D16: Migrate cold reads — RaffleList completed, TransactionsTab, UserProfile activity

**Files:**
- Modify: `packages/frontend/src/routes/RaffleList.jsx` (completed-season cards / details)
- Modify: `packages/frontend/src/components/curve/TransactionsTab.jsx` (when season is completed)
- Modify: `packages/frontend/src/routes/UserProfile.jsx` (activity tab)

- [ ] **Step 1: RaffleList completed**

Within the Completed tab branch, when fetching extra detail for a completed season, use `useColdRead`:

```javascript
import { useColdRead } from '@/hooks/chain/useColdRead';
// ...
const holdersQuery = useColdRead({
  endpoint: 'tokens/:address/holders',
  params: { address: season.raffle_token },
  enabled: season.status === 'completed' && !!season.raffle_token,
  staleTime: 10 * 60_000,
});
```

- [ ] **Step 2: TransactionsTab**

When the season prop indicates completed status, swap the RPC-fetched buy/sell transactions for cold transfers:

```javascript
const transferQuery = useColdRead({
  endpoint: 'tokens/:address/transfers',
  params: { address: raffleTokenAddress },
  enabled: seasonStatus === 'completed' && !!raffleTokenAddress,
});
```

Adapt rendering to the Blockscout transfer schema (fields: `from`, `to`, `total.value`, `transaction_hash`, `timestamp`).

- [ ] **Step 3: UserProfile activity**

```javascript
const txQuery = useColdRead({
  endpoint: 'addresses/:address/transactions',
  params: { address: userAddress },
  enabled: !!userAddress,
  staleTime: 60_000,
});
```

Render the resulting `items` list.

- [ ] **Step 4: Run tests + lint**

Run: `cd packages/frontend && npm test && npm run lint`
Expected: green.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/routes/RaffleList.jsx packages/frontend/src/components/curve/TransactionsTab.jsx packages/frontend/src/routes/UserProfile.jsx
git commit -m "feat(frontend): RaffleList/TransactionsTab/UserProfile use cold reads for historical data"
```

---

### Task D17: Delete useRaffleRead dead code; migrate known consumers

**Files:**
- Delete: `packages/frontend/src/hooks/useRaffleRead.js`
- Modify: `packages/frontend/src/hooks/useRaffleState.js` (known consumer)
- Modify: `packages/frontend/src/hooks/useMarketCardData.js` (known consumer — also migrated in Task D10)
- Modify: any newly-discovered consumers from the grep

After Tasks D1+D3+D10 land, the remaining direct consumers of `useRaffleRead`/`useSeasonDetailsQuery` are `useRaffleState` and `useMarketCardData`. Migrate both, then delete the file.

- [ ] **Step 1: Search for remaining consumers**

Run: `cd packages/frontend && grep -rn "useSeasonDetailsQuery\|from.*useRaffleRead\|from ['\"]\\./useRaffleRead" src --include='*.js' --include='*.jsx' | grep -v useRaffleRead.js`

Expected: at least `useRaffleState.js` and `useMarketCardData.js`. If anything else is listed, migrate it too in the same task.

- [ ] **Step 2: Migrate useRaffleState**

Read existing: `cat packages/frontend/src/hooks/useRaffleState.js`

Replace the `useRaffleRead`/`useSeasonDetailsQuery` calls with warm reads:

```javascript
import { useWarmRead } from '@/hooks/chain/useWarmRead';

// inside useRaffleState:
const seasonsQuery = useWarmRead({ path: '/seasons/all', staleTime: 20_000, refetchInterval: 30_000 });
const currentSeasonId = seasonsQuery.data?.[0]?.season_id ?? null;
const effectiveSeasonId = explicitSeasonId ?? currentSeasonId;
const seasonDetailsQuery = useWarmRead({
  path: '/seasons/:seasonId',
  params: { seasonId: effectiveSeasonId },
  enabled: effectiveSeasonId != null,
  staleTime: 5_000,
  refetchInterval: 10_000,
});
```

Then adapt downstream return shape if needed. Keep the public API of `useRaffleState` stable.

- [ ] **Step 3: Confirm useMarketCardData is already migrated**

Task D10 should have rewritten this file to use `useWarmRead` instead of `useSeasonDetailsQuery`. If not, fix it now:

```javascript
const seasonDetailsQuery = useWarmRead({
  path: '/seasons/:seasonId',
  params: { seasonId },
  enabled: seasonId != null,
});
```

- [ ] **Step 4: Delete useRaffleRead.js**

```bash
rm packages/frontend/src/hooks/useRaffleRead.js
```

- [ ] **Step 5: Verify no stale imports**

Run: `cd packages/frontend && grep -rn "useRaffleRead" src --include='*.js' --include='*.jsx'`
Expected: empty.

- [ ] **Step 6: Run tests + lint**

Run: `cd packages/frontend && npm test && npm run lint`
Expected: green.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor(frontend): delete useRaffleRead; migrate useRaffleState + useMarketCardData to warm reads"
```

---

### Task D18: Sweep legacy ['sofBalance'] invalidations

**Files:**
- Modify: `packages/frontend/src/hooks/useClaims.js`
- Modify: `packages/frontend/src/hooks/useFundDistributor.js`
- Modify: `packages/frontend/src/hooks/useRaffle.js`
- Modify: `packages/frontend/src/hooks/useRafflePrizes.js`
- Modify: `packages/frontend/src/hooks/useRollover.js`
- Modify: `packages/frontend/src/hooks/useInfoFiMarket.js`
- Modify: `packages/frontend/src/hooks/useProfileData.js`

After Task D6 makes `useSOFBalance` ultra-fresh with `touches: [SOF]`, every tx through `executeBatch` invalidates it via the centralized predicate. The `qc.invalidateQueries({ queryKey: ['sofBalance'] })` calls scattered across handler files are redundant. Delete them.

- [ ] **Step 1: Enumerate occurrences**

Run: `cd packages/frontend && grep -rn '"sofBalance"\|.sofBalance.' src --include='*.js' --include='*.jsx'`
Expected: lines in useClaims.js, useFundDistributor.js, useRaffle.js, useRafflePrizes.js, useRollover.js, useInfoFiMarket.js, useProfileData.js.

- [ ] **Step 2: Delete each invalidation call**

For each line of the form:
```javascript
qc.invalidateQueries({ queryKey: ["sofBalance"] });
// or
queryClient.invalidateQueries({ queryKey: ["sofBalance"] });
// or with extra args
qc.invalidateQueries({ queryKey: ["sofBalance", netKey, contracts.SOF, address] });
```
Delete the entire call. Keep adjacent invalidations for OTHER query keys.

- [ ] **Step 3: Handle useProfileData**

`useProfileData.js` defines its own `useQuery({ queryKey: ['sofBalance', ...] })`. This is a duplicate of `useSOFBalance`. Delete the entire `sofBalanceQuery` definition; have the hook return `useSOFBalance()` instead:

```javascript
import { useSOFBalance } from '@/hooks/useSOFBalance';
// inside useProfileData:
const sofBalance = useSOFBalance();
// replace `sofBalanceQuery` in the return with:
sofBalanceQuery: {
  data: sofBalance.balanceRaw,
  isLoading: sofBalance.isLoading,
  refetch: sofBalance.refetch,
},
```

(Verify the consumers — `ProfileContent.jsx`, possibly others — read `.data`. The shim above keeps the field shape.)

- [ ] **Step 4: Run tests + lint**

Run: `cd packages/frontend && npm test && npm run lint`
Expected: green.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/hooks/
git commit -m "refactor(frontend): delete redundant sofBalance invalidations (handled by central predicate)"
```

---

## Phase E — Verify & ship

### Task E1: Version bumps

**Files:**
- Modify: `packages/frontend/package.json`
- Modify: `packages/backend/package.json`

- [ ] **Step 1: Bump frontend minor**

Open `packages/frontend/package.json`, increment the minor version (e.g., `0.26.0` → `0.27.0`).

- [ ] **Step 2: Bump backend minor**

Same in `packages/backend/package.json`.

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/package.json packages/backend/package.json
git commit -m "chore: bump frontend + backend minor versions for RPC-reduction release"
```

---

### Task E2: Run the full test + lint + build matrix

**Files:** none

- [ ] **Step 1: Run tests across the monorepo**

Run: `npm test`
Expected: all green.

- [ ] **Step 2: Run lint across the monorepo**

Run: `npm run lint`
Expected: zero warnings.

- [ ] **Step 3: Run build across the monorepo**

Run: `npm run build`
Expected: success in all packages.

If any step fails, fix the underlying issue and re-run before continuing.

---

### Task E3: Apply migration to remote Supabase

**Files:** none (operational)

- [ ] **Step 1: Confirm local migration is in place**

Run: `ls packages/backend/migrations/ | grep 018`
Expected: `018_curve_state.sql` listed.

- [ ] **Step 2: Push to remote**

```bash
cd packages/backend
supabase migration list --linked
supabase db push --linked
supabase migration list --linked   # confirm 018 is now applied
```

If the remote shows older migrations as unapplied while the local lists them, repair with `supabase migration repair --status applied <timestamp>` first, then push 018.

- [ ] **Step 3: Smoke-test endpoint**

```bash
curl https://<railway-pr-env>/api/seasons/all | head
```
Expected: JSON array (may be empty if no seasons populated yet — but no 500).

---

### Task E4: Tenderly RPC budget gate

**Files:** none (manual verification — log evidence in the PR description)

- [ ] **Step 1: Capture baseline**

On the Tenderly dashboard for the project, screenshot the RPC request count for the last hour.

- [ ] **Step 2: Smoke-test the PR preview**

With the Vercel + Railway PR previews up:
- Open the Raffle List, scroll through all 4 tabs.
- Open an active raffle detail page; let it sit for 60 seconds.
- Buy 1 ticket; watch position update.
- Open Profile activity.
- Open InfoFi trading widget.
- Open Admin panel (if you have access).

Total smoke session: ~5 minutes.

- [ ] **Step 3: Capture delta**

Screenshot the new request count. Compute the delta.

Expected: < 100 RPC calls over 5 minutes (vs. several thousand pre-change).

- [ ] **Step 4: Document in PR**

Edit the PR description to attach both screenshots + the delta number. Check off "Tenderly RPC delta logged" in the test plan.

---

### Task E5: Per-screen smoke checklist

**Files:** none (manual verification on the PR preview — log evidence in the PR description)

- [ ] Raffle List (4 tabs: Upcoming / Active / Settling / Completed) renders without RPC fan-out
- [ ] Active raffle detail page — buy a ticket, watch position + curve state update within ~1s
- [ ] Rollover claim flow — claim a consolation, balance refreshes immediately
- [ ] User profile — historical activity tab loads from Blockscout proxy
- [ ] InfoFi trading widget — place a bet, market info reflects new trade
- [ ] Admin panel — role checks work, treasury extraction succeeds
- [ ] Create season workflow — chain time fetches from /api/chain/time, gating signature works
- [ ] System menu — SOF balance loads when menu opens, updates after a buy

Take screenshots of each step. Attach to PR.

---

### Task E6: Final PR polish + mark ready for review

**Files:** none

- [ ] **Step 1: Update PR description**

Add the test-plan results, screenshots, and Tenderly delta.

- [ ] **Step 2: Mark PR ready for review**

```bash
gh pr ready <PR_NUMBER>
```

(`PR_NUMBER` for this branch is #85.)

- [ ] **Step 3: Notify owner**

Mention the PR in the team channel (or wait for the user). Do NOT merge yet — user-driven action.

---

## Done criteria

- All ~60 frontend read hooks routed through one of the four `chain/*` hooks.
- All hand-rolled `invalidateQueries` blocks after txs are deleted; centralized predicate in `executeBatch` is the only invalidation path.
- Backend SSE serves three per-domain channels; `/sse/market-events` is gone.
- Blockscout reads happen exclusively via the backend proxy.
- Tenderly RPC delta < 100 over the 5-minute smoke session.
- All vitest + lint + build green.
- Supabase migration 018 applied to both local and `mmblfpccknlrhowicesv`.
- Frontend + backend minor versions bumped.
