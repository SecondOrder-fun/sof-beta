# Transactions and Holders Tabs Not Displaying - Debug Guide

## Issue Report

**Problem**: Transactions and Holders tabs are broken and not displaying content.

**Location**: RaffleDetails.jsx - Lines 373-378

## Diagnostic Steps

### 1. Check Browser Console

Open browser DevTools (F12) and check for:

```javascript
// Common errors to look for:
- "Cannot read property 'map' of undefined"
- "Failed to fetch"
- "Network request failed"
- React rendering errors
- Query errors from React Query
```

### 2. Verify Data Loading

Check if the hooks are returning data:

```javascript
// In TransactionsTab.jsx (line 21)
const { transactions, isLoading, error } = useRaffleTransactions(bondingCurveAddress, seasonId);

// In HoldersTab.jsx (line 21)
const { holders, totalHolders, totalTickets, isLoading, error } = useRaffleHolders(bondingCurveAddress, seasonId);

// Add debug logging:
console.log('Transactions:', { transactions, isLoading, error });
console.log('Holders:', { holders, isLoading, error });
```

### 3. Check Props Being Passed

In RaffleDetails.jsx:

```javascript
// Line 374
<TransactionsTab bondingCurveAddress={bc} seasonId={seasonId} />

// Line 377
<HoldersTab bondingCurveAddress={bc} seasonId={seasonId} />

// Verify:
console.log('bondingCurveAddress:', bc);
console.log('seasonId:', seasonId);
```

### 4. Verify Event Fetching

The hooks fetch `PositionUpdate` events:

```javascript
event PositionUpdate(
  uint256 indexed seasonId,
  address indexed player,
  uint256 oldTickets,
  uint256 newTickets,
  uint256 totalTickets,
  uint256 probabilityBps
)
```

**Check**:
- Are events being emitted from the contract?
- Is the block range correct? (currently fetching last 10,000 blocks)
- Is the RPC endpoint responding?

### 5. Common Issues & Fixes

#### Issue 1: No Events Found
**Symptom**: Empty arrays returned
**Cause**: No PositionUpdate events in the block range
**Fix**: 
```javascript
// Increase block range in useRaffleTransactions.js and useRaffleHolders.js
const fromBlock = currentBlock > 50000n ? currentBlock - 50000n : 0n;
```

#### Issue 2: RPC Rate Limiting
**Symptom**: Intermittent failures, "429 Too Many Requests"
**Cause**: Too many RPC calls
**Fix**:
```javascript
// Increase staleTime to reduce refetch frequency
staleTime: 60000, // 60 seconds instead of 30
```

#### Issue 3: Network Mismatch
**Symptom**: No data despite transactions existing
**Cause**: Wrong network selected
**Fix**: Verify `getStoredNetworkKey()` returns correct network

#### Issue 4: Tab Not Rendering
**Symptom**: Tab exists but content is blank
**Cause**: TabsContent not showing
**Fix**: Check if `activeTab` state matches tab value

#### Issue 5: DataTable Not Rendering
**Symptom**: Data exists but table is empty
**Cause**: Column definitions or data format issue
**Fix**: Verify data structure matches column accessors

## Quick Fixes to Try

### Fix 1: Add Error Boundaries

```jsx
// Wrap tabs in error boundary
<ErrorBoundary fallback={<div>Error loading tab</div>}>
  <TransactionsTab bondingCurveAddress={bc} seasonId={seasonId} />
</ErrorBoundary>
```

### Fix 2: Add Loading States

```jsx
// In TransactionsTab.jsx
if (isLoading) {
  return <div className="p-4">Loading transactions...</div>;
}

if (error) {
  return <div className="p-4 text-red-600">Error: {error.message}</div>;
}

if (!transactions || transactions.length === 0) {
  return <div className="p-4 text-muted-foreground">No transactions found</div>;
}
```

### Fix 3: Verify Tab Component

```jsx
// Check if Tabs component is working
<Tabs value={activeTab} onValueChange={setActiveTab}>
  <TabsList>
    <TabsTrigger value="token-info">Token Info</TabsTrigger>
    <TabsTrigger value="transactions">Transactions</TabsTrigger>
    <TabsTrigger value="holders">Holders</TabsTrigger>
  </TabsList>
  <TabsContent value="token-info">
    <div>Token Info Content</div>
  </TabsContent>
  <TabsContent value="transactions">
    <div>Transactions Content</div>
  </TabsContent>
  <TabsContent value="holders">
    <div>Holders Content</div>
  </TabsContent>
</Tabs>
```

### Fix 4: Check if bondingCurveAddress is Valid

```javascript
// In RaffleDetails.jsx, before rendering tabs
if (!bc || bc === '0x0000000000000000000000000000000000000000') {
  return <div>Invalid bonding curve address</div>;
}
```

## Implementation Fix

### Step 1: Add Debug Logging

```javascript
// In TransactionsTab.jsx, after line 21
useEffect(() => {
  console.log('[TransactionsTab] Data:', {
    bondingCurveAddress,
    seasonId,
    transactions,
    isLoading,
    error
  });
}, [bondingCurveAddress, seasonId, transactions, isLoading, error]);
```

### Step 2: Add Fallback UI

```javascript
// In TransactionsTab.jsx, before return statement
if (isLoading) {
  return (
    <div className="flex items-center justify-center p-8">
      <div className="text-muted-foreground">Loading transactions...</div>
    </div>
  );
}

if (error) {
  return (
    <div className="p-4 border border-red-200 rounded-md bg-red-50">
      <p className="text-red-600 font-medium">Error loading transactions</p>
      <p className="text-sm text-red-500 mt-1">{error.message}</p>
    </div>
  );
}

if (!transactions || transactions.length === 0) {
  return (
    <div className="flex items-center justify-center p-8">
      <div className="text-center">
        <p className="text-muted-foreground">No transactions found</p>
        <p className="text-sm text-muted-foreground mt-1">
          Transactions will appear here once users start trading
        </p>
      </div>
    </div>
  );
}
```

### Step 3: Verify Event ABI Matches Contract

```javascript
// Check if contract emits this exact event
event PositionUpdate(
  uint256 indexed seasonId,
  address indexed player,
  uint256 oldTickets,
  uint256 newTickets,
  uint256 totalTickets,
  uint256 probabilityBps
)

// If contract has different event signature, update parseAbiItem()
```

## Testing Checklist

- [ ] Open browser DevTools console
- [ ] Check for JavaScript errors
- [ ] Verify network requests in Network tab
- [ ] Check if bondingCurveAddress is valid
- [ ] Verify seasonId is correct
- [ ] Check if PositionUpdate events exist on-chain
- [ ] Verify RPC endpoint is responding
- [ ] Check React Query DevTools for query status
- [ ] Test with different seasons
- [ ] Test after a transaction occurs

## Expected Behavior

### Transactions Tab Should Show:
- List of all buy/sell transactions
- Player addresses
- Ticket deltas (+100, -50, etc.)
- Timestamps
- Transaction hashes with explorer links

### Holders Tab Should Show:
- List of all current ticket holders
- Ticket counts
- Win probabilities
- Rankings
- Last update times

## Next Steps

1. **Add Debug Logging** - See what data is being returned
2. **Check Console** - Look for errors
3. **Verify Events** - Ensure PositionUpdate events exist
4. **Add Fallback UI** - Show loading/error/empty states
5. **Test with Known Data** - Use a season with confirmed transactions

---

*Debug guide created: 2025-10-03*
*Check browser console first, then verify data flow*
