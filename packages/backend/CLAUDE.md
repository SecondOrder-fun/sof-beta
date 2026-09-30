# @sof/backend Rules

See `instructions/backend-guidelines.md` for full coding conventions, route patterns, service layer structure.

## Key Rules

### Route Pattern
Routes are Fastify async plugins registered with URL prefix in `server.js`. Auth hook populates `request.user` from Bearer JWT but does not reject unauthenticated requests — routes enforce auth individually.

### Admin Guard
Protected routes use `createRequireAdmin()` preHandler from `shared/adminGuard.js`. Requires access level 4 (ADMIN) checked against allowlist access service.

```js
import { createRequireAdmin } from "../../shared/adminGuard.js";
const requireAdmin = createRequireAdmin();
fastify.get("/admin-only", { preHandler: [requireAdmin] }, handler);
```

### Allowlist Service
Absorbed from the former `sof-allowlist` repo. Lives in `shared/allowlistService.js`. Manages FID-based and wallet-based access control with granular access groups.

### ABI Imports
Always import from `@sof/contracts`:
```js
import { RaffleABI, SOFBondingCurveABI } from '@sof/contracts';
import { getDeployment } from '@sof/contracts/deployments';
```

Never copy ABI JSON files into the backend.

### Event Listeners
On-chain event listeners run as long-lived processes started in `server.js` (`startListeners`). The fixed set (SeasonStarted, SeasonCompleted, SeasonStatus — itself 5 event pollers, MarketCreated, Rollover, AccountCreated, SponsorHat) is joined by per-season/per-market pollers (PositionUpdate per season, Trade per FPMM market), so the live poller count grows with active raffles. Each uses a Supabase-backed block cursor for crash recovery and processes events idempotently (check-before-insert).

All pollers share one chain-head source: `startListeners` registers and starts a `blockHead.js` tracker for the `publicClient` singleton **before** any listener, so each `contractEventPolling` tick reads the cached head instead of issuing its own `getBlockNumber`/`getBlock` pair (keeps Tenderly RPC volume flat as raffles scale). The tracker is stopped in the shutdown gather.

### Launchpad Indexer

`tokenLaunchedListener` indexes `TokenLaunchpad.TokenLaunched` into `token_launches`
(migration 023), served at `/api/launchpad/tokens`. Two things are specific to it:

- It is the **only** source for a token's name, symbol and metadata URI. The launchpad
  emits them but does not store them (a setter would let a creator swap the name after
  people have bought), so a missed event is not recoverable by reading the contract
  later — unlike every other listener here, whose state can be re-read.
- The event's `placementId` **is** the Uniswap v4 PoolId, so `token_launches.pool_id`
  is the key `launchTradeListener` uses to attribute PoolManager `Swap` logs to a token.

Because a missed launch is unrecoverable, `processTokenLaunchedLog` lets a failed
block-time read, or a transient (or unknown) insert failure, **throw** — there is no
stand-in `launched_at`, since the insert ignores a launch already indexed and a wrong time
would never be corrected: the poller tick fails before its cursor moves and the
range is retried (`contractEventPolling` never advances past a range whose `onLogs` threw —
tested). A row that can **never** be stored — a Postgres data or constraint error, SQLSTATE
class 22/23, which supabase-js surfaces as `error.code` — is logged at error level with its
tx hash and skipped, since retrying it would block every later launch (and the trade
listener) forever. `buildLaunchRow` makes the text storable first: U+0000 dropped (Postgres
TEXT rejects it), name/symbol cut to the launchpad's 48/16 limits, and a metadata URI over
2,048 characters dropped rather than cut. Boot scans (both launch listeners, via
`src/lib/bootScanWindow.js`) hand the live poller `resumeNoLaterThan`: the block after the
scanned head when the scan finished (so blocks mined during the scan are covered even with
an empty cursor), the failed block when it failed partway, and the stored cursor — or the
lookback window's start — when it failed before learning its window. After a completed
scan `launchTradeListener` also saves the scanned head as its cursor (unless the stored
cursor is older than the window — the blocks between were not scanned), so the poller
does not process the window a second time.
`launchTradeListener` indexes launches through the same exported function, so whichever
listener's insert wins broadcasts `TokenLaunched` — exactly once.

The listener is skipped, at info level, when `TokenLaunchpad` is absent from the
deployment JSON. That is a normal state: the raffle stack deploys independently of the
launchpad, and deploy step 22 skips on a chain with no Uniswap v4. The two launch
listeners start independently, in the background, through `src/lib/startWithRetry.js`:
a failed start (a chain or database read) is logged and retried with backoff (5 s
doubling to a 5-minute cap, indefinitely), never crashing the server; the stop function
it returns cancels a pending retry, so shutdown never races a late start.

`launchTradeListener` indexes trades on launch pools into `launch_trades` from the v4
PoolManager's `Swap` event. Rules it depends on:

- **Always filter by pool id at the RPC.** The PoolManager is a singleton, so an
  unfiltered `Swap` query is every v4 swap on the chain. `contractEventPolling` takes an
  `args` filter; a filter function returning `null` (or an empty list) means "nothing to
  watch" and skips the query — it never falls back to unfiltered (tested). The pool ids
  go out in batches of at most 100 (`args` may be a list of filters: one getLogs each,
  run in parallel, merged in log order), so the OR-list stays within RPC limits as
  launches accumulate.
- **Discover pools per block range.** The filter function receives the range about to be
  queried and reads that range's `TokenLaunched` events first (chunked, 2,000 blocks —
  the boot scan too), so a new token's first swaps are never skipped because the launch
  indexer lagged a tick. The span already read is tracked in memory, so a retried range
  (or the part of the poller's first range the boot scan covered) is not read again. A
  launch skipped as unstorable is not watched either — its trades could not be stored.
  The starting pool map (`tokenLaunchesDb.listPoolIndex`) is paged by keyset until
  exhausted: PostgREST caps a response at 1,000 rows by default.
- **`amount0 < 0` is a BUY, and `sender` is the router.** Pinned against a real swap by
  `contracts/test/UniV4LaunchRouter.t.sol:test_swapEventSignConvention_forTheIndexer`
  (IPoolManager's own comment reads as the opposite sign). The real trader comes from
  the router's `Bought`/`Sold` event in the same receipt, trusted only when the swap's
  sender has been a launch router **and** emitted the event. The trusted set is built
  from chain history, not memory, so it survives a restart: every
  `TokenLaunchpad.RouterUpdated` (previous and current) from the launchpad's deploy block
  (`LAUNCHPAD_DEPLOY_BLOCK`, else `deployBlocks.TokenLaunchpad` in the deployments file,
  which `scripts/extract-deployment-addresses.js` records from the broadcast receipts) —
  else from the earlier of the lookback window and the stored cursor, which misses a
  router retired before it, so startup warns — plus the current `router()`, and the history is read up to the
  newest swap before each batch is attributed. Each Swap pairs with the router event
  that follows it in log order (a batched buy-then-sell attributes both), and a Bought
  only names a BUY, a Sold only a SELL.
- **Never store a half-built row.** A failed block-time read, receipt read, router-history
  read or trade insert throws, so the range is retried; a row written with `block_time`
  NULL or the router as trader would never be repaired, since the insert ignores
  duplicates. Blocks and receipts are fetched 4 at a time.
- **Broadcast only what was inserted.** `insertLaunchTrades` returns the rows its
  `ON CONFLICT DO NOTHING` actually inserted, and only those go out as `TokenTrade` SSE —
  a restart's replay or a retried range never re-announces old trades as live.

Seasons link to launch tokens through `season_contracts.quote_token_address`, and record
their grand-prize `winner_address` (migration 024). The season listeners only send those
fields when the on-chain read produced them — a failed read on replay never writes null
over a stored value — and fill a missing `quote_token_address` on rows written before 024.
The launchpad's live surfaces read:
`/api/launchpad/tokens/:address/chart`, `/tokens/:address/seasons`, `/raffles?tokens=`
(badges for a page of cards), and `/api/activity` (the ticker's tokens and raffles rows).
Shaping for all of them is pure, in `src/services/activityFeed.js`. Rules they share:

- **Hidden tokens** (`token_launches.is_hidden`) are absent everywhere: the token, chart
  and seasons routes 404 them, and `/raffles` and `/api/activity` drop their trades and
  the seasons priced in them (`launchpadActivityDb.hiddenTokens`). The ticker's recent
  trades exclude them **in the query** (inner join to `token_launches` on
  `is_hidden = false`), so a heavily traded hidden token cannot use up the row's limit.
  That query's `(block_number DESC, log_index DESC)` order is served by
  `launch_trades_recent_idx` (migration 025).
- **A live season's prize pool is its curve's reserves** (`curve_state.sof_reserves`,
  one batched query per request via `launchpadActivityDb.curveReserves`):
  `season_contracts` records `total_prize_pool` only at start, status changes and
  completion. Participants stay as `season_contracts` last recorded them — nothing the
  backend keeps current per trade counts a season's holders (`user_raffle_positions` is
  refreshed only by the historical sync).
- **Raffle entries are scoped by bonding curve.** `season_id` restarts on a Raffle
  redeploy, so an entry counts for a season only if its `bonding_curve_address` matches
  the season's (migration 020).
- The chart reads **every** trade in range, paged newest-first by
  `(block_number, log_index)` keyset and returned oldest first, up to 50,000. Past that
  the oldest are dropped (never the latest price), the response says `truncated: true`,
  and the line enters at the newest trade left out instead of the launch price (the last
  trade before the range is read only for a complete range). Feeds that order trades
  tie-break on `log_index` within a block.
- **"won" items are dated by the season's `end_time`**, and recent seasons are ordered by
  `end_time`/`start_time`, never `updated_at`: every listener write (replays on restart
  included) bumps `updated_at`, which would resurface old wins as new. A won item carries
  `grandPrize` = floor(`total_prize_pool` × `grand_prize_bps` / 10000) when both are
  known; season summaries carry `grandPrizeBps`. Entry items have no `logIndex`
  (`raffle_transactions` records none; it is unique on `tx_hash` + `season_id`).

### Error Handling
- Return structured JSON: `reply.code(400).send({ error: "message" })`
- Use Fastify logger (`fastify.log.error()`, `request.log.info()`)
- Listener errors must never crash the server
- Validate required env vars at module load time

### Backend Relay Functions
For gasless relay transactions (e.g., airdrop attestations), follow the four-layer verification pattern:
1. Authenticate caller (JWT or MiniApp context)
2. Validate inputs (address format, FID existence)
3. Sign with backend wallet (`BACKEND_WALLET_PRIVATE_KEY`)
4. Return signature for on-chain submission

## Commands

```bash
npm run dev            # Dev server with env loading
npm test           # Vitest
npm run lint           # ESLint (zero warnings enforced)
npm run reset:local-db    # Reset local Supabase
npm run scan:historical   # Backfill missed events
```
