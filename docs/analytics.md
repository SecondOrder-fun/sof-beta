# Analytics API Documentation

This document outlines the Analytics API endpoints for the SecondOrder.fun platform.

## Strategy Performance Metrics

### Get Strategy Performance Metrics

Retrieves performance metrics for a player's trading strategy.

- **Endpoint**: `GET /api/analytics/strategy/:playerAddress`
- **Authentication**: None required

#### Strategy Performance Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| playerAddress | string | Ethereum address of the player |
| timeframe | string | Timeframe filter (optional: 'day', 'week', 'month', 'all') |
| limit | number | Maximum number of positions to analyze (optional, default: 50) |

#### Strategy Performance Response

```json
{
  "performance": {
    "player_address": "0x123...",
    "total_positions": 25,
    "total_profit": 1250.75,
    "win_rate": 68.00,
    "avg_return": 50.03,
    "best_trade": 250.50,
    "worst_trade": -75.25
  }
}
```

## Arbitrage History

### Get Historical Arbitrage Transactions

Retrieves historical arbitrage transactions.

- **Endpoint**: `GET /api/analytics/arbitrage/history`
- **Authentication**: None required

#### Arbitrage History Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| timeframe | string | Timeframe filter (optional: 'day', 'week', 'month', 'all') |
| limit | number | Maximum number of transactions to retrieve (optional, default: 50) |

#### Arbitrage History Response

```json
{
  "history": [
    {
      "id": 1,
      "raffle_id": 5,
      "market_id": 10,
      "profit": 153.85,
      "timestamp": "2023-05-15T14:30:00Z"
    }
  ]
}
```

## User Analytics

### Get Comprehensive User Analytics

Retrieves comprehensive analytics for a specific user.

- **Endpoint**: `GET /api/analytics/user/:playerAddress`
- **Authentication**: None required

#### User Analytics Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| playerAddress | string | Ethereum address of the user |

#### User Analytics Response

```json
{
  "analytics": {
    "user": {
      "address": "0x123...",
      "created_at": "2023-01-01T00:00:00Z"
    },
    "market_activity": {
      "total_markets": 15,
      "total_volume": 5000.00,
      "favorite_markets": ["Market 1", "Market 2"]
    },
    "arbitrage_activity": {
      "total_arbitrages": 8,
      "total_profit": 850.25,
      "success_rate": 87.50
    }
  }
}
```
