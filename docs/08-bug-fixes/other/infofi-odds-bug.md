# InfoFi Odds Calculation Bug - Critical Fix Required

## 🚨 Critical Issues Found

### Issue 1: Non-Participant Showing 70% Odds
**Symptom**: User not participating in raffle shows 70% win odds in InfoFi market
**Root Cause**: Market is showing stale or incorrect probability data

### Issue 2: User with 11k/21k Tickets Showing 100% Odds  
**Symptom**: User with ~52% of tickets shows 100% odds
**Root Cause**: Probability calculation overflow or incorrect data source

## 🔍 Root Cause Analysis

### Problem 1: Percentage Display Bug (Line 185-188)

```javascript
// Current BUGGY code in InfoFiMarketCard.jsx
const percent = React.useMemo(() => {
  const v = Number(bps.hybrid ?? 0);
  return (v / 100).toFixed(0);  // ← WRONG: bps is 0-10000, should divide by 100
}, [bps.hybrid]);
```

**Issue**: 
- `bps.hybrid` is in basis points (0-10000)
- Dividing by 100 gives 0-100 range ✅
- BUT `.toFixed(0)` rounds to integer, losing precision
- AND if bps > 10000, shows >100%

**Example**:
- 5200 bps (52%) → 5200/100 = 52% ✅
- 11000 bps (110%!) → 11000/100 = 110% ❌ (should cap at 100%)

### Problem 2: Probability Data Source

The probability comes from `useOraclePriceLive`:

```javascript
// Line 38
const { data: priceData } = useOraclePriceLive(market?.id);

// Line 41
setBps({ 
  hybrid: priceData.hybridPriceBps,      // ← Where does this come from?
  raffle: priceData.raffleProbabilityBps, 
  market: priceData.marketSentimentBps 
});
```

**Questions**:
1. Is `useOraclePriceLive` returning correct data?
2. Is the hybrid pricing formula correct?
3. Is it syncing with raffle probability updates?

### Problem 3: Raffle Probability Not Syncing

When raffle odds change (user buys tickets), InfoFi markets may not update because:

1. **Oracle doesn't listen to raffle events**
2. **Stale cache** (staleTime: 5000ms)
3. **No cross-invalidation** between raffle and InfoFi queries

## 🔧 Fixes Required

### Fix 1: Correct Percentage Display

```javascript
// In InfoFiMarketCard.jsx, replace lines 185-188
const percent = React.useMemo(() => {
  const v = Number(bps.hybrid ?? 0);
  // Clamp to 0-10000 range, then convert to percentage
  const clamped = Math.max(0, Math.min(10000, v));
  return (clamped / 100).toFixed(1); // Show 1 decimal place
}, [bps.hybrid]);
```

### Fix 2: Add Data Validation

```javascript
// Add validation after line 41
React.useEffect(() => {
  if (!priceData) return;
  
  // Validate data ranges
  const hybrid = Math.max(0, Math.min(10000, priceData.hybridPriceBps ?? 0));
  const raffle = Math.max(0, Math.min(10000, priceData.raffleProbabilityBps ?? 0));
  const market = Math.max(0, Math.min(10000, priceData.marketSentimentBps ?? 0));
  
  setBps({ hybrid, raffle, market });
  
  // Debug logging
  if (hybrid > 10000 || raffle > 10000) {
    console.error('[InfoFi] Invalid probability data:', {
      hybrid: priceData.hybridPriceBps,
      raffle: priceData.raffleProbabilityBps,
      market: priceData.marketSentimentBps
    });
  }
}, [priceData]);
```

### Fix 3: Check Oracle Data Source

Need to verify `useOraclePriceLive` hook:

```javascript
// Check what this hook returns
// Should return:
{
  hybridPriceBps: 0-10000,        // Hybrid price
  raffleProbabilityBps: 0-10000,  // From raffle contract
  marketSentimentBps: 0-10000     // From market trading
}
```

### Fix 4: Sync with Raffle Updates

```javascript
// Add raffle event listener to InfoFiMarketCard
import { useCurveEvents } from '@/hooks/useCurveEvents';

// Inside component, after line 42
const raffleAddress = /* get from market data */;
useCurveEvents(raffleAddress, {
  onPositionUpdate: () => {
    // Invalidate oracle price query
    qc.invalidateQueries({ queryKey: ['oraclePriceLive', market?.id] });
  },
});
```

## 🐛 Debugging Steps

### Step 1: Check Oracle Data

```javascript
// Add debug logging in InfoFiMarketCard
React.useEffect(() => {
  console.log('[InfoFi Debug]', {
    marketId: market?.id,
    priceData,
    bps,
    percent,
    player: market?.player,
    seasonId: market?.seasonId
  });
}, [market, priceData, bps, percent]);
```

### Step 2: Verify Raffle Probability

```javascript
// Check actual raffle probability for the player
// Should match: (playerTickets * 10000) / totalTickets

// For user with 11k/21k tickets:
// Expected: (11000 * 10000) / 21000 = 5238 bps = 52.38%
// If showing 100%, something is very wrong
```

### Step 3: Check Hybrid Pricing Formula

The hybrid price should be:
```
hybridPrice = (raffleWeight * raffleProbability + marketWeight * marketSentiment) / 10000

// Default weights: 70% raffle, 30% market
hybridPrice = (7000 * raffleProbability + 3000 * marketSentiment) / 10000
```

**Verify**:
- Weights sum to 10000 ✓
- Result is 0-10000 ✓
- Formula matches contract ✓

## 🔍 Investigation Checklist

- [ ] Check `useOraclePriceLive` implementation
- [ ] Verify hybrid pricing formula
- [ ] Check if raffle probability is correct
- [ ] Verify market sentiment calculation
- [ ] Check for data type issues (string vs number)
- [ ] Verify no integer overflow
- [ ] Check if non-participants have 0 probability
- [ ] Verify probability updates when tickets change

## 💡 Quick Diagnostic

Add this to InfoFiMarketCard to see what's happening:

```jsx
{/* Debug panel - add after line 270 */}
{import.meta.env.DEV && (
  <div className="mt-2 p-2 bg-yellow-50 border border-yellow-200 rounded text-xs">
    <div className="font-bold">Debug Info:</div>
    <div>Hybrid BPS: {bps.hybrid}</div>
    <div>Raffle BPS: {bps.raffle}</div>
    <div>Market BPS: {bps.market}</div>
    <div>Displayed %: {percent}%</div>
    <div>Player: {market?.player?.slice(0,10)}...</div>
    <div>Market ID: {market?.id}</div>
  </div>
)}
```

## 🚀 Immediate Action Items

1. **Fix percentage display** - Clamp to 0-100% range
2. **Add data validation** - Ensure bps values are 0-10000
3. **Check oracle hook** - Verify `useOraclePriceLive` returns correct data
4. **Add debug logging** - See what data is actually being received
5. **Verify raffle sync** - Ensure InfoFi updates when raffle odds change

## 📊 Expected Behavior

### Scenario 1: User with 11k/21k tickets
- **Raffle probability**: (11000 * 10000) / 21000 = 5238 bps = **52.38%**
- **Market sentiment**: Varies based on trading
- **Hybrid (70/30)**: (7000 * 5238 + 3000 * market) / 10000
- **Display**: Should show **~52%** (not 100%)

### Scenario 2: Non-participant
- **Raffle probability**: 0 bps = **0%**
- **Market sentiment**: Could be non-zero if people are betting
- **Hybrid (70/30)**: (7000 * 0 + 3000 * market) / 10000 = 30% of market sentiment
- **Display**: Should show **0-30%** based on market only (not 70%)

---

*Critical bug - fix immediately before users lose trust in odds display*
