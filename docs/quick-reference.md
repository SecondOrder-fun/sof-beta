# Quick Fix Reference - SecondOrder.fun

## 🚀 What Was Fixed Today

### ✅ Consolation Prize System
**File**: `contracts/src/core/RafflePrizeDistributor.sol`
- Removed Merkle proofs
- Added simple equal distribution
- Formula: `consolationAmount / (totalParticipants - 1)`
- **Test**: `forge test --match-contract ConsolationClaims` ✅

### ✅ Win Odds Display  
**File**: `src/hooks/useRaffleHolders.js` (lines 119-131)
- All players' odds now update when anyone trades
- Recalculates: `(tickets * 10000) / totalTickets`
- **Test**: `npm test tests/hooks/useRaffleHolders.probability.test.jsx`

### ✅ InfoFi Odds Bug
**File**: `src/components/infofi/InfoFiMarketCard.jsx` (lines 39-59, 202-207)
- Clamps odds to 0-100%
- Shows 1 decimal precision
- Validates all probability data

---

## 🐛 Known Issues

### ⚠️ Transactions & Holders Tabs Not Displaying
**Debug Steps**:
1. Open browser DevTools (F12)
2. Check console for errors
3. Verify `bondingCurveAddress` is valid
4. Check if `PositionUpdate` events exist

**Quick Fix**:
```javascript
// Add to TransactionsTab.jsx after line 21
console.log('Debug:', { bondingCurveAddress, seasonId, transactions, isLoading, error });
```

**See**: `TABS_DISPLAY_ISSUE_DEBUG.md`

---

## 🧪 Testing Commands

### Smart Contracts
```bash
cd contracts

# All tests
forge test

# Consolation only
forge test --match-contract ConsolationClaims -vv

# E2E flow
forge script script/EndToEndResolveAndClaim.s.sol --rpc-url $RPC_URL --private-key $PRIVATE_KEY --broadcast
```

### Frontend
```bash
# All tests
npm test

# Odds display test
npm test tests/hooks/useRaffleHolders.probability.test.jsx

# Run dev server
npm run dev
```

---

## 📁 Key Files Modified

### Smart Contracts (6 files)
- `contracts/src/core/RafflePrizeDistributor.sol` ⭐
- `contracts/src/lib/IRafflePrizeDistributor.sol`
- `contracts/src/core/Raffle.sol`
- `contracts/test/ConsolationClaims.t.sol` (NEW)
- `contracts/test/PrizeSponsorship.t.sol`
- `contracts/script/EndToEndResolveAndClaim.s.sol`

### Frontend (3 files)
- `src/hooks/useRaffleHolders.js` ⭐
- `src/components/infofi/InfoFiMarketCard.jsx` ⭐
- `src/services/onchainRaffleDistributor.js`

---

## 📚 Documentation

### Implementation Guides
- `CONSOLATION_IMPLEMENTATION_COMPLETE.md` - Full consolation system
- `ODDS_DISPLAY_FIX_COMPLETE.md` - Odds display fix
- `INFOFI_ODDS_BUG_FIX.md` - InfoFi odds bug details

### Debug Guides
- `TABS_DISPLAY_ISSUE_DEBUG.md` - Tabs not showing
- `SESSION_SUMMARY_2025-10-03_EVENING.md` - Complete session summary

---

## 🔍 Quick Diagnostics

### Check Consolation System
```bash
# Verify contract compiles
forge build

# Run consolation tests
forge test --match-contract ConsolationClaims -vv

# Check if function exists
forge inspect RafflePrizeDistributor methods | grep claimConsolation
```

### Check Odds Display
```javascript
// Add to browser console on raffle page
const holders = await fetch('/api/holders/...').then(r => r.json());
const totalProb = holders.reduce((sum, h) => sum + h.winProbabilityBps, 0);
console.log('Total probability:', totalProb, '(should be ~10000)');
```

### Check InfoFi Odds
```javascript
// Add to browser console on markets page
// Look for this error in console:
// "[InfoFi] Invalid probability data: { ... }"
// If you see it, the oracle is returning bad data
```

---

## 🚨 Emergency Rollback

If something breaks:

### Revert Consolation Changes
```bash
git diff HEAD contracts/src/core/RafflePrizeDistributor.sol
git checkout HEAD -- contracts/src/core/RafflePrizeDistributor.sol
git checkout HEAD -- contracts/src/lib/IRafflePrizeDistributor.sol
git checkout HEAD -- contracts/src/core/Raffle.sol
```

### Revert Odds Display Fix
```bash
git checkout HEAD -- src/hooks/useRaffleHolders.js
```

### Revert InfoFi Odds Fix
```bash
git checkout HEAD -- src/components/infofi/InfoFiMarketCard.jsx
```

---

## ✅ Verification Checklist

### Before Deploying
- [ ] All tests pass: `forge test` and `npm test`
- [ ] Consolation claims work in E2E test
- [ ] All players' odds update correctly
- [ ] InfoFi odds show 0-100% range
- [ ] Tabs display correctly (debug if needed)
- [ ] No console errors in browser
- [ ] Gas costs acceptable

### After Deploying
- [ ] Verify contracts on explorer
- [ ] Update frontend ABIs
- [ ] Test consolation claim on testnet
- [ ] Verify odds update in real-time
- [ ] Check InfoFi markets display correctly
- [ ] Monitor for errors

---

## 📞 Need Help?

### Consolation Issues
→ See `CONSOLATION_IMPLEMENTATION_COMPLETE.md`

### Odds Display Issues  
→ See `ODDS_DISPLAY_FIX_COMPLETE.md`

### InfoFi Odds Issues
→ See `INFOFI_ODDS_BUG_FIX.md`

### Tabs Not Showing
→ See `TABS_DISPLAY_ISSUE_DEBUG.md`

### Full Session Details
→ See `SESSION_SUMMARY_2025-10-03_EVENING.md`

---

*Quick reference created: 2025-10-03*
*All fixes tested and documented ✅*
