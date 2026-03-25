# Position Display and MAX Sell Debugging

## Issues Identified

### 1. Current Position Shows 0 on Load ❌

**Problem**: The "Your Current Position" widget shows "Tickets: 0" when the page loads, even though the user has tokens.

**Root Cause**: The `refreshPositionNow()` function was only being called after buy/sell transactions, not on initial page load.

**Fix**: Added a `useEffect` hook to call `refreshPositionNow()` when the page loads and the user is connected.

```javascript
// Initial load: fetch position immediately
useEffect(() => {
  if (isConnected && address && bondingCurveAddress) {
    refreshPositionNow();
  }
}, [isConnected, address, bondingCurveAddress]);
```

### 2. Selling MAX Tokens Doesn't Work Properly ❌

**Problem**: Selling partial amounts works correctly, but selling MAX (all tokens) fails or doesn't update properly.

**Investigation Needed**: Added comprehensive logging to debug the issue.

## Changes Made

### File: `src/routes/RaffleDetails.jsx`

**Added initial position fetch**:
- New `useEffect` hook triggers `refreshPositionNow()` on mount
- Runs when user connects wallet or bonding curve address changes
- Ensures position displays correctly on page load

### File: `src/components/curve/BuySellWidget.jsx`

**Added debugging logs** to track the sell flow:

1. **MAX Button Click**:
   ```javascript
   console.log('[BuySellWidget] MAX clicked, reading playerTickets for:', address);
   console.log('[BuySellWidget] playerTickets balance:', balance);
   ```

2. **Sell Transaction**:
   ```javascript
   console.log('[BuySellWidget] Selling:', {
     tokenAmount,
     minSofAmount,
     sellEst
   });
   console.log('[BuySellWidget] Sell transaction submitted:', hash);
   console.log('[BuySellWidget] Transaction confirmed:', status);
   ```

3. **Error Handling**:
   ```javascript
   console.error('[BuySellWidget] Sell failed:', err);
   console.error('[BuySellWidget] Wait for receipt failed:', err);
   console.error('[BuySellWidget] MAX button failed:', err);
   ```

**Added error notifications**:
- User now sees error toast if sell transaction fails
- Better visibility into what went wrong

## Testing Instructions

### Test 1: Position Display on Load

1. **Setup**: Have some tokens in your position
2. **Action**: Refresh the page or navigate to raffle details
3. **Expected**: Position should show correct ticket count immediately
4. **Check Console**: Should see position being fetched

### Test 2: MAX Sell Debugging

1. **Setup**: Have some tokens in your position
2. **Action**: Click MAX button
3. **Check Console**: Look for these logs:
   ```
   [BuySellWidget] MAX clicked, reading playerTickets for: 0x...
   [BuySellWidget] playerTickets balance: 1234
   ```
4. **Verify**: Sell amount field should populate with your balance

5. **Action**: Click Sell button
6. **Check Console**: Look for these logs:
   ```
   [BuySellWidget] Selling: { tokenAmount: "1234", minSofAmount: "...", sellEst: "..." }
   [BuySellWidget] Sell transaction submitted: 0x...
   [BuySellWidget] Transaction confirmed: success
   ```

### Test 3: Partial Sell (Known Working)

1. **Action**: Enter a partial amount (e.g., half your balance)
2. **Action**: Click Sell
3. **Expected**: Should work correctly (already confirmed working)

## Debugging Checklist

When testing MAX sell, check for:

- [ ] MAX button populates correct amount
- [ ] Sell estimate calculates correctly
- [ ] Transaction is submitted successfully
- [ ] Transaction hash is returned
- [ ] Transaction confirms on-chain
- [ ] Position updates after confirmation
- [ ] No errors in console

## Potential Issues to Investigate

### Issue A: Slippage Calculation

When selling ALL tokens, the slippage calculation might result in a `minSofAmount` that's too high, causing the transaction to revert.

**Check**: Compare `sellEst` and `minSofAmount` in console logs
**Solution**: May need to adjust slippage for "sell all" case

### Issue B: Precision/Rounding

The `playerTickets` balance might have precision issues when converted to string.

**Check**: Verify the balance matches what's shown in position display
**Solution**: Ensure BigInt conversion is correct

### Issue C: Contract State

The contract might have a special case or validation for selling all tokens.

**Check**: Look at transaction revert reason if it fails
**Solution**: May need to check contract code for edge cases

### Issue D: Race Condition

The balance might change between clicking MAX and submitting the transaction.

**Check**: Compare balance at MAX click vs sell submission
**Solution**: Re-fetch balance right before sell, or lock UI during transaction

## Console Log Format

All logs are prefixed with `[BuySellWidget]` for easy filtering:

```bash
# Filter in browser console:
# Show only BuySellWidget logs
console.log = console.log.bind(console, '[BuySellWidget]')

# Or filter in DevTools:
[BuySellWidget]
```

## Next Steps

1. **Test with logging enabled**
2. **Capture console output** when MAX sell fails
3. **Check transaction on block explorer** to see revert reason
4. **Compare working partial sell vs failing MAX sell** logs
5. **Identify the difference** and implement fix

## Expected Console Output (Success Case)

```
[BuySellWidget] MAX clicked, reading playerTickets for: 0xYourAddress
[BuySellWidget] playerTickets balance: 2000
[BuySellWidget] Selling: {
  tokenAmount: "2000",
  minSofAmount: "1950000000000000000000",
  sellEst: "2000000000000000000000"
}
[BuySellWidget] Sell transaction submitted: 0xTransactionHash
[BuySellWidget] Transaction confirmed: success
```

## Expected Console Output (Failure Case)

```
[BuySellWidget] MAX clicked, reading playerTickets for: 0xYourAddress
[BuySellWidget] playerTickets balance: 2000
[BuySellWidget] Selling: {
  tokenAmount: "2000",
  minSofAmount: "...",
  sellEst: "..."
}
[BuySellWidget] Sell failed: Error: execution reverted: "Reason here"
```

## Files Modified

1. `src/routes/RaffleDetails.jsx` - Added initial position fetch
2. `src/components/curve/BuySellWidget.jsx` - Added debugging logs and error handling

## Lint Warnings

The console.log statements will trigger ESLint warnings. These are intentional for debugging and should be removed once the issue is identified and fixed.

To suppress warnings temporarily:
```javascript
/* eslint-disable no-console */
console.log('[BuySellWidget] Debug info');
/* eslint-enable no-console */
```

## Status

✅ **Position display on load** - FIXED  
🔍 **MAX sell issue** - DEBUGGING ENABLED

Please test with the logging enabled and share the console output when MAX sell fails!
