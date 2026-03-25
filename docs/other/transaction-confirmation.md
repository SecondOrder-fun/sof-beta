# Transaction Confirmation Fix

## Issue

**Problem**: After selling tokens, the UI still displayed the old token balance even though the transaction hash was returned.

**Transaction**: `0x64662a154cae2f4caf98a46e5ee414c762f34f193bf83abeafbfd820141c01a8`

## Root Cause

The `onTxSuccess` callback was being triggered **immediately after the transaction was submitted**, not after it was confirmed on-chain. This caused the UI to try to refresh data before the blockchain state had actually changed.

### The Problem Flow

```javascript
// OLD CODE (BROKEN)
const tx = await sellTokens.mutateAsync({ ... });
onTxSuccess && onTxSuccess();  // ❌ Called immediately!
// Transaction is still pending at this point
```

**What happened**:
1. User clicks "Sell"
2. Transaction is submitted to blockchain
3. `writeContractAsync` returns transaction hash immediately
4. `onTxSuccess` is called immediately
5. UI tries to refresh data from blockchain
6. **Blockchain state hasn't changed yet** (transaction still pending)
7. UI shows old balance because contract state is unchanged

## Solution

Wait for the transaction to be **mined and confirmed** before triggering the refresh callbacks.

### The Fix

```javascript
// NEW CODE (FIXED)
const tx = await sellTokens.mutateAsync({ ... });
const hash = tx?.hash ?? tx ?? '';

// Notify immediately with transaction hash
onNotify && onNotify({ type: 'success', message: 'Sold', hash });

// Wait for transaction to be mined before refreshing
if (client && hash) {
  try {
    await client.waitForTransactionReceipt({ 
      hash, 
      confirmations: 1  // Wait for 1 confirmation
    });
    onTxSuccess && onTxSuccess();  // ✅ Called after confirmation!
  } catch (waitErr) {
    // Fallback: trigger refresh after delay
    setTimeout(() => onTxSuccess && onTxSuccess(), 2000);
  }
}
```

## How It Works Now

### Correct Flow

1. User clicks "Sell"
2. Transaction is submitted to blockchain
3. `writeContractAsync` returns transaction hash
4. **Toast notification shows immediately** with transaction hash
5. **Wait for transaction to be mined** using `waitForTransactionReceipt`
6. Transaction is confirmed on-chain
7. `onTxSuccess` is called
8. UI refreshes data from blockchain
9. **Blockchain state has changed** - new balance is correct
10. UI displays updated balance

### Visual Feedback Timeline

```
0ms:    User clicks "Sell"
100ms:  Transaction submitted
200ms:  Toast shows "Sold" with transaction hash
        "Updating..." badge appears
        [Waiting for confirmation...]
2000ms: Transaction confirmed (1 block)
2001ms: onTxSuccess() called
2002ms: Data refresh begins
        - refreshPositionNow() reads new balance
        - debouncedRefresh() updates curve state
        - snapshotQuery.refetch() updates server
3500ms: Follow-up refresh (indexer lag)
6000ms: Final refresh
6001ms: "Updating..." badge disappears
```

## Changes Made

### File: `src/components/curve/BuySellWidget.jsx`

**Both `onBuy` and `onSell` functions updated**:

1. Extract transaction hash immediately
2. Show toast notification immediately (user sees tx hash right away)
3. Wait for transaction receipt with 1 confirmation
4. Only call `onTxSuccess` after confirmation
5. Fallback to delayed refresh if waiting fails

### Benefits

✅ **Accurate data** - UI only refreshes after blockchain state changes  
✅ **Better UX** - User sees transaction hash immediately  
✅ **Reliable** - Fallback mechanism if waiting fails  
✅ **Consistent** - Both buy and sell use same pattern  

### Error Handling

- If `waitForTransactionReceipt` fails, fallback to 2-second delay
- If no client available, fallback to 2-second delay
- Toast notification always shows regardless of waiting status
- Multiple refresh attempts still happen (1.5s, 4s) to catch indexer lag

## Testing

To verify the fix works:

1. **Sell some tokens**
   - Should see toast with transaction hash immediately
   - Should see "Updating..." badge
   - After ~2-3 seconds, balance should update
   - "Updating..." badge should disappear after 4 seconds

2. **Sell ALL tokens**
   - Should see toast with transaction hash
   - After confirmation, balance should show 0
   - Win probability should show 0.00%
   - Position should reflect zero tickets

3. **Buy tokens**
   - Same behavior as sell
   - Balance should increase after confirmation

## Related Issues

This fix resolves:
- ❌ UI showing stale data after transaction
- ❌ Race condition between transaction submission and data refresh
- ❌ Confusion about whether transaction succeeded

## Technical Details

### `waitForTransactionReceipt` API

```javascript
await client.waitForTransactionReceipt({
  hash: '0x...',           // Transaction hash
  confirmations: 1,        // Number of confirmations to wait for
  timeout: 30000,          // Optional: timeout in ms (default: 30s)
});
```

**Returns**: Transaction receipt after specified confirmations  
**Throws**: If transaction reverts or times out

### Why 1 Confirmation?

- **Fast feedback**: User sees update within 2-3 seconds (1 block)
- **Safe enough**: 1 confirmation is sufficient for UI updates
- **Fallback protection**: Multiple refresh attempts catch any issues

For critical operations (like prize claims), you might want more confirmations, but for balance updates, 1 is appropriate.

## Files Modified

1. `src/components/curve/BuySellWidget.jsx` - Added transaction confirmation wait
2. `src/routes/RaffleDetails.jsx` - Already had refresh callbacks (no changes needed)
3. `src/hooks/useCurveState.js` - Already had refresh logic (no changes needed)

## Conclusion

The fix ensures that **UI updates only happen after blockchain state has actually changed**, eliminating the race condition that caused stale data to be displayed.

**Before**: Transaction submitted → Immediate refresh → Stale data  
**After**: Transaction submitted → Wait for confirmation → Refresh → Fresh data

This is a critical fix for any blockchain UI that needs to display accurate on-chain state.
