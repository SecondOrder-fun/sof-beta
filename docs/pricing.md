# Pricing API Documentation

This document outlines the hybrid Pricing API for InfoFi markets (basis points model).

## Endpoints

- `GET /stream/pricing/:marketId` — SSE stream of hybrid price updates
- `GET /stream/pricing/:marketId/current` — current pricing snapshot (REST)

## Real-Time Pricing Stream (SSE)

Establishes a Server-Sent Events (SSE) connection to receive real-time price updates for a specific InfoFi market using the hybrid pricing model.

- **Endpoint**: `GET /stream/pricing/:marketId`
- **Authentication**: None
- **Protocol**: Server-Sent Events (SSE)

### Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| marketId  | string/number | InfoFi market ID |

### Event Types

- **initial_price** — sent immediately after connection with the current snapshot
- **raffle_probability_update** — raffle component changed
- **market_sentiment_update** — sentiment component changed
- **heartbeat** — keep-alive message

### Payload (bps fields)

```json
{
  "type": "raffle_probability_update",
  "marketId": 123,
  "raffleProbabilityBps": 1234,
  "marketSentimentBps": 1100,
  "hybridPriceBps": 1188,
  "timestamp": "2025-08-17T00:00:00.000Z"
}
```

### Example JavaScript Usage

```javascript
const eventSource = new EventSource('/stream/pricing/123');

eventSource.onmessage = (event) => {
  const data = JSON.parse(event.data);
  switch (data.type) {
    case 'initial_price':
      // hydrate UI with snapshot
      break;
    case 'raffle_probability_update':
    case 'market_sentiment_update':
      // update live price from data.hybridPriceBps
      break;
    case 'heartbeat':
    default:
      break;
  }
};

eventSource.onerror = (err) => {
  console.error('SSE error:', err);
};
```

## Current Pricing Snapshot (REST)

- **Endpoint**: `GET /stream/pricing/:marketId/current`
- **Response**: `MarketPricingCache`

```json
{
  "marketId": 123,
  "raffleProbabilityBps": 1234,
  "marketSentimentBps": 1100,
  "hybridPriceBps": 1188,
  "raffleWeightBps": 7000,
  "marketWeightBps": 3000,
  "lastUpdated": "2025-08-17T00:00:00.000Z"
}
```
