# SecondOrder.fun Project Requirements

## Product Vision

SecondOrder.fun transforms memecoins from chaotic, scam-prone infinite games into structured, fair finite games using game theory principles enhanced with InfoFi (Information Finance) integration.

**Core Innovation**: Converting infinite-game memecoins into finite-game structured products with InfoFi prediction markets that aggregate collective intelligence about outcomes and player behavior.

**Target Market**: The retail crypto speculation market currently dominated by rug pulls and extraction-based tokenomics.

**Competitive Advantage**: First-mover in InfoFi-powered gaming with game design research creating knowledge barriers competitors cannot replicate.

## Platform Architecture

### Layer 1: Base Game (Finite Memecoin Raffles)

- 2-week seasons with seasonal ticket-tokens on custom bonding curves, each priced in the season's **quote token**: a token launched on the platform's launchpad, or an admin-allowlisted 18-decimal ERC-20 (`Raffle.isAllowedQuoteToken`)
- Pre-set winner pools (55-75% of bonding curve reserves) with Chainlink VRF settlement
- Real-time position tracking via sliding window system
- Winners receive prizes in the season's quote token; non-winners recover 50-70% via graduated liquidity

### Launchpad (Token Launches)

- Creators launch fixed-supply ERC-20 tokens through `TokenLaunchpad`; the whole supply is placed as single-sided liquidity in a Uniswap v4 pool, with starting price bounds set as implied FDV
- In-app buy/sell goes through the swappable `UniV4LaunchRouter` (the app reads `TokenLaunchpad.router()`, never a hardcoded address)
- The pool's 1% swap fee is split 88% to the launch's fee recipient (the creator) and 12% to the platform treasury, claimed in-app
- Launched tokens can price raffle seasons; the backend indexes launches and trades for the token pages, price chart and activity ticker

### Layer 2: InfoFi Markets (Prediction Markets)

- **Winner Prediction Markets**: "Will Player X win?" with live probability updates
- **Hybrid Pricing**: 70% raffle probability (on-chain from Raffle contract) + 30% market sentiment (on-chain from FPMM YES/NO pools), combined by on-chain InfoFiPriceOracle
- Backend-driven market creation when players cross 1% position threshold (saves users ~300k gas per market)
- VRF-coordinated settlement resolves all related prediction markets atomically

### Layer 3: Cross-Layer Strategy

- Hedge strategies (hold raffle position + bet against yourself in InfoFi)
- Real-time arbitrage detection between raffle positions and InfoFi valuations
- Cross-layer performance tracking

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, Vite 6, Tailwind CSS, shadcn/ui, Wagmi + Viem |
| Backend | Fastify 5, Supabase (PostgreSQL), Redis (ioredis client) |
| Contracts | Solidity ^0.8.20, Foundry, OpenZeppelin, Chainlink VRF v2.5, Uniswap v4 |
| Network | Base (primary) |
| Deployment | Vercel (frontend), Railway (backend), Base Sepolia (testnet contracts) |

## Authentication Flows

Wallet sign-in only: connect a wallet, then sign a one-time SIWE message. Users transact from the wallet they connect and pay their own gas; there is no smart account, gas sponsorship or sign-in airdrop.

| Context | Primary Auth | Notes |
|---------|-------------|-------|
| Base App / Coinbase Smart Wallet | Coinbase Wallet login | Connected address (the Coinbase smart wallet) is the user |
| Desktop browser | Wallet connect (RainbowKit) | Transactions are sent from the connected wallet |

## Smart Contract System

| Contract | Purpose |
|----------|---------|
| `SeasonFactory.sol` | Deploys seasonal contracts |
| `Raffle.sol` | Season management, VRF coordination, winner selection |
| `RaffleStorage.sol` | Participant tracking, season state |
| `RafflePrizeDistributor.sol` | Prize pool management, consolation claims |
| `RolloverEscrow.sol` | Holds consolation payouts a season cohort rolls over, in that season's quote token |
| `SOFBondingCurve.sol` | Ticket purchases via custom bonding curve, quoted in the season's quote token |
| `RaffleToken.sol` | Per-season ticket tokens (0 decimals) |
| `InfoFiMarketFactory.sol` | Creates FPMM prediction markets (backend-driven) |
| `InfoFiFPMMV2.sol` | Fixed-product market maker for YES/NO trading |
| `InfoFiPriceOracle.sol` | Hybrid pricing oracle (70/30 raffle/sentiment) |
| `InfoFiSettlement.sol` | VRF-coordinated market settlement |
| `ConditionalTokenSOF.sol` | Conditional tokens for market positions |
| `MarketTypeRegistry.sol`, `RaffleOracleAdapter.sol` | InfoFi market types and raffle-outcome oracle |
| `SeasonGating.sol` | Per-season access control (signatures, passwords) |
| `SponsorOnboarding.sol` | Prize pool sponsorship via Hats Protocol |
| `TokenLaunchpad.sol`, `LaunchToken.sol` | Token launches (fixed supply, immutable name/symbol) |
| `UniV4LiquidityPlacer.sol`, `LaunchPoolGate.sol` | Owns each launch's v4 position, collects and splits LP fees; the hook stops anyone else initializing a launch pool |
| `UniV4LaunchRouter.sol` | In-app buy/sell against launch pools |

The `$SOF` token, its exchange, faucet and airdrop contracts were removed: seasons are priced in per-season quote tokens instead.

## Token Economics

### Quote Tokens

There is no single platform currency. Each season names its quote token at creation: a launchpad token (`launchpad.isLaunchToken`) or one an admin allowlisted (`setQuoteTokenAllowed`). Arbitrary ERC-20s are refused because fee-on-transfer or rebasing tokens would break the curve's reserve accounting. InfoFi markets are collateralised in their season's quote token.

### Revenue Streams

1. **Raffle fees**: set per season on the bonding curve (`buyFeeBps` / `sellFeeBps`); the admin season form defaults to 0.1% on entries and 0.7% on exits
2. **InfoFi market fees**: 2% (`InfoFiFPMMV2.FEE_BPS`)
3. **Launch LP fees**: 12% platform share of each launch pool's 1% swap fee

## On-Chain Transaction Flow

All user-facing on-chain operations go through `useSmartTransactions.executeBatch`, sent from the user's own connected wallet (the user pays gas; there is no smart account or paymaster):

1. **Atomic batching supported** (EIP-5792 `atomic.status` is `supported` or `ready` for the current chain): one `wallet_sendCalls`, a single confirmation
2. **Otherwise**: one `sendTransaction` per call, in order (e.g. approve, then buy), each confirmed before the next

Applies to: ticket buy/sell, InfoFi market trades, launch token buys/sells, creator fee claims, and all future on-chain operations.
