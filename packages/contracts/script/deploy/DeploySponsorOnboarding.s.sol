// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../../src/sponsor/SponsorOnboarding.sol";

/**
 * @title DeploySponsorOnboarding
 * @notice Deploys the SponsorOnboarding contract for claiming Sponsor hats
 * 
 * Usage:
 *   forge script script/deploy/DeploySponsorOnboarding.s.sol:DeploySponsorOnboarding \
 *     --rpc-url $RPC_URL_TESTNET \
 *     --broadcast \
 *     --verify
 * 
 * Required env vars:
 *   - PRIVATE_KEY: Deployer private key
 *   - HATS_PROTOCOL: Hats Protocol contract address
 *   - STAKING_ELIGIBILITY: StakingEligibility contract address
 *   - SPONSOR_HAT_ID: The Sponsor hat ID (uint256)
 */
contract DeploySponsorOnboarding is Script {
    function run() external {
        // Load config from environment
        address hatsProtocol = vm.envAddress("HATS_PROTOCOL");
        address stakingEligibility = vm.envAddress("STAKING_ELIGIBILITY");
        uint256 sponsorHatId = vm.envUint("SPONSOR_HAT_ID");
        
        console.log("=== DeploySponsorOnboarding ===");
        console.log("Hats Protocol:", hatsProtocol);
        console.log("StakingEligibility:", stakingEligibility);
        console.log("Sponsor Hat ID:", sponsorHatId);
        
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        console.log("Deployer:", deployer);
        
        vm.startBroadcast(deployerPrivateKey);
        
        SponsorOnboarding onboarding = new SponsorOnboarding(
            hatsProtocol,
            stakingEligibility,
            sponsorHatId
        );
        
        console.log("SponsorOnboarding deployed at:", address(onboarding));
        
        vm.stopBroadcast();
        
        // Verify deployment
        console.log("\n=== Verification ===");
        console.log("HATS:", address(onboarding.HATS()));
        console.log("STAKING:", address(onboarding.STAKING()));
        console.log("SPONSOR_HAT_ID:", onboarding.SPONSOR_HAT_ID());
        
        console.log("\n=== Next Steps ===");
        console.log("1. Add the following env vars to Railway:");
        console.log("   HATS_STAKING_ELIGIBILITY=", stakingEligibility);
        console.log("   HATS_PROTOCOL=", hatsProtocol);
        console.log("   HATS_SPONSOR_HAT_ID=", sponsorHatId);
        console.log("");
        console.log("2. The backend will auto-mint hats on Staked events");
        console.log("   (Backend wallet must wear Top Hat to have mint permission)");
    }
}
