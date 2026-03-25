# Arbitrage Detection System

## Overview

The ArbitrageOpportunityDisplay component provides real-time detection and visualization of arbitrage opportunities between raffle entry costs and InfoFi prediction market prices. The system is fully on-chain with no backend dependencies.

## Architecture

### Components

1. **useArbitrageDetection Hook** (`src/hooks/useArbitrageDetection.js`)
   - Core arbitrage detection logic
   - Compares raffle bonding curve prices vs InfoFi oracle prices
   - Filters by profitability threshold
   - Returns top N opportunities sorted by profit

2. **useArbitrageDetectionLive Hook** (`src/hooks/useArbitrageDetection.js`)
   - Extends base hook with real-time oracle event subscriptions
   - Uses viem `watchContractEvent` for `PriceUpdated` events
   - Automatically triggers recalculation on price changes

3. **ArbitrageOpportunityDisplay Component** (`src/components/infofi/ArbitrageOpportunityDisplay.jsx`)
   - Visual display of arbitrage opportunities
   - Real-time updates with live indicator
   - Color-coded profitability badges
   - Strategy explanations for each opportunity

## How It Works

### Detection Algorithm

```javascript
For each active InfoFi market:
1. Read oracle hybrid price (70% raffle probability + 30% market sentiment)
2. Calculate raffle entry cost from bonding curve
3. Compare prices: priceDiff = |raffleCost - marketPrice|
4. Calculate profitability: (priceDiff / avgPrice) * 100
5. Filter by minimum threshold (default: 2%)
6. Sort by profitability descending
7. Return top 10 opportunities
```

### Price Calculation

**Raffle Entry Cost:**
```javascript
// Target probability in basis points (e.g., 500 = 5%)
const ticketsNeeded = (targetProbabilityBps / 10000) * totalSupply
const raffleCost = ticketsNeeded * currentTicketPrice
```

**Market Price:**
```javascript
// Oracle returns hybrid price in basis points
const marketPriceSOF = (hybridPriceBps / 10000)
```

**Profitability:**
```javascript
const priceDifference = Math.abs(raffleCost - marketPriceSOF)
const avgPrice = (raffleCost + marketPriceSOF) / 2
const profitability = (priceDifference / avgPrice) * 100
```

### Arbitrage Strategies

**Strategy A: Buy Raffle, Sell Market**
- **Condition:** `raffleCost < marketPrice`
- **Action:** Purchase raffle tickets at lower cost, sell equivalent position in InfoFi market
- **Profit:** `marketPrice - raffleCost`

**Strategy B: Buy Market, Exit Raffle**
- **Condition:** `marketPrice < raffleCost`
- **Action:** Purchase InfoFi market position, exit raffle position early
- **Profit:** `raffleCost - marketPrice`

## Usage

### Basic Integration

```jsx
import ArbitrageOpportunityDisplay from '@/components/infofi/ArbitrageOpportunityDisplay';

function MyPage() {
  return (
    <ArbitrageOpportunityDisplay
      seasonId={currentSeasonId}
      bondingCurveAddress={curveAddress}
      minProfitability={2} // 2% minimum threshold
    />
  );
}
```

### With Custom Configuration

```jsx
<ArbitrageOpportunityDisplay
  seasonId={1}
  bondingCurveAddress="0x..."
  minProfitability={5} // 5% minimum threshold
/>
```

### Hook Usage (Advanced)

```jsx
import { useArbitrageDetectionLive } from '@/hooks/useArbitrageDetection';

function CustomArbitrageUI() {
  const { opportunities, isLoading, error, isLive, refetch } = useArbitrageDetectionLive(
    seasonId,
    bondingCurveAddress,
    {
      minProfitabilityBps: 200, // 2% in basis points
      maxResults: 10,
    }
  );

  return (
    <div>
      {isLive && <span>🟢 Live</span>}
      {opportunities.map(opp => (
        <div key={opp.id}>
          {opp.profitability.toFixed(2)}% profit
        </div>
      ))}
    </div>
  );
}
```

## Data Structure

### Opportunity Object

```typescript
{
  id: string,                    // Unique identifier
  marketId: string,              // InfoFi market ID
  player: address,               // Player address
  seasonId: number,              // Season ID
  rafflePrice: number,           // Raffle entry cost (SOF)
  marketPrice: number,           // InfoFi market price (SOF)
  priceDifference: number,       // Absolute price difference
  profitability: number,         // Percentage (e.g., 5.2)
  estimatedProfit: number,       // Estimated profit in SOF
  strategy: string,              // Human-readable strategy
  direction: 'buy_raffle' | 'buy_market',
  raffleProbabilityBps: number,  // Raffle component (basis points)
  marketSentimentBps: number,    // Market component (basis points)
  lastUpdated: number,           // Timestamp
}
```

## Configuration

### Default Parameters

- **Minimum Profitability:** 2% (200 basis points)
- **Maximum Results:** 10 opportunities
- **Oracle Weights:** 70% raffle probability, 30% market sentiment
- **Update Frequency:** Real-time via oracle events + 10s polling fallback

### Customization

```javascript
// In useArbitrageDetection hook
const options = {
  minProfitabilityBps: 200,  // Adjust threshold
  maxResults: 10,            // Adjust result limit
};
```

## Real-Time Updates

### Oracle Event Subscription

The system subscribes to `PriceUpdated` events from the InfoFiPriceOracle contract:

```javascript
event PriceUpdated(
  bytes32 indexed marketId,
  uint256 raffleBps,
  uint256 marketBps,
  uint256 hybridBps,
  uint256 timestamp
);
```

When an event is received:
1. Live indicator activates
2. Arbitrage calculations re-run
3. Opportunities list updates
4. UI reflects new data

### Fallback Polling

If WebSocket is unavailable:
- Falls back to HTTP polling every 10 seconds
- Ensures data freshness even without WS
- Graceful degradation

## UI Features

### Visual Indicators

- **Live Badge:** Green pulsing badge when receiving oracle events
- **Profitability Colors:**
  - 🟢 Green (≥10%): High profit opportunity
  - 🟡 Yellow (5-10%): Medium profit opportunity
  - ⚪ Gray (<5%): Low profit opportunity

### Information Display

Each opportunity card shows:
- Player address (truncated)
- Market ID (truncated)
- Season number
- Raffle cost vs Market price comparison
- Price spread
- Profitability percentage
- Strategy explanation
- Raffle and market sentiment components
- Estimated profit

### User Actions

- **Manual Refresh:** Click refresh button to force update
- **Last Update Time:** Shows when data was last refreshed
- **Empty State:** Educational message when no opportunities exist

## Testing

### Unit Tests

Located in `tests/hooks/useArbitrageDetection.test.jsx`:

```bash
npm test -- tests/hooks/useArbitrageDetection.test.jsx
```

**Test Coverage:**
- ✅ Detects arbitrage opportunities
- ✅ Respects profitability threshold
- ✅ Handles errors gracefully
- ✅ Returns empty array when no markets
- ✅ Limits results to maxResults
- ✅ Sorts by profitability descending

### Integration Testing

Test with local Anvil:

```bash
# 1. Start Anvil
anvil --gas-limit 30000000

# 2. Deploy contracts
cd contracts && forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:8545 --private-key $PRIVATE_KEY --broadcast

# 3. Create season and buy tickets
# (Follow standard E2E runbook)

# 4. Create prediction market
# (Creates market with oracle pricing)

# 5. Navigate to /markets in UI
# Should see ArbitrageOpportunityDisplay with detected opportunities
```

## Performance Considerations

### Optimization Strategies

1. **Caching:** Oracle prices cached in-memory
2. **Debouncing:** Rapid updates debounced to prevent thrashing
3. **Lazy Loading:** Markets loaded on-demand
4. **Efficient Filtering:** Early exit for inactive markets

### Gas Costs

The detection system is **read-only** and incurs **zero gas costs**:
- All calculations happen off-chain
- Only reads contract state
- No transactions required

## Troubleshooting

### No Opportunities Detected

**Possible Causes:**
1. No active markets for the season
2. All price differences below threshold
3. Oracle not updating prices
4. Bonding curve address incorrect

**Solutions:**
- Check active season has markets
- Lower minProfitability threshold
- Verify oracle contract address
- Confirm bonding curve address

### Live Indicator Not Showing

**Possible Causes:**
1. WebSocket not available
2. Oracle not emitting events
3. Subscription failed

**Solutions:**
- Check WebSocket RPC URL in env
- Verify oracle has PRICE_UPDATER_ROLE
- Check browser console for errors
- Falls back to polling automatically

### Incorrect Profitability Calculations

**Possible Causes:**
1. Bonding curve price stale
2. Oracle weights misconfigured
3. Player position data incorrect

**Solutions:**
- Refresh bonding curve state
- Verify oracle weights (70/30 default)
- Check RafflePositionTracker integration

## Future Enhancements

### Planned Features

1. **Execute Arbitrage Button**
   - One-click arbitrage execution
   - Multi-step transaction handling
   - Slippage protection
   - Gas estimation

2. **Historical Tracking**
   - Track arbitrage opportunities over time
   - Show missed opportunities
   - Profitability analytics

3. **Notifications**
   - Browser notifications for high-profit opportunities
   - Configurable alert thresholds
   - Email/SMS integration

4. **Advanced Strategies**
   - Multi-market arbitrage
   - Cross-season opportunities
   - Automated execution bots

## API Reference

### useArbitrageDetection(seasonId, bondingCurveAddress, options)

**Parameters:**
- `seasonId` (number|string): Season ID to monitor
- `bondingCurveAddress` (string): Bonding curve contract address
- `options` (object):
  - `minProfitabilityBps` (number): Minimum profit threshold in basis points (default: 200)
  - `maxResults` (number): Maximum opportunities to return (default: 10)

**Returns:**
- `opportunities` (array): Array of opportunity objects
- `isLoading` (boolean): Loading state
- `error` (string|null): Error message if any
- `refetch` (function): Manual refresh function

### useArbitrageDetectionLive(seasonId, bondingCurveAddress, options)

Same as `useArbitrageDetection` but adds:

**Additional Returns:**
- `isLive` (boolean): Whether receiving real-time oracle events

## Related Documentation

- [InfoFi Integration Specification](../instructions/sof-infofi-integration-*.md)
- [Bonding Curve Mathematics](../instructions/sof-bonding-curve-prize-pool.md)
- [Oracle Hybrid Pricing](../instructions/sof-tokenomics.md)
- [Project Tasks](../instructions/project-tasks.md)

## Support

For issues or questions:
1. Check troubleshooting section above
2. Review test cases for examples
3. Consult project documentation
4. Open GitHub issue with reproduction steps
