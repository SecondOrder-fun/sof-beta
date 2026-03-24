// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "forge-std/console2.sol";
import "../../src/core/Raffle.sol";
import "../../src/core/SeasonFactory.sol";
import "chainlink-brownie-contracts/contracts/src/v0.8/vrf/dev/interfaces/IVRFCoordinatorV2Plus.sol";

/**
 * @title RedeployRaffleV2
 * @notice Deploys new Raffle + SeasonFactory with Hats Protocol support
 */
contract RedeployRaffleV2 is Script {
    // ═══════════════════════════════════════════════════════════════════════
    // BASE SEPOLIA ADDRESSES
    // ═══════════════════════════════════════════════════════════════════════
    address constant SOF_TOKEN = 0x5146Dd2a3Af7Bd4D247e34A3F7322daDF7ee5B0c;
    address constant VRF_COORDINATOR = 0x5C210eF41CD1a72de73bF76eC39637bB0d3d7BEE;
    bytes32 constant VRF_KEY_HASH = 0x4e5acf960b4e5bb0fb6b4ba4ed1d3c5082bf7a77be61a38ee3f9b33b0ef55f78;
    uint256 constant VRF_SUBSCRIPTION_ID = 41855330402557609641075039705305501419707903893372860901739913879066150933426;
    
    // Existing infrastructure
    address constant PRIZE_DISTRIBUTOR = 0xDaD1DdeE136879E2f59916fD66b9CeDB708a1e66;
    
    // Hats Protocol
    address constant HATS_PROTOCOL = 0x3bc1A0Ad72417f2d411118085256fC53CBdDd137;
    uint256 constant SPONSOR_HAT_ID = 4906710704797555772930907284579868421939586530586350599955822902509568;
    
    // Backend wallet
    address constant BACKEND_WALLET = 0x1eD4aC856D7a072C3a336C0971a47dB86A808Ff4;

    function run() public {
        address deployer = msg.sender;
        console2.log(unicode"🎰 Deploying Raffle V2 + SeasonFactory");
        console2.log("Deployer:", deployer);
        
        vm.startBroadcast();
        
        // ═══════════════════════════════════════════════════════════════════
        // STEP 1: Deploy new Raffle
        // ═══════════════════════════════════════════════════════════════════
        console2.log(unicode"\n📦 Deploying Raffle...");
        Raffle raffle = new Raffle(
            SOF_TOKEN,
            VRF_COORDINATOR,
            VRF_SUBSCRIPTION_ID,
            VRF_KEY_HASH
        );
        console2.log(unicode"✅ Raffle deployed:", address(raffle));
        
        // ═══════════════════════════════════════════════════════════════════
        // STEP 2: Deploy new SeasonFactory pointing to new Raffle
        // ═══════════════════════════════════════════════════════════════════
        console2.log(unicode"\n📦 Deploying SeasonFactory...");
        SeasonFactory seasonFactory = new SeasonFactory(address(raffle));
        console2.log(unicode"✅ SeasonFactory deployed:", address(seasonFactory));
        
        // ═══════════════════════════════════════════════════════════════════
        // STEP 3: Configure Raffle
        // ═══════════════════════════════════════════════════════════════════
        console2.log(unicode"\n⚙️  Configuring Raffle...");
        raffle.setSeasonFactory(address(seasonFactory));
        console2.log(unicode"✅ SeasonFactory set");
        
        raffle.setPrizeDistributor(PRIZE_DISTRIBUTOR);
        console2.log(unicode"✅ PrizeDistributor set");
        
        raffle.setHatsProtocol(HATS_PROTOCOL);
        console2.log(unicode"✅ Hats Protocol set");
        
        raffle.setSponsorHat(SPONSOR_HAT_ID);
        console2.log(unicode"✅ Sponsor Hat ID set");
        
        // ═══════════════════════════════════════════════════════════════════
        // STEP 4: Add Raffle as VRF consumer
        // ═══════════════════════════════════════════════════════════════════
        console2.log(unicode"\n⚙️  Adding Raffle as VRF consumer...");
        IVRFCoordinatorV2Plus(VRF_COORDINATOR).addConsumer(VRF_SUBSCRIPTION_ID, address(raffle));
        console2.log(unicode"✅ VRF consumer added");
        
        // ═══════════════════════════════════════════════════════════════════
        // STEP 5: Grant roles
        // ═══════════════════════════════════════════════════════════════════
        console2.log(unicode"\n🔑 Granting roles...");
        bytes32 SEASON_CREATOR_ROLE = keccak256("SEASON_CREATOR_ROLE");
        raffle.grantRole(SEASON_CREATOR_ROLE, BACKEND_WALLET);
        console2.log(unicode"✅ SEASON_CREATOR_ROLE granted to backend");
        
        vm.stopBroadcast();
        
        // ═══════════════════════════════════════════════════════════════════
        // OUTPUT
        // ═══════════════════════════════════════════════════════════════════
        console2.log(unicode"\n═══════════════════════════════════════════════════════");
        console2.log(unicode"🎰 DEPLOYMENT COMPLETE");
        console2.log(unicode"═══════════════════════════════════════════════════════");
        console2.log("Raffle V2:       ", address(raffle));
        console2.log("SeasonFactory:   ", address(seasonFactory));
        console2.log("VRF Subscription:", VRF_SUBSCRIPTION_ID);
        console2.log(unicode"═══════════════════════════════════════════════════════");
        console2.log(unicode"\n🔧 MANUAL STEPS:");
        console2.log("1. Update RAFFLE_ADDRESS in Vercel + Railway");
        console2.log("2. Update SEASON_FACTORY_ADDRESS in Railway");
        console2.log(unicode"═══════════════════════════════════════════════════════\n");
    }
}
