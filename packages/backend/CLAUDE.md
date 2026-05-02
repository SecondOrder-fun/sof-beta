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
7 on-chain event listeners run as long-lived processes started in `server.js`. Each uses a Supabase-backed block cursor for crash recovery and processes events idempotently (check-before-insert).

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

<!-- pr-preview pairing test marker (PR #69 / v2 workflow). Safe to revert. -->

