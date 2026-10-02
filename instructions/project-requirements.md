# SecondOrder.fun Project Requirements

## Product Vision

SecondOrder.fun transforms memecoins from chaotic, scam-prone infinite games into structured, fair finite games using game theory principles enhanced with InfoFi (Information Finance) integration.

**Core Innovation**: Converting infinite-game memecoins into finite-game structured products with InfoFi prediction markets that aggregate collective intelligence about outcomes and player behavior.

**Target Market**: The retail crypto speculation market currently dominated by rug pulls and extraction-based tokenomics.

**Competitive Advantage**: First-mover in InfoFi-powered gaming with game design research creating knowledge barriers competitors cannot replicate.

## Platform Architecture

### Layer 1: Base Game (Finite Memecoin Raffles)

- 2-week seasons with seasonal ticket-tokens on custom bonding curves denominated in $SOF
- Pre-set winner pools (55-75% of bonding curve reserves) with Chainlink VRF settlement
- Real-time position tracking via sliding window system
- Winners receive $SOF prizes; non-winners recover 50-70% via graduated liquidity

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
| Backend | Fastify 5, Supabase (PostgreSQL), Redis (Upstash/IORedis) |
| Contracts | Solidity ^0.8.20, Foundry, OpenZeppelin, Chainlink VRF v2.5 |
| Network | Base (primary) |
| Deployment | Vercel (frontend), Railway (backend), Base Sepolia (testnet contracts) |

## Authentication Flows

Wallet sign-in only: connect a wallet, then sign a one-time SIWE message.

| Context | Primary Auth | Notes |
|---------|-------------|-------|
| Base App / Coinbase Smart Wallet | Coinbase Wallet login | Transacts from the connected wallet |
| Desktop browser | Wallet connect (RainbowKit) | Gameplay transacts from the user's own connected wallet |

## Smart Contract System

| Contract | Purpose |
|----------|---------|
| `SeasonFactory.sol` | Deploys seasonal contracts |
| `Raffle.sol` | Season management, VRF coordination, winner selection |
| `RaffleStorage.sol` | Participant tracking, season state |
| `RafflePrizeDistributor.sol` | Prize pool management, consolation claims |
| `SOFBondingCurve.sol` | Ticket purchases via custom bonding curve |
| `SOFToken.sol` | Platform token ($SOF), ERC-20 + ERC-2612 permit |
| `RaffleToken.sol` | Per-season ticket tokens |
| `InfoFiMarketFactory.sol` | Creates FPMM prediction markets (backend-driven) |
| `InfoFiFPMMV2.sol` | Fixed-product market maker for YES/NO trading |
| `InfoFiPriceOracle.sol` | Hybrid pricing oracle (70/30 raffle/sentiment) |
| `InfoFiSettlement.sol` | VRF-coordinated market settlement |
| `ConditionalTokenSOF.sol` | Conditional tokens for market positions |
| `SOFExchange.sol` | Token exchange functionality |
| `SOFAirdrop.sol` | Gasless airdrop claims via EIP-712 attestations |
| `SOFFaucet.sol` | Testnet faucet |
| `SeasonGating.sol` | Per-season access control (signatures, passwords) |
| `SponsorOnboarding.sol` | Prize pool sponsorship via Hats Protocol |

## Token Economics

### $SOF Protocol Token

1. Universal participation currency for raffle tickets and InfoFi market trades
2. Cross-layer fee capture (35% of raffle + InfoFi fees used to buy $SOF)
3. Governance rights over market parameters and pricing weights

### Revenue Streams

1. **Raffle fees**: 0.1% on entries, 0.7% on exits (bonding curve)
2. **InfoFi market fees**: 2% on net winnings
3. **Arbitrage execution fees**: 0.5% on executed arbitrage opportunities

## On-Chain Transaction Flow

All user-facing on-chain operations go through `useSmartTransactions.executeBatch`, sent from the user's own connected wallet (the user pays gas; there is no smart account or paymaster):

1. **Atomic batching supported** (EIP-5792 `atomic.status` is `supported` or `ready` for the current chain): one `wallet_sendCalls`, a single confirmation
2. **Otherwise**: one `sendTransaction` per call, in order (e.g. approve, then buy), each confirmed before the next

Applies to: ticket buy/sell, InfoFi market trades, airdrop claims, token swaps, and all future on-chain operations.
