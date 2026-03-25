# InfoFi Market API Documentation

## Overview

The InfoFi Market API provides endpoints for managing prediction markets, real-time pricing, arbitrage opportunities, and cross-layer coordination with raffle systems.

## Base URL

The InfoFi layer integrates with the Onit SDK by pointing to a configurable base URL.

```text
VITE_ONIT_API_BASE (frontend)
ONIT_API_BASE (backend)
```

Defaults:

- Dev (local mock): `http://localhost:8787`
- Prod (hosted): `https://markets.onit-labs.workers.dev`

## InfoFi Markets

### Get All Active InfoFi Markets

Retrieve all currently active prediction markets.

```http
GET /markets
```

**Response:**

```json
{
  "markets": [
    {
      "id": 123,
      "seasonId": 1,
      "playerAddress": "0xabc...",
      "marketType": "WINNER_PREDICTION",
      "initialProbabilityBps": 1200,
      "currentProbabilityBps": 1350,
      "isActive": true,
      "isSettled": false,
      "createdAt": "2025-08-17T00:00:00Z",
      "updatedAt": "2025-08-17T00:10:00Z"
    }
  ]
}
```

### Get InfoFi Market by Address/ID

Retrieve a specific prediction market by ID.

```http
GET /markets/:marketAddress
```

**Response:**

```json
{
  "id": 123,
  "seasonId": 1,
  "playerAddress": "0xabc...",
  "marketType": "WINNER_PREDICTION",
  "initialProbabilityBps": 1200,
  "currentProbabilityBps": 1350,
  "isActive": true,
  "isSettled": false,
  "createdAt": "2025-08-17T00:00:00Z",
  "updatedAt": "2025-08-17T00:10:00Z",
  "contractAddress": "0xMarket..."
}
```

### Create InfoFi Market

Create a new prediction market.

```http
POST /markets
```

**Request Body:**

```json
{
  "seasonId": 1,
  "playerAddress": "0xabc...",
  "marketType": "WINNER_PREDICTION"
}
```

**Response:**

```json
{
  "id": 123,
  "seasonId": 1,
  "playerAddress": "0xabc...",
  "marketType": "WINNER_PREDICTION",
  "initialProbabilityBps": 1200,
  "currentProbabilityBps": 1200,
  "isActive": true,
  "isSettled": false,
  "createdAt": "2025-08-17T00:00:00Z",
  "updatedAt": "2025-08-17T00:00:00Z",
  "contractAddress": "0xMarket..."
}
```

### Update InfoFi Market

Update an existing prediction market.

```http
PUT /markets/:id
```

**Request Body:**

```json
{
  "question": "Updated question",
  "description": "Updated description"
}
```

**Response:**

```json
{
  "id": 1,
  "raffle_id": 1,
  "question": "Updated question",
  "yes_price": 0.65,
  "no_price": 0.35,
  "volume": 12500,
  "created_at": "2023-01-01T00:00:00Z",
  "expires_at": "2023-01-15T00:00:00Z",
  "status": "active",
  "description": "Updated description"
}
```

### Delete InfoFi Market

Delete a prediction market.

```http
DELETE /markets/:id
```

**Response:**

```json
{
  "success": true
}
```

## Real-Time Pricing

For pricing stream and snapshot formats, see `pricing-api.md` (hybrid model with bps fields):

- `GET /stream/pricing/:marketId` (SSE)
- `GET /stream/pricing/:marketId/current` (REST)

## Arbitrage Opportunities

### Get Arbitrage Opportunities

Retrieve current arbitrage opportunities between raffle positions and InfoFi markets.

```http
GET /arbitrage/opportunities
```

**Response:**

```json
{
  "opportunities": [
    {
      "id": 1,
      "raffle_id": 1,
      "market_id": 1,
      "player_address": "0x123...",
      "raffle_price": 0.75,
      "infofi_price": 0.65,
      "price_difference": 0.1,
      "profitability": 15.38,
      "estimated_profit": 153.85,
      "strategy_description": "Hedge raffle position by selling equivalent InfoFi position"
    }
  ]
}
```

### Execute Arbitrage Strategy

Execute an arbitrage strategy.

```http
POST /arbitrage/execute
```

**Request Body:**

```json
{
  "opportunity_id": 1,
  "player_address": "0x123..."
}
```

**Response:**

```json
{
  "success": true,
  "transaction_hash": "0xabc...",
  "estimated_profit_realized": 153.85
}
```

## Cross-Layer Coordination

### Get Settlement Status

Retrieve the settlement status for a raffle and its associated InfoFi markets.

```http
GET /settlement/status/:raffle_id
```

**Response:**

```json
{
  "raffle_id": 1,
  "raffle_status": "resolved",
  "infofi_markets": [
    {
      "market_id": 1,
      "status": "settled",
      "winning_outcome": "YES",
      "settled_at": "2023-01-15T00:00:00Z"
    }
  ],
  "vrf_request_id": "0xdef...",
  "completed_at": "2023-01-15T00:00:00Z"
}
```
