# SecondOrder.fun Data Schema

This document defines the data schema and formats for all entities in the SecondOrder.fun platform, including raffles, users, InfoFi markets, and real-time pricing data.

---

## Updated Schema (2025-08-17)

The following models align with the current smart contracts, InfoFi roadmap, and real-time pricing architecture. Values using basis points (bps) are integers from 0–10000.

### Season / Raffle (Onchain-aligned)

```typescript
type Season = {
  seasonId: number;                 // Unique season/raffle ID (uint256 onchain)
  status: number;                   // Enum-like numeric status (e.g., 0=Uninitialized,1=Active,2=Ended)
  raffleContract: string;           // Address of the Raffle contract
  bondingCurveContract: string;     // Address of the curve/ticket token
  startTime: number;                // Unix ms
  endTime: number;                  // Unix ms
  winnerCount: number;              // 1,3,5,10, etc.
  totalTickets: number;             // Current total supply of tickets
  vrfRequestId?: string;            // Optional VRF request identifier
  vrfStatus?: string;               // 'none' | 'requested' | 'fulfilled' | 'failed'
  prizePoolSof?: string;            // Optional SOF totals (string for bigints)
  consolationPoolSof?: string;
  buyFeeBps?: number;               // e.g., 10 = 0.1%
  sellFeeBps?: number;              // e.g., 70 = 0.7%
}
```

### Player Position (Per Season)

```typescript
type PlayerPosition = {
  seasonId: number;
  address: string;                  // EVM address
  ticketCount: number;              // Current tickets
  startRange: number;               // Sliding-window start index for the player
  lastUpdate: number;               // Unix ms
  winProbabilityBps: number;        // (ticketCount / totalTickets) * 10000
}
```

### InfoFi Market (Platform-level)

```typescript
type InfoFiMarket = {
  id: string | number;              // DB identifier
  seasonId: number;                 // Associated raffle/season
  playerAddress?: string;           // For player-focused markets
  marketType: 'WINNER_PREDICTION' | 'POSITION_SIZE' | 'BEHAVIORAL';
  contractAddress?: string;         // Onchain market address if deployed
  initialProbabilityBps: number;    // Snapshot at creation
  currentProbabilityBps: number;    // Updated via position changes
  isActive: boolean;
  isSettled: boolean;
  settlementTime?: string;          // ISO timestamp
  winningOutcome?: boolean;         // Depends on market type
  createdAt: string;                // ISO timestamp
  updatedAt: string;                // ISO timestamp
}
```

### InfoFi Position (User Bet)

```typescript
type InfoFiUserPosition = {
  id: string | number;
  marketId: string | number;
  userAddress: string;              // EVM address
  outcome: 'YES' | 'NO';
  amount: string;                   // Decimal string
  price?: string;                   // Price at entry
  createdAt: string;                // ISO timestamp
}
```

### InfoFi Winnings (Claimable)

```typescript
type InfoFiWinnings = {
  id: string | number;
  userAddress: string;
  marketId: string | number;
  amount: string;                   // Decimal string
  isClaimed: boolean;
  claimedAt?: string;               // ISO timestamp
  createdAt: string;                // ISO timestamp
}
```

### Market Pricing Cache (Hybrid Model)

```typescript
type MarketPricingCache = {
  marketId: string | number;
  raffleProbabilityBps: number;     // From onchain positions
  marketSentimentBps: number;       // From trading activity
  hybridPriceBps: number;           // (raffleWeight*raffle + marketWeight*sentiment)/10000
  raffleWeightBps: number;          // Default 7000
  marketWeightBps: number;          // Default 3000
  lastUpdated: string;              // ISO timestamp
}
```

### Arbitrage Opportunity (Analytics)

```typescript
type ArbitrageOpportunity = {
  id: string | number;
  seasonId: number;
  playerAddress: string;
  marketId: string | number;
  rafflePriceBps: number;           // Effective raffle-implied price
  marketPriceBps: number;           // Current hybrid market price
  priceDifferenceBps: number;
  profitabilityPct: number;         // Percentage (e.g., 2.5 means 2.5%)
  estimatedProfit: string;          // Decimal string
  isExecuted: boolean;
  executedAt?: string;              // ISO timestamp
  createdAt: string;                // ISO timestamp
}
```

### SSE Pricing Update (Hybrid)

```typescript
type SSEPricingUpdate = {
  type: 'initial_price' | 'raffle_probability_update' | 'market_sentiment_update' | 'heartbeat';
  marketId: string | number;
  raffleProbabilityBps?: number;
  marketSentimentBps?: number;
  hybridPriceBps?: number;
  timestamp: string;                // ISO timestamp
}
```

### REST Snapshot (Pricing)

```typescript
// GET /stream/pricing/:marketId/current
type PricingSnapshot = MarketPricingCache;
```

---

## Raffle Schema

### Raffle Object

```javascript
{
  "id": 1,                    // Integer - Unique identifier for the raffle
  "name": "Ethereum Merge Prediction",  // String - Name of the raffle
  "description": "Predict the exact timestamp of the Ethereum Merge event",  // String - Description of the raffle
  "startTime": 1686000000000,  // Integer (Unix timestamp) - Start time of the raffle
  "endTime": 1686259200000,    // Integer (Unix timestamp) - End time of the raffle
  "ticketPrice": "0.1",       // String - Price per ticket
  "ticketPriceToken": "ETH",  // String - Token used for ticket purchase
  "totalPrize": "10.5",       // String - Total prize pool
  "totalPrizeToken": "ETH",   // String - Token of the prize pool
  "totalTickets": 105,         // Integer - Total number of tickets sold
  "winnerCount": 3,            // Integer - Number of winners
  "status": "active",         // String - Status of the raffle (active, completed, cancelled)
  "participants": 87           // Integer - Number of participants
}
```

### Participant Object

```javascript
{
  "address": "0x1234567890123456789012345678901234567890",  // String - Ethereum address of participant
  "tickets": 5,              // Integer - Number of tickets purchased
  "joinTime": 1686000000000  // Integer (Unix timestamp) - When the participant joined
}
```

## User Schema

### User Profile Object

```javascript
{
  "id": "0x1234567890123456789012345678901234567890",  // String - Ethereum address of the user
  "username": "crypto_player_1",                     // String - Username
  "displayName": "Crypto Player One",               // String - Display name
  "bio": "Enthusiastic participant in DeFi and prediction markets",  // String - User biography
  "avatar": "https://example.com/avatar1.png",      // String - URL to avatar image
  "joinDate": "2023-01-15",                          // String (ISO date) - User join date
  "totalWinnings": "2.5",                            // String - Total winnings
  "totalWinningsToken": "ETH",                       // String - Token of winnings
  "totalParticipations": 15,                          // Integer - Total raffles participated in
  "winRate": "0.27"                                  // String - Win rate as decimal
}
```

### User Raffle Participation Object

```javascript
{
  "raffleId": 1,              // Integer - ID of the raffle
  "raffleName": "Ethereum Merge Prediction",  // String - Name of the raffle
  "ticketsPurchased": 5,      // Integer - Number of tickets purchased
  "joinDate": "2023-06-01",   // String (ISO date) - When user joined the raffle
  "status": "active",         // String - Status of participation (active, completed)
  "won": true,                // Boolean - Whether user won (only for completed raffles)
  "prize": "1.25",            // String - Prize amount won (only for completed raffles)
  "prizeToken": "ETH"         // String - Token of prize (only for completed raffles)
}
```

### User Portfolio Object

```javascript
{
  "totalValue": "25.75",        // String - Total portfolio value
  "totalValueToken": "ETH",     // String - Token of total value
  "assets": [                   // Array - List of assets
    {
      "token": "ETH",           // String - Token symbol
      "balance": "12.5",        // String - Token balance
      "value": "12.5",          // String - Value in ETH
      "valueToken": "ETH"       // String - Token of value
    },
    {
      "token": "USDC",          // String - Token symbol
      "balance": "15000",       // String - Token balance
      "value": "13.25",         // String - Value in ETH
      "valueToken": "ETH"       // String - Token of value
    }
  ],
  "performance": {              // Object - Performance metrics
    "dailyChange": "2.5",       // String - Daily change percentage
    "weeklyChange": "5.7",      // String - Weekly change percentage
    "monthlyChange": "12.3"     // String - Monthly change percentage
  }
}
```

## InfoFi Market Schema

### InfoFi Position Object

```javascript
{
  "marketId": 1,                           // Integer - ID of the InfoFi market
  "marketQuestion": "Will ETH reach $3000 by June 2023?",  // String - Market question
  "prediction": true,                      // Boolean - User's prediction (true/false)
  "amount": "0.5",                        // String - Amount bet
  "token": "ETH",                         // String - Token used for bet
  "entryPrice": "0.65",                   // String - Price at time of entry
  "currentPrice": "0.72",                 // String - Current price
  "potentialPayout": "0.55",              // String - Potential payout
  "status": "active"                      // String - Status of position (active, settled)
}
```

## Real-Time Pricing Schema

### SSE Pricing Update Object

```javascript
{
  "type": "priceUpdate",        // String - Type of update (priceUpdate, connected, heartbeat)
  "market_id": 1,                // Integer - ID of the market
  "yes_price": 0.72,             // Number - Probability of 'yes' outcome (0-1)
  "no_price": 0.28,              // Number - Probability of 'no' outcome (0-1)
  "timestamp": "2023-06-01T12:00:00.000Z"  // String (ISO timestamp) - Update timestamp
}
```

### SSE Connection Object

```javascript
{
  "type": "connected",           // String - Type of update
  "timestamp": 1686000000000     // Integer (Unix timestamp) - Connection timestamp
}
```

### SSE Heartbeat Object

```javascript
{
  "type": "heartbeat",           // String - Type of update
  "timestamp": 1686000000000     // Integer (Unix timestamp) - Heartbeat timestamp
}
```
