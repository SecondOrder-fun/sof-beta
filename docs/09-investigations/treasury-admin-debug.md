# Treasury Admin Panel Debug Summary

## Date

2025-10-02

## Issues Found and Fixed

### 1. ABIs Not Updated After Contract Changes

**Problem:** The frontend ABIs in `src/contracts/abis/` were outdated and didn't include the new treasury functions (`accumulatedFees`, `extractFeesToTreasury`, `getContractBalance`, `transferToTreasury`).

**Root Cause:** Contracts were modified to add treasury functionality, but ABIs weren't recompiled and copied to the frontend.

**Solution:**
```bash
cd contracts && forge build --force
node scripts/copy-abis.js
```

**Verification:**
```bash
# Verify functions exist in ABIs
cat src/contracts/abis/SOFBondingCurve.json | jq '.[] | select(.name == "accumulatedFees")'
cat src/contracts/abis/SOFBondingCurve.json | jq '.[] | select(.name == "extractFeesToTreasury")'
cat src/contracts/abis/SOFToken.json | jq '.[] | select(.name == "getContractBalance")'
cat src/contracts/abis/SOFToken.json | jq '.[] | select(.name == "transferToTreasury")'
```

### 2. Incorrect Role Hashes in useTreasury Hook

**Problem:** The role hashes used to check user permissions were incorrect placeholder values:
- Used: `0x0e2f3d9db2c3c6e6f3e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5`
- This was the same for both `RAFFLE_MANAGER_ROLE` and `TREASURY_ROLE`

**Root Cause:** Placeholder values were never replaced with actual keccak256 hashes.

**Solution:** Updated `src/hooks/useTreasury.js` with correct role hashes:
- `RAFFLE_MANAGER_ROLE`: `0x03b4459c543e7fe245e8e148c6cab46a28e66bba7ee09988335c0dc88457fac2`
- `TREASURY_ROLE`: `0xe1dcbdb91df27212a29bc27177c840cf2f819ecf2187432e1fac86c2dd5dfca9`

**Calculation:**
```bash
cast keccak "RAFFLE_MANAGER_ROLE"
# 0x03b4459c543e7fe245e8e148c6cab46a28e66bba7ee09988335c0dc88457fac2

cast keccak "TREASURY_ROLE"
# 0xe1dcbdb91df27212a29bc27177c840cf2f819ecf2187432e1fac86c2dd5dfca9
```

### 3. Incorrect ABI Import Paths

**Problem:** The `useTreasury.js` hook was importing ABIs from `@/abis/` instead of `@/contracts/abis/`.

**Root Cause:** Incorrect import paths that didn't match the actual file structure.

**Solution:** Updated imports in `src/hooks/useTreasury.js`:
```javascript
// Before
import SOFTokenAbi from '@/abis/SOFToken.json';
import SOFBondingCurveAbi from '@/abis/SOFBondingCurve.json';

// After
import SOFTokenAbi from '@/contracts/abis/SOFToken.json';
import SOFBondingCurveAbi from '@/contracts/abis/SOFBondingCurve.json';
```

## Files Modified

1. **src/hooks/useTreasury.js**
   - Fixed ABI import paths
   - Updated role hashes for permission checks

## Testing Checklist

### Smart Contract Level

- [ ] Deploy contracts to local Anvil
- [ ] Verify `accumulatedFees` is accessible on bonding curve
- [ ] Verify `extractFeesToTreasury()` can be called by admin
- [ ] Verify `getContractBalance()` returns correct value
- [ ] Verify `transferToTreasury()` can be called by treasury role

### Frontend Level

- [ ] Treasury controls component renders without errors
- [ ] Fee statistics display correctly (Accumulated Fees, Treasury Balance, Total Collected)
- [ ] Extract fees button is enabled when fees > 0 and user has manager role
- [ ] Transfer to treasury button is enabled when balance > 0 and user has treasury role
- [ ] Extract fees transaction succeeds
- [ ] Transfer to treasury transaction succeeds
- [ ] Balances update after transactions

### Integration Test

- [ ] Run full E2E flow: Deploy → Create Season → Buy Tickets → Extract Fees → Transfer to Treasury
- [ ] Verify fees accumulate during buy/sell operations
- [ ] Verify extracted fees show up in SOF token contract balance
- [ ] Verify transferred fees arrive at treasury address

## Next Steps

1. **Start Development Server:** Test that frontend loads without errors
2. **Deploy to Local Anvil:** Run full E2E test with treasury operations
3. **Add Unit Tests:** Create tests for treasury functionality
4. **Update Documentation:** Add treasury admin panel usage guide

## Related Files

- `src/components/admin/TreasuryControls.jsx` - Treasury admin UI component
- `src/hooks/useTreasury.js` - Treasury management hook (FIXED)
- `contracts/src/curve/SOFBondingCurve.sol` - Bonding curve with fee tracking
- `contracts/src/token/SOFToken.sol` - SOF token with treasury functions
- `TREASURY_IMPLEMENTATION_SUMMARY.md` - Original implementation documentation

## Commands for Testing

### Compile and Copy ABIs
```bash
cd contracts && forge build --force
cd .. && node scripts/copy-abis.js
```

### Start Frontend
```bash
npm run dev
```

### Deploy to Local Anvil
```bash
# Terminal 1: Start Anvil
anvil --gas-limit 30000000

# Terminal 2: Deploy contracts
cd contracts
forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:8545 --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 --broadcast

# Update env and copy ABIs
cd ..
node scripts/update-env-addresses.js
node scripts/copy-abis.js
```

### Test Treasury Flow
```bash
# Create season
export $(cat .env | xargs)
cd contracts
forge script script/CreateSeason.s.sol --rpc-url $RPC_URL --private-key $PRIVATE_KEY --broadcast

# Wait and start season
sleep 61
cast send $RAFFLE_ADDRESS "startSeason(uint256)" 1 --rpc-url $RPC_URL --private-key $PRIVATE_KEY

# Buy tickets (generates fees)
export CURVE_ADDRESS=<from_logs>
cast send $SOF_ADDRESS "approve(address,uint256)" $CURVE_ADDRESS 0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff --rpc-url $RPC_URL --private-key $PRIVATE_KEY
cast send $CURVE_ADDRESS "buyTokens(uint256,uint256)" 2000 3500000000000000000000 --rpc-url $RPC_URL --private-key $PRIVATE_KEY

# Check accumulated fees
cast call $CURVE_ADDRESS "accumulatedFees()" --rpc-url $RPC_URL

# Extract fees (requires RAFFLE_MANAGER_ROLE)
cast send $CURVE_ADDRESS "extractFeesToTreasury()" --rpc-url $RPC_URL --private-key $PRIVATE_KEY

# Check SOF token contract balance
cast call $SOF_ADDRESS "getContractBalance()" --rpc-url $RPC_URL

# Transfer to treasury (requires TREASURY_ROLE)
cast send $SOF_ADDRESS "transferToTreasury(uint256)" 1000000000000000000 --rpc-url $RPC_URL --private-key $PRIVATE_KEY

# Check treasury balance
cast call $SOF_ADDRESS "balanceOf(address)" $ACCOUNT0_ADDRESS --rpc-url $RPC_URL
```

### 4. Missing Separator Component

**Problem:** The `TreasuryControls` component imported a `Separator` component that didn't exist.

**Root Cause:** The separator UI component was never added to the project.

**Solution:** 
1. Created `src/components/ui/separator.jsx` using Radix UI pattern
2. Installed `@radix-ui/react-separator` package
3. Fixed import path to use standard format (without `.jsx` extension)

### 5. Incorrect Contract Address References

**Problem:** The `useTreasury` hook was using lowercase property names (`contracts.sofToken`, `contracts.raffle`) instead of uppercase (`contracts.SOF`, `contracts.RAFFLE`).

**Root Cause:** The `contracts` object was being imported incorrectly and property names didn't match the actual exported structure.

**Solution:** 
1. Changed import from `{ contracts }` to `{ getContractAddresses }`
2. Added `getStoredNetworkKey()` to get current network
3. Updated all contract references to use uppercase keys (SOF, RAFFLE)

## Files Modified Summary

1. **src/hooks/useTreasury.js**
   - Fixed ABI import paths (`@/contracts/abis/` instead of `@/abis/`)
   - Updated role hashes for permission checks
   - Changed contract import to use `getContractAddresses()`
   - Updated all contract references to uppercase keys

2. **src/components/ui/separator.jsx** (NEW)
   - Created Radix UI separator component

3. **package.json**
   - Added `@radix-ui/react-separator` dependency

## Conclusion

The Treasury Admin Panel implementation was complete, but had **five critical bugs** preventing it from working:

1. ✅ **Outdated ABIs** - Fixed by recompiling contracts and copying ABIs
2. ✅ **Incorrect role hashes** - Fixed by using proper keccak256 hashes
3. ✅ **Wrong ABI import paths** - Fixed by correcting paths to `@/contracts/abis/`
4. ✅ **Missing Separator component** - Fixed by creating the component and installing dependency
5. ✅ **Incorrect contract references** - Fixed by using `getContractAddresses()` and uppercase keys

**All fixes have been applied and the build succeeds.** The treasury system should now work correctly in the admin panel.
