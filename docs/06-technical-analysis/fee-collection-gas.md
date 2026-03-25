# Fee Collection Gas Cost Analysis

## Executive Summary

Adding treasury fee collection to the bonding curve will add approximately **15,000-20,000 gas** per buy/sell transaction, representing a **3-5% increase** in total transaction costs.

## Current Gas Costs (Estimated)

### buyTokens() Function

| Operation | Estimated Gas | Notes |
|-----------|--------------|-------|
| Function entry + checks | 2,000 | Basic validation |
| Price calculation | 5,000-10,000 | Depends on step count |
| SafeTransferFrom (SOF) | 50,000 | ERC20 transfer from user |
| Mint raffle tokens | 45,000 | ERC20 mint operation |
| State updates | 20,000 | Multiple SSTORE operations |
| Event emissions | 5,000 | Multiple events |
| Raffle callback | 10,000-30,000 | If raffle != address(0) |
| Position tracker | 5,000-15,000 | If positionTracker != address(0) |
| InfoFi factory | 0-50,000 | Only if crossing 1% threshold |
| **Total (typical)** | **~150,000-200,000** | Without InfoFi trigger |

### sellTokens() Function

| Operation | Estimated Gas | Notes |
|-----------|--------------|-------|
| Function entry + checks | 2,000 | Basic validation |
| Price calculation | 5,000-10,000 | Depends on step count |
| Burn raffle tokens | 30,000 | ERC20 burn operation |
| SafeTransfer (SOF) | 30,000 | ERC20 transfer to user |
| State updates | 20,000 | Multiple SSTORE operations |
| Event emissions | 5,000 | Multiple events |
| Raffle callback | 10,000-30,000 | If raffle != address(0) |
| Position tracker | 5,000-15,000 | If positionTracker != address(0) |
| **Total (typical)** | **~110,000-150,000** | Standard sell operation |

## Proposed Fee Collection Addition

### New Operation: collectFees() Call

```solidity
// In SOFToken.collectFees():
function collectFees(uint256 amount) external onlyRole(FEE_COLLECTOR_ROLE) nonReentrant {
    require(amount > 0, "Amount must be greater than 0");
    require(balanceOf(msg.sender) >= amount, "Insufficient balance");
    
    _transfer(msg.sender, address(this), amount);
    totalFeesCollected += amount;
    
    emit FeesCollected(msg.sender, amount);
}
```

### Gas Breakdown for collectFees()

| Operation | Estimated Gas | Notes |
|-----------|--------------|-------|
| External call overhead | 2,600 | CALL opcode base cost |
| Role check (AccessControl) | 2,400 | SLOAD + comparison |
| ReentrancyGuard check | 2,100 | SLOAD + SSTORE |
| require statements (2x) | 400 | Validation checks |
| balanceOf() internal call | 2,100 | SLOAD from mapping |
| _transfer() internal | 5,000 | Two SSTORE operations |
| totalFeesCollected += | 5,000 | SLOAD + SSTORE (warm) |
| Event emission | 1,500 | LOG operation |
| ReentrancyGuard reset | 2,900 | SSTORE (refund partial) |
| **Total** | **~15,000-20,000** | Per collectFees() call |

### Additional Considerations

**Warm vs Cold Storage:**
- First call to SOFToken in a transaction: +2,100 gas (cold SLOAD)
- Subsequent calls: Already warm, no additional cost
- Our case: First call per transaction, so +2,100 gas

**Role Check Optimization:**
- AccessControl caches role checks
- After first grant, subsequent checks are cheaper
- Estimated: 2,400 gas (warm storage)

**ReentrancyGuard:**
- First entry: 20,000 gas (cold SSTORE)
- Reset: 2,900 gas (warm SSTORE with refund)
- Net cost: ~17,100 gas, but we're already using it in buyTokens/sellTokens
- Additional cost: Just the SOFToken's guard, ~2,100 gas

## Total Impact

### buyTokens() with Fee Collection

| Scenario | Current Gas | With collectFees() | Increase | % Increase |
|----------|-------------|-------------------|----------|------------|
| Typical buy | 150,000 | 167,000 | +17,000 | +11.3% |
| Buy with raffle callback | 180,000 | 197,000 | +17,000 | +9.4% |
| Buy crossing 1% threshold | 230,000 | 247,000 | +17,000 | +7.4% |

### sellTokens() with Fee Collection

| Scenario | Current Gas | With collectFees() | Increase | % Increase |
|----------|-------------|-------------------|----------|------------|
| Typical sell | 110,000 | 127,000 | +17,000 | +15.5% |
| Sell with raffle callback | 140,000 | 157,000 | +17,000 | +12.1% |

## Optimization Opportunities

### 1. Batch Fee Collection (Recommended)

Instead of calling `collectFees()` on every transaction, accumulate fees and collect periodically:

```solidity
uint256 public accumulatedFees;

function buyTokens(...) {
    // ... existing logic ...
    accumulatedFees += fee;
    
    // Collect when threshold reached
    if (accumulatedFees >= FEE_COLLECTION_THRESHOLD) {
        sofToken.collectFees(accumulatedFees);
        accumulatedFees = 0;
    }
}
```

**Gas Savings:**
- Only pay 17,000 gas once per N transactions
- Amortized cost: 17,000 / N
- Example: If N=10, cost per transaction = 1,700 gas (90% reduction)

**Trade-offs:**
- Fees not immediately available in treasury
- Requires additional state variable (5,000 gas for first write)
- Need to handle edge cases (season end, emergency extraction)

### 2. Direct Transfer (Alternative Approach)

Skip the `collectFees()` function and transfer directly:

```solidity
function buyTokens(...) {
    // ... existing logic ...
    sofToken.safeTransfer(treasuryAddress, fee);
}
```

**Gas Comparison:**
- Direct transfer: ~30,000 gas (ERC20 transfer)
- collectFees(): ~17,000 gas
- **Verdict:** collectFees() is actually cheaper due to internal _transfer()

### 3. Fee Accumulation Only (Simplest)

Don't call collectFees() during transactions. Add separate extraction function:

```solidity
function extractAccumulatedFees() external onlyRole(RAFFLE_MANAGER_ROLE) {
    uint256 availableFees = sofToken.balanceOf(address(this)) - curveConfig.sofReserves;
    if (availableFees > 0) {
        sofToken.collectFees(availableFees);
    }
}
```

**Gas Impact:**
- **Zero additional gas** on buy/sell transactions
- Manual extraction when needed (admin operation)
- Fees available but not in treasury system until extracted

**Recommended for MVP** ✅

## Recommendation: Hybrid Approach

### Phase 1: MVP (Zero Gas Overhead)

1. **Don't call collectFees() during transactions**
2. **Add extractAccumulatedFees() function** for manual collection
3. **Call it at season end** or when fees reach threshold
4. **Zero impact on user transactions**

### Phase 2: Automated Collection (Post-Launch)

1. **Implement batch collection** with threshold (e.g., 10,000 SOF)
2. **Amortize gas costs** across multiple transactions
3. **Monitor gas prices** and adjust threshold dynamically

### Phase 3: Optimized (If Needed)

1. **Custom fee collection contract** with optimized storage
2. **Merkle tree claims** for gas-efficient distribution
3. **Layer 2 aggregation** if on mainnet

## Implementation Plan

### Step 1: Add Fee Tracking (No Gas Impact)

```solidity
// In SOFBondingCurve
uint256 public accumulatedFees;

function buyTokens(...) {
    // ... existing logic ...
    uint256 fee = (baseCost * curveConfig.buyFee) / 10000;
    accumulatedFees += fee; // Just track, don't collect yet
    // ... rest of function ...
}
```

**Gas Cost:** +5,000 gas first time (cold SSTORE), +100 gas subsequent (warm SSTORE)

### Step 2: Add Manual Extraction

```solidity
function extractFeesToTreasury() external onlyRole(RAFFLE_MANAGER_ROLE) nonReentrant {
    require(accumulatedFees > 0, "No fees to extract");
    
    // Transfer fees to SOFToken treasury system
    sofToken.approve(address(sofToken), accumulatedFees);
    sofToken.collectFees(accumulatedFees);
    
    accumulatedFees = 0;
    
    emit FeesExtracted(address(sofToken), accumulatedFees);
}
```

**Gas Cost:** ~50,000 gas (admin operation, not user-facing)

### Step 3: Season-End Automation

```solidity
// In Raffle.fulfillRandomWords() or similar
function _finalizeSeasonFees(uint256 seasonId) internal {
    address curve = seasons[seasonId].bondingCurve;
    if (curve != address(0)) {
        try SOFBondingCurve(curve).extractFeesToTreasury() {
            // Fees extracted successfully
        } catch {
            // Log error but don't revert season finalization
        }
    }
}
```

**Gas Cost:** Included in season finalization (one-time cost)

## Final Recommendation

**For MVP Launch:**
- ✅ Implement fee tracking (+100 gas per transaction)
- ✅ Add manual extraction function (admin-only)
- ✅ Extract fees at season end automatically
- ✅ **Total user-facing gas increase: ~100-200 gas (<0.1%)**

**Post-Launch Optimization:**
- Consider batch collection if manual extraction becomes burdensome
- Monitor treasury balance and automate distribution
- Evaluate Layer 2 or custom solutions if gas costs become prohibitive

## Conclusion

The recommended hybrid approach adds **negligible gas costs** (~100 gas, <0.1% increase) to user transactions while maintaining full treasury system functionality. Fees are extracted at season end or manually by admins, keeping user experience optimal while enabling proper revenue management.
