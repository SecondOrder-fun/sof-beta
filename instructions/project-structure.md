# SecondOrder.fun Project Structure

## Monorepo Layout

```
sof-beta/
├── package.json                    # Root scripts, npm workspace
├── turbo.json                      # Turborepo task pipeline
├── .env.shared                     # Non-secret shared vars (tracked)
├── .env.platform                   # Vercel/Railway tokens (gitignored)
├── .env.platform.example           # Template for platform tokens
├── scripts/
│   ├── local-dev.sh                # Local stack: Anvil + contracts + Supabase + backend + frontend
│   ├── deploy-env.sh               # Push env vars to Vercel/Railway (sync-env-vercel.sh, sync-env-railway.sh; --prune)
│   ├── export-abis.js              # Build ABIs from Foundry output
│   ├── extract-deployment-addresses.js  # deployments/<network>.json from the forge broadcast log
│   ├── grant-backend-wallet.sh     # Backend wallet PAYMASTER_ROLE on InfoFiMarketFactory (--check is read-only)
│   ├── revoke-sma-roles.sh         # Revoke admin roles held by the retired smart account (sends via forge script/ops/)
│   ├── lib/roles.sh                # Shared helpers for the role scripts (validated hasRole reads, lag-tolerant waits)
│   └── load-env.sh                 # Load env files for dev
├── supabase/migrations/            # Supabase CLI copies of the backend migrations (pushed to the remote project)
├── .github/
│   └── workflows/
│       └── pr-preview-pairing.yml  # Paired Vercel + Railway preview orchestration ([preview] commits)
├── instructions/                   # Living documentation
│   ├── project-requirements.md     # Vision, architecture, tech stack
│   ├── project-structure.md        # This file
│   ├── frontend-guidelines.md      # UI/UX conventions
│   ├── backend-guidelines.md       # API/service conventions
│   └── archive/                    # Retired docs (project-tasks.md superseded by TaskList)
├── packages/
│   ├── frontend/                   # @sof/frontend — React/Vite (Vercel)
│   ├── backend/                    # @sof/backend — Fastify API (Railway)
│   └── contracts/                  # @sof/contracts — Foundry/Solidity (Base)
└── docs/                           # GitBook documentation
```

## Package: frontend (`@sof/frontend`)

Deployed to **Vercel**. React 18 + Vite 6 + Tailwind CSS.

```
packages/frontend/
├── package.json
├── vite.config.js
├── vitest.config.js
├── env/                            # .env.local, .env.testnet, .env.mainnet (gitignored)
├── api/                            # Vercel serverless functions (OG images)
├── public/
│   └── locales/{lang}/             # i18n translation files
├── src/
│   ├── styles/tailwind.css         # CSS variables — ONLY place colors are defined
│   ├── components/
│   │   ├── ui/                     # shadcn/ui base components (Radix wrappers)
│   │   ├── layout/                 # Header, Footer, PageTitle, StickyFooter
│   │   ├── auth/                   # LoginModal, MobileLoginSheet, sign-in banners/overlays
│   │   ├── access/                 # AccessGate, ProtectedRoute, MaintenancePage
│   │   ├── infofi/                 # InfoFi market cards, charts, trading
│   │   ├── launchpad/              # Token cards/table, buy panel, price chart, trades, raffle badge/card, creator fees
│   │   ├── raffle/, raffles/       # Season cards, holdings, list views
│   │   ├── buysell/                # BuyForm, SellForm, SlippageSettings
│   │   ├── mint/                   # AllowlistMintCard, GiftClaimCard
│   │   ├── gating/                 # SignatureGateModal, PasswordGateModal
│   │   └── mobile/                 # Mobile layout (phones, touch tablets): MobileHeader, BottomNav, SystemMenu, per-route views
│   ├── context/                    # React contexts (auth, SSE, theme, wallet)
│   ├── features/                   # Feature modules
│   │   └── admin/                  # Admin panel components
│   ├── hooks/                      # Custom React hooks (useSmartTransactions.executeBatch is the single write path)
│   ├── lib/                        # Pure helpers: curve/v4 pool math, creator fees, launch formatting, wagmi config
│   ├── routes/                     # Route components (RaffleList, Launch, TokensIndex, AccountPage, UserProfile, …)
│   ├── services/                   # API + business logic services
│   ├── utils/                      # Utility functions
│   ├── config/                     # App config (contract addresses, hats, access levels)
│   └── test/                       # Test setup
└── tests/                          # Vitest test files
```

## Package: backend (`@sof/backend`)

Deployed to **Railway**. Fastify 5 + Supabase + Redis.

```
packages/backend/
├── package.json
├── env/                            # .env.local, .env.testnet, .env.mainnet (gitignored)
├── fastify/
│   ├── server.js                   # Entrypoint: plugins, routes, listeners
│   └── routes/                     # Route modules (Fastify plugin pattern)
├── shared/                         # Shared services (supabase, redis, auth, access, usernames)
├── src/
│   ├── config/chain.js             # Network configuration
│   ├── lib/                        # Core libraries (viemClient, blockHead, blockCursor, contractEventPolling)
│   ├── listeners/                  # On-chain event listeners (seasons, InfoFi, rollover, sponsors, launches, launch trades)
│   ├── services/                   # Business logic (positionRelayService, activityFeed, season lifecycle, …)
│   ├── utils/                      # Utility functions
│   └── scripts/                    # One-off scripts
├── scripts/                        # Operational scripts (reset-local-db, backfill-positions, reconcile-seasons)
├── migrations/                     # Numbered SQL migrations (mirrored in root supabase/migrations/)
├── tests/                          # Vitest tests (api/, backend/, listeners/, scripts/, services/)
└── supabase/                       # Supabase config
```

## Package: contracts (`@sof/contracts`)

Deployed to **Base** (Sepolia testnet, mainnet planned). Foundry + Solidity ^0.8.20.

```
packages/contracts/
├── package.json                    # Exports: "./abi/index.js", "./deployments/index.js"
├── foundry.toml
├── env/                            # .env.local, .env.testnet, .env.mainnet (gitignored)
├── src/
│   ├── core/                       # Raffle.sol, SeasonFactory.sol, RaffleStorage.sol, RafflePrizeDistributor.sol
│   ├── curve/                      # SOFBondingCurve.sol, IRaffleToken.sol
│   ├── token/                      # RaffleToken.sol
│   ├── infofi/                     # InfoFiMarketFactory, InfoFiFPMMV2, InfoFiPriceOracle, InfoFiSettlement, ConditionalTokenSOF, MarketTypeRegistry, RaffleOracleAdapter
│   ├── gating/                     # SeasonGating.sol, SeasonGatingStorage.sol
│   ├── sponsor/                    # SponsorOnboarding.sol
│   ├── launchpad/                  # TokenLaunchpad, LaunchToken, UniV4LiquidityPlacer (also the pools' hook), HookMiner, UniV4LaunchRouter (+ interfaces)
│   ├── lib/                        # Interfaces (IRaffle, ISeasonFactory, etc.) + RaffleTypes, RaffleLogic
│   └── test-helpers/               # MockERC20.sol (placeholder quote token), MockUSDC.sol
├── test/                           # Forge tests + helpers/ + invariant/ + integration/
├── script/deploy/                  # Numbered deploy steps chained by DeployAll.s.sol
├── script/ops/                     # Operational forge scripts (RevokeSmaRoles.s.sol)
├── abi/                            # Exported ABIs (generated by export-abis.js)
│   └── index.js                    # Named ABI exports
├── deployments/                    # Version-controlled contract addresses
│   ├── local.json
│   ├── testnet.json
│   ├── mainnet.json
│   └── index.js                    # getDeployment(network) helper
└── lib/                            # Foundry dependencies (forge-std, openzeppelin, chainlink, Uniswap v4)
```

### ABI Pipeline

1. `forge build` compiles contracts to `out/`
2. `scripts/export-abis.js` extracts ABIs from `out/` to `packages/contracts/abi/`
3. Frontend/backend import via `@sof/contracts`: `import { RaffleABI } from '@sof/contracts'`
4. Deployment addresses via `@sof/contracts/deployments`: `import { getDeployment } from '@sof/contracts/deployments'`

---

## Data Schema

### Supabase Tables

#### User & Access Control

| Table | Key Columns | Used By |
|-------|------------|---------|
| `players` | id, address (varchar 42, unique, lowercase) | supabaseClient.js |
| `allowlist_entries` | wallet_address (NOT NULL), username, access_level (0-4), is_admin, source | allowlistService.js, accessService.js |
| `allowlist_config` | window_start, window_end, is_active, max_entries | allowlistService.js |
| `access_groups` | slug (unique), name, is_active | accessService.js, groupService.js |
| `user_access_groups` | wallet_address (NOT NULL), group_id, granted_by, expires_at | accessService.js, groupService.js |
| `route_access_config` | route_pattern, required_level, required_groups, is_public | accessService.js, routeConfigService.js |
| `access_settings` | key (PK), value (JSONB) | accessService.js |

Access levels: 0=public, 1=connected, 2=allowlist, 3=beta, 4=admin.

#### InfoFi (Prediction Markets)

| Table | Key Columns | Used By |
|-------|------------|---------|
| `infofi_markets` | season_id, player_address, market_type, contract_address, current_probability_bps | infoFiRoutes.js, infoFiPositionService.js |
| `infofi_positions` | market_id, user_address, outcome (YES/NO), amount, tx_hash | infoFiPositionService.js |
| `infofi_winnings` | user_address, market_id, amount, is_claimed | infoFiRoutes.js |
| `infofi_odds_history` | market_id, season_id, recorded_at, yes_bps, no_bps, hybrid_bps | historicalOddsService.js |
| `infofi_failed_markets` | season_id, player_address, error_message, attempts | supabaseClient.js, adminRoutes.js |

#### Raffle (Seasons & Tickets)

| Table | Key Columns | Used By |
|-------|------------|---------|
| `season_contracts` | season_id, bonding_curve_address, raffle_token_address, raffle_address, is_active, name, start_time, end_time, grand_prize_bps, status, total_prize_pool (019), quote_token_address, winner_address (024) | supabaseClient.js, healthRoutes.js, season listeners, launchpadActivityDb.js |
| `raffle_transactions` | season_id (partition key), user_address, transaction_type, ticket_amount, tx_hash, bonding_curve_address (020) | raffleTransactionService.js, launchpadActivityDb.js |

`raffle_transactions` is partitioned by season_id with auto-created partitions.
`season_contracts.quote_token_address` links a season to the launch token it is priced in.

#### Launchpad

| Table | Key Columns | Used By |
|-------|------------|---------|
| `token_launches` | token_address (PK), launch_id, creator_address, name, symbol, metadata_uri, quote_token / quote_symbol / quote_decimals (ETH or an allowlisted ERC-20), start_price_e18 (quote raw units per whole token × 1e18), start_fdv (quote raw units), trade_fee (pips, 10000 = 1%; the creator's per-launch fee, 10000 on pre-0.42 launches), pool_id (v4 PoolId, unique), launched_at, is_hidden, is_verified (023, 029) | tokenLaunchedListener.js, launchTradeListener.js, tokenLaunchesDb.js, launchpadActivityDb.js |
| `launch_trades` | (tx_hash, log_index) PK, token_address (FK token_launches), pool_id, trader, side, quote_amount (what the trader paid / received, trade fee included), fee_amount (hook trade fee, quote raw units; NULL on older rows and pre-0.42 LP-fee pools), token_amount, price_e18 (quote raw units per whole token × 1e18), block_number, block_time (023, 029); index (block_number DESC, log_index DESC) for the ticker (025) | launchTradeListener.js, tokenLaunchesDb.js, launchpadActivityDb.js |

#### Infrastructure

| Table | Key Columns | Used By |
|-------|------------|---------|
| `listener_block_cursors` | listener_key (PK), last_block | blockCursor.js (all event listeners) |

#### Views

| View | Type | Purpose |
|------|------|---------|
| `user_raffle_positions` | Materialized | Aggregated raffle positions per user per season |
| `user_market_positions` | View | Aggregated InfoFi positions by user + market + outcome |

### Redis Keys

The Redis is the Railway Redis service (`REDIS_URL` = `${{Redis.REDIS_URL}}`). Usernames are the only durable data in it (no database copy); everything else is a cache or a TTL'd token.

| Key Pattern | Purpose | TTL |
|------------|---------|-----|
| `wallet:{address}` | Username for a wallet (display case) | none (durable) |
| `username:{name}` | Reverse lookup: lowercase username → wallet | none (durable) |
| `auth:nonce:{nonce}` | Single-use sign-in nonce | 5 min |
| `access:wallet:{address}` | Access level/groups cache | 5 min |
| `route_config:*` | Route access config cache | 5 min |
| `allowlist:count:*` | Allowlist entry counts | 1 h |
| `season_contracts:*` | Season rows cache | 5 min |
| `markets:*`, `market_info:{marketId}` | InfoFi market caches | 30 s |
| `positions:net:{marketId}:{user}` | InfoFi net position cache | 20 s |
| `raffle_tx:{seasonId}:…` | Raffle transaction list cache | 30 s |

Rate limiting (`@fastify/rate-limit`, 100 req/min) uses its in-memory store, not Redis.

### Contract Storage (On-chain, Not in Database)

#### Season State (Raffle.sol)

```
seasonId -> SeasonState { status, participants[], ticketCounts[], totalTickets,
  winners[], vrfRequestId, vrfRequestTimestamp, lockSnapshot, startTime, endTime }
```

Status enum: 0=Uninitialized, 1=Active, 2=Locked, 3=VRFPending, 4=Distributing, 5=Completed, 6=Cancelled

#### Bonding Curve (SOFBondingCurve.sol)

```
tradingLocked, currentStep, reserves, totalSupply, buyFeeBps, sellFeeBps
```

#### InfoFi Markets (InfoFiFPMMV2.sol)

```
marketId -> { conditionId, collateralToken, fee, outcomeSlotCounts, positionIds[] }
YES/NO pool balances per market
```

### Known Schema Issues

1. Two migration files share prefix `011` (`011_fix_service_role_permissions.sql` and `011_infofi_odds_history.sql`)
2. Core tables (`players`, `infofi_markets`, `infofi_positions`, `season_contracts`) have no migration files
