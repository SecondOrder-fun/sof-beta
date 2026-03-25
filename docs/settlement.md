# Settlement API Documentation

This document outlines the Settlement API endpoints for the SecondOrder.fun platform.

## Settlement Status

### Get Market Settlement Status

Retrieves the settlement status for a specific InfoFi market.

- **Endpoint**: `GET /api/settlement/status/:marketId`
- **Authentication**: None required

#### Settlement Status Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| marketId | number | InfoFi market ID |

#### Settlement Status Response

```json
{
  "status": {
    "market_id": 1,
    "raffle_id": 5,
    "market_status": "active",
    "raffle_status": "completed",
    "settlement_status": "pending_vrf",
    "vrf_request_id": "0x123...",
    "estimated_settlement_time": "2023-05-15T15:00:00Z",
    "is_settled": false
  }
}
```

## Trigger Settlement

### Manually Trigger Settlement

Manually triggers settlement for a specific InfoFi market.

- **Endpoint**: `POST /api/settlement/trigger/:marketId`
- **Authentication**: None required

#### Trigger Settlement Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| marketId | number | InfoFi market ID |
| outcome | string | Settlement outcome ('yes' or 'no') |

#### Trigger Settlement Request Body

```json
{
  "outcome": "yes"
}
```

#### Trigger Settlement Response

```json
{
  "success": true,
  "market_id": 1,
  "raffle_id": 5,
  "outcome": "yes",
  "settled_at": "2023-05-15T14:30:00Z"
}
```
