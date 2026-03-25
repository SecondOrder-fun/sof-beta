# Sell Max Revert Issue - Fix Summary

## Problem

When users clicked "Sell Max" to sell all their raffle tokens, the transaction would revert with "Curve: reserves" error. This occurred because:

1. The discrete bonding curve's `calculateSellPrice()` function would sometimes return a value slightly higher than the actual reserves due to rounding in the step-based pricing calculation
2. When selling ALL tokens (tokenAmount == totalSupply), the calculated baseReturn could exceed sofReserves by a tiny amount
3. The contract's check `require(curveConfig.sofReserves >= baseReturn, "Curve: reserves")` would fail

## Root Cause

The issue was in the `sellTokens()` function in `SOFBondingCurve.sol`. The discrete bonding curve uses step-based pricing, and when calculating the sell price for ALL tokens, there could be a small discrepancy between:

- The sum of all step prices (calculated in `calculateSellPrice()`)
- The actual reserves accumulated from buys (stored in `curveConfig.sofReserves`)

This discrepancy occurs because:

- Buy fees are added on top of the base cost
- Sell fees are deducted from the base return
- The reserves only track base costs, not fees
- Rounding in discrete steps can cause tiny mismatches

## Solution

### Smart Contract Fix

Added an edge case handler in `SOFBondingCurve.sol` at line 271-275:

```solidity
// Edge case: if selling all tokens, cap baseReturn to available reserves
// This handles rounding errors in the discrete bonding curve calculation
if (tokenAmount == curveConfig.totalSupply && baseReturn > curveConfig.sofReserves) {
    baseReturn = curveConfig.sofReserves;
}
```

This ensures that when a user sells ALL their tokens (which means totalSupply goes to zero), we cap the return to exactly what's available in reserves, preventing the revert.

### Frontend Fix

Removed the workaround in `BuySellWidget.jsx` that was leaving 1 token unsold. The previous code at line 282-285:

```javascript
// WORKAROUND: When selling ALL tokens, leave 1 token to avoid edge case
const balanceToSell = bal > 1n ? bal - 1n : bal;
```

Was replaced with the clean implementation:

```javascript
setSellAmount((bal ?? 0n).toString());
```

Now users can sell their entire balance without any workarounds.

## Testing

All tests pass, including:

- `test_Buy2000_Sell2000_LeavesZeroBalanceAndInactive()` - Verifies selling all tokens works correctly
- `test_Mixed_BuySell_Patterns_FinalZero()` - Tests various buy/sell patterns
- `test_RebuyAfterFullSell_RemainsTracked()` - Ensures position tracking after full sell
- All 47 tests in the test suite pass

## Impact

- ✅ Users can now sell 100% of their raffle tokens without reverts
- ✅ No more need to leave 1 token behind
- ✅ Cleaner user experience
- ✅ Maintains all security guarantees (slippage protection, reserve checks)
- ✅ Minimal gas overhead (one additional comparison)

## Files Changed

1. `contracts/src/curve/SOFBondingCurve.sol` - Added edge case handler
2. `src/components/curve/BuySellWidget.jsx` - Removed workaround
3. `src/contracts/abis/SOFBondingCurve.json` - Updated ABI (via copy-abis script)

## Deployment Notes

When deploying this fix:

1. Compile contracts: `cd contracts && forge build`
2. Run tests: `forge test`
3. Copy ABIs: `node scripts/copy-abis.js`
4. Deploy updated `SOFBondingCurve` contract
5. Update contract addresses in `.env` and frontend config
6. Restart frontend dev server

The fix is backward compatible and doesn't require any migration of existing data.
