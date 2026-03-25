# SecondOrder.fun Comprehensive Project Requirements Document (Updated with InfoFi Integration)

## Executive Summary

SecondOrder.fun represents a paradigm shift in Web3 gaming and speculation through the innovative integration of InfoFi (Information Finance) prediction markets with transparent raffle mechanics. The platform transforms toxic memecoin mechanics into structured, fair finite games using applied game theory, while enabling sophisticated cross-layer strategies through real-time information arbitrage.

**Core Innovation**: Making crypto into a game by converting infinite-game memecoins into finite-game structured products with InfoFi prediction markets that aggregate collective intelligence about outcomes and player behavior.

**Target Market**: The $50+ billion retail crypto speculation market currently dominated by rug pulls and extraction-based tokenomics, now addressable through transparent information markets.

**Competitive Advantage**: First-mover in InfoFi-powered gaming with 15+ years of game design research creating knowledge barriers competitors cannot replicate, combined with real-time cross-layer arbitrage systems.

## Product Vision & Strategy

### The Core Problem: Memecoin Prisoner's Dilemma + Information Asymmetries

Traditional memecoins create a Prisoner's Dilemma dynamic compounded by information opacity:

- Infinite game assumptions encourage long-term holding while enabling insider extraction
- First mover advantage incentivizes early exit (dumping) based on hidden information
- Technical solutions fail because this is fundamentally a people problem, not a technology problem
- Information asymmetries enable sophisticated actors to exploit retail participants
- Result: Rug pulls, exit scams, community destruction, and $50+ billion in retail losses

### The SecondOrder.fun Solution: InfoFi-Powered Transparent Gaming

Transform memecoins into finite games with InfoFi integration providing four key characteristics:

1. **Clearly Stated Rules**: Transparent raffle mechanics with defined winning conditions and real-time position tracking
2. **Time-Limited Utility**: 2-week seasons with explicit start/end dates and automated VRF resolution
3. **Terminal Value Events**: Known endpoints where Prisoner's Dilemma becomes strategic choice rather than fear
4. **Information Transparency**: Real-time InfoFi markets aggregate collective intelligence about outcomes, eliminating information asymmetries

### Product Philosophy Enhanced by InfoFi

- **"Memecoins without the hangover"** - Fair play through game design and information transparency
- **"Gambling on gamblers"** - Meta-game layer where analytical thinking creates economic value
- **Credible neutrality** through transparent rules, provably fair mechanics, and real-time information discovery
- **Network effects** where platform success benefits all participants through cross-layer value creation
- **Sustainable tokenomics** replacing extraction with information-based value generation

## Two-Layer System Architecture Enhanced with InfoFi Integration

### Layer 1: Base Game (Finite Memecoin Raffles) - Enhanced

**Season Structure:**

- 2-week seasons with seasonal tokens (ticket-coins) tracked via sliding window system
- Pre-set winner pools (3/5/10 winners based on initial rules) with VRF-triggered settlement
- Clear start/end dates known upfront with automated InfoFi market resolution
- Custom bonding curve denominated in $SOF protocol token with extractable prize pools

**Ticket Acquisition with Real-Time Position Tracking:**

- Primary market: Custom bonding curve system for $SOF → ticket-coin conversion
- Real-time position updates trigger InfoFi market creation when crossing 1% threshold
- Sliding window position tracking for transparent win probability calculation
- Secondary market: P2P trading disabled during active seasons to maintain game integrity

**Game Resolution with InfoFi Coordination:**

- Provably fair random drawing using Chainlink VRF with 5-30 minute InfoFi settlement window
- VRF callback triggers both raffle resolution AND InfoFi market settlement atomically
- Winners receive predetermined $SOF prizes; losers recover 50-70% via graduated liquidity system
- Cross-layer settlement ensures prediction market accuracy and prevents manipulation

### Layer 2: InfoFi Markets (Information Finance Integration) - NEW

**Market Types with Real-Time Data Feeds:**

- **Winner Prediction Markets**: "Will Player X win this raffle?" with live probability updates
- **Position Size Markets**: "Will Player X hold >5,000 tickets at season end?" tracking commitment levels
- **Behavioral Markets**: "Will Player X exit before season end?" predicting player psychology
- **Cross-Layer Arbitrage Markets**: Price discrepancies between raffle positions and InfoFi valuations

**Hybrid Pricing Model (70% Raffle Data + 30% Market Sentiment) — On-chain:**

- Raffle position probability is computed on-chain from `Raffle` totals (tickets/totalTickets)
- Market sentiment is computed on-chain from `InfoFiPlayerMarket` YES/NO pools (`sentimentBps()`)
- An on-chain `InfoFiPriceOracle` combines both into a hybrid price in basis points with configurable weights
- Automatic arbitrage detection runs off-chain but uses only on-chain oracle values
- Live updates are streamed via Server-Sent Events (SSE) as a transport layer for oracle outputs (no off-chain math)

**Automated Market Creation & Management:**

- Smart contract triggers create InfoFi markets when players cross 1% position threshold
- OpenZeppelin AccessControl manages market creation permissions and admin functions
- VRF-coordinated settlement resolves all related prediction markets within 30 minutes of raffle completion
- Fee structure: 2% on net winnings (proven InfoFi model) with cross-layer revenue sharing

### Layer 3: Cross-Layer Strategy & Arbitrage System - NEW

**Information Arbitrage Opportunities:**

- Real-time detection of pricing inefficiencies between raffle positions and InfoFi market valuations
- Algorithmic identification of profitable strategies across both layers simultaneously
- User-friendly arbitrage execution tools with estimated profit calculations and risk assessments
- Historical arbitrage performance tracking and strategy optimization recommendations

**Multi-Layer Strategic Gameplay:**

- **The Hedge Strategy**: Hold raffle position while betting against yourself in InfoFi markets for guaranteed positive outcomes
- **Information Edge Play**: Leverage real-time position data to identify InfoFi market mispricing opportunities
- **Behavioral Analysis**: Profit from predicting other players' psychological patterns and exit timing strategies
- **Meta-Game Specialization**: Develop expertise in cross-layer dynamics for sustained competitive advantages

## Blockchain and Smart Contract Architecture Enhanced with InfoFi Integration

### Core Challenge: Multi-Contract Coordination with VRF Automation

**Enhanced Architecture Requirements:**

- Atomic coordination between raffle resolution and InfoFi market settlement via single VRF callback
- Real-time event emission from raffle contracts triggering InfoFi market price updates
- OpenZeppelin AccessControl integration across all contracts with role-based permission management
- Gas-optimized operations supporting concurrent seasons and multiple InfoFi markets per raffle

### Smart Contract Integration Following OpenZeppelin Standards

#### 1. **Enhanced RaffleBondingCurve.sol** (Updated)

```solidity
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@chainlink/contracts/src/v0.8/vrf/dev/VRFConsumerBaseV2Plus.sol";
```

**Key Enhancements:**

- **InfoFi Event Integration**: Emits `PositionUpdate` and `MarketTrigger` events for real-time InfoFi coordination
- **VRF-Triggered Settlement**: Single VRF callback coordinates both raffle resolution and InfoFi market settlement
- **OpenZeppelin AccessControl**: Role-based permissions for admin functions, VRF coordination, and InfoFi integration
- **Gas-Optimized Position Tracking**: Efficient sliding window calculations with external verification patterns
- **Cross-Contract Communication**: Direct integration with InfoFiMarketFactory for automated market creation

#### 2. **InfoFiMarketFactory.sol** (New)

```solidity
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
```

**Core Functionality:**

- **Automated Market Creation**: Triggers when raffle positions cross configurable thresholds (default: 1% of total)
- **Hybrid Pricing Integration**: Coordinates with InfoFiPriceOracle for real-time price discovery
- **OpenZeppelin Security**: AccessControl for market creation permissions, ReentrancyGuard for external calls
- **Event-Driven Architecture**: Responds to raffle position updates via cross-contract integration
- **Market Parameter Management**: Admin-controlled thresholds, fee structures, and market type configurations

#### 3. **InfoFiPriceOracle.sol** (New)

```solidity
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
```

**Hybrid Pricing Implementation (On-chain Oracle):**

- **70% Raffle Data**: Oracle reads `Raffle.getSeasonDetails` and `getParticipantPosition` to compute probability
- **30% Market Sentiment**: Oracle reads `InfoFiPlayerMarket.sentimentBps()` derived from on-chain YES/NO pools
- **Chainlink Compatibility**: Optional AggregatorV3Interface surface for standardized price feed consumption
- **Updates**: Oracle is pure view; SSE streams oracle values for sub-second UX without client-side polling
- **Arbitrage Detection**: Detects discrepancies using oracle outputs; no off-chain price components

#### 4. **InfoFiSettlement.sol** (New)

```solidity
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@chainlink/contracts/src/v0.8/vrf/dev/VRFConsumerBaseV2Plus.sol";
```

**VRF-Coordinated Settlement:**

- **Atomic Resolution**: Single VRF callback triggers settlement of all related InfoFi markets simultaneously
- **Rapid Settlement Window**: 5-30 minute resolution timeline coordinated with raffle prize distribution
- **Batch Operations**: Gas-optimized settlement of multiple markets per raffle with comprehensive error handling
- **Winnings Management**: Automated calculation and distribution of InfoFi market winnings with claim mechanisms
- **Emergency Procedures**: Admin override capabilities for edge cases with transparent governance controls

### Technical Implementation Strategy Enhanced for InfoFi

#### Phase 1: **InfoFi Smart Contract Foundation (Weeks 1-2)**

- Deploy InfoFiMarketFactory with OpenZeppelin AccessControl and automated threshold detection
- Implement InfoFiPriceOracle with hybrid pricing model and Chainlink AggregatorV3Interface compatibility
- Integrate VRF callbacks across RaffleBondingCurve and InfoFiSettlement for atomic cross-layer resolution
- Enhanced security auditing focusing on cross-contract communication and VRF manipulation resistance

#### Phase 2: **Real-Time Data Coordination (Weeks 3-4)**

- Server-Sent Events (SSE) infrastructure streams on-chain oracle values to the frontend (transport only)
- Event-driven architecture connects blockchain events (trades/positions) to refresh oracle reads
- Database schema supports InfoFi markets, positions, arbitrage opportunities, and settlement tracking
- Performance optimization for concurrent seasons with multiple InfoFi markets per raffle

#### Phase 3: **Cross-Layer Strategy Tools (Weeks 5-6)**

- Frontend components for InfoFi market participation with real-time pricing and arbitrage opportunity displays
- Cross-layer strategy interfaces enabling simultaneous raffle and InfoFi position management
- Automated arbitrage detection and execution tools with profit estimation and risk assessment capabilities
- Advanced analytics dashboard for strategy performance tracking and optimization recommendations

## Frontend Architecture Enhanced with InfoFi Integration

### UI Component System (Radix + shadcn/ui)

We standardize on Radix UI primitives wrapped in shadcn-style components for accessible, composable UI.

Currently adopted primitives under `src/components/ui/`:

- Dialog: `@radix-ui/react-dialog` (`dialog.jsx`)
- Label: `@radix-ui/react-label` (`label.jsx`)
- Toast: `@radix-ui/react-toast` (`toast.jsx`, `toaster.jsx`)
- Dropdown Menu: `@radix-ui/react-dropdown-menu` (`dropdown-menu.jsx`)
- Select: `@radix-ui/react-select` (`select.jsx`)
- Popover: `@radix-ui/react-popover` (`popover.jsx`)
- Tooltip: `@radix-ui/react-tooltip` (`tooltip.jsx`)

Guidelines:

- Prefer Radix for overlays and complex a11y (dialog, popover, tooltip, dropdown-menu, select, toast, sheet, navigation-menu, context-menu).
- Keep exports stable; wrap primitives with Tailwind classes and the `cn` helper.
- Reuse `tailwindcss-animate` utilities for enter/exit transitions.

### Enhanced Project Structure Supporting InfoFi

```bash
src/features/
├── raffle/                    # Enhanced raffle features
│   ├── components/
│   │   ├── RaffleCard.jsx           # Enhanced with InfoFi market links
│   │   ├── PositionTracker.jsx      # Real-time sliding window position display
│   │   ├── BondingCurveChart.jsx    # Live pricing with InfoFi arbitrage indicators
│   │   └── CrossLayerStrategyPanel.jsx  # Multi-layer position management
│   ├── hooks/
│   │   ├── useRafflePosition.js     # Enhanced with InfoFi market integration
│   │   └── useCrossLayerStrategy.js # NEW: Multi-layer strategy management
│   └── services/
│       └── crossLayerService.js     # NEW: Cross-layer coordination logic
├── infofi/                    # NEW: InfoFi market features
│   ├── components/
│   │   ├── InfoFiMarketCard.jsx     # Individual market display with real-time pricing
│   │   ├── ProbabilityChart.jsx     # Live probability visualization
│   │   ├── ArbitrageOpportunityDisplay.jsx  # Cross-layer arbitrage alerts
│   │   ├── MarketDepthVisualization.jsx     # Market liquidity and order book
│   │   ├── SettlementStatus.jsx     # Settlement progress tracking
│   │   └── WinningsClaimPanel.jsx   # Claim interface for settled markets
│   ├── hooks/
│   │   ├── useInfoFiMarkets.js      # Market data with React Query
│   │   ├── useArbitrageOpportunities.js  # Real-time arbitrage detection
│   │   ├── useHybridPricing.js      # Hybrid pricing calculations
│   │   ├── useSettlement.js         # Settlement status tracking
│   │   └── useWinningsClaim.js      # Claim functionality
│   ├── services/
│   │   ├── infoFiMarketService.js   # Market CRUD operations
│   │   ├── arbitrageService.js      # Arbitrage detection algorithms
│   │   ├── hybridPricingService.js  # Real-time pricing calculations
│   │   └── settlementService.js     # Settlement tracking
│   └── types/
│       ├── infoFiMarket.js          # InfoFi market type definitions
│       ├── arbitrage.js             # Arbitrage opportunity types
│       └── settlement.js            # Settlement-related types
└── dashboard/                 # Enhanced dashboard features
    ├── components/
    │   ├── CrossLayerPortfolio.jsx  # Multi-layer position overview
    │   ├── ArbitrageHistory.jsx     # Historical arbitrage performance
    │   └── StrategyRecommendations.jsx  # AI-driven strategy suggestions
    └── hooks/
        └── useCrossLayerAnalytics.js    # Cross-layer performance analytics
```

### Key Frontend Components Enhanced for InfoFi

#### Real-Time Updates via Server-Sent Events

```javascript
// Enhanced SSE integration for live InfoFi pricing
const useRealTimeInfoFiPricing = (marketId) => {
  const [pricing, setPricing] = useState(null);
  const [arbitrageOpportunities, setArbitrageOpportunities] = useState([]);

  useEffect(() => {
    const eventSource = new EventSource(
      `/api/stream/infofi-pricing/${marketId}`
    );

    eventSource.onmessage = (event) => {
      const update = JSON.parse(event.data);
      setPricing(update.pricing);

      if (update.arbitrageOpportunities) {
        setArbitrageOpportunities(update.arbitrageOpportunities);
      }
    };

    return () => eventSource.close();
  }, [marketId]);

  return { pricing, arbitrageOpportunities };
};
```

#### Cross-Layer Strategy Management

```javascript
// Multi-layer position management with real-time coordination
const useCrossLayerStrategy = (raffleId) => {
  const { data: rafflePosition } = useRafflePosition(raffleId);
  const { data: infoFiPositions } = useInfoFiMarkets(raffleId);
  const { arbitrageOpportunities } = useArbitrageOpportunities(raffleId);

  const executeHedgeStrategy = async (raffleAmount, infoFiOutcome) => {
    // Coordinate simultaneous raffle participation and InfoFi hedging
    const raffleResult = await raffleService.joinRaffle(raffleId, raffleAmount);
    const infoFiResult = await infoFiService.placeBet(
      raffleResult.marketId,
      infoFiOutcome,
      calculateHedgeAmount(raffleAmount)
    );

    return { raffleResult, infoFiResult };
  };

  return {
    rafflePosition,
    infoFiPositions,
    arbitrageOpportunities,
    executeHedgeStrategy,
    // ... other cross-layer strategy functions
  };
};
```

## Backend Architecture Enhanced with InfoFi Integration

### Hybrid Fastify + Hono Architecture with InfoFi Support

#### Enhanced Fastify (Main Application Server) Services

- **InfoFi Market Management**: CRUD operations and indexing for on-chain prediction markets
- **Oracle Streaming Service**: Reads on-chain `InfoFiPriceOracle` and streams values via SSE
- **Arbitrage Detection Engine**: Identifies cross-layer profit opportunities using on-chain oracle values
- **Cross-Layer Settlement Coordination**: VRF-triggered settlement management across raffle and InfoFi systems
- **Advanced Analytics**: Strategy performance tracking, arbitrage history, and user behavior analysis

#### Enhanced Hono (Edge Functions) Capabilities

- **InfoFi Market Data APIs**: High-speed public access to market pricing, volume, and arbitrage opportunities
- **Real-Time Price Feeds**: Edge-cached pricing data for global low-latency access
- **Arbitrage Opportunity Feeds**: Fast-access APIs for arbitrage detection and strategy recommendations
- **Settlement Status APIs**: Quick-access settlement progress and completion status endpoints

### Real-Time Architecture with InfoFi Integration

#### Server-Sent Events (SSE) Enhanced Implementation

```javascript
// Enhanced real-time pricing service with InfoFi coordination
export class InfoFiRealTimePricingService extends EventEmitter {
  constructor() {
    super();
    this.pricingCache = new Map(); // Hybrid pricing cache
    this.arbitrageDetector = new ArbitrageDetectionService();
    this.subscribers = new Map(); // SSE connections per market
  }

  async updateHybridPricing(marketId, raffleUpdate, sentimentUpdate) {
    const cached = this.pricingCache.get(marketId);

    // Calculate new hybrid price (70% raffle + 30% sentiment)
    const newHybridPrice = this._calculateHybridPrice(
      raffleUpdate.probability,
      sentimentUpdate.sentiment,
      7000, // 70% raffle weight
      3000 // 30% sentiment weight
    );

    // Detect arbitrage opportunities
    const arbitrageOpps = await this.arbitrageDetector.detectOpportunities(
      marketId,
      raffleUpdate.price,
      newHybridPrice
    );

    // Broadcast real-time updates
    this._broadcastUpdate(marketId, {
      hybridPrice: newHybridPrice,
      raffleComponent: raffleUpdate.probability,
      sentimentComponent: sentimentUpdate.sentiment,
      arbitrageOpportunities: arbitrageOpps,
      timestamp: new Date().toISOString(),
    });
  }
}
```

## Database Schema Enhanced with InfoFi Integration

### Supabase Schema Extensions for InfoFi

```sql
-- Enhanced InfoFi Markets table with advanced features
CREATE TABLE infofi_markets (
    id BIGSERIAL PRIMARY KEY,
    raffle_id BIGINT NOT NULL REFERENCES raffles(id),
    player_id BIGINT NOT NULL REFERENCES players(id),
    market_type VARCHAR(50) NOT NULL, -- 'WINNER_PREDICTION', 'POSITION_SIZE', 'BEHAVIORAL'
    contract_address VARCHAR(42), -- Ethereum address of deployed market contract
    initial_probability INTEGER NOT NULL, -- Basis points (0-10000)
    current_probability INTEGER NOT NULL, -- Updated in real-time
    hybrid_price DECIMAL(18,6), -- Current hybrid price (70% raffle + 30% sentiment)
    total_volume DECIMAL(18,6) DEFAULT 0, -- Total trading volume
    is_active BOOLEAN DEFAULT true,
    is_settled BOOLEAN DEFAULT false,
    settlement_time TIMESTAMPTZ,
    settlement_block_number BIGINT, -- VRF block for settlement verification
    winning_outcome BOOLEAN,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- InfoFi Positions with enhanced tracking
CREATE TABLE infofi_positions (
    id BIGSERIAL PRIMARY KEY,
    market_id BIGINT NOT NULL REFERENCES infofi_markets(id),
    user_address VARCHAR(42) NOT NULL, -- Ethereum address
    outcome VARCHAR(10) NOT NULL, -- 'YES' or 'NO'
    amount DECIMAL(18,6) NOT NULL, -- Amount bet
    entry_price DECIMAL(18,6), -- Price at time of bet
    current_value DECIMAL(18,6), -- Real-time position value
    is_hedge_position BOOLEAN DEFAULT false, -- Marks cross-layer hedge positions
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Real-time arbitrage opportunities tracking
CREATE TABLE arbitrage_opportunities (
    id BIGSERIAL PRIMARY KEY,
    raffle_id BIGINT NOT NULL REFERENCES raffles(id),
    market_id BIGINT REFERENCES infofi_markets(id),
    player_address VARCHAR(42) NOT NULL,
    raffle_price DECIMAL(18,6) NOT NULL,
    infofi_price DECIMAL(18,6) NOT NULL,
    price_difference DECIMAL(18,6) NOT NULL,
    profitability DECIMAL(5,2) NOT NULL, -- Percentage
    estimated_profit DECIMAL(18,6) NOT NULL,
    strategy_description TEXT, -- Human-readable strategy explanation
    is_executed BOOLEAN DEFAULT false,
    executed_by VARCHAR(42), -- Address that executed the arbitrage
    executed_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ, -- Opportunity expiration
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Hybrid pricing cache for performance
CREATE TABLE hybrid_pricing_cache (
    market_id BIGINT PRIMARY KEY REFERENCES infofi_markets(id),
    raffle_component DECIMAL(18,6) NOT NULL, -- 70% weight component
    sentiment_component DECIMAL(18,6) NOT NULL, -- 30% weight component
    hybrid_price DECIMAL(18,6) NOT NULL, -- Final calculated price
    volume_24h DECIMAL(18,6) DEFAULT 0, -- 24-hour trading volume
    price_change_24h DECIMAL(5,2) DEFAULT 0, -- 24-hour price change percentage
    last_arbitrage_check TIMESTAMPTZ, -- Last arbitrage detection run
    last_updated TIMESTAMPTZ DEFAULT NOW()
);

-- Cross-layer strategy performance tracking
CREATE TABLE strategy_performance (
    id BIGSERIAL PRIMARY KEY,
    user_address VARCHAR(42) NOT NULL,
    raffle_id BIGINT NOT NULL REFERENCES raffles(id),
    strategy_type VARCHAR(50) NOT NULL, -- 'HEDGE', 'ARBITRAGE', 'SPECULATION', etc.
    raffle_position_value DECIMAL(18,6), -- Value of raffle position
    infofi_position_value DECIMAL(18,6), -- Value of InfoFi positions
    total_investment DECIMAL(18,6) NOT NULL,
    current_value DECIMAL(18,6) NOT NULL,
    realized_profit DECIMAL(18,6) DEFAULT 0,
    unrealized_profit DECIMAL(18,6) DEFAULT 0,
    is_complete BOOLEAN DEFAULT false,
    completion_time TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enhanced indexes for InfoFi performance
CREATE INDEX idx_infofi_markets_raffle_active ON infofi_markets(raffle_id, is_active);
CREATE INDEX idx_infofi_positions_user_market ON infofi_positions(user_address, market_id);
CREATE INDEX idx_arbitrage_opportunities_active ON arbitrage_opportunities(is_executed, expires_at)
    WHERE is_executed = false AND expires_at > NOW();
CREATE INDEX idx_hybrid_pricing_cache_updated ON hybrid_pricing_cache(last_updated);
CREATE INDEX idx_strategy_performance_user ON strategy_performance(user_address, is_complete);

-- Real-time subscriptions for InfoFi features
ALTER TABLE infofi_markets ENABLE ROW LEVEL SECURITY;
ALTER TABLE infofi_positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE arbitrage_opportunities ENABLE ROW LEVEL SECURITY;
ALTER TABLE hybrid_pricing_cache ENABLE ROW LEVEL SECURITY;
```

## Token Economics & Business Model Enhanced with InfoFi

### $SOF Protocol Token with InfoFi Integration

**Enhanced Functions:**

1. **Cross-layer fee capture** - 35% of both raffle AND InfoFi market fees used to buy $SOF from market
2. **Universal participation currency** - Required for both raffle tickets AND InfoFi market participation
3. **Enhanced governance rights** - Control over InfoFi market parameters, arbitrage detection thresholds, hybrid pricing weights
4. **InfoFi staking rewards** - Additional yield from InfoFi market maker rewards and arbitrage fee sharing
5. **Treasury management** - Enhanced treasury from multiple revenue streams and cross-layer value capture

### Multi-Stream Revenue Model Enhanced

**Primary Revenue Streams:**

1. **Raffle participation fees**: 0.1% on entries, 0.7% on exits (existing model)
2. **InfoFi market fees**: 2% on net winnings (proven InfoFi model from Polymarket research)
3. **Arbitrage execution fees**: 0.5% fee on executed arbitrage opportunities
4. **Cross-layer strategy fees**: Premium fees for advanced strategy tools and automated execution
5. **Data and analytics services**: Premium real-time data feeds and strategy analytics for institutional users

**Enhanced Revenue Synergies:**

- **Cross-layer multiplier effect**: Users participating in both layers generate 2-3x revenue per user
- **Information value creation**: InfoFi markets create valuable data sold to external analytics providers
- **Strategy tool monetization**: Advanced cross-layer tools command premium pricing from sophisticated users
- **Network effect amplification**: Each successful arbitrage increases platform reputation and attracts more users

### Sustainability Model with InfoFi Integration

**Self-reinforcing ecosystem loops:**

- More raffle participation → More InfoFi markets → More arbitrage opportunities → Higher user engagement
- Better information discovery → More accurate pricing → Higher trading volumes → Increased fee capture
- Successful cross-layer strategies → Platform reputation growth → Institutional adoption → Premium revenue streams
- InfoFi market accuracy → Media attention and research interest → Organic growth and partnerships

## User Experience & Workflows Enhanced for InfoFi

### Enhanced Creator Workflow with InfoFi Integration

1. **Authentication**: Farcaster Auth Kit integration with InfoFi market permissions
2. **Enhanced Raffle Setup**: Multi-step form with InfoFi market configuration options
   - Basic raffle information with automatic InfoFi market prediction
   - Cast lookup and validation with sentiment analysis integration
   - Time settings coordinated with InfoFi settlement windows
   - Prize pool configuration with InfoFi market correlation analysis
3. **Integrated Publishing**: Frame generation with embedded InfoFi market links for viral sharing
4. **Multi-Layer Management**: Real-time monitoring of both raffle participation AND InfoFi market activity

### Enhanced Participant Workflow with Cross-Layer Strategies

1. **Discovery**: Browse raffles with integrated InfoFi market opportunities and arbitrage alerts
2. **Strategy Selection**:
   - **Simple Participation**: Traditional raffle entry with InfoFi market awareness
   - **Hedge Strategy**: Coordinated raffle + InfoFi positions for guaranteed positive outcomes
   - **Arbitrage Strategy**: Pure arbitrage plays between raffle and InfoFi pricing
   - **Speculation Strategy**: InfoFi-only participation based on analytical insights
3. **Execution Tools**:
   - Real-time pricing data and arbitrage opportunity detection
   - One-click hedge execution coordinating both raffle and InfoFi positions
   - Advanced strategy interfaces with profit estimation and risk assessment
   - Performance tracking and strategy optimization recommendations

### Enhanced Frame Integration with InfoFi Features

1. **Multi-Layer Embedding**: Frames display both raffle status AND InfoFi market opportunities
2. **Interactive Strategy Selection**: Direct strategy execution within Farcaster feeds
3. **Real-Time Updates**: Live arbitrage opportunity notifications via frame updates
4. **Viral Growth Enhancement**: InfoFi market predictions increase frame engagement and sharing

## Functional Requirements Enhanced with InfoFi Integration

### Enhanced Authentication System

- **Multi-layer permissions**: Separate permission levels for raffle participation vs InfoFi market trading
- **Strategy verification**: Advanced user verification for complex cross-layer strategies and arbitrage execution
- **Institutional access**: Premium authentication tiers for institutional InfoFi market participants

### Enhanced Raffle Management with InfoFi Coordination

- **Creation**: Multi-step form with real-time InfoFi market impact prediction and configuration options
- **Criteria System**: Enhanced framework including InfoFi market participation requirements and cross-layer strategy incentives
- **Time Management**: Automated phase transitions coordinated with InfoFi settlement windows and VRF callbacks
- **Prize Distribution**: Enhanced burn-to-claim integration with InfoFi settlement coordination and cross-layer reward calculation

### InfoFi Market Management (NEW)

- **Automated Market Creation**: Smart contract triggered generation with OpenZeppelin AccessControl permissions
- **Hybrid Pricing Management**: Real-time 70%/30% price calculation with arbitrage detection and alert systems
- **Settlement Coordination**: VRF-triggered 5-30 minute settlement window with comprehensive cross-market resolution
- **Fee Structure**: 2% on net winnings with transparent cross-layer revenue sharing and $SOF buyback integration

### Enhanced Smart Contract Integration with InfoFi Coordination

- **Multi-Contract VRF Coordination**: Single VRF callback triggers raffle resolution AND InfoFi settlement simultaneously
- **Real-Time Event Integration**: Blockchain event processing triggers InfoFi price updates and arbitrage detection
- **Cross-Contract Communication**: Direct integration between raffle, InfoFi, and settlement contracts using OpenZeppelin patterns
- **Enhanced Security**: Multi-contract audit requirements and emergency pause mechanisms across all integrated systems

### Enhanced Real-time Features with InfoFi Integration

- **Multi-Layer Live Updates**: SSE streams for both raffle positions AND InfoFi market pricing with sub-second latency
- **Arbitrage Opportunity Alerts**: Real-time detection and notification of profitable cross-layer strategies
- **Cross-Layer Social Features**: Enhanced comment system including InfoFi market discussions and strategy sharing
- **Advanced Analytics**: Real-time dashboards for multi-layer position tracking, arbitrage history, and strategy performance

### Enhanced Security & Compliance with InfoFi Requirements

- **Multi-Contract Audits**: Comprehensive security reviews covering raffle, InfoFi, and cross-layer integration contracts
- **InfoFi Compliance**: Following Polymarket/Kalshi regulatory precedents for prediction market operations
- **Cross-Layer Validation**: Enhanced input validation for complex multi-layer strategies and arbitrage executions
- **Advanced Rate Limiting**: Protection against manipulation across both raffle and InfoFi market systems

## Non-Functional Requirements Enhanced for InfoFi

### Enhanced Performance Requirements

- **Multi-Layer Page Load**: Sub-3 second initial load including both raffle AND InfoFi market data
- **Real-Time Updates**: Sub-1 second price updates for InfoFi markets with arbitrage opportunity detection
- **Cross-Layer Operations**: <500ms response time for cross-layer strategy execution and coordination
- **Concurrent Market Support**: Architecture supporting 10+ concurrent InfoFi markets per raffle with real-time pricing

### Enhanced Scalability Requirements

- **Multi-Layer Users**: Support for 10,000+ simultaneous participants across both raffle and InfoFi systems
- **InfoFi Market Scaling**: Database optimization for 100+ concurrent prediction markets with real-time pricing
- **Arbitrage Detection Scaling**: Real-time opportunity detection across all active markets with <2 second processing
- **Cross-Chain InfoFi**: Architecture ready for InfoFi market expansion beyond Base to Ethereum, Arbitrum, Polygon

### Enhanced Security with InfoFi Integration

- **Multi-Contract Security**: Comprehensive audit covering raffle, InfoFi, and cross-contract integration vulnerabilities
- **InfoFi Market Manipulation Prevention**: Price oracle protections, volume verification, and coordinated attack detection
- **Cross-Layer Attack Prevention**: Protection against strategies that exploit timing between raffle and InfoFi systems
- **VRF Security Enhancement**: Protection against VRF manipulation affecting both raffle resolution and InfoFi settlement

### Enhanced Usability with Cross-Layer Complexity

- **Progressive Complexity**: Simple raffle participation → InfoFi awareness → Cross-layer strategies → Advanced arbitrage
- **Strategy Guidance**: Interactive tutorials for cross-layer strategies with risk/reward education
- **Mobile-First InfoFi**: Responsive InfoFi market interfaces optimized for mobile trading and arbitrage execution
- **Accessibility Compliance**: WCAG 2.1 AA compliance across all raffle and InfoFi market interfaces

## Risk Management & Mitigation Enhanced with InfoFi

### Enhanced Technical Risks

- **Cross-Contract Integration Vulnerabilities**:
  - Mitigation: Comprehensive audit of all contract interactions, emergency pause mechanisms, gradual rollout with limited InfoFi markets
- **InfoFi Price Manipulation Attacks**:
  - Mitigation: Hybrid pricing model limits manipulation impact to 30% of price, circuit breakers, volume verification
- **VRF Coordination Failures**:
  - Mitigation: Fallback settlement mechanisms, time-based triggers, separate VRF coordinators for critical functions
- **Real-Time System Overload**:
  - Mitigation: SSE connection limits, price update batching, edge caching for high-frequency data

### Enhanced Economic Risks

- **InfoFi Market Liquidity Crises**:
  - Mitigation: Minimum liquidity requirements, emergency liquidity provision, gradual market wind-down procedures
- **Cross-Layer Arbitrage Exploitation**:
  - Mitigation: Position limits, rate limiting on strategy execution, monitoring for coordinated attacks
- **Regulatory Changes in InfoFi Markets**:
  - Mitigation: Compliance-first approach following Polymarket/Kalshi precedents, legal structure flexibility, geographic restrictions

### InfoFi-Specific Risk Management

- **Information Market Accuracy Failures**:
  - Mitigation: Hybrid pricing reduces dependency on pure market sentiment, historical accuracy tracking, reputation systems
- **Settlement Coordination Failures**:
  - Mitigation: Atomic transaction patterns, comprehensive testing of VRF coordination, manual override capabilities
- **User Strategy Complexity Overwhelm**:
  - Mitigation: Progressive complexity introduction, clear risk warnings, strategy simulation tools

## Development Roadmap Enhanced with InfoFi Integration

### Phase 1: InfoFi Smart Contract Foundation (Weeks 1-3)

- **InfoFi Core Contracts**: Deploy InfoFiMarketFactory, InfoFiPriceOracle, InfoFiSettlement with OpenZeppelin integration
- **Enhanced Raffle Contracts**: Upgrade RaffleBondingCurve with InfoFi event integration and VRF coordination
- **Cross-Contract Integration**: Implement atomic VRF callbacks coordinating raffle resolution and InfoFi settlement
- **Security Foundation**: Multi-contract audit process, emergency pause mechanisms, role-based access control

### Phase 2: Real-Time InfoFi Infrastructure (Weeks 4-6)

- **Hybrid Pricing System**: Implement 70%/30% pricing model with real-time calculation and SSE streaming
- **Arbitrage Detection Engine**: Deploy algorithmic opportunity detection with user-friendly execution interfaces
- **Database Integration**: InfoFi schema implementation with real-time subscriptions and performance optimization
- **Backend Services**: Enhanced Fastify services for InfoFi market management, pricing, and settlement coordination

### Phase 3: Cross-Layer Frontend Integration (Weeks 7-9)

- **InfoFi Market Components**: Complete user interface for prediction market participation with real-time pricing
- **Arbitrage Opportunity Display**: User-friendly arbitrage detection with profit estimation and execution tools
- **Cross-Layer Strategy Tools**: Advanced interfaces for hedge strategies, meta-gaming, and performance tracking
- **Mobile Optimization**: Full InfoFi market functionality on mobile with touch-optimized trading interfaces

### Phase 4: Advanced Features & Optimization (Weeks 10-12)

- **Strategy Analytics**: Advanced performance tracking, historical analysis, and optimization recommendations
- **Institutional Features**: API access, bulk operations, advanced analytics for sophisticated traders
- **Cross-Chain Expansion**: InfoFi market deployment to additional networks with unified liquidity
- **Community Features**: Social trading, strategy sharing, reputation systems, and educational content

### Phase 5: Launch & Scale Preparation (Weeks 13-16)

- **Comprehensive Testing**: End-to-end testing of all cross-layer scenarios, stress testing, security validation
- **Regulatory Compliance**: Final legal review, geographic restrictions, KYC/AML implementation
- **Launch Marketing**: Community building, influencer partnerships, educational content creation
- **Post-Launch Monitoring**: Real-time system monitoring, user behavior analysis, continuous optimization

## Success Metrics & KPIs Enhanced with InfoFi

### Enhanced Engagement Metrics

- **Cross-Layer Participation**: % of raffle players also using InfoFi markets (target: 40-60%)
- **Strategy Sophistication Adoption**: Progression from simple participation to advanced cross-layer strategies
- **InfoFi Market Accuracy**: Prediction accuracy vs. actual raffle outcomes (target: >75% accuracy)
- **Arbitrage Opportunity Utilization**: % of detected opportunities successfully executed by users

### Enhanced Financial Metrics

- **Multi-Layer Revenue per User**: Combined earnings from raffle AND InfoFi participation (target: 2-3x single-layer)
- **InfoFi Market Efficiency**: Price discovery accuracy and spread measurements compared to actual probabilities
- **Arbitrage Profit Generation**: Total profits generated through cross-layer arbitrage opportunities
- **Cross-Layer Value Creation**: Additional value generated through InfoFi integration vs. raffle-only model

### InfoFi-Specific Performance Metrics

- **Market Creation Success Rate**: % of eligible raffle positions that generate active InfoFi markets
- **Hybrid Pricing Accuracy**: Correlation between hybrid prices and actual outcome probabilities
- **Settlement Coordination Success**: % of VRF callbacks successfully coordinating both raffle and InfoFi resolution
- **Real-Time System Performance**: Latency metrics for price updates, arbitrage detection, and user notifications

### Network Effects & Growth Metrics

- **Information Value Creation**: Quantified value of collective intelligence generated through InfoFi markets
- **Cross-Layer Network Effects**: User retention and engagement improvements from multi-layer participation
- **Strategy Community Formation**: Growth of user-generated educational content and strategy sharing
- **Platform Authority Development**: Recognition as information discovery platform beyond gaming use cases

## Compliance & Legal Considerations Enhanced with InfoFi

### Enhanced Regulatory Framework

- **InfoFi Market Compliance**: Following Polymarket ($9B+ volume) and Kalshi ($2B+ volume) regulatory precedents
- **Prediction Market Licensing**: Appropriate licensing for information market operations in target jurisdictions
- **Cross-Layer Regulatory Coordination**: Ensuring both raffle and InfoFi components meet regional requirements
- **Data Protection Enhancement**: GDPR and CCPA compliance for enhanced user data collection and analytics

### InfoFi-Specific Legal Considerations

- **Information Market vs. Gambling Distinction**: Clear legal positioning following successful InfoFi platform precedents
- **Market Manipulation Prevention**: Legal frameworks preventing coordinated attacks across raffle and InfoFi layers
- **Settlement Dispute Resolution**: Legal procedures for InfoFi market disputes and resolution challenges
- **Institutional Participation**: Legal structure supporting institutional InfoFi market participation

### Enhanced Smart Contract Governance

- **Multi-Contract Governance**: Coordinated governance across raffle, InfoFi, and settlement contracts using OpenZeppelin patterns
- **Emergency Procedures**: Legal and technical procedures for multi-contract emergency situations
- **Upgrade Coordination**: Governance procedures for coordinated upgrades across integrated contract systems
- **Transparency Requirements**: Enhanced disclosure requirements for cross-layer operations and InfoFi market parameters

## Technical Innovation Summary

**SecondOrder.fun Enhanced with InfoFi Integration** represents a transformative advancement in Web3 gaming through the integration of Information Finance principles. The platform's **dual-layer architecture** combines transparent raffle mechanics with sophisticated prediction markets, creating the first platform where participants can simultaneously engage in structured gaming AND information-based speculation.

**Key Technical Innovations:**

1. **Cross-Layer VRF Coordination**: Single Chainlink VRF callback atomically triggers both raffle resolution and InfoFi market settlement, ensuring coordination and preventing manipulation

2. **Hybrid Pricing Oracle**: Innovative 70%/30% pricing model combining real-time raffle probability data with market sentiment, creating more accurate price discovery than pure speculation

3. **Real-Time Arbitrage Detection**: Algorithmic identification of profitable opportunities across raffle participation and InfoFi market trading, democratizing sophisticated trading strategies

4. **Progressive Strategy Complexity**: User experience design enabling progression from simple raffle participation to advanced cross-layer arbitrage and meta-gaming strategies

5. **Information Value Creation**: Platform generates genuine economic value through collective intelligence aggregation, moving beyond zero-sum speculation to positive-sum information discovery

**Investment Thesis Enhanced**: The convergence of InfoFi emergence ($9B+ market validation), proven prediction market regulatory precedents, and human-centered game design creates a unique opportunity to transform the $50+ billion toxic speculation market into sustainable information-based innovation.

**Bottom Line**: SecondOrder.fun enables "everyone to be the house" while generating superior information discovery and fair profit distribution through the first platform where game theory, InfoFi innovation, and Web3 technology converge to create genuinely positive-sum outcomes for all participants.

---

## Appendix: InfoFi Integration Sources & Research

### InfoFi Market Research Foundation

- Buterin, V. "From prediction markets to info finance." November 2024 - Foundational InfoFi framework
- The Block. "Polymarket's huge year: $9 billion in volume and 314,000 active traders." January 2025 - Market size validation
- Boston Globe. "How prediction markets beat polls in 2024 election." November 2024 - InfoFi accuracy demonstration
- Crypto.com Research. "InfoFi Market Analysis." June 2025 - Sector analysis and growth projections

### Technical Architecture References

- OpenZeppelin Contracts Documentation - AccessControl, ReentrancyGuard, VRFConsumerBase integration patterns
- Gnosis Conditional Token Framework - Outcome tokenization and settlement infrastructure
- UMA Optimistic Oracle V3 - Automated settlement and dispute resolution systems
- Chainlink VRF Documentation - Verifiable random function integration and security best practices

### Regulatory Precedents & Compliance Framework

- Kalshi Federal Registration - CFTC compliance model for regulated prediction markets
- Polymarket Geographic Restrictions - International compliance framework and risk management
- InfoFi Regulatory Analysis - Legal framework for information market operations and oversight requirements

### Market Performance & Validation Data

- Polymarket 2024 Performance - $9B trading volume, 314K active traders, superior election prediction accuracy
- Kalshi Revenue Growth - $24M revenue in 2024, 1,220% growth rate, $787M valuation
- InfoFi Market Capitalization - $404-649M sector size with significant venture capital investment from tier-1 firms
