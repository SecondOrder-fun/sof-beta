# SecondOrder.fun Prediction Market Development Ruleset

## Executive Summary

This technical ruleset defines the complete architecture for SecondOrder.fun's raffle-specific prediction market system. The implementation focuses exclusively on raffle outcome prediction using a hybrid pricing model that combines real-time raffle data (70%) with market sentiment (30%). No external dependencies or generic prediction market functionality required.

**Core Market Types**: Binary winner prediction, scalar position size prediction, and categorical behavioral prediction markets, all optimized for 2-week raffle cycles with immediate resolution.

## System Architecture Overview

### Data Flow Pipeline
```
Raffle Contract Events → Real-Time Position Tracker → Hybrid Pricing Engine → Market Contracts → Frontend Updates
```

### Core Components
- **Raffle Position Oracle**: Real-time ticket position tracking system
- **Hybrid Pricing Engine**: 70% fixed-odds + 30% AMM sentiment pricing
- **Market Resolution System**: Immediate settlement tied to raffle outcomes
- **Cross-Market Arbitrage Detection**: Price correction mechanisms

## Market Type Specifications

### 1. Binary Winner Prediction Markets

**Purpose**: "Will Player X win the raffle?"

**Development Rules**:
```solidity
// RULESET: Binary Winner Market Contract
pragma solidity ^0.8.19;
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract RaffleBinaryMarket is ReentrancyGuard, AccessControl {
    bytes32 public constant ORACLE_ROLE = keccak256("ORACLE_ROLE");
    bytes32 public constant EMERGENCY_ROLE = keccak256("EMERGENCY_ROLE");

    struct BinaryMarket {
        uint256 raffleSeasonId;
        address targetPlayer;
        string playerName;
        uint256 yesShares;           // Total YES position tokens
        uint256 noShares;            // Total NO position tokens  
        uint256 fixedOddsPrice;      // From raffle probability (70% weight)
        uint256 sentimentPrice;      // From AMM activity (30% weight)
        uint256 totalLiquidity;      // USDC locked in market
        bool resolved;
        bool outcome;
        uint256 creationBlock;
        uint256 resolutionBlock;
        mapping(address => uint256) yesHoldings;
        mapping(address => uint256) noHoldings;
    }

    mapping(uint256 => BinaryMarket) public markets;
    mapping(address => uint256) public playerToMarketId;
    uint256 public nextMarketId;
    
    IERC20 public immutable collateralToken; // USDC
    IRaffleContract public immutable raffleContract;

    // RULESET: Market Creation Trigger
    function createMarketForPlayer(address player) external returns (uint256) {
        require(playerToMarketId[player] == 0, "Market already exists");
        
        // RULESET: Only create if player has ≥1% of total tickets
        uint256 playerTickets = raffleContract.getPlayerPosition(player);
        uint256 totalTickets = raffleContract.getTotalTickets();
        require(playerTickets * 100 >= totalTickets, "Player below 1% threshold");

        uint256 marketId = nextMarketId++;
        BinaryMarket storage market = markets[marketId];
        
        market.raffleSeasonId = raffleContract.getCurrentSeason();
        market.targetPlayer = player;
        market.creationBlock = block.number;
        
        // RULESET: Initialize with current raffle probability
        market.fixedOddsPrice = calculateRaffleProbability(player);
        market.sentimentPrice = market.fixedOddsPrice; // Start equal
        
        playerToMarketId[player] = marketId;
        
        emit MarketCreated(marketId, player, market.fixedOddsPrice);
        return marketId;
    }

    // RULESET: Hybrid Pricing Formula Implementation
    function getCurrentPrice(uint256 marketId) external view returns (uint256) {
        BinaryMarket storage market = markets[marketId];
        require(market.targetPlayer != address(0), "Market does not exist");
        
        uint256 raffleProb = calculateRaffleProbability(market.targetPlayer);
        uint256 ammPrice = calculateAMMPrice(market.yesShares, market.noShares);
        
        // RULESET: 70% raffle data, 30% market sentiment
        return (raffleProb * 7000 + ammPrice * 3000) / 10000;
    }

    // RULESET: Real-time raffle probability calculation
    function calculateRaffleProbability(address player) internal view returns (uint256) {
        uint256 playerTickets = raffleContract.getPlayerPosition(player);
        uint256 totalTickets = raffleContract.getTotalTickets();
        
        if (totalTickets == 0) return 0;
        
        // Return probability as basis points (1% = 100, 100% = 10000)
        return (playerTickets * 10000) / totalTickets;
    }

    // RULESET: AMM sentiment price calculation
    function calculateAMMPrice(uint256 yesShares, uint256 noShares) internal pure returns (uint256) {
        if (yesShares + noShares == 0) return 5000; // 50% if no trading
        
        // Simple AMM: Price = Yes / (Yes + No)
        return (yesShares * 10000) / (yesShares + noShares);
    }

    // RULESET: Buy shares with hybrid pricing
    function buyShares(
        uint256 marketId,
        bool buyYes,
        uint256 usdcAmount
    ) external nonReentrant {
        BinaryMarket storage market = markets[marketId];
        require(!market.resolved, "Market resolved");
        require(raffleContract.isSeasonActive(market.raffleSeasonId), "Season ended");
        
        collateralToken.transferFrom(msg.sender, address(this), usdcAmount);
        
        uint256 currentPrice = this.getCurrentPrice(marketId);
        uint256 shares;
        
        if (buyYes) {
            shares = (usdcAmount * 10000) / currentPrice;
            market.yesHoldings[msg.sender] += shares;
            market.yesShares += shares;
        } else {
            shares = (usdcAmount * 10000) / (10000 - currentPrice);
            market.noHoldings[msg.sender] += shares;
            market.noShares += shares;
        }
        
        market.totalLiquidity += usdcAmount;
        
        // RULESET: Update sentiment price based on new trading
        market.sentimentPrice = calculateAMMPrice(market.yesShares, market.noShares);
        
        emit SharesPurchased(marketId, msg.sender, buyYes, shares, usdcAmount);
    }

    // RULESET: Immediate resolution when raffle ends
    function resolveMarket(uint256 marketId) external onlyRole(ORACLE_ROLE) {
        BinaryMarket storage market = markets[marketId];
        require(!market.resolved, "Already resolved");
        require(!raffleContract.isSeasonActive(market.raffleSeasonId), "Season still active");
        
        address winner = raffleContract.getSeasonWinner(market.raffleSeasonId);
        market.resolved = true;
        market.outcome = (winner == market.targetPlayer);
        market.resolutionBlock = block.number;
        
        emit MarketResolved(marketId, market.outcome, winner);
    }

    // RULESET: Claim winnings after resolution
    function claimWinnings(uint256 marketId) external nonReentrant {
        BinaryMarket storage market = markets[marketId];
        require(market.resolved, "Market not resolved");
        
        uint256 winnings;
        if (market.outcome) {
            // Player won - YES holders get paid
            winnings = (market.yesHoldings[msg.sender] * market.totalLiquidity) / market.yesShares;
            market.yesHoldings[msg.sender] = 0;
        } else {
            // Player lost - NO holders get paid
            winnings = (market.noHoldings[msg.sender] * market.totalLiquidity) / market.noShares;
            market.noHoldings[msg.sender] = 0;
        }
        
        require(winnings > 0, "No winnings to claim");
        
        // RULESET: 2% platform fee on winnings
        uint256 fee = (winnings * 200) / 10000;
        uint256 payout = winnings - fee;
        
        collateralToken.transfer(msg.sender, payout);
        collateralToken.transfer(feeCollector, fee);
        
        emit WinningsClaimed(marketId, msg.sender, payout, fee);
    }
}
```

### 2. Scalar Position Size Markets

**Purpose**: "Will Player X hold more than Y tickets at season end?"

**Development Rules**:
```solidity
// RULESET: Scalar Position Market Contract
contract RaffleScalarMarket is ReentrancyGuard, AccessControl {
    struct ScalarMarket {
        uint256 raffleSeasonId;
        address targetPlayer;
        uint256 thresholdTickets;    // Target ticket count
        uint256 currentPosition;     // Real-time player position
        uint256 aboveShares;         // Shares betting "above threshold"
        uint256 belowShares;         // Shares betting "below threshold"
        uint256 totalLiquidity;
        bool resolved;
        bool finalAboveThreshold;
        mapping(address => uint256) aboveHoldings;
        mapping(address => uint256) belowHoldings;
    }

    mapping(uint256 => ScalarMarket) public scalarMarkets;
    uint256 public nextScalarMarketId;

    // RULESET: Create position size market
    function createPositionMarket(
        address player,
        uint256 thresholdTickets
    ) external returns (uint256) {
        require(thresholdTickets > 0, "Invalid threshold");
        
        uint256 marketId = nextScalarMarketId++;
        ScalarMarket storage market = scalarMarkets[marketId];
        
        market.raffleSeasonId = raffleContract.getCurrentSeason();
        market.targetPlayer = player;
        market.thresholdTickets = thresholdTickets;
        market.currentPosition = raffleContract.getPlayerPosition(player);
        
        // RULESET: Initial pricing based on current position vs threshold
        uint256 currentTickets = market.currentPosition;
        if (currentTickets >= thresholdTickets) {
            // Player already above threshold - "above" shares expensive
            market.aboveShares = 7000; // 70%
            market.belowShares = 3000; // 30%
        } else {
            // Player below threshold - calculate based on gap
            uint256 gap = thresholdTickets - currentTickets;
            uint256 totalTickets = raffleContract.getTotalTickets();
            uint256 probability = gap < totalTickets ? ((totalTickets - gap) * 10000) / totalTickets : 1000;
            
            market.aboveShares = probability;
            market.belowShares = 10000 - probability;
        }
        
        emit ScalarMarketCreated(marketId, player, thresholdTickets);
        return marketId;
    }

    // RULESET: Update market when player position changes
    function updatePlayerPosition(address player, uint256 newPosition) external onlyRole(ORACLE_ROLE) {
        // Find all scalar markets for this player and update
        for (uint256 i = 1; i < nextScalarMarketId; i++) {
            ScalarMarket storage market = scalarMarkets[i];
            if (market.targetPlayer == player && !market.resolved) {
                market.currentPosition = newPosition;
                
                // RULESET: Recalculate hybrid pricing
                _recalculateScalarPrice(i);
            }
        }
    }

    // RULESET: Scalar market resolution
    function resolveScalarMarket(uint256 marketId) external onlyRole(ORACLE_ROLE) {
        ScalarMarket storage market = scalarMarkets[marketId];
        require(!market.resolved, "Already resolved");
        require(!raffleContract.isSeasonActive(market.raffleSeasonId), "Season active");
        
        uint256 finalPosition = raffleContract.getFinalPlayerPosition(
            market.targetPlayer, 
            market.raffleSeasonId
        );
        
        market.resolved = true;
        market.finalAboveThreshold = finalPosition >= market.thresholdTickets;
        
        emit ScalarMarketResolved(marketId, finalPosition, market.finalAboveThreshold);
    }
}
```

### 3. Categorical Behavioral Markets

**Purpose**: "What will Player X do?" (Exit Early, Double Down, Hold Position, etc.)

**Development Rules**:
```solidity
// RULESET: Categorical Behavioral Market Contract
contract RaffleCategoricalMarket is ReentrancyGuard, AccessControl {
    struct CategoricalMarket {
        uint256 raffleSeasonId;
        address targetPlayer;
        string[] outcomes;           // ["Exit Early", "Double Down", "Hold Position", "Sell Half"]
        uint256[] outcomeShares;     // Shares for each outcome
        uint256[] currentPrices;     // Real-time hybrid prices
        uint256 totalLiquidity;
        bool resolved;
        uint8 winningOutcome;
        mapping(address => mapping(uint8 => uint256)) holdings;
    }

    mapping(uint256 => CategoricalMarket) public categoricalMarkets;
    uint256 public nextCategoricalMarketId;

    // RULESET: Create behavioral prediction market
    function createBehavioralMarket(
        address player,
        string[] memory outcomes
    ) external returns (uint256) {
        require(outcomes.length >= 2 && outcomes.length <= 6, "Invalid outcome count");
        
        uint256 marketId = nextCategoricalMarketId++;
        CategoricalMarket storage market = categoricalMarkets[marketId];
        
        market.raffleSeasonId = raffleContract.getCurrentSeason();
        market.targetPlayer = player;
        market.outcomes = outcomes;
        market.outcomeShares = new uint256[](outcomes.length);
        market.currentPrices = new uint256[](outcomes.length);
        
        // RULESET: Initialize equal probability for all outcomes
        uint256 equalPrice = 10000 / outcomes.length;
        for (uint8 i = 0; i < outcomes.length; i++) {
            market.currentPrices[i] = equalPrice;
            market.outcomeShares[i] = equalPrice;
        }
        
        emit CategoricalMarketCreated(marketId, player, outcomes);
        return marketId;
    }

    // RULESET: Buy outcome shares
    function buyOutcomeShares(
        uint256 marketId,
        uint8 outcomeIndex,
        uint256 usdcAmount
    ) external nonReentrant {
        CategoricalMarket storage market = categoricalMarkets[marketId];
        require(outcomeIndex < market.outcomes.length, "Invalid outcome");
        require(!market.resolved, "Market resolved");
        
        collateralToken.transferFrom(msg.sender, address(this), usdcAmount);
        
        uint256 currentPrice = market.currentPrices[outcomeIndex];
        uint256 shares = (usdcAmount * 10000) / currentPrice;
        
        market.holdings[msg.sender][outcomeIndex] += shares;
        market.outcomeShares[outcomeIndex] += shares;
        market.totalLiquidity += usdcAmount;
        
        // RULESET: Recalculate all outcome prices using AMM
        _recalculateCategoricalPrices(marketId);
        
        emit OutcomeSharesPurchased(marketId, msg.sender, outcomeIndex, shares, usdcAmount);
    }

    // RULESET: Behavioral pattern detection and resolution
    function resolveBehavioralMarket(
        uint256 marketId,
        uint8 winningOutcome,
        string calldata evidence
    ) external onlyRole(ORACLE_ROLE) {
        CategoricalMarket storage market = categoricalMarkets[marketId];
        require(!market.resolved, "Already resolved");
        require(winningOutcome < market.outcomes.length, "Invalid outcome");
        
        market.resolved = true;
        market.winningOutcome = winningOutcome;
        
        emit CategoricalMarketResolved(marketId, winningOutcome, evidence);
    }

    // RULESET: AMM price calculation for multiple outcomes
    function _recalculateCategoricalPrices(uint256 marketId) internal {
        CategoricalMarket storage market = categoricalMarkets[marketId];
        
        uint256 totalShares = 0;
        for (uint8 i = 0; i < market.outcomes.length; i++) {
            totalShares += market.outcomeShares[i];
        }
        
        if (totalShares == 0) return;
        
        // RULESET: Price = OutcomeShares / TotalShares
        for (uint8 i = 0; i < market.outcomes.length; i++) {
            market.currentPrices[i] = (market.outcomeShares[i] * 10000) / totalShares;
        }
    }
}
```

## Raffle Integration Interface

### Required Raffle Contract Interface
```solidity
// RULESET: Raffle contract must implement this interface
interface IRaffleContract {
    function getCurrentSeason() external view returns (uint256);
    function isSeasonActive(uint256 seasonId) external view returns (bool);
    function getTotalTickets() external view returns (uint256);
    function getPlayerPosition(address player) external view returns (uint256);
    function getPlayerList() external view returns (address[] memory);
    function getNumberRange(address player) external view returns (uint256 start, uint256 end);
    function getSeasonWinner(uint256 seasonId) external view returns (address);
    function getFinalPlayerPosition(address player, uint256 seasonId) external view returns (uint256);
    
    // RULESET: Events that prediction markets must monitor
    event TicketPurchase(address indexed player, uint256 amount, uint256 newTotal);
    event TicketSale(address indexed player, uint256 amount, uint256 newTotal);
    event PositionUpdate(address indexed player, uint256 startRange, uint256 endRange);
    event SeasonEnded(uint256 indexed seasonId, address winner);
}
```

### Real-Time Position Tracking System
```solidity
// RULESET: Position tracking service
contract RafflePositionTracker is AccessControl {
    bytes32 public constant MARKET_ROLE = keccak256("MARKET_ROLE");
    
    struct PlayerSnapshot {
        uint256 ticketCount;
        uint256 timestamp;
        uint256 blockNumber;
        uint256 totalTicketsAtTime;
        uint256 winProbability; // Basis points
    }
    
    mapping(address => PlayerSnapshot[]) public playerHistory;
    mapping(address => PlayerSnapshot) public currentPositions;
    
    IRaffleContract public immutable raffleContract;
    
    // RULESET: Update positions on every raffle event
    function updatePlayerPosition(address player) external onlyRole(MARKET_ROLE) {
        uint256 newTicketCount = raffleContract.getPlayerPosition(player);
        uint256 totalTickets = raffleContract.getTotalTickets();
        
        PlayerSnapshot memory snapshot = PlayerSnapshot({
            ticketCount: newTicketCount,
            timestamp: block.timestamp,
            blockNumber: block.number,
            totalTicketsAtTime: totalTickets,
            winProbability: totalTickets > 0 ? (newTicketCount * 10000) / totalTickets : 0
        });
        
        playerHistory[player].push(snapshot);
        currentPositions[player] = snapshot;
        
        // RULESET: Notify all relevant prediction markets
        _notifyMarkets(player, snapshot);
    }
    
    // RULESET: Market notification system
    function _notifyMarkets(address player, PlayerSnapshot memory snapshot) internal {
        // Update binary markets
        if (binaryMarketRegistry.hasMarket(player)) {
            binaryMarketContract.updatePlayerOdds(player, snapshot.winProbability);
        }
        
        // Update scalar markets
        scalarMarketContract.updatePlayerPosition(player, snapshot.ticketCount);
        
        // Check for behavioral pattern triggers
        _checkBehavioralTriggers(player, snapshot);
    }
}
```

## Security Framework

### Access Control Implementation
```solidity
// RULESET: Security roles for prediction markets
contract PredictionMarketAccessControl is AccessControl {
    bytes32 public constant ORACLE_ROLE = keccak256("ORACLE_ROLE");
    bytes32 public constant EMERGENCY_ROLE = keccak256("EMERGENCY_ROLE");
    bytes32 public constant MARKET_CREATOR_ROLE = keccak256("MARKET_CREATOR_ROLE");
    bytes32 public constant RESOLVER_ROLE = keccak256("RESOLVER_ROLE");
    
    // RULESET: Critical function modifiers
    modifier onlyDuringActiveSeason(uint256 seasonId) {
        require(raffleContract.isSeasonActive(seasonId), "Season not active");
        _;
    }
    
    modifier onlyAfterSeasonEnd(uint256 seasonId) {
        require(!raffleContract.isSeasonActive(seasonId), "Season still active");
        _;
    }
    
    modifier validPlayer(address player) {
        require(raffleContract.getPlayerPosition(player) > 0, "Player has no position");
        _;
    }
}
```

### MEV Protection
```solidity
// RULESET: MEV protection for Base chain (2-second blocks)
contract MEVProtection {
    mapping(address => uint256) private lastActionBlock;
    
    modifier mevProtection() {
        require(
            block.number > lastActionBlock[tx.origin],
            "Same block action prohibited"
        );
        lastActionBlock[tx.origin] = block.number;
        _;
    }
    
    // RULESET: Commit-reveal for large trades (>$1000 USDC)
    mapping(address => bytes32) private commitments;
    mapping(address => uint256) private commitBlocks;
    
    function commitLargeTrade(bytes32 commitment) external {
        commitments[msg.sender] = commitment;
        commitBlocks[msg.sender] = block.number;
    }
    
    function revealLargeTrade(
        uint256 marketId,
        uint256 amount,
        bool outcome,
        uint256 nonce
    ) external mevProtection {
        require(amount >= 1000e6, "Use regular trade function");
        require(
            block.number >= commitBlocks[msg.sender] + 1,
            "Must wait one block"
        );
        
        bytes32 hash = keccak256(abi.encode(marketId, amount, outcome, nonce));
        require(commitments[msg.sender] == hash, "Invalid reveal");
        
        _executeTrade(marketId, amount, outcome);
        delete commitments[msg.sender];
    }
}
```

## Base Chain Optimization

### Gas-Optimized Contract Design
```solidity
// RULESET: Base chain specific optimizations
contract BaseOptimizedMarkets {
    // RULESET: Pack market data into single storage slots
    struct PackedMarketData {
        uint128 totalLiquidity;  // 16 bytes
        uint64 creationTime;     // 8 bytes  
        uint32 participantCount; // 4 bytes
        bool resolved;           // 1 byte
        bool outcome;            // 1 byte
        uint8 marketType;        // 1 byte
        uint8 reserved;          // 1 byte
        // Total: 32 bytes = 1 storage slot
    }
    
    // RULESET: Batch operations for gas efficiency
    function batchUpdatePositions(
        address[] calldata players,
        uint256[] calldata newPositions
    ) external onlyRole(ORACLE_ROLE) {
        require(players.length == newPositions.length, "Array length mismatch");
        
        for (uint256 i = 0; i < players.length; i++) {
            _updatePlayerPosition(players[i], newPositions[i]);
        }
        
        emit BatchPositionsUpdated(players, newPositions);
    }
    
    // RULESET: Single transaction market resolution
    function batchResolveMarkets(
        uint256[] calldata marketIds,
        bool[] calldata outcomes
    ) external onlyRole(RESOLVER_ROLE) {
        require(marketIds.length == outcomes.length, "Array length mismatch");
        
        for (uint256 i = 0; i < marketIds.length; i++) {
            _resolveMarket(marketIds[i], outcomes[i]);
        }
        
        emit BatchMarketsResolved(marketIds, outcomes);
    }
}
```

### Cross-Chain Compatibility Preparation
```solidity
// RULESET: Future multi-chain deployment readiness
abstract contract CrossChainReady {
    uint256 public immutable CHAIN_ID;
    
    constructor() {
        CHAIN_ID = block.chainid;
    }
    
    modifier onlySupportedChain() {
        require(
            CHAIN_ID == 8453 ||  // Base
            CHAIN_ID == 1 ||     // Ethereum
            CHAIN_ID == 42161,   // Arbitrum
            "Unsupported chain"
        );
        _;
    }
    
    // RULESET: Chain-specific configurations
    function getChainConfig() internal view returns (ChainConfig memory) {
        if (CHAIN_ID == 8453) {
            return ChainConfig({
                blockTime: 2,
                gasLimit: 30000000,
                baseFee: 0.001 gwei
            });
        }
        // Other chain configs...
    }
}
```

## Frontend Integration Requirements

### WebSocket Event System
```typescript
// RULESET: Real-time updates for frontend
interface MarketUpdate {
  marketId: number;
  marketType: 'binary' | 'scalar' | 'categorical';
  currentPrice: number;
  totalLiquidity: number;
  playerPosition?: number;
  timestamp: number;
}

interface RaffleUpdate {
  seasonId: number;
  totalTickets: number;
  playerPositions: {
    address: string;
    tickets: number;
    winProbability: number;
  }[];
  timestamp: number;
}

// RULESET: WebSocket message types
type WebSocketMessage = 
  | { type: 'MARKET_UPDATE', data: MarketUpdate }
  | { type: 'RAFFLE_UPDATE', data: RaffleUpdate }
  | { type: 'MARKET_RESOLVED', data: { marketId: number, outcome: boolean } }
  | { type: 'NEW_MARKET_CREATED', data: { marketId: number, player: string } };
```

### API Endpoints
```typescript
// RULESET: Required API endpoints for frontend
interface PredictionMarketAPI {
  // Get current odds for all players
  'GET /api/seasons/{seasonId}/odds': {
    response: {
      players: {
        address: string;
        name: string;
        tickets: number;
        winProbability: number;
        marketId?: number;
      }[];
    };
  };

  // Get specific market data
  'GET /api/markets/{marketId}': {
    response: {
      marketId: number;
      type: 'binary' | 'scalar' | 'categorical';
      targetPlayer: string;
      currentPrice: number;
      totalLiquidity: number;
      userPosition?: {
        yesShares: number;
        noShares: number;
        totalValue: number;
      };
      resolved: boolean;
      outcome?: boolean;
    };
  };

  // Place bet
  'POST /api/markets/{marketId}/bet': {
    request: {
      outcome: boolean | number; // boolean for binary, number for categorical
      amount: number; // USDC amount
      walletAddress: string;
    };
    response: {
      transactionHash: string;
      shares: number;
      newPrice: number;
    };
  };
}
```

## Testing Requirements

### Invariant Testing
```solidity
// RULESET: Critical invariants that must always hold
contract PredictionMarketInvariants is Test {
    function invariant_totalSharesEqualLiquidity() public {
        // Total shares across all outcomes must equal total USDC locked
        for (uint256 i = 1; i < nextMarketId; i++) {
            BinaryMarket memory market = markets[i];
            if (!market.resolved) {
                uint256 totalShares = market.yesShares + market.noShares;
                assertApproxEqRel(totalShares, market.totalLiquidity, 0.01e18); // 1% tolerance
            }
        }
    }
    
    function invariant_probabilitiesSum100Percent() public {
        // In categorical markets, all outcome probabilities must sum to 100%
        for (uint256 i = 1; i < nextCategoricalMarketId; i++) {
            CategoricalMarket memory market = categoricalMarkets[i];
            if (!market.resolved) {
                uint256 totalProbability = 0;
                for (uint8 j = 0; j < market.currentPrices.length; j++) {
                    totalProbability += market.currentPrices[j];
                }
                assertEq(totalProbability, 10000); // 100% in basis points
            }
        }
    }
    
    function invariant_hybridPricingBounds() public {
        // Hybrid prices must stay within reasonable bounds of raffle probability
        for (uint256 i = 1; i < nextMarketId; i++) {
            BinaryMarket memory market = markets[i];
            if (!market.resolved) {
                uint256 currentPrice = this.getCurrentPrice(i);
                uint256 raffleProb = calculateRaffleProbability(market.targetPlayer);
                
                // Market price should not deviate more than 50% from raffle probability
                uint256 deviation = currentPrice > raffleProb 
                    ? ((currentPrice - raffleProb) * 100) / raffleProb
                    : ((raffleProb - currentPrice) * 100) / raffleProb;
                    
                assertLt(deviation, 50); // Max 50% deviation
            }
        }
    }
}
```

### Integration Testing
```solidity
// RULESET: End-to-end testing scenarios
contract PredictionMarketIntegration is Test {
    function test_fullSeasonCycle() public {
        // 1. Season starts
        uint256 seasonId = raffleContract.startNewSeason();
        
        // 2. Players buy tickets, triggering market creation
        address player1 = makeAddr("player1");
        raffleContract.buyTickets{value: 10 ether}(player1, 1000);
        
        // Should auto-create binary market when player reaches 1%
        uint256 marketId = binaryMarketContract.playerToMarketId(player1);
        assertGt(marketId, 0);
        
        // 3. Users bet on outcomes
        deal(USDC, alice, 1000e6);
        vm.startPrank(alice);
        IERC20(USDC).approve(address(binaryMarketContract), 1000e6);
        binaryMarketContract.buyShares(marketId, true, 500e6);
        vm.stopPrank();
        
        // 4. Season ends, markets resolve
        raffleContract.endSeason();
        address winner = raffleContract.getSeasonWinner(seasonId);
        
        // 5. Markets should auto-resolve
        binaryMarketContract.resolveMarket(marketId);
        
        // 6. Winners can claim
        if (winner == player1) {
            vm.prank(alice);
            binaryMarketContract.claimWinnings(marketId);
            assertGt(IERC20(USDC).balanceOf(alice), 500e6); // Won more than invested
        }
    }
}
```

## Deployment Checklist

### Pre-Deployment Requirements
- [ ] All contracts implement required interfaces
- [ ] Hybrid pricing formulas tested with edge cases
- [ ] Real-time position tracking system deployed
- [ ] Oracle roles configured correctly
- [ ] Emergency pause mechanisms tested
- [ ] Fee collection addresses configured
- [ ] WebSocket event system operational

### Base Chain Deployment Steps
```typescript
// RULESET: Deployment script for Base mainnet
const deployPredictionMarkets = async () => {
  // 1. Deploy core contracts
  const raffleTracker = await deploy('RafflePositionTracker', [raffleContractAddress]);
  const binaryMarkets = await deploy('RaffleBinaryMarket', [USDC_BASE, raffleContractAddress]);
  const scalarMarkets = await deploy('RaffleScalarMarket', [USDC_BASE, raffleContractAddress]);
  const categoricalMarkets = await deploy('RaffleCategoricalMarket', [USDC_BASE, raffleContractAddress]);
  
  // 2. Configure roles
  await binaryMarkets.grantRole(ORACLE_ROLE, raffleTracker.address);
  await scalarMarkets.grantRole(ORACLE_ROLE, raffleTracker.address);
  await categoricalMarkets.grantRole(ORACLE_ROLE, raffleTracker.address);
  
  // 3. Set up cross-contract communication
  await raffleTracker.grantRole(MARKET_ROLE, binaryMarkets.address);
  await raffleTracker.grantRole(MARKET_ROLE, scalarMarkets.address);
  
  // 4. Initialize with current raffle state
  const currentPlayers = await raffleContract.getPlayerList();
  for (const player of currentPlayers) {
    await raffleTracker.updatePlayerPosition(player);
  }
  
  // 5. Verify all systems
  console.log('Deployment complete. Contracts deployed:');
  console.log('RafflePositionTracker:', raffleTracker.address);
  console.log('RaffleBinaryMarket:', binaryMarkets.address);
  console.log('RaffleScalarMarket:', scalarMarkets.address);
  console.log('RaffleCategoricalMarket:', categoricalMarkets.address);
};
```

### Post-Deployment Monitoring
- [ ] Set up real-time position tracking alerts
- [ ] Monitor hybrid pricing accuracy vs actual probabilities  
- [ ] Track gas usage optimization on Base
- [ ] Verify market resolution accuracy
- [ ] Monitor for MEV exploitation attempts
- [ ] Set up automated market creation monitoring

## Revenue Model Implementation

### Fee Structure Rules
```solidity
// RULESET: Fee collection system
contract FeeManager is AccessControl {
    uint256 public constant PLATFORM_FEE_BPS = 200; // 2% on winnings
    uint256 public constant TRADE_FEE_BPS = 10;     // 0.1% on volume
    
    address public feeCollector;
    mapping(address => uint256) public collectedFees;
    
    function collectPlatformFee(
        address winner,
        uint256 winnings
    ) external onlyRole(MARKET_ROLE) returns (uint256) {
        uint256 fee = (winnings * PLATFORM_FEE_BPS) / 10000;
        collectedFees[feeCollector] += fee;
        
        emit FeesCollected(winner, fee, "platform");
        return winnings - fee;
    }
    
    function collectTradeFee(
        address trader,
        uint256 volume
    ) external onlyRole(MARKET_ROLE) returns (uint256) {
        uint256 fee = (volume * TRADE_FEE_BPS) / 10000;
        collectedFees[feeCollector] += fee;
        
        emit FeesCollected(trader, fee, "trade");
        return fee;
    }
}
```

This ruleset provides complete technical specifications for building SecondOrder.fun's prediction market system with focus on raffle-specific markets, hybrid pricing, and Base chain optimization. All components work together as a cohesive system optimized for real-time raffle prediction markets.