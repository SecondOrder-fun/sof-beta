# SecondOrder.fun Backend Guidelines

## Technology Stack

- **Fastify 5** — main application server (ESM, `"type": "module"`)
- **Supabase** (PostgreSQL) — primary database via `@supabase/supabase-js` service role client
- **Redis** (Upstash/IORedis) — caching, rate limiting, real-time state
- **Viem** — Ethereum RPC reads (public client) and transaction signing (wallet client)
- **JSON Web Tokens** — auth via `jsonwebtoken` (Bearer tokens)
- **Node.js 20+** — ES module imports throughout

## Project Layout

```
packages/backend/
├── fastify/
│   ├── server.js              # App entrypoint: plugins, routes, listeners
│   └── routes/                # Route modules (Fastify plugin pattern)
│       ├── healthRoutes.js
│       ├── authRoutes.js
│       ├── seasonRoutes.js
│       ├── infoFiRoutes.js
│       ├── raffleTransactionRoutes.js
│       ├── airdropRoutes.js
│       ├── sseRoutes.js
│       ├── paymasterProxyRoutes.js
│       ├── accessRoutes.js
│       ├── allowlistRoutes.js
│       ├── adminRoutes.js
│       ├── userRoutes.js
│       ├── usernameRoutes.js
│       ├── groupRoutes.js
│       ├── gatingRoutes.js
│       ├── routeConfigRoutes.js
│       ├── sponsorPrizeRoutes.js
│       ├── nftDropRoutes.js
│       └── farcasterWebhookRoutes.js
├── shared/                    # Shared services (imported by routes + listeners)
│   ├── supabaseClient.js      # Supabase singleton + query helpers
│   ├── redisClient.js         # Redis singleton
│   ├── auth.js                # JWT AuthService + Fastify auth hook
│   ├── adminGuard.js          # createRequireAdmin() preHandler
│   ├── accessService.js       # getUserAccess, ACCESS_LEVELS
│   ├── allowlistService.js    # Allowlist CRUD (absorbed from sof-allowlist)
│   ├── historicalOddsService.js
│   ├── routeConfigService.js
│   ├── groupService.js
│   ├── usernameService.js
│   ├── fidResolverService.js
│   ├── farcasterNotificationService.js
│   ├── sponsorPrizeService.js
│   └── utils.js
├── src/
│   ├── config/
│   │   └── chain.js           # Network config (LOCAL, TESTNET, MAINNET)
│   ├── lib/
│   │   ├── viemClient.js      # Public + wallet clients
│   │   ├── blockCursor.js     # Persistent block tracking (Supabase-backed)
│   │   └── contractEventPolling.js  # Chunked event polling with backoff
│   ├── listeners/             # On-chain event listeners (long-running)
│   │   ├── seasonStartedListener.js
│   │   ├── seasonCompletedListener.js
│   │   ├── positionUpdateListener.js
│   │   ├── marketCreatedListener.js
│   │   ├── tradeListener.js
│   │   ├── sponsorHatListener.js
│   │   └── sponsorPrizeListener.js
│   ├── services/              # Business logic services
│   │   ├── infoFiPositionService.js
│   │   ├── raffleTransactionService.js
│   │   ├── seasonLifecycleService.js
│   │   ├── seasonReconciliationService.js
│   │   ├── sseService.js
│   │   ├── paymasterService.js
│   │   ├── oracleCallService.js
│   │   └── adminAlertService.js
│   ├── utils/
│   │   └── blockRangeQuery.js
│   └── scripts/
│       └── backfillMarketTrades.js
├── scripts/
│   ├── reset-local-db.js
│   └── scan-historical-events.js
├── migrations/                # Supabase SQL migrations (sequential numbering)
├── tests/
│   ├── api/                   # Route tests
│   └── backend/               # Service + listener tests
├── env/                       # Environment files (gitignored)
└── package.json
```

## Route Pattern

Routes are Fastify async plugins registered with a URL prefix in `server.js`.

```js
// Route module pattern
export default async function exampleRoutes(fastify) {
  fastify.get("/endpoint", async (request, reply) => {
    // request.user is populated by auth hook (may be null for public endpoints)
    return reply.send({ data });
  });
}

// Registration in server.js
await app.register(exampleRoutes, { prefix: "/api/example" });
```

### Auth Middleware

`authenticateFastify(app)` registers a global `onRequest` hook that parses `Authorization: Bearer <JWT>` headers and sets `request.user`. It does NOT reject unauthenticated requests — individual routes or preHandlers enforce auth.

### Body Schema Validation

Mutation routes should declare a JSON Schema for `body` (and where applicable `params` / `querystring`). Fastify validates against the schema before the handler runs and rejects malformed payloads with a structured 400. Reusable fragments live in `shared/schemas/index.js`:

```js
import { fidOrWalletSchema } from "../../shared/schemas/index.js";

fastify.post(
  "/add",
  {
    preHandler: [requireAdmin],
    schema: { body: fidOrWalletSchema },
  },
  async (request, reply) => {
    // request.body is shape-validated; handlers can drop the
    // hand-rolled `if (!body.foo)` checks the schema covers.
    const { fid, wallet } = request.body;
    ...
  },
);
```

Tier-1 routes covered as of `@sof/backend@0.20.0`: `accessRoutes.set-access-level`, `allowlistRoutes.add` / `.remove`, `airdropRoutes.claim`, `delegationRoutes.delegate` / `.delegate-shortcut`, `gatingRoutes.signatures`. New mutation routes should follow the same pattern; reuse fragments from `shared/schemas/index.js` or add new ones there.

Note: Fastify's default Ajv config strips unknown fields silently (`removeAdditional: 'all'`). Schemas declare `additionalProperties: false` for documentation, but the strip-vs-reject behavior is global; toggle the global Ajv config if strict input rejection ever becomes load-bearing.

### Admin Guard

Protected routes use the `createRequireAdmin()` preHandler:

```js
import { createRequireAdmin } from "../../shared/adminGuard.js";
const requireAdmin = createRequireAdmin();

fastify.get("/admin-only", { preHandler: [requireAdmin] }, handler);
```

This checks `request.user` against the allowlist access service. Requires `ACCESS_LEVELS.ADMIN` (level 4).

## Service Layer

Business logic lives in `shared/` (stateless query helpers) and `src/services/` (stateful services with lifecycle). Routes call services; services call Supabase/Redis/RPC.

### Supabase Client

`shared/supabaseClient.js` exports:
- `db` — singleton with helper methods (e.g., `db.getSeasonContracts()`, `db.getOrCreatePlayerId()`)
- `db.client` — raw `@supabase/supabase-js` client for direct queries
- `hasSupabase` — boolean, false if env vars missing (graceful degradation)

Always use the service-role client. All Supabase tables have RLS; service role bypasses it.

### Redis Client

`shared/redisClient.js` exports a singleton `RedisClient` class. Connect lazily; check `isConnected` before use. Used for:
- SSE connection state
- Rate limiting supplements
- Ephemeral caching

### Viem Clients

`src/lib/viemClient.js` exports:
- `publicClient` — read-only RPC client for contract reads and event polling
- Chain config from `src/config/chain.js` (`getChainByKey("TESTNET")`)

## Event Listeners

Long-running processes started in `server.js` after route registration. Each listener:

1. Creates a `blockCursor` (Supabase-backed) for crash recovery
2. Backfills missed events from last processed block on startup
3. Polls for new events using `contractEventPolling` with chunked block ranges
4. Processes events idempotently (check-before-insert pattern)

```js
// Pattern: start listener in server.js
await startSeasonStartedListener({
  raffleAddress, raffleAbi, logger, chainConfig,
  onSeasonCreated: async (season) => { /* ... */ }
});
```

### Block Cursor

`src/lib/blockCursor.js` persists the last processed block number in the `listener_block_cursors` Supabase table. Key format: `{contractAddress}:{eventName}`.

### Contract Event Polling

`src/lib/contractEventPolling.js` provides `startContractEventPolling()` which:
- Polls at configurable intervals
- Chunks large block ranges to avoid RPC limits
- Handles reorgs by processing from `lastBlock - confirmations`

## ABI Imports

Always import ABIs from `@sof/contracts`:

```js
import { RaffleABI, SOFBondingCurveABI } from '@sof/contracts';
import { getDeployment } from '@sof/contracts/deployments';
```

Never copy ABI JSON files into the backend. The contracts package is the single source of truth.

## Error Handling

- Return structured JSON errors: `reply.code(400).send({ error: "message" })`
- Use Fastify's built-in logger (`fastify.log.error()`, `request.log.info()`)
- Listeners use try/catch with logging; never let listener errors crash the server
- Validate required env vars at module load time (throw on missing)

## Environment Variables

Environment files live in `packages/backend/env/`. Key variables:
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` — database
- `REDIS_URL` (or `REDIS_URL_PROD`, `REDIS_URL_STAGING`, `REDIS_URL_DEV`) — cache
- `JWT_SECRET`, `JWT_EXPIRES_IN` — auth tokens
- `RPC_URL` — Ethereum RPC endpoint
- `NETWORK` — `LOCAL`, `TESTNET`, or `MAINNET`
- `CORS_ORIGINS` — comma-separated list (supports regex patterns wrapped in `/`)
- `BACKEND_WALLET_PRIVATE_KEY` — for signing attestations and relay transactions
- `NEYNAR_API_KEY` — Farcaster webhook verification
- `PAYMASTER_RPC_URL_TESTNET` — CDP paymaster proxy target

## Testing

Tests use Vitest. Run with `npm test` from `packages/backend/`.

```
tests/
├── api/         # Route-level tests (mock services, test HTTP responses)
└── backend/     # Service + listener unit tests
```

### Test Patterns

- Mock Supabase client and Redis for unit tests
- Mock viem `publicClient` for contract read tests
- Test admin guard enforcement on protected routes
- Test webhook signature verification
- Use `describe`/`it` with descriptive test names

## Migrations

SQL migrations live in `packages/backend/migrations/` with sequential numbering (`001_`, `002_`, etc.). Apply via Supabase SQL Editor or CLI. Core tables without migrations should be backfilled.

## CORS Configuration

`CORS_ORIGINS` env var supports:
- Plain origins: `https://secondorder.fun`
- Regex patterns: `/\.vercel\.app$/` (wrapped in `/`)
- Comma-separated: `https://secondorder.fun,/\.vercel\.app$/`

In development (non-production), CORS defaults to `true` (allow all). In production, `CORS_ORIGINS` is required.
