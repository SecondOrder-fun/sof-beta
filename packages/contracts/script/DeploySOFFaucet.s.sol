// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/faucet/SOFFaucet.sol";

/**
 * @title DeploySOFFaucet
 * @dev Deploy SOFFaucet with correct configuration
 */
contract DeploySOFFaucet is Script {
    function run() external {
        // Get environment variables
        address sofTokenAddress = vm.envAddress("SOF_ADDRESS_TESTNET");

        console.log("DEPLOYING SOFFaucet");
        console.log("===================");
        console.log("SOF Token Address:", sofTokenAddress);
        console.log("Deployer:", msg.sender);

        vm.startBroadcast();

        // Configure allowed chain IDs: Anvil (31337) and Base Sepolia (84532)
        uint256[] memory allowedChainIds = new uint256[](2);
        allowedChainIds[0] = 31337; // Anvil
        allowedChainIds[1] = 84532; // Base Sepolia

        // Deploy faucet
        // amountPerRequest: 50,000 SOF (50000e18 wei)
        // cooldownPeriod: 6 hours (21600 seconds)
        SOFFaucet faucet = new SOFFaucet(
            sofTokenAddress,
            50_000 * 10 ** 18, // 50,000 SOF per request
            6 * 60 * 60, // 6 hour cooldown
            allowedChainIds
        );

        console.log("SOFFaucet deployed at:", address(faucet));
        console.log("Amount per request: 50,000 SOF");
        console.log("Cooldown period: 6 hours");
        console.log("Allowed chains: Anvil (31337), Base Sepolia (84532)");

        vm.stopBroadcast();
    }
}
