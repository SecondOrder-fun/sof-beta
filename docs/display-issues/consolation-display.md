# Consolation Display Fix - "Waiting for participants..." Issue

## 🐛 Problem

**Symptom**: Consolation display shows "Waiting for participants..." even when participants exist.

**Display**: 
```
Consolation Per User (35% ÷ ?)
Waiting for participants...
```

## 🔍 Root Cause

**File**: `src/components/curve/TokenInfoTab.jsx` (line 60)

The component was trying to read `totalParticipants` from the **bonding curve contract**, but this data doesn't exist there. The `totalParticipants` is tracked in the **Raffle contract**, not the bonding curve.

**Wrong approach**:
```javascript
// Trying to read from bonding curve (WRONG)
client.readContract({
  address: bondingCurveAddress,
  abi,
  functionName: 'totalParticipants',  // ❌ Doesn't exist on bonding curve
  args: []
})
```

## ✅ Solution

**Fixed approach**: Get the raffle address and season ID from the bonding curve, then query the raffle contract for participant count.

### Step 1: Get Raffle Address and Season ID
```javascript
const [tokenAddr, raffleAddr, seasonId] = await Promise.all([
  client.readContract({
    address: bondingCurveAddress,
    abi: curveAbi,
    functionName: 'raffleToken',
    args: []
  }),
  client.readContract({
    address: bondingCurveAddress,
    abi: curveAbi,
    functionName: 'raffle',  // ✅ Get raffle contract address
    args: []
  }),
  client.readContract({
    address: bondingCurveAddress,
    abi: curveAbi,
    functionName: 'seasonId',  // ✅ Get season ID
    args: []
  })
]);
```

### Step 2: Query Raffle Contract
```javascript
const raffleAbi = [
  {
    type: 'function',
    name: 'getSeasonDetails',
    stateMutability: 'view',
    inputs: [{ name: 'seasonId', type: 'uint256' }],
    outputs: [
      { name: 'config', type: 'tuple', components: [] },
      { name: 'status', type: 'uint8' },
      { name: 'totalParticipants', type: 'uint256' },  // ✅ Here it is!
      { name: 'totalTickets', type: 'uint256' },
      { name: 'totalPrizePool', type: 'uint256' }
    ]
  }
];

const details = await client.readContract({
  address: raffleAddr,
  abi: raffleAbi,
  functionName: 'getSeasonDetails',
  args: [seasonId]
});

// details is a tuple: [config, status, totalParticipants, totalTickets, totalPrizePool]
participants = details[2]; // totalParticipants is at index 2
```

## 📊 Data Flow

```
TokenInfoTab
    ↓
1. Query BondingCurve.raffle() → Get raffle address
2. Query BondingCurve.seasonId() → Get season ID
    ↓
3. Query Raffle.getSeasonDetails(seasonId) → Get totalParticipants
    ↓
4. Calculate: consolationPerUser = consolationPool / (totalParticipants - 1)
    ↓
5. Display: "Consolation Per User (35% ÷ N)"
```

## 🧪 Testing

### Verify the Fix
1. Open raffle page
2. Navigate to "Token Info" tab
3. Check consolation display

**Expected**:
```
Consolation Per User (35% ÷ 3)
125.5000 SOF
```

**Before Fix**:
```
Consolation Per User (35% ÷ ?)
Waiting for participants...
```

### Debug if Still Broken
```javascript
// Add to browser console
const curve = '0x...'; // bonding curve address
const client = ... // create viem client

// Check if bonding curve has raffle address
const raffle = await client.readContract({
  address: curve,
  abi: [{ type: 'function', name: 'raffle', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'address' }] }],
  functionName: 'raffle'
});
console.log('Raffle address:', raffle);

// Check if bonding curve has seasonId
const seasonId = await client.readContract({
  address: curve,
  abi: [{ type: 'function', name: 'seasonId', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] }],
  functionName: 'seasonId'
});
console.log('Season ID:', seasonId);

// Check raffle for participants
const details = await client.readContract({
  address: raffle,
  abi: [{ type: 'function', name: 'getSeasonDetails', ... }],
  functionName: 'getSeasonDetails',
  args: [seasonId]
});
console.log('Total participants:', details[2]);
```

## 📝 Files Modified

**File**: `src/components/curve/TokenInfoTab.jsx`
- **Lines 24-121**: Updated `useEffect` to query raffle contract for participants
- **Added**: Error logging for debugging
- **Fixed**: Correct data source for `totalParticipants`

## ✅ Verification Checklist

- [ ] Consolation display shows participant count
- [ ] Per-user amount calculates correctly
- [ ] No "Waiting for participants..." when participants exist
- [ ] Console shows no errors
- [ ] Works with 1 participant (shows "?")
- [ ] Works with 2+ participants (shows count)

## 🔗 Related Issues

- **Consolation System**: See `CONSOLATION_IMPLEMENTATION_COMPLETE.md`
- **Prize Distribution**: Implemented in `RafflePrizeDistributor.sol`
- **Raffle State**: Tracked in `RaffleStorage.sol`

---

*Fix implemented: 2025-10-03*
*Consolation display now shows correct participant count ✅*
