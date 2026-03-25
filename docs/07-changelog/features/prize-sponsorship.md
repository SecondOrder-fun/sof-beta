# Prize Pool Sponsorship Implementation

## Overview

Implemented comprehensive prize pool sponsorship functionality allowing anyone to sponsor ERC-20 tokens and ERC-721 NFTs to season prize pools. Winners can claim all sponsored prizes in addition to the main $SOF prize pool.

## Implementation Date

2025-10-03

## Features Implemented

### 1. ERC-20 Token Sponsorship ✅

**Functionality**:
- Anyone can sponsor any ERC-20 token to a season
- Multiple sponsors can contribute to the same season
- Multiple different tokens can be sponsored
- Tracks total amount per token
- Winner claims all sponsored ERC-20 tokens

**Use Cases**:
- Sponsor USDC, USDT, or other stablecoins
- Sponsor project tokens
- Sponsor $SOF tokens (in addition to main prize pool)
- Multi-token prize pools

### 2. ERC-721 NFT Sponsorship ✅

**Functionality**:
- Anyone can sponsor NFTs to a season
- Multiple NFTs can be sponsored
- Winner receives all sponsored NFTs
- Supports any ERC-721 compliant token

**Use Cases**:
- Sponsor valuable NFTs as prizes
- Art collections
- Gaming items
- Membership tokens

### 3. Sponsorship Lifecycle ✅

**Phases**:
1. **Open Period**: Season created → Season ends
   - Anyone can sponsor ERC-20 or ERC-721 tokens
   - Tokens transferred to RafflePrizeDistributor
   - Sponsorships tracked per season

2. **Locked Period**: Season ends → Winner determined
   - Sponsorships locked (no new sponsors)
   - Called by Raffle contract when season ends

3. **Claim Period**: Winner determined → Prizes claimed
   - Winner can claim all sponsored ERC-20 tokens
   - Winner can claim all sponsored ERC-721 tokens
   - Separate claim functions for each type

## Smart Contract Changes

### RafflePrizeDistributor.sol

**New Imports**:
```solidity
import "openzeppelin-contracts/contracts/token/ERC721/IERC721.sol";
import "openzeppelin-contracts/contracts/token/ERC721/utils/ERC721Holder.sol";
```

**New Structs**:
```solidity
struct SponsoredERC20 {
    address token;
    uint256 amount;
    address sponsor;
}

struct SponsoredERC721 {
    address token;
    uint256 tokenId;
    address sponsor;
}
```

**Enhanced Season Struct**:
```solidity
struct Season {
    // ... existing fields
    bool sponsorshipsLocked;  // NEW: whether sponsorships are locked
}
```

**New Storage**:
```solidity
mapping(uint256 => SponsoredERC20[]) private _sponsoredERC20;
mapping(uint256 => SponsoredERC721[]) private _sponsoredERC721;
mapping(uint256 => mapping(address => uint256)) private _erc20TotalByToken;
```

**New Functions**:

1. **sponsorERC20(uint256 seasonId, address token, uint256 amount)**
   - Permissionless - anyone can call
   - Transfers tokens from sponsor to distributor
   - Records sponsorship details
   - Emits `ERC20Sponsored` event

2. **sponsorERC721(uint256 seasonId, address token, uint256 tokenId)**
   - Permissionless - anyone can call
   - Transfers NFT from sponsor to distributor
   - Records sponsorship details
   - Emits `ERC721Sponsored` event

3. **lockSponsorships(uint256 seasonId)**
   - Only RAFFLE_ROLE can call
   - Prevents new sponsorships
   - Called when season ends
   - Emits `SponsorshipsLocked` event

4. **claimSponsoredERC20(uint256 seasonId)**
   - Only winner can call
   - Transfers all sponsored ERC-20 tokens to winner
   - Clears sponsorship array (prevents double claim)
   - Emits `SponsoredERC20Claimed` events

5. **claimSponsoredERC721(uint256 seasonId)**
   - Only winner can call
   - Transfers all sponsored NFTs to winner
   - Clears sponsorship array (prevents double claim)
   - Emits `SponsoredERC721Claimed` events

6. **View Functions**:
   - `getSponsoredERC20(uint256 seasonId)` - Returns all ERC-20 sponsorships
   - `getSponsoredERC721(uint256 seasonId)` - Returns all ERC-721 sponsorships
   - `getERC20TotalByToken(uint256 seasonId, address token)` - Returns total per token

## Test Coverage

### PrizeSponsorship.t.sol - 12/12 Tests Passing ✅

**ERC-20 Tests**:
- ✅ `testSponsorERC20` - Single ERC-20 sponsorship
- ✅ `testSponsorMultipleERC20` - Multiple ERC-20 sponsorships
- ✅ `testClaimSponsoredERC20` - Winner claims ERC-20 tokens

**ERC-721 Tests**:
- ✅ `testSponsorERC721` - Single NFT sponsorship
- ✅ `testSponsorMultipleERC721` - Multiple NFT sponsorships
- ✅ `testClaimSponsoredERC721` - Winner claims NFTs

**Security Tests**:
- ✅ `testRevertSponsorAfterLocked` - Cannot sponsor after locked
- ✅ `testRevertClaimByNonWinner` - Only winner can claim
- ✅ `testRevertClaimBeforeLocked` - Cannot claim before locked
- ✅ `testRevertSponsorZeroAmount` - Rejects zero amount
- ✅ `testRevertSponsorZeroAddress` - Rejects zero address
- ✅ `testRevertSponsorInvalidSeason` - Rejects invalid season

## Integration with Existing System

### Raffle.sol Integration

The Raffle contract should call `lockSponsorships()` when the season ends:

```solidity
// In Raffle.sol when season ends (after VRF callback)
function _setupPrizeDistribution(uint256 seasonId) internal {
    // ... existing prize distribution setup
    
    // Lock sponsorships to prevent new sponsors
    IRafflePrizeDistributor(prizeDistributor).lockSponsorships(seasonId);
}
```

### Winner Claim Flow

Winners now have three claim functions:
1. `claimGrand()` - Claim main $SOF prize
2. `claimSponsoredERC20()` - Claim all sponsored ERC-20 tokens
3. `claimSponsoredERC721()` - Claim all sponsored NFTs

All three are independent and can be called separately.

## Security Considerations

### Access Control

- **Sponsorship**: Permissionless (anyone can sponsor)
- **Lock Sponsorships**: Only RAFFLE_ROLE
- **Claim Prizes**: Only grand winner

### Reentrancy Protection

- All external functions use `nonReentrant` modifier
- Uses OpenZeppelin's ReentrancyGuard

### Token Safety

- Uses SafeERC20 for ERC-20 transfers
- Uses ERC721Holder to safely receive NFTs
- Clears sponsorship arrays after claim to prevent double claims

### Validation

- Checks for zero addresses
- Checks for zero amounts
- Checks season is valid (> 0)
- Checks sponsorships not locked
- Checks season is funded
- Checks caller is winner

## Gas Optimization

### Storage Patterns

- Arrays cleared after claim (prevents double claims and saves gas)
- Mapping for quick token total lookups
- Efficient struct packing

### Batch Operations

- `claimSponsoredERC20()` claims all ERC-20 tokens in one transaction
- `claimSponsoredERC721()` claims all NFTs in one transaction

## Events

All sponsorship and claim actions emit events for off-chain tracking:

```solidity
event ERC20Sponsored(uint256 indexed seasonId, address indexed sponsor, address indexed token, uint256 amount);
event ERC721Sponsored(uint256 indexed seasonId, address indexed sponsor, address indexed token, uint256 tokenId);
event SponsorshipsLocked(uint256 indexed seasonId);
event SponsoredERC20Claimed(uint256 indexed seasonId, address indexed winner, address indexed token, uint256 amount);
event SponsoredERC721Claimed(uint256 indexed seasonId, address indexed winner, address indexed token, uint256 tokenId);
```

## Example Usage

### Sponsor ERC-20 Tokens

```solidity
// Approve tokens
IERC20(usdcAddress).approve(distributorAddress, 1000e6);

// Sponsor USDC
distributor.sponsorERC20(seasonId, usdcAddress, 1000e6);
```

### Sponsor NFT

```solidity
// Approve NFT
IERC721(nftAddress).approve(distributorAddress, tokenId);

// Sponsor NFT
distributor.sponsorERC721(seasonId, nftAddress, tokenId);
```

### Winner Claims Prizes

```solidity
// Claim main $SOF prize
distributor.claimGrand(seasonId);

// Claim all sponsored ERC-20 tokens
distributor.claimSponsoredERC20(seasonId);

// Claim all sponsored NFTs
distributor.claimSponsoredERC721(seasonId);
```

## Frontend Integration (TODO)

### Required Components

1. **Sponsorship Widget**
   - Token selector (ERC-20 or ERC-721)
   - Amount input (for ERC-20)
   - Token ID input (for ERC-721)
   - Approve + Sponsor button
   - Transaction status

2. **Sponsored Prizes Display**
   - List of all sponsored ERC-20 tokens with amounts
   - Gallery of sponsored NFTs with metadata
   - Sponsor addresses and timestamps
   - Total value estimation

3. **Winner Claim Interface**
   - Separate claim buttons for each prize type
   - Show claimable amounts/NFTs
   - Transaction status for each claim
   - Claimed status indicators

### Required Hooks

1. `useSponsorPrize` - Hook for sponsoring prizes
2. `useSponsoredPrizes` - Hook to fetch sponsored prizes
3. `useClaimSponsoredPrizes` - Hook for claiming prizes

## Files Modified

1. `contracts/src/core/RafflePrizeDistributor.sol` - Added sponsorship functionality
2. `contracts/test/PrizeSponsorship.t.sol` - Comprehensive test suite (NEW)

## Files To Be Created

1. `src/hooks/useSponsorPrize.js` - Frontend hook for sponsoring
2. `src/components/prizes/SponsorPrizeWidget.jsx` - Sponsorship UI
3. `src/components/prizes/SponsoredPrizesDisplay.jsx` - Display sponsored prizes
4. `src/services/sponsorshipService.js` - Service layer for sponsorship

## Next Steps

1. ✅ Smart contract implementation - COMPLETE
2. ✅ Test suite - COMPLETE (12/12 passing)
3. ⏳ Integration with Raffle.sol (add `lockSponsorships` call)
4. ⏳ Frontend UI implementation
5. ⏳ Update deployment scripts
6. ⏳ Update project documentation

## Benefits

### For Sponsors

- **Marketing**: Promote their tokens/NFTs to raffle participants
- **Community Building**: Support the platform and gain visibility
- **Flexible**: Can sponsor any amount, any token
- **Transparent**: All sponsorships are on-chain and visible

### For Winners

- **Enhanced Prizes**: Win more than just $SOF
- **Variety**: Receive different tokens and NFTs
- **Value**: Additional value beyond main prize pool
- **Flexibility**: Can claim prizes separately

### For Platform

- **Increased Engagement**: More valuable prizes attract more participants
- **Network Effects**: Token projects sponsor → their communities participate
- **Differentiation**: Unique feature not available in other platforms
- **Sustainability**: Sponsorships reduce platform prize funding burden

## Conclusion

The Prize Pool Sponsorship feature is fully implemented and tested at the smart contract level. It provides a flexible, secure, and gas-efficient way for anyone to sponsor ERC-20 tokens and ERC-721 NFTs to season prize pools, creating more valuable and diverse prizes for winners.

All 12 tests pass, demonstrating comprehensive coverage of functionality, security, and edge cases. The system integrates seamlessly with the existing prize distribution architecture while maintaining security and preventing double claims.
