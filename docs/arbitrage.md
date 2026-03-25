# Arbitrage API Documentation

This document outlines the Arbitrage API endpoints for the SecondOrder.fun platform.

## Arbitrage Opportunities

### Get Current Arbitrage Opportunities

Retrieves current arbitrage opportunities between raffle positions and InfoFi markets.

- **Endpoint**: `GET /api/arbitrage/opportunities`
- **Authentication**: None required

#### Arbitrage Opportunities Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| minProfitability | number | Minimum profitability percentage to filter results (optional) |
| limit | number | Maximum number of opportunities to retrieve (optional, default: 10) |

#### Arbitrage Opportunities Response

```json
{
  "opportunities": [
    {
      "raffle_id": 5,
      "market_id": 10,
      "raffle_price": 0.65,
      "infofi_price": 0.55,
      "price_difference": 0.10,
      "profitability": 18.18,
      "estimated_profit": 153.85,
      "strategy_description": "Hedge raffle position by selling equivalent InfoFi YES position"
    }
  ]
}
```

## Execute Arbitrage Strategy

### Execute Selected Arbitrage Strategy

Executes an arbitrage strategy to capitalize on a price discrepancy.

- **Endpoint**: `POST /api/arbitrage/execute`
- **Authentication**: None required

#### Execute Strategy Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| opportunity_id | number | ID of the arbitrage opportunity |
| player_address | string | Player's wallet address |

#### Execute Strategy Request Body

```json
{
  "opportunity_id": 1,
  "player_address": "0x123..."
}
```

#### Execute Strategy Response

```json
{
  "success": true,
  "transaction_hash": "0x456...",
  "estimated_profit_realized": 153.85
}
```
