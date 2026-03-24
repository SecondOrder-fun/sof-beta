// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "forge-std/console2.sol";
import {SOFToken} from "src/token/SOFToken.sol";
import {SeasonFactory} from "src/core/SeasonFactory.sol";
import {Raffle} from "src/core/Raffle.sol";
import {SOFBondingCurve} from "src/curve/SOFBondingCurve.sol";
import {SOFFaucet} from "src/faucet/SOFFaucet.sol";
import {RafflePrizeDistributor} from "src/core/RafflePrizeDistributor.sol";
import {IVRFCoordinatorV2Plus} from "chainlink-brownie-contracts/contracts/src/v0.8/vrf/dev/interfaces/IVRFCoordinatorV2Plus.sol";

/**
 * @title DeployToSepolia
 * @notice Deployment script for Base Sepolia testnet using Frame.sh wallet
 * @dev Usage:
 *   export FRAME_RPC="http://127.0.0.1:1248"
 *   LATTICE_ADDRESS=$(cast wallet address --rpc-url $FRAME_RPC)
 *   forge script script/deploy/00_DeployToSepolia.s.sol \
 *     --rpc-url $FRAME_RPC \
 *     --sender $LATTICE_ADDRESS \
 *     --broadcast \
 *     -vvvv
 */
contract DeployToSepolia is Script {
    // Deployment addresses
    address public sofTokenAddress;
    address public seasonFactoryAddress;
    address public raffleAddress;
    address public bondingCurveAddress;
    address public sofFaucetAddress;
    address public prizeDistributorAddress;

    // Configuration
    uint256 constant INITIAL_SOF_SUPPLY = 100_000_000e18; // 100M SOF

    function run() public {
        // Get sender from Frame wallet
        address deployer = msg.sender;
        console2.log("Deploying from:", deployer);
        console2.log("Chain ID:", block.chainid);

        // Read VRF configuration from environment variables
        address vrfCoordinator = vm.envAddress("VRF_COORDINATOR_ADDRESS_TESTNET");
        uint256 vrfSubscriptionId = vm.envUint("VRF_SUBSCRIPTION_ID_TESTNET");
        bytes32 vrfKeyHash = vm.envBytes32("VRF_KEY_HASH_TESTNET");

        vm.startBroadcast(deployer);

        // 1. Deploy SOF Token
        console2.log(unicode"\n📦 Deploying SOF Token...");
        SOFToken sofToken = new SOFToken("SecondOrder Fun", "SOF", INITIAL_SOF_SUPPLY);
        sofTokenAddress = address(sofToken);
        console2.log(unicode"✅ SOF Token deployed:", sofTokenAddress);

        // 2. Deploy Raffle
        console2.log(unicode"\n📦 Deploying Raffle...");
        Raffle raffle = new Raffle(sofTokenAddress, vrfCoordinator, vrfSubscriptionId, vrfKeyHash);
        raffleAddress = address(raffle);
        console2.log(unicode"\n✅ Raffle deployed:", raffleAddress);

        // 2.5. Add Raffle as VRF consumer
        console2.log(unicode"\n⚙️  Adding Raffle as VRF consumer...");
        IVRFCoordinatorV2Plus(vrfCoordinator).addConsumer(vrfSubscriptionId, raffleAddress);
        console2.log(unicode"\n✅ Raffle added as VRF consumer");

        // 3. Deploy SeasonFactory
        console2.log(unicode"\n📦 Deploying SeasonFactory...");
        SeasonFactory seasonFactory = new SeasonFactory(raffleAddress);
        seasonFactoryAddress = address(seasonFactory);
        console2.log(unicode"\n✅ SeasonFactory deployed:", seasonFactoryAddress);

        // 4. Set SeasonFactory in Raffle
        console2.log(unicode"\n⚙️  Setting SeasonFactory in Raffle...");
        raffle.setSeasonFactory(seasonFactoryAddress);
        console2.log(unicode"\n✅ SeasonFactory set");

        // 5. Deploy SOFBondingCurve
        console2.log(unicode"\n📦 Deploying SOFBondingCurve...");
        SOFBondingCurve bondingCurve = new SOFBondingCurve(
            sofTokenAddress,
            deployer // _admin for role management
        );
        bondingCurveAddress = address(bondingCurve);
        console2.log(unicode"\n✅ SOFBondingCurve deployed:", bondingCurveAddress);

        // 6. Grant BONDING_CURVE_ROLE to bonding curve
        console2.log(unicode"\n⚙️  Granting BONDING_CURVE_ROLE...");
        bytes32 bondingCurveRole = keccak256("BONDING_CURVE_ROLE");
        raffle.grantRole(bondingCurveRole, bondingCurveAddress);
        console2.log(unicode"\n✅ BONDING_CURVE_ROLE granted");

        // 7. Deploy SOFFaucet
        console2.log(unicode"\n📦 Deploying SOFFaucet...");
        uint256[] memory allowedChainIds = new uint256[](2);
        allowedChainIds[0] = 31337; // Anvil
        allowedChainIds[1] = 84532; // Base Sepolia
        SOFFaucet sofFaucet = new SOFFaucet(
            sofTokenAddress,
            1000e18, // 1000 SOF per request
            1 days,  // 1 day cooldown
            allowedChainIds
        );
        sofFaucetAddress = address(sofFaucet);
        console2.log(unicode"\n✅ SOFFaucet deployed:", sofFaucetAddress);

        // 8. Deploy RafflePrizeDistributor
        console2.log(unicode"\n📦 Deploying RafflePrizeDistributor...");
        RafflePrizeDistributor prizeDistributor = new RafflePrizeDistributor(deployer);
        prizeDistributorAddress = address(prizeDistributor);
        console2.log(unicode"\n✅ RafflePrizeDistributor deployed:", prizeDistributorAddress);

        // 9. Grant RAFFLE_ROLE to raffle in prizeDistributor
        console2.log(unicode"\n⚙️  Granting RAFFLE_ROLE to Raffle...");
        bytes32 raffleRole = keccak256("RAFFLE_ROLE");
        prizeDistributor.grantRole(raffleRole, raffleAddress);
        console2.log(unicode"\n✅ RAFFLE_ROLE granted");

        // 9.5 Set PrizeDistributor in Raffle
        console2.log(unicode"\n⚙️  Setting PrizeDistributor in Raffle...");
        raffle.setPrizeDistributor(prizeDistributorAddress);
        console2.log(unicode"\n✅ PrizeDistributor set");

        // 9.6 Grant SEASON_CREATOR_ROLE and EMERGENCY_ROLE to deployer
        console2.log(unicode"\n⚙️  Granting SEASON_CREATOR_ROLE + EMERGENCY_ROLE to deployer...");
        raffle.grantRole(keccak256("SEASON_CREATOR_ROLE"), deployer);
        raffle.grantRole(keccak256("EMERGENCY_ROLE"), deployer);
        console2.log(unicode"\n✅ Deployer roles granted");

        // NOTE: If redeploying ONLY the Raffle (not SeasonFactory), you must also:
        //   seasonFactory.grantRole(keccak256("RAFFLE_ADMIN_ROLE"), newRaffleAddress);
        // SeasonFactory auto-grants RAFFLE_ADMIN_ROLE in its constructor, but only to
        // the Raffle address passed at deploy time.
        //
        // TODO: Research Hats Protocol for SEASON_CREATOR_ROLE management.
        // Goal: Let anyone with a stake of $SOF tokens be granted a Hat role that maps
        // to SEASON_CREATOR_ROLE — permissionless season creation gated by skin-in-the-game.
        // This avoids contract updates AND prevents bot spam (must hold staked SOF).
        // See: https://www.hatsprotocol.xyz/

        // 10. Fund SOFFaucet with SOF tokens
        console2.log(unicode"\n💰 Funding SOFFaucet with SOF tokens...");
        uint256 faucetFundAmount = 100_000e18; // 100,000 SOF for faucet
        sofToken.transfer(sofFaucetAddress, faucetFundAmount);
        console2.log(unicode"\n✅ SOFFaucet funded with", faucetFundAmount / 1e18, "SOF");

        vm.stopBroadcast();

        // Print summary
        console2.log("\n============================================================");
        console2.log("RAFFLE SYSTEM DEPLOYMENT COMPLETE");
        console2.log("============================================================");
        console2.log("SOF Token:", sofTokenAddress);
        console2.log("Raffle:", raffleAddress);
        console2.log("SeasonFactory:", seasonFactoryAddress);
        console2.log("SOFBondingCurve:", bondingCurveAddress);
        console2.log("SOFFaucet:", sofFaucetAddress);
        console2.log("RafflePrizeDistributor:", prizeDistributorAddress);
        console2.log("============================================================");
    }
}
