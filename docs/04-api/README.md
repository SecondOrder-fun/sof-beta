# API Documentation

This directory contains documentation for all API endpoints in the SecondOrder.fun platform.

## Base Services

- __Onit Mock/Prod Base__: configurable via `VITE_ONIT_API_BASE` (frontend) / `ONIT_API_BASE` (backend)
  - Dev: `http://localhost:8787`
  - Prod: `https://markets.onit-labs.workers.dev`

## InfoFi Markets API

Documentation for InfoFi market management, including CRUD operations, betting, and odds retrieval.

- [InfoFi API Documentation](./infofi-api.md)

## Real-Time Pricing API

Documentation for real-time pricing updates via Server-Sent Events (SSE).

- [Pricing API Documentation](./pricing-api.md) — `GET /stream/pricing/:marketId`, `GET /stream/pricing/:marketId/current`

## Arbitrage API

Documentation for arbitrage opportunity detection and execution.

- [Arbitrage API Documentation](./arbitrage-api.md)

## Settlement API

Documentation for cross-layer settlement coordination and status retrieval.

- [Settlement API Documentation](./settlement-api.md)

## Analytics API

Documentation for advanced analytics including strategy performance, arbitrage history, and user analytics.

- [Analytics API Documentation](./analytics-api.md)

## Hono Edge APIs

Documentation for high-speed edge APIs (coming soon).

- Hono Edge API Documentation (TODO)
