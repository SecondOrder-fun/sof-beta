# SecondOrder.fun Treasury System Documentation

## Overview

The SecondOrder.fun platform implements a **two-stage fee collection and treasury management system** designed to centralize platform revenue collection and enable flexible distribution to stakeholders.

## Architecture

### System Components

```
┌─────────────────────────────────────────────────────────────┐
│                     Platform Operations                      │
├─────────────────────────────────────────────────────────────┤
│  SOFBondingCurve  │  InfoFiMarket  │  Future Contracts     │
│  (buy/sell fees)  │  (trading fees)│  (other revenue)      │
└────────┬──────────┴────────┬────────┴────────┬──────────────┘
         │                   │                  │
         │ accumulatedFees   │ accumulatedFees  │
         ▼                   ▼                  ▼
┌─────────────────────────────────────────────────────────────┐
│              Manual/Automated Fee Extraction                 │
│              extractFeesToTreasury()                         │
└────────┬────────────────────────────────────────────────────┘
         │ collectFees(amount)
         ▼
┌─────────────────────────────────────────────────────────────┐
│                      SOFToken Contract                       │
│              (Central Fee Aggregation Point)                 │
│                                                              │
│  • Accumulates fees from all platform contracts             │
│  • Tracks totalFeesCollected globally                       │
│  • Provides getContractBalance() for monitoring             │
└────────┬────────────────────────────────────────────────────┘
         │ transferToTreasury(amount)
         ▼
┌─────────────────────────────────────────────────────────────┐
│                    Treasury Address                          │
│              (Multisig, DAO, or EOA)                        │
│                                                              │
│  • Receives distributed fees                                │
│  • Manages platform reserves                                │
│  • Funds operations, development, rewards                   │
└─────────────────────────────────────────────────────────────┘
```

## Smart Contract Reference

### SOFToken.sol

The central hub for fee management.

#### State Variables

```solidity
uint256 public totalFeesCollected;  // Cumulative fees ever collected
address public treasuryAddress;     // Destination for fee distribution
```

#### Access Control Roles

```solidity
bytes32 public constant FEE_COLLECTOR_ROLE = keccak256("FEE_COLLECTOR_ROLE");
bytes32 public constant TREASURY_ROLE = keccak256("TREASURY_ROLE");
```

**Role Assignments:**
- `FEE_COLLECTOR_ROLE`: Granted to bonding curves and other fee-generating contracts
- `TREASURY_ROLE`: Granted to treasury managers (initially deployer, later multisig/DAO)
- `DEFAULT_ADMIN_ROLE`: Granted to deployer, can manage roles and treasury address

#### Core Functions

##### collectFees()

```solidity
function collectFees(uint256 amount) 
    external 
    onlyRole(FEE_COLLECTOR_ROLE) 
    nonReentrant 
```

**Purpose:** Pull fees from platform contracts into SOFToken for aggregation

**Called by:** Bonding curves, markets, or other contracts with FEE_COLLECTOR_ROLE

**Gas Cost:** ~15,000-20,000 gas

**Process:**
1. Validates caller has FEE_COLLECTOR_ROLE
2. Checks caller has sufficient balance
3. Transfers amount from caller to SOFToken contract
4. Increments totalFeesCollected counter
5. Emits FeesCollected event

##### transferToTreasury()

```solidity
function transferToTreasury(uint256 amount) 
    external 
    onlyRole(TREASURY_ROLE) 
    nonReentrant
```

**Purpose:** Distribute accumulated fees to treasury address

**Called by:** Treasury managers (manual or automated)

**Gas Cost:** ~30,000 gas

**Process:**
1. Validates caller has TREASURY_ROLE
2. Checks SOFToken contract has sufficient balance
3. Transfers amount to treasuryAddress
4. Emits TreasuryTransfer event

##### setTreasuryAddress()

```solidity
function setTreasuryAddress(address newTreasury) 
    external 
    onlyRole(DEFAULT_ADMIN_ROLE)
```

**Purpose:** Update treasury destination address

**Called by:** Admin (for migration to multisig/DAO)

**Gas Cost:** ~25,000 gas

**Process:**
1. Validates new address is not zero
2. Updates treasuryAddress
3. Emits TreasuryUpdated event

##### getContractBalance()

```solidity
function getContractBalance() external view returns (uint256)
```

**Purpose:** View accumulated fees available for distribution

**Returns:** SOF balance of the SOFToken contract itself

**Gas Cost:** ~2,000 gas (view function)

### SOFBondingCurve.sol

Fee generation and tracking at the bonding curve level.

#### State Variables

```solidity
uint256 public accumulatedFees;  // Fees collected but not yet sent to treasury
```

#### Fee Calculation

##### Buy Fees

```solidity
uint256 baseCost = calculateBuyPrice(tokenAmount);
uint256 fee = (baseCost * curveConfig.buyFee) / 10000;
uint256 totalCost = baseCost + fee;

// User pays totalCost, reserves increase by baseCost, fee accumulates
accumulatedFees += fee;
```

**Default Rate:** 0.1% (10 basis points)
**Configurable:** Yes, up to 10% (1000 basis points)

##### Sell Fees

```solidity
uint256 baseReturn = calculateSellPrice(tokenAmount);
uint256 fee = (baseReturn * curveConfig.sellFee) / 10000;
uint256 payout = baseReturn - fee;

// User receives payout, reserves decrease by baseReturn, fee accumulates
accumulatedFees += fee;
```

**Default Rate:** 0.7% (70 basis points)
**Configurable:** Yes, up to 10% (1000 basis points)

#### Fee Extraction

##### extractFeesToTreasury()

```solidity
function extractFeesToTreasury() 
    external 
    onlyRole(RAFFLE_MANAGER_ROLE) 
    nonReentrant
```

**Purpose:** Transfer accumulated fees to SOFToken treasury system

**Called by:** Admins manually or automatically at season end

**Gas Cost:** ~50,000 gas (includes approval + collectFees call)

**Process:**
1. Validates accumulatedFees > 0
2. Approves SOFToken to spend accumulatedFees
3. Calls sofToken.collectFees(accumulatedFees)
4. Resets accumulatedFees to 0
5. Emits FeesExtracted event

## Deployment Configuration

### Initial Setup (Deploy.s.sol)

```solidity
// Deploy SOFToken with treasury set to deployer
SOFToken sof = new SOFToken(
    "SOF Token", 
    "SOF", 
    100_000_000 ether,  // 100M initial supply
    msg.sender           // treasury = deployer (for testing)
);

// Grant roles
// DEFAULT_ADMIN_ROLE → deployer (automatic)
// TREASURY_ROLE → deployer (automatic)
// FEE_COLLECTOR_ROLE → bonding curves (must be granted)
```

### Role Grants for Bonding Curves

```solidity
// After deploying bonding curve
sof.grantRole(sof.FEE_COLLECTOR_ROLE(), address(bondingCurve));
```

### Treasury Migration (Pre-Mainnet)

```solidity
// Update treasury to multisig/DAO
sof.setTreasuryAddress(MULTISIG_ADDRESS);

// Grant TREASURY_ROLE to multisig
sof.grantRole(sof.TREASURY_ROLE(), MULTISIG_ADDRESS);

// Revoke deployer's TREASURY_ROLE (optional, for security)
sof.revokeRole(sof.TREASURY_ROLE(), DEPLOYER_ADDRESS);
```

## Operational Workflows

### Workflow 1: Manual Fee Collection (MVP)

**Frequency:** As needed (weekly, monthly, or at season end)

**Steps:**
1. Admin checks accumulated fees: `bondingCurve.accumulatedFees()`
2. Admin extracts fees: `bondingCurve.extractFeesToTreasury()`
3. Fees now in SOFToken contract: `sofToken.getContractBalance()`
4. Treasury manager distributes: `sofToken.transferToTreasury(amount)`
5. Funds arrive at treasury address

**Gas Cost:** ~80,000 gas total (50k + 30k)

### Workflow 2: Season-End Automation

**Trigger:** Raffle resolution (VRF callback)

**Implementation:**
```solidity
// In Raffle.sol, after winner selection
function _finalizeSeasonFees(uint256 seasonId) internal {
    address curve = seasons[seasonId].bondingCurve;
    if (curve != address(0)) {
        try SOFBondingCurve(curve).extractFeesToTreasury() {
            emit SeasonFeesExtracted(seasonId, curve);
        } catch {
            emit SeasonFeesExtractionFailed(seasonId, curve);
        }
    }
}
```

**Benefits:**
- Automatic fee extraction at natural checkpoint
- No manual intervention required
- Fees available immediately after season ends

### Workflow 3: Scheduled Distribution

**Frequency:** Weekly/monthly via off-chain automation

**Implementation:**
```javascript
// Cron job or keeper network
async function distributeTreasuryFees() {
    const balance = await sofToken.getContractBalance();
    const threshold = ethers.utils.parseEther("10000"); // 10k SOF minimum
    
    if (balance.gte(threshold)) {
        await sofToken.transferToTreasury(balance);
        console.log(`Distributed ${ethers.utils.formatEther(balance)} SOF to treasury`);
    }
}
```

**Benefits:**
- Predictable treasury inflows
- Batch processing for gas efficiency
- Automated operations

## Fee Distribution Strategies

### Strategy 1: Single Treasury (Simple)

**Configuration:**
- `treasuryAddress` = multisig wallet
- All fees go to one destination
- Multisig decides allocation off-chain

**Pros:**
- Simple implementation
- Flexible allocation
- Low gas costs

**Cons:**
- Manual distribution required
- Less transparent on-chain

### Strategy 2: Multi-Destination Split (Advanced)

**Configuration:**
- `treasuryAddress` = custom distribution contract
- Contract splits fees automatically

**Example:**
```solidity
contract TreasuryDistributor {
    address public operations;
    address public development;
    address public stakingRewards;
    
    function distributeFees(uint256 amount) external {
        uint256 ops = amount * 40 / 100;      // 40% operations
        uint256 dev = amount * 30 / 100;      // 30% development
        uint256 staking = amount * 30 / 100;  // 30% staking
        
        sofToken.transfer(operations, ops);
        sofToken.transfer(development, dev);
        sofToken.transfer(stakingRewards, staking);
    }
}
```

**Pros:**
- Automated allocation
- Transparent on-chain
- Configurable splits

**Cons:**
- Higher gas costs
- More complex implementation
- Requires additional contract

### Strategy 3: Vesting Schedule (Long-term)

**Configuration:**
- `treasuryAddress` = vesting contract
- Fees released over time

**Use Cases:**
- Team compensation
- Long-term reserves
- Gradual market releases

## Monitoring & Analytics

### Key Metrics

#### On-Chain Queries

```solidity
// Total fees ever collected across all contracts
uint256 totalFees = sofToken.totalFeesCollected();

// Fees currently in SOFToken awaiting distribution
uint256 pendingDistribution = sofToken.getContractBalance();

// Fees accumulated in specific bonding curve
uint256 curveAccumulated = bondingCurve.accumulatedFees();

// Current treasury balance
uint256 treasuryBalance = sofToken.balanceOf(treasuryAddress);
```

#### Events for Tracking

```solidity
// Fee collection events
event FeesCollected(address indexed from, uint256 amount);

// Treasury distribution events  
event TreasuryTransfer(address indexed to, uint256 amount);

// Fee extraction from curves
event FeesExtracted(address indexed to, uint256 amount);

// Treasury address updates
event TreasuryUpdated(address indexed oldTreasury, address indexed newTreasury);
```

### Dashboard Metrics

**Revenue Tracking:**
- Total fees collected (all-time)
- Fees collected per season
- Fees collected per day/week/month
- Average fee per transaction

**Distribution Tracking:**
- Total distributed to treasury
- Distribution frequency
- Average distribution amount
- Pending distribution balance

**Efficiency Metrics:**
- Fee collection gas costs
- Distribution gas costs
- Fees as % of trading volume
- Treasury utilization rate

## Security Considerations

### Access Control

**Critical Roles:**
- `FEE_COLLECTOR_ROLE`: Only granted to trusted contracts (bonding curves)
- `TREASURY_ROLE`: Only granted to treasury managers (initially deployer, then multisig)
- `DEFAULT_ADMIN_ROLE`: Only granted to deployer, used sparingly

**Best Practices:**
1. Use multisig for TREASURY_ROLE in production
2. Time-lock treasury address changes
3. Implement role revocation for compromised accounts
4. Monitor role grant/revoke events

### Reentrancy Protection

All fee-related functions use OpenZeppelin's `ReentrancyGuard`:
- `collectFees()` - nonReentrant
- `transferToTreasury()` - nonReentrant
- `extractFeesToTreasury()` - nonReentrant

### Fee Calculation Safety

**Overflow Protection:**
- Solidity 0.8.20+ has built-in overflow checks
- All arithmetic operations are safe by default

**Precision:**
- Fees calculated in basis points (1 bp = 0.01%)
- Maximum fee: 1000 bp = 10%
- Minimum fee: 1 bp = 0.01%

### Emergency Procedures

**Scenario 1: Treasury Compromise**
```solidity
// Admin updates treasury address immediately
sofToken.setTreasuryAddress(NEW_SAFE_ADDRESS);
```

**Scenario 2: Fee Collection Failure**
```solidity
// Fees remain in bonding curve
// Can be extracted manually later
// No funds lost, just delayed collection
```

**Scenario 3: Contract Upgrade**
```solidity
// Fees in SOFToken can be rescued
// transferToTreasury() by admin
// Migrate to new treasury system
```

## Testing Checklist

### Unit Tests

- ✅ Fee calculation accuracy (buy/sell)
- ✅ Fee accumulation tracking
- ✅ Role-based access control
- ✅ Reentrancy protection
- ✅ Edge cases (zero fees, max fees)

### Integration Tests

- ✅ End-to-end fee flow (curve → SOFToken → treasury)
- ✅ Multiple bonding curves feeding one treasury
- ✅ Season-end automatic extraction
- ✅ Manual extraction by admin
- ✅ Treasury address migration

### Gas Tests

- ✅ buyTokens() with fee tracking
- ✅ sellTokens() with fee tracking
- ✅ extractFeesToTreasury() cost
- ✅ collectFees() cost
- ✅ transferToTreasury() cost

## Future Enhancements

### Phase 1: Optimization (Post-MVP)

- Batch fee collection with thresholds
- Automated distribution scheduling
- Gas price-aware extraction

### Phase 2: Advanced Features

- Multi-token treasury support (ETH, USDC, etc.)
- Automated fee buybacks for $SOF
- Staking rewards distribution
- Governance-controlled fee rates

### Phase 3: Decentralization

- DAO-controlled treasury
- On-chain governance for fee allocation
- Transparent reporting dashboard
- Community treasury proposals

## References

### Related Documentation

- [Fee Collection Gas Analysis](./FEE_COLLECTION_GAS_ANALYSIS.md)
- [Project Tokenomics](./.windsurf/rules/project-tokenomics.md)
- [Smart Contract Architecture](./instructions/project-requirements.md)

### External Resources

- [OpenZeppelin AccessControl](https://docs.openzeppelin.com/contracts/4.x/access-control)
- [OpenZeppelin ReentrancyGuard](https://docs.openzeppelin.com/contracts/4.x/api/security#ReentrancyGuard)
- [ERC20 Standard](https://eips.ethereum.org/EIPS/eip-20)

## Changelog

### v1.0.0 (2025-10-01)

- Initial treasury system implementation
- Fee tracking in bonding curves
- Manual extraction mechanism
- Season-end automation support
- Comprehensive documentation
