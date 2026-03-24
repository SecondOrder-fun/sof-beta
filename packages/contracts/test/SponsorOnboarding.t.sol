// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/sponsor/SponsorOnboarding.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// Mock SOF Token
contract MockSOF is ERC20 {
    constructor() ERC20("SOF Token", "SOF") {
        _mint(msg.sender, 1_000_000 * 1e18);
    }
    
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

// Mock Hats Protocol
contract MockHats {
    mapping(address => mapping(uint256 => bool)) public wearers;
    mapping(address => mapping(uint256 => bool)) public eligible;
    
    function setEligible(address wearer, uint256 hatId, bool _eligible) external {
        eligible[wearer][hatId] = _eligible;
    }
    
    function isWearerOfHat(address wearer, uint256 hatId) external view returns (bool) {
        return wearers[wearer][hatId];
    }
    
    function isEligible(address wearer, uint256 hatId) external view returns (bool) {
        return eligible[wearer][hatId];
    }
    
    function mintHat(uint256 hatId, address wearer) external returns (bool) {
        require(eligible[wearer][hatId], "Not eligible");
        require(!wearers[wearer][hatId], "Already wearing");
        wearers[wearer][hatId] = true;
        return true;
    }
}

// Mock StakingEligibility
contract MockStakingEligibility {
    mapping(address => uint248) public stakedAmounts;
    uint248 public minStakeAmount = 50_000 * 1e18;
    
    function stakes(address staker) external view returns (uint248 amount, bool slashed) {
        return (stakedAmounts[staker], false);
    }
    
    function minStake() external view returns (uint248) {
        return minStakeAmount;
    }
    
    function setStake(address staker, uint248 amount) external {
        stakedAmounts[staker] = amount;
    }
}

contract SponsorOnboardingTest is Test {
    SponsorOnboarding public onboarding;
    MockSOF public sof;
    MockHats public hats;
    MockStakingEligibility public staking;
    
    uint256 constant SPONSOR_HAT_ID = 12345;
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    
    function setUp() public {
        sof = new MockSOF();
        hats = new MockHats();
        staking = new MockStakingEligibility();
        
        onboarding = new SponsorOnboarding(
            address(hats),
            address(staking),
            SPONSOR_HAT_ID
        );
    }
    
    function test_claimSponsorHat_success() public {
        // Setup: alice has staked and is eligible
        staking.setStake(alice, 50_000 * 1e18);
        hats.setEligible(alice, SPONSOR_HAT_ID, true);
        
        // Alice claims the hat
        vm.prank(alice);
        onboarding.claimSponsorHat();
        
        // Verify alice is now a sponsor
        assertTrue(hats.isWearerOfHat(alice, SPONSOR_HAT_ID));
        assertTrue(onboarding.isSponsor(alice));
    }
    
    function test_claimSponsorHatFor_success() public {
        // Setup: alice has staked and is eligible
        staking.setStake(alice, 50_000 * 1e18);
        hats.setEligible(alice, SPONSOR_HAT_ID, true);
        
        // Bob claims on behalf of alice
        vm.prank(bob);
        onboarding.claimSponsorHatFor(alice);
        
        // Verify alice is now a sponsor
        assertTrue(hats.isWearerOfHat(alice, SPONSOR_HAT_ID));
    }
    
    function test_claimSponsorHat_alreadySponsor_reverts() public {
        // Setup: alice has already claimed
        staking.setStake(alice, 50_000 * 1e18);
        hats.setEligible(alice, SPONSOR_HAT_ID, true);
        
        vm.prank(alice);
        onboarding.claimSponsorHat();
        
        // Try to claim again
        vm.prank(alice);
        vm.expectRevert(SponsorOnboarding.AlreadySponsor.selector);
        onboarding.claimSponsorHat();
    }
    
    function test_claimSponsorHat_notEligible_reverts() public {
        // Setup: alice has not staked enough
        staking.setStake(alice, 10_000 * 1e18);
        hats.setEligible(alice, SPONSOR_HAT_ID, false);
        
        vm.prank(alice);
        vm.expectRevert(SponsorOnboarding.NotEligible.selector);
        onboarding.claimSponsorHat();
    }
    
    function test_canClaim_true() public {
        staking.setStake(alice, 50_000 * 1e18);
        hats.setEligible(alice, SPONSOR_HAT_ID, true);
        
        assertTrue(onboarding.canClaim(alice));
    }
    
    function test_canClaim_falseIfAlreadySponsor() public {
        staking.setStake(alice, 50_000 * 1e18);
        hats.setEligible(alice, SPONSOR_HAT_ID, true);
        
        vm.prank(alice);
        onboarding.claimSponsorHat();
        
        assertFalse(onboarding.canClaim(alice));
    }
    
    function test_canClaim_falseIfNotEligible() public {
        staking.setStake(alice, 10_000 * 1e18);
        hats.setEligible(alice, SPONSOR_HAT_ID, false);
        
        assertFalse(onboarding.canClaim(alice));
    }
    
    function test_getStake() public {
        staking.setStake(alice, 75_000 * 1e18);
        assertEq(onboarding.getStake(alice), 75_000 * 1e18);
    }
    
    function test_getMinStake() public {
        assertEq(onboarding.getMinStake(), 50_000 * 1e18);
    }
}
