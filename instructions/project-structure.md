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
│   ├── deploy-env.sh               # Push env vars to Vercel/Railway
│   ├── export-abis.js              # Build ABIs from Foundry output
│   └── load-env.sh                 # Load env files for dev
├── .github/
│   └── workflows/
│       └── pr-preview.yml          # Paired Vercel + Railway preview orchestration
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
│   │   ├── auth/                   # FarcasterAuth, LoginModal, MobileLoginSheet
│   │   ├── access/                 # AccessGate, ProtectedRoute, MaintenancePage
│   │   ├── infofi/                 # InfoFi market cards, charts, trading
│   │   ├── buysell/                # BuyForm, SellForm, SlippageSettings
│   │   ├── mint/                   # AllowlistMintCard, GiftClaimCard
│   │   ├── gating/                 # SignatureGateModal, PasswordGateModal
│   │   ├── landing/                # OpenAppButton
│   │   └── shells/                 # WebShell, MiniAppShell
│   ├── context/                    # React contexts (auth, SSE, theme, wallet)
│   ├── features/                   # Feature modules
│   │   └── admin/                  # Admin panel components
│   ├── hooks/                      # Custom React hooks
│   ├── services/                   # API + business logic services
│   ├── utils/                      # Utility functions
│   ├── config/                     # App config (hats, access levels)
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
│   └── routes/                     # 18 route modules (Fastify plugin pattern)
├── shared/                         # Shared services (supabase, redis, auth, access)
├── src/
│   ├── config/chain.js             # Network configuration
│   ├── lib/                        # Core libraries (viemClient, blockCursor, eventPolling)
│   ├── listeners/                  # 7 on-chain event listeners
│   ├── services/                   # 8 business logic services
│   ├── utils/                      # Utility functions
│   └── scripts/                    # One-off scripts
├── scripts/                        # Operational scripts (reset-local-db, scan-historical)
├── migrations/                     # 15 Supabase SQL migrations
├── tests/                          # Vitest tests (api/ + backend/)
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
│   ├── token/                      # SOFToken.sol, RaffleToken.sol
│   ├── infofi/                     # InfoFiMarketFactory, InfoFiFPMMV2, InfoFiPriceOracle, InfoFiSettlement, ConditionalTokenSOF, MarketTypeRegistry, RaffleOracleAdapter
│   ├── exchange/                   # SOFExchange.sol
│   ├── airdrop/                    # SOFAirdrop.sol
│   ├── faucet/                     # SOFFaucet.sol
│   ├── gating/                     # SeasonGating.sol, SeasonGatingStorage.sol
│   ├── sponsor/                    # SponsorOnboarding.sol
│   ├── lib/                        # Interfaces (IRaffle, ISeasonFactory, etc.) + RaffleTypes, RaffleLogic
│   └── test-helpers/               # MockUSDC.sol
├── test/                           # 24 Forge test files + invariant/ + integration/
├── script/                         # Forge deploy scripts
├── abi/                            # Exported ABIs (generated by export-abis.js)
│   └── index.js                    # Named ABI exports
├── deployments/                    # Version-controlled contract addresses
│   ├── local.json
│   ├── testnet.json
│   ├── mainnet.json
│   └── index.js                    # getDeployment(network) helper
└── lib/                            # Foundry dependencies (forge-std, openzeppelin, chainlink)
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
| `allowlist_entries` | fid, wallet_address, access_level (0-4), source | allowlistService.js, accessService.js |
| `allowlist_config` | window_start, window_end, is_active, max_entries | allowlistService.js |
| `access_groups` | slug (unique), name, is_active | accessService.js, groupService.js |
| `user_access_groups` | fid, group_id, granted_by, expires_at | accessService.js, groupService.js |
| `route_access_config` | route_pattern, required_level, required_groups, is_public | accessService.js, routeConfigService.js |
| `access_settings` | key (PK), value (JSONB) | accessService.js |
| `farcaster_notification_tokens` | fid, app_key, notification_url, notification_token | farcasterNotificationService.js |

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
| `token_launches` | token_address (PK), launch_id, creator_address, name, symbol, metadata_uri, start_price_wei, implied_fdv_wei, pool_id (v4 PoolId, unique), launched_at, is_hidden, is_verified (023) | tokenLaunchedListener.js, launchTradeListener.js, tokenLaunchesDb.js, launchpadActivityDb.js |
| `launch_trades` | (tx_hash, log_index) PK, token_address (FK token_launches), pool_id, trader, side, eth_amount, token_amount, price_wei, block_number, block_time (023) | launchTradeListener.js, tokenLaunchesDb.js, launchpadActivityDb.js |

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

| Key Pattern | Purpose | TTL |
|------------|---------|-----|
| `sse:connections:{userId}` | Active SSE connection tracking | Session |
| `rate:{ip}:{endpoint}` | Rate limit counters | Window-based |
| `cache:season:{seasonId}` | Season data cache | 30s |

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
3. `nft_drops` table referenced by `nftDropRoutes.js` but table does not exist yet
