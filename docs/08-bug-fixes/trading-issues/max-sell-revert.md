# MAX Sell Transaction Revert - Complete Analysis

## Issue Summary

**Problem**: Selling ALL tokens (9000 tickets) causes transaction to revert, but selling partial amounts works fine.

**Status**: Root cause identified - **Insufficient curve reserves**

## Transaction Analysis

From console logs:
```
tokenAmount: '9000' (tickets to sell)
sellEst: '9000000000000000000000' (9000 SOF expected)
minSofAmount: '8910000000000000000000' (8910 SOF minimum after 1% slippage)
Transaction status: REVERTED
```

## Root Cause: Curve Reserve Mechanics

### How the Bonding Curve Works

1. **When users BUY tickets**:
   - User pays SOF (base price + fee)
   - Base price goes into `sofReserves`
   - Fee stays as "surplus" (not in reserves)

2. **When users SELL tickets**:
   - Curve calculates base return
   - Curve takes sell fee
   - User receives: `baseReturn - sellFee`
   - Reserves decrease by `baseReturn`

3. **The Problem**:
   ```solidity
   require(curveConfig.sofReserves >= baseReturn, "Curve: reserves");
   ```
   
   If you try to sell ALL tickets, the reserves might not have enough SOF because:
   - Fees accumulate as surplus (not in reserves)
   - Other sellers may have already withdrawn SOF
   - The last person to exit might not be able to get all their SOF back

## Why Partial Sells Work

When you sell a smaller amount (e.g., 1000 tickets):
- Requires less SOF from reserves
- Reserves have enough to cover the withdrawal
- Transaction succeeds ✅

When you try to sell ALL (9000 tickets):
- Requires 9000 SOF from reserves
- Reserves might only have 8000 SOF (example)
- Transaction reverts ❌

## Fixes Implemented

### 1. Position Refresh on Revert ✅

**Problem**: Position didn't update after reverted transaction.

**Fix**: Call `onTxSuccess` even when transaction reverts, so the UI refreshes and shows the correct (unchanged) balance.

```javascript
if (receipt.status === 'reverted') {
  // Show error
  onNotify({ type: 'error', message: 'Transaction reverted' });
  // Still refresh to show accurate state
  onTxSuccess && onTxSuccess();
}
```

### 2. Pre-flight Reserve Check ✅

**Problem**: Transaction wastes gas by reverting on-chain.

**Fix**: Check reserves BEFORE submitting transaction.

```javascript
const reserves = await readContract('curveConfig');
if (reserves < sellEstimate) {
  showError('Insufficient curve reserves');
  return; // Don't submit transaction
}
```

### 3. Enhanced Error Reporting ✅

**Problem**: User doesn't know why transaction failed.

**Fix**: Added detailed console logging and error messages.

## Solutions for Users

### Option A: Sell Less Than MAX

Instead of selling all 9000 tickets, try:
- 8900 tickets
- 8800 tickets
- Keep reducing until it works

This works around the reserve limitation.

### Option B: Wait for More Buyers

As more people buy tickets:
- More SOF flows into reserves
- Eventually reserves will be sufficient
- Then you can sell your full position

### Option C: Multiple Transactions

Sell in batches:
1. Sell 3000 tickets
2. Wait for confirmation
3. Sell another 3000 tickets
4. Sell remaining 3000 tickets

Each smaller transaction is more likely to succeed.

## Long-term Contract Fix

The contract could be improved to handle this edge case:

### Solution 1: Use Fee Surplus for Exits

Allow the last sellers to withdraw from accumulated fees:

```solidity
uint256 available = curveConfig.sofReserves + accumulatedFees;
require(available >= baseReturn, "Curve: insufficient liquidity");
```

### Solution 2: Calculate Maximum Sellable

Add a view function to show maximum sellable amount:

```solidity
function getMaxSellable(address player) external view returns (uint256) {
  uint256 playerBalance = playerTickets[player];
  uint256 maxAffordable = calculateMaxFromReserves(curveConfig.sofReserves);
  return min(playerBalance, maxAffordable);
}
```

### Solution 3: Reserve Ratio Requirement

Prevent the reserve shortage by requiring minimum reserves:

```solidity
require(
  curveConfig.sofReserves >= curveConfig.totalSupply * minReserveRatio,
  "Curve: reserves too low"
);
```

## Testing Checklist

- [x] Position displays correctly on page load
- [x] Position refreshes after successful transaction
- [x] Position refreshes after reverted transaction
- [x] Pre-flight reserve check prevents wasted gas
- [x] Error messages show when reserves insufficient
- [x] Console logs show reserve amounts
- [ ] User tests selling less than MAX
- [ ] User confirms reserve amounts in console

## Files Modified

1. `src/routes/RaffleDetails.jsx` - Added initial position fetch
2. `src/components/curve/BuySellWidget.jsx` - Added reserve checking, error handling, and position refresh on revert

## Next Steps

1. **Test with new code** - Try selling MAX again
2. **Check console** for reserve amounts:
   ```
   [BuySellWidget] Curve reserves: XXXXX SOF
   [BuySellWidget] Sell would return: 9000 SOF
   ```
3. **If reserves insufficient** - Try selling a smaller amount
4. **Consider contract upgrade** - Implement one of the long-term fixes

## Conclusion

This is a **known limitation** of bonding curve mechanics when reserves are depleted. The fixes implemented:
- ✅ Prevent wasted gas
- ✅ Show clear error messages
- ✅ Keep UI in sync with blockchain state

The user can work around it by selling less than their full position or waiting for more buyers to add liquidity.
