# Investigation: Cannot Sell All Tokens Issue

## Issue Summary

**Problem**: Users cannot close their position by selling all raffle tickets.

**Status**: ✅ **ROOT CAUSE IDENTIFIED**

**Date**: 2025-10-01

## Investigation Findings

### 1. Smart Contract Analysis

✅ **The smart contract works correctly**

- Tested `test_Buy2000_Sell2000_LeavesZeroBalanceAndInactive()` in `SellAllTickets.t.sol`
- Test **PASSES** - confirms selling all tokens works on-chain
- The `sellTokens` function in `SOFBondingCurve.sol` properly:
  - Burns raffle tokens
  - Updates `playerTickets` mapping
  - Calls `removeParticipant` on Raffle contract
  - Sets position to inactive when ticket count reaches 0

### 2. Frontend Issue Identified

❌ **The MAX button in BuySellWidget is broken**

**Location**: `src/components/curve/BuySellWidget.jsx` line 144-151

**Current Code**:
```javascript
const erc20Abi = [{ type: 'function', name: 'balanceOf', ... }];
const onMaxSell = async (ownerAddress) => {
  try {
    if (!client || !ownerAddress) return;
    const bal = await client.readContract({ 
      address: bondingCurveAddress,  // ❌ WRONG!
      abi: erc20Abi, 
      functionName: 'balanceOf', 
      args: [ownerAddress] 
    });
    setSellAmount((bal ?? 0n).toString());
  } catch { /* no-op */ }
};
```

**Problems**:

1. **Wrong contract address**: Trying to call `balanceOf` on the bonding curve contract
2. **Wrong parameter**: Passing `addrs?.ACCOUNT0 || addrs?.RAFFLE` instead of the connected wallet address
3. **Wrong approach**: The bonding curve is NOT an ERC20 token - it's a contract that manages a separate RaffleToken

### 3. Architecture Understanding

The system has two separate contracts:

```
SOFBondingCurve (bondingCurveAddress)
├── playerTickets mapping (tracks positions)
└── raffleToken (address of RaffleToken contract)

RaffleToken (separate ERC20 contract)
└── balanceOf(address) (actual token balances)
```

### 4. Why It Fails

When the user clicks MAX:
1. Frontend calls `onMaxSell(addrs?.ACCOUNT0 || addrs?.RAFFLE)`
2. Function tries to read `balanceOf` from bonding curve address
3. **Bonding curve doesn't have `balanceOf`** - it's not an ERC20!
4. Call fails silently (caught in try/catch)
5. `sellAmount` stays empty
6. User cannot sell

## Root Cause

**The MAX button is reading from the wrong contract and using the wrong address.**

## Solution Options

### Option A: Use playerTickets mapping (RECOMMENDED)

Read from the bonding curve's `playerTickets` mapping using the connected wallet address:

```javascript
const onMaxSell = async () => {
  try {
    if (!client || !address) return; // Use connected wallet address
    const SOFBondingCurveAbi = [...]; // Full ABI
    const bal = await client.readContract({ 
      address: bondingCurveAddress,
      abi: SOFBondingCurveAbi, 
      functionName: 'playerTickets',  // ✅ Correct mapping
      args: [address]  // ✅ Connected wallet
    });
    setSellAmount((bal ?? 0n).toString());
  } catch { /* no-op */ }
};
```

**Pros**:
- Direct read from authoritative source
- No need to discover raffle token address
- Matches the pattern used in `RaffleDetails.jsx` line 70-85

### Option B: Read from RaffleToken contract

First discover the raffle token address, then read its `balanceOf`:

```javascript
const onMaxSell = async () => {
  try {
    if (!client || !address) return;
    
    // 1. Get raffle token address from curve
    const raffleTokenAddr = await client.readContract({
      address: bondingCurveAddress,
      abi: [{ type: 'function', name: 'raffleToken', ... }],
      functionName: 'raffleToken',
      args: []
    });
    
    // 2. Read balance from raffle token
    const bal = await client.readContract({
      address: raffleTokenAddr,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [address]
    });
    
    setSellAmount((bal ?? 0n).toString());
  } catch { /* no-op */ }
};
```

**Pros**:
- Uses standard ERC20 interface
- More "correct" from token perspective

**Cons**:
- Requires two contract calls
- More complex
- Raffle token might not be discoverable in all cases

## Recommended Fix

**Use Option A (playerTickets mapping)** because:

1. ✅ Single contract call
2. ✅ Authoritative source (bonding curve tracks positions)
3. ✅ Consistent with `RaffleDetails.jsx` implementation
4. ✅ Simpler and more reliable
5. ✅ Already tested and working in other parts of the app

## Additional Issues Found

### Issue: Wrong address parameter

Line 201 in `BuySellWidget.jsx`:
```javascript
<Button ... onClick={() => onMaxSell(addrs?.ACCOUNT0 || addrs?.RAFFLE)}>MAX</Button>
```

**Problems**:
- `addrs.ACCOUNT0` and `addrs.RAFFLE` are contract addresses, not user addresses
- Should use the connected wallet address from `useWallet()` or `useAccount()`

**Fix**: Import wallet hook and use connected address:
```javascript
import { useWallet } from '@/hooks/useWallet';

// In component:
const { address } = useWallet();

// In button:
<Button ... onClick={() => onMaxSell()}>MAX</Button>
```

## Implementation Plan

1. Import `useWallet` hook in `BuySellWidget.jsx`
2. Get connected wallet address
3. Update `onMaxSell` to use `playerTickets` mapping
4. Remove the parameter from `onMaxSell` (use wallet address directly)
5. Update the MAX button to call `onMaxSell()` without parameters
6. Test the fix with local Anvil

## Testing Checklist

- [ ] User can click MAX button
- [ ] MAX button populates with correct balance
- [ ] User can sell all tokens
- [ ] Position becomes inactive after selling all
- [ ] No errors in console
- [ ] Works with different wallet addresses
- [ ] Works across different seasons

## Related Files

- `src/components/curve/BuySellWidget.jsx` (needs fix)
- `src/routes/RaffleDetails.jsx` (reference implementation, lines 70-85)
- `contracts/src/curve/SOFBondingCurve.sol` (contract reference)
- `contracts/test/SellAllTickets.t.sol` (proof that contract works)

## Notes

- The contract implementation is **correct** and fully functional
- This is purely a **frontend bug** in the MAX button implementation
- The bug prevents users from easily selling all tokens, but they could still manually enter the amount if they know it
- Priority: **HIGH** - This is a critical UX issue that blocks a core user flow
