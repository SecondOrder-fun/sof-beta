// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

// ============ Interfaces ============

interface IHatsForOnboarding {
    function mintHat(uint256 _hatId, address _wearer) external returns (bool success);
    function isWearerOfHat(address _wearer, uint256 _hatId) external view returns (bool);
    function isEligible(address _wearer, uint256 _hatId) external view returns (bool);
}

interface IStakingEligibilityForOnboarding {
    function stakes(address _staker) external view returns (uint248 amount, bool slashed);
    function minStake() external view returns (uint248);
}

/// @title SponsorOnboarding
/// @notice Claims Sponsor hat for users who have staked
/// @dev Wears the Operator Hat, allowing it to mint Sponsor Hats to eligible stakers
/// 
/// Flow:
/// 1. User approves SOF to StakingEligibility
/// 2. User calls stake() on StakingEligibility directly
/// 3. User calls claimSponsorHat() here (or we auto-claim via backend)
contract SponsorOnboarding {
    // ============ Immutables ============
    
    IHatsForOnboarding public immutable HATS;
    IStakingEligibilityForOnboarding public immutable STAKING;
    uint256 public immutable SPONSOR_HAT_ID;

    // ============ Events ============
    
    event SponsorHatClaimed(address indexed sponsor);

    // ============ Errors ============
    
    error AlreadySponsor();
    error NotEligible();
    error MintFailed();

    // ============ Constructor ============
    
    constructor(
        address _hats,
        address _staking,
        uint256 _sponsorHatId
    ) {
        HATS = IHatsForOnboarding(_hats);
        STAKING = IStakingEligibilityForOnboarding(_staking);
        SPONSOR_HAT_ID = _sponsorHatId;
    }

    // ============ External Functions ============
    
    /// @notice Claim Sponsor hat after staking
    /// @dev User must have already staked to StakingEligibility
    function claimSponsorHat() external {
        _claimFor(msg.sender);
    }
    
    /// @notice Claim Sponsor hat for a specific address (permissionless)
    /// @dev Anyone can trigger the claim for an eligible staker
    function claimSponsorHatFor(address _staker) external {
        _claimFor(_staker);
    }
    
    function _claimFor(address _staker) internal {
        // Check not already a sponsor
        if (HATS.isWearerOfHat(_staker, SPONSOR_HAT_ID)) {
            revert AlreadySponsor();
        }
        
        // Check eligible (has staked enough)
        if (!HATS.isEligible(_staker, SPONSOR_HAT_ID)) {
            revert NotEligible();
        }
        
        // Mint Sponsor hat
        // This works because this contract wears the Operator hat (parent of Sponsor hat)
        bool success = HATS.mintHat(SPONSOR_HAT_ID, _staker);
        if (!success) revert MintFailed();
        
        emit SponsorHatClaimed(_staker);
    }
    
    // ============ View Functions ============
    
    /// @notice Check if an address is already a sponsor
    function isSponsor(address _account) external view returns (bool) {
        return HATS.isWearerOfHat(_account, SPONSOR_HAT_ID);
    }
    
    /// @notice Check if an address is eligible to become a sponsor
    function isEligible(address _account) external view returns (bool) {
        return HATS.isEligible(_account, SPONSOR_HAT_ID);
    }
    
    /// @notice Check if an address can claim (eligible but not yet sponsor)
    function canClaim(address _account) external view returns (bool) {
        return HATS.isEligible(_account, SPONSOR_HAT_ID) && 
               !HATS.isWearerOfHat(_account, SPONSOR_HAT_ID);
    }
    
    /// @notice Get the stake amount for an address
    function getStake(address _account) external view returns (uint256) {
        (uint248 amount,) = STAKING.stakes(_account);
        return uint256(amount);
    }
    
    /// @notice Get the minimum stake required
    function getMinStake() external view returns (uint256) {
        return uint256(STAKING.minStake());
    }
}
