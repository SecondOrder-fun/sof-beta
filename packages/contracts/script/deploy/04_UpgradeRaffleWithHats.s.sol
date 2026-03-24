// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "forge-std/console2.sol";
import {Raffle} from "src/core/Raffle.sol";
import {SeasonFactory} from "src/core/SeasonFactory.sol";
import {RafflePrizeDistributor} from "src/core/RafflePrizeDistributor.sol";
import {IVRFCoordinatorV2Plus} from "chainlink-brownie-contracts/contracts/src/v0.8/vrf/dev/interfaces/IVRFCoordinatorV2Plus.sol";

/**
 * @title UpgradeRaffleWithHats
 * @notice Deploys new Raffle + SeasonFactory with Hats Protocol integration
 * @dev Complete redeployment preserving existing token/curve/distributor
 * 
 * Prerequisites:
 * - Hats tree deployed via DeployHatsTree.s.sol
 * 
 * Usage:
 *   forge script script/deploy/04_UpgradeRaffleWithHats.s.sol:UpgradeRaffleWithHats \
 *     --rpc-url https://sepolia.base.org \
 *     --private-key $PRIVATE_KEY \
 *     --broadcast -vvvv
 */
contract UpgradeRaffleWithHats is Script {
    // ═══════════════════════════════════════════════════════════════════════
    // EXISTING INFRASTRUCTURE (Base Sepolia)
    // ═══════════════════════════════════════════════════════════════════════
    address constant SOF_TOKEN = 0x5146Dd2a3Af7Bd4D247e34A3F7322daDF7ee5B0c;
    address constant BONDING_CURVE = 0x382f8dC967F3c71c1D0601D0bE790CA1d60A3401;
    address constant PRIZE_DISTRIBUTOR = 0xDaD1DdeE136879E2f59916fD66b9CeDB708a1e66;
    
    // VRF Config (Base Sepolia)
    address constant VRF_COORDINATOR = 0x5C210eF41CD1a72de73bF76eC39637bB0d3d7BEE;
    uint256 constant VRF_SUBSCRIPTION_ID = 41855330402557609641075039705305501419707903893372860901739913879066150933426;
    bytes32 constant VRF_KEY_HASH = 0x9e1344a1247c8a1785d0a4681a27152bffdb43666ae5bf7d14d24a5efd44bf71;
    
    // ═══════════════════════════════════════════════════════════════════════
    // HATS PROTOCOL (from DeployHatsTree output)
    // ═══════════════════════════════════════════════════════════════════════
    address constant HATS = 0x3bc1A0Ad72417f2d411118085256fC53CBdDd137;
    uint256 constant SPONSOR_HAT_ID = 4906710704797555772930907284579868421939586530586350599955822902509568;
    
    // Output
    address public newRaffleAddress;
    address public newSeasonFactoryAddress;

    function run() public {
        address deployer = msg.sender;
        console2.log(unicode"🔄 Upgrading Raffle with Hats Protocol Integration");
        console2.log("Deployer:", deployer);
        console2.log("Chain ID:", block.chainid);
        
        vm.startBroadcast();
        
        // ═══════════════════════════════════════════════════════════════════
        // STEP 1: Deploy New Raffle
        // ═══════════════════════════════════════════════════════════════════
        console2.log(unicode"\n📦 Deploying new Raffle...");
        Raffle raffle = new Raffle(
            SOF_TOKEN,
            VRF_COORDINATOR,
            VRF_SUBSCRIPTION_ID,
            VRF_KEY_HASH
        );
        newRaffleAddress = address(raffle);
        console2.log(unicode"✅ New Raffle deployed:", newRaffleAddress);
        
        // ═══════════════════════════════════════════════════════════════════
        // STEP 2: Add as VRF Consumer
        // ═══════════════════════════════════════════════════════════════════
        console2.log(unicode"\n⚙️  Adding Raffle as VRF consumer...");
        IVRFCoordinatorV2Plus(VRF_COORDINATOR).addConsumer(VRF_SUBSCRIPTION_ID, newRaffleAddress);
        console2.log(unicode"✅ VRF consumer added");
        
        // ═══════════════════════════════════════════════════════════════════
        // STEP 3: Deploy New SeasonFactory
        // ═══════════════════════════════════════════════════════════════════
        console2.log(unicode"\n📦 Deploying new SeasonFactory...");
        SeasonFactory seasonFactory = new SeasonFactory(newRaffleAddress);
        newSeasonFactoryAddress = address(seasonFactory);
        console2.log(unicode"✅ New SeasonFactory deployed:", newSeasonFactoryAddress);
        
        // ═══════════════════════════════════════════════════════════════════
        // STEP 4: Configure Raffle
        // ═══════════════════════════════════════════════════════════════════
        console2.log(unicode"\n⚙️  Setting SeasonFactory in Raffle...");
        raffle.setSeasonFactory(newSeasonFactoryAddress);
        console2.log(unicode"✅ SeasonFactory set");
        
        console2.log(unicode"\n⚙️  Setting PrizeDistributor in Raffle...");
        raffle.setPrizeDistributor(PRIZE_DISTRIBUTOR);
        console2.log(unicode"✅ PrizeDistributor set");
        
        // ═══════════════════════════════════════════════════════════════════
        // STEP 5: Configure Hats Protocol
        // ═══════════════════════════════════════════════════════════════════
        console2.log(unicode"\n🎩 Configuring Hats Protocol...");
        raffle.setHatsProtocol(HATS);
        console2.log(unicode"✅ Hats Protocol set:", HATS);
        
        raffle.setSponsorHat(SPONSOR_HAT_ID);
        console2.log(unicode"✅ Sponsor Hat ID set");
        
        // ═══════════════════════════════════════════════════════════════════
        // STEP 6: Grant Roles
        // ═══════════════════════════════════════════════════════════════════
        console2.log(unicode"\n🔐 Granting roles...");
        bytes32 bondingCurveRole = keccak256("BONDING_CURVE_ROLE");
        raffle.grantRole(bondingCurveRole, BONDING_CURVE);
        console2.log(unicode"✅ BONDING_CURVE_ROLE granted");
        
        // Grant RAFFLE_ROLE to new Raffle in PrizeDistributor
        console2.log(unicode"\n⚙️  Granting RAFFLE_ROLE in PrizeDistributor...");
        bytes32 raffleRole = keccak256("RAFFLE_ROLE");
        RafflePrizeDistributor(PRIZE_DISTRIBUTOR).grantRole(raffleRole, newRaffleAddress);
        console2.log(unicode"✅ RAFFLE_ROLE granted to new Raffle");
        
        vm.stopBroadcast();
        
        // ═══════════════════════════════════════════════════════════════════
        // OUTPUT
        // ═══════════════════════════════════════════════════════════════════
        console2.log(unicode"\n═══════════════════════════════════════════════════════");
        console2.log(unicode"🔄 RAFFLE UPGRADE COMPLETE");
        console2.log(unicode"═══════════════════════════════════════════════════════");
        console2.log("New Raffle:         ", newRaffleAddress);
        console2.log("New SeasonFactory:  ", newSeasonFactoryAddress);
        console2.log(unicode"═══════════════════════════════════════════════════════");
        console2.log(unicode"\n📝 UPDATE THESE ENV VARS:");
        console2.log("");
        console2.log("# Vercel (.env.testnet):");
        console2.log("VITE_RAFFLE_ADDRESS_TESTNET=", newRaffleAddress);
        console2.log("VITE_SEASON_FACTORY_ADDRESS_TESTNET=", newSeasonFactoryAddress);
        console2.log("");
        console2.log("# Railway:");
        console2.log("RAFFLE_ADDRESS=", newRaffleAddress);
        console2.log("SEASON_FACTORY_ADDRESS=", newSeasonFactoryAddress);
        console2.log(unicode"═══════════════════════════════════════════════════════\n");
    }
}
