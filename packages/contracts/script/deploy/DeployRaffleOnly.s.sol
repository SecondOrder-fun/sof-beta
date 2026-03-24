// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "forge-std/console2.sol";
import {Raffle} from "src/core/Raffle.sol";
import {SeasonFactory} from "src/core/SeasonFactory.sol";
import {IVRFCoordinatorV2Plus} from "chainlink-brownie-contracts/contracts/src/v0.8/vrf/dev/interfaces/IVRFCoordinatorV2Plus.sol";

/**
 * @title DeployRaffleOnly
 * @notice Deploys only the Raffle contract with proper configuration
 * @dev Reads all addresses from environment variables
 */
contract DeployRaffleOnly is Script {
    function run() public {
        // STEP 1: Read all configuration from environment variables
        address sofToken = vm.envAddress("SOF_ADDRESS_TESTNET");
        address vrfCoordinator = vm.envAddress("VRF_COORDINATOR_ADDRESS_TESTNET");
        uint256 vrfSubscriptionId = vm.envUint("VRF_SUBSCRIPTION_ID_TESTNET");
        bytes32 vrfKeyHash = vm.envBytes32("VRF_KEY_HASH_TESTNET");
        address seasonFactory = vm.envAddress("SEASON_FACTORY_ADDRESS_TESTNET");

        address deployer = msg.sender;
        console2.log("Deploying Raffle from:", deployer);
        console2.log("Chain ID:", block.chainid);

        vm.startBroadcast(deployer);

        // STEP 2: Deploy Raffle with native ETH payment support
        console2.log(unicode"\n📦 STEP 2: Deploying Raffle...");
        Raffle raffle = new Raffle(sofToken, vrfCoordinator, vrfSubscriptionId, vrfKeyHash);
        address raffleAddress = address(raffle);
        console2.log(unicode"✅ Raffle deployed:", raffleAddress);

        // STEP 3: Add Raffle as VRF consumer
        console2.log(unicode"\n⚙️  STEP 3: Adding Raffle as VRF consumer...");
        IVRFCoordinatorV2Plus(vrfCoordinator).addConsumer(vrfSubscriptionId, raffleAddress);
        console2.log(unicode"✅ Raffle added as VRF consumer");

        // STEP 4: Set SeasonFactory on Raffle
        console2.log(unicode"\n⚙️  STEP 4: Setting SeasonFactory on Raffle...");
        raffle.setSeasonFactory(seasonFactory);
        console2.log(unicode"✅ SeasonFactory set");

        // STEP 5: Grant RAFFLE_ADMIN_ROLE to Raffle on SeasonFactory
        console2.log(unicode"\n⚙️  STEP 5: Granting RAFFLE_ADMIN_ROLE to Raffle on SeasonFactory...");
        bytes32 raffleAdminRole = keccak256("RAFFLE_ADMIN_ROLE");
        SeasonFactory(seasonFactory).grantRole(raffleAdminRole, raffleAddress);
        console2.log(unicode"✅ RAFFLE_ADMIN_ROLE granted");

        vm.stopBroadcast();

        // Print summary
        console2.log("\n============================================================");
        console2.log("RAFFLE DEPLOYMENT COMPLETE");
        console2.log("============================================================");
        console2.log("Raffle Contract:", raffleAddress);
        console2.log("VRF Coordinator:", vrfCoordinator);
        console2.log("VRF Subscription ID:", vrfSubscriptionId);
        console2.log("Payment Method: Native ETH (nativePayment: true)");
        console2.log("============================================================");
    }
}
